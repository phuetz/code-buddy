/**
 * Secret Scrubber
 *
 * Centralised, hot-path-safe redaction of secrets from any text that is about
 * to leave the process: logs, Sentry events, OTEL span attributes, breadcrumbs.
 *
 * Design goals:
 * - ONE source of truth for known token shapes — reuses `SECRET_PATTERNS` from
 *   `secrets-detector.ts` (the static scanner) plus a handful of runtime-only
 *   formats (OpenAI/Anthropic `sk-…`, generic `Bearer …`, full PEM blocks,
 *   broader Slack tokens).
 * - PERF: the logger is extremely hot, so a single fast `SENTINEL_RE.test()`
 *   short-circuits every string that carries no tell-tale secret prefix. On the
 *   overwhelmingly common secret-free line the cost is one regex test.
 * - Idempotent: scrub(scrub(x)) === scrub(x). Placeholders carry no secret body.
 * - Never-throws: any regex/traversal error returns the original value.
 * - Reference-preserving: a value with nothing to redact comes back byte- AND
 *   reference-identical, so structured logs / span attrs are untouched (no false
 *   positives, no needless allocation).
 */

import { SECRET_PATTERNS } from './secret-patterns.js';

// ============================================================================
// Fast-path sentinel
// ============================================================================

/**
 * Ultra-cheap pre-check. If none of these tell-tale prefixes appear, the string
 * cannot contain any secret we recognise, so we return immediately without
 * running the (comparatively expensive) pattern battery.
 */
const SENTINEL_RE =
  /sk-|sk_|xai-|gsk_|npm_|xox|AKIA|ghp_|github_pat_|glpat-|AIza|-----BEGIN|Bearer |eyJ/;

// ============================================================================
// Scrub patterns
// ============================================================================

interface ScrubPattern {
  /** Global-flagged regex (required for String.replace to redact every hit). */
  regex: RegExp;
  /** Static placeholder OR a `Bearer …`-style prefixed replacement. */
  replacement: string;
}

/** Ensure a regex has the global flag (needed to replace all occurrences). */
function globalize(re: RegExp): RegExp {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  return new RegExp(re.source, flags);
}

/**
 * Self-identifying types from the static scanner that are safe to redact
 * globally at runtime (no context anchor, negligible false-positive rate).
 * Context-anchored types (aws_secret, password_in_code, connection_string,
 * generic_api_key) are intentionally excluded — they need a surrounding
 * assignment to be meaningful and would over-match in free-form log prose.
 */
const REUSED_PLACEHOLDER: Record<string, string> = {
  aws_key: '[REDACTED:aws_key]',
  github_token: '[REDACTED:github_token]',
  gitlab_token: '[REDACTED:gitlab_token]',
  slack_token: '[REDACTED:slack_token]',
  stripe_key: '[REDACTED:stripe_key]',
  google_api_key: '[REDACTED:google_api_key]',
  jwt_secret: '[REDACTED:jwt]',
  private_key: '[REDACTED:private_key]',
};

// Reused straight from the shared pattern leaf — same regex source, made global.
const REUSED: ScrubPattern[] = SECRET_PATTERNS.filter(
  (p) => p.type in REUSED_PLACEHOLDER,
).map((p) => ({
  regex: globalize(p.pattern),
  replacement: REUSED_PLACEHOLDER[p.type]!,
}));

/**
 * Runtime-only formats not covered (or only partially covered) by the static
 * scanner. Ordered strong→weak; the full PEM block MUST precede the header-only
 * reused pattern so an entire private key is redacted, not just its `BEGIN`
 * line. `sk-ant-` / `sk-proj-` precede the generic `sk-` for accurate labels.
 *
 * The `(?<![A-Za-z0-9-])` look-behind anchors `sk-` at a boundary so ordinary
 * words ("risk-management-…", "task-oriented-…") are never mistaken for keys.
 */
const ADDED: ScrubPattern[] = [
  // Whole PEM private-key block (redact body, not just the header line).
  {
    regex: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED:private_key]',
  },
  // Anthropic API key.
  {
    regex: /(?<![A-Za-z0-9-])sk-ant-[A-Za-z0-9_-]{20,}/g,
    replacement: '[REDACTED:anthropic_key]',
  },
  // OpenAI project-scoped key.
  {
    regex: /(?<![A-Za-z0-9-])sk-proj-[A-Za-z0-9_-]{20,}/g,
    replacement: '[REDACTED:openai_key]',
  },
  // OpenRouter API key.
  {
    regex: /(?<![A-Za-z0-9-])sk-or-v1-[A-Za-z0-9_-]{20,}/g,
    replacement: '[REDACTED:openrouter_key]',
  },
  // xAI API key.
  {
    regex: /(?<![A-Za-z0-9-])xai-[A-Za-z0-9_-]{20,}/g,
    replacement: '[REDACTED:xai_key]',
  },
  // Groq API key.
  {
    regex: /(?<![A-Za-z0-9_])gsk_[A-Za-z0-9_-]{20,}/g,
    replacement: '[REDACTED:groq_key]',
  },
  // npm access token.
  {
    regex: /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9_])/g,
    replacement: '[REDACTED:npm_token]',
  },
  // OpenAI classic secret key (alphanumeric body — no internal hyphen).
  {
    regex: /(?<![A-Za-z0-9-])sk-[A-Za-z0-9]{20,}/g,
    replacement: '[REDACTED:openai_key]',
  },
  // Slack app/refresh tokens beyond xox[bpors] (xoxa, xoxr, …).
  {
    regex: /xox[a-z]-[A-Za-z0-9-]{10,}/g,
    replacement: '[REDACTED:slack_token]',
  },
  // Generic long Bearer token — keep the scheme, drop the credential.
  {
    regex: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
    replacement: 'Bearer [REDACTED:bearer_token]',
  },
];

// Full pattern list: ADDED (strong→weak) first so the full PEM block and the
// specific sk-ant-/sk-proj- keys win before the reused header-only / generic ones.
const SCRUB_PATTERNS: ScrubPattern[] = [...ADDED, ...REUSED];

/** Bound recursion so a cyclic / pathological object can never hang. */
const MAX_DEPTH = 6;

// ============================================================================
// Public API
// ============================================================================

/**
 * Redact every recognised secret in `text`. Secret-free input is returned
 * unchanged (value-identical). Never throws.
 */
export function scrubSecrets(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    // Fast path: no tell-tale prefix ⇒ nothing to do.
    if (!SENTINEL_RE.test(text)) return text;

    let out = text;
    for (const { regex, replacement } of SCRUB_PATTERNS) {
      regex.lastIndex = 0; // defensive — global regexes are module-shared
      out = out.replace(regex, replacement);
    }
    return out;
  } catch {
    // A malformed input or engine hiccup must never break logging/telemetry.
    return text;
  }
}

/**
 * Recursively scrub all string descendants of an arbitrary value (object,
 * array, or primitive). Depth-bounded, never-throws. Returns the SAME reference
 * when nothing was redacted, so secret-free structured payloads are untouched.
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  try {
    if (typeof value === 'string') return scrubSecrets(value);
    if (value === null || typeof value !== 'object') return value;
    if (depth >= MAX_DEPTH) return value;

    if (Array.isArray(value)) {
      let changed = false;
      const out = value.map((item) => {
        const s = scrubValue(item, depth + 1);
        if (s !== item) changed = true;
        return s;
      });
      return changed ? out : value;
    }

    // Plain-ish object: walk own enumerable string/array/object props.
    const src = value as Record<string, unknown>;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) {
      const v = src[key];
      const s = scrubValue(v, depth + 1);
      if (s !== v) changed = true;
      out[key] = s;
    }
    return changed ? out : value;
  } catch {
    return value;
  }
}
