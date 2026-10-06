/**
 * Secret Scrubber
 *
 * Centralised, hot-path-safe redaction of secrets from any text that is about
 * to leave the process: logs, Sentry events, OTEL span attributes, breadcrumbs,
 * audit JSONL, run journals, session exports, and `buddy run show` timelines.
 *
 * Design goals:
 * - ONE source of truth for known token shapes — reuses `SECRET_PATTERNS` from
 *   `secret-patterns.ts` (the static scanner) plus a handful of runtime-only
 *   formats (OpenAI/Anthropic `sk-…`, xAI `xai-…`, generic `Bearer …`, full PEM
 *   blocks, broader Slack tokens) and exact values of sensitive environment
 *   variables (fail-closed for keys passed via env that may not match a shape).
 * - PERF: the logger is extremely hot, so a single fast `SENTINEL_RE.test()`
 *   short-circuits every string that carries no tell-tale secret prefix AND no
 *   remembered env secret. On the overwhelmingly common secret-free line the
 *   cost is one regex test (+ a cheap env-fingerprint check).
 * - Idempotent: scrub(scrub(x)) === scrub(x). Placeholders carry no secret body.
 * - Fail-closed: any regex/traversal error returns a redaction placeholder,
 *   NEVER the original value (availability of the log line is worth less than
 *   leaking a credential).
 * - Reference-preserving: a value with nothing to redact comes back byte- AND
 *   reference-identical, so structured logs / span attrs are untouched (no false
 *   positives, no needless allocation).
 */

import { SECRET_PATTERNS } from './secret-patterns.js';

// ============================================================================
// Fail-closed placeholder
// ============================================================================

const SCRUB_ERROR_PLACEHOLDER = '[REDACTED:scrub_error]';

// ============================================================================
// Fast-path sentinel
// ============================================================================

/**
 * Ultra-cheap pre-check. If none of these tell-tale prefixes appear AND no
 * remembered env secret is present, the string cannot contain any secret we
 * recognise, so we return immediately without running the pattern battery.
 *
 * MUST stay in sync with every prefix covered by SCRUB_PATTERNS / SECRET_PATTERNS
 * self-identifying types — a missing prefix is a silent fail-open hole
 * (historically: `xai-` leaked through logger + audit JSONL).
 */
const SENTINEL_RE =
  /sk-|sk_|xai-|xox|AKIA|ghp_|github_pat_|glpat-|AIza|hf_|dop_v1_|SG\.|npm_|pypi-|sb_(?:secret|publishable)_|vc[piark]_|AccountKey=|-----BEGIN|Bearer |Basic |:\/\/[^\s@\/]*:[^\s@\/]*@|eyJ|(?:SK|AC)[0-9a-fA-F]{32}/i;

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
 * generic_api_key, cloudflare_token) are intentionally excluded — they need a
 * surrounding assignment to be meaningful and would over-match in free-form
 * log prose. Those still get caught when their value is also present in a
 * sensitive environment variable (see `getEnvSecretValues`).
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
  anthropic_key: '[REDACTED:anthropic_key]',
  openai_key: '[REDACTED:openai_key]',
  xai_key: '[REDACTED:xai_key]',
  huggingface_token: '[REDACTED:huggingface_token]',
  digitalocean_token: '[REDACTED:digitalocean_token]',
  sendgrid_key: '[REDACTED:sendgrid_key]',
  npm_token: '[REDACTED:npm_token]',
  pypi_token: '[REDACTED:pypi_token]',
  twilio_key: '[REDACTED:twilio_key]',
  vercel_token: '[REDACTED:vercel_token]',
  supabase_key: '[REDACTED:supabase_key]',
  azure_key: '[REDACTED:azure_key]',
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
 * The `(?<![A-Za-z0-9-])` look-behind anchors `sk-` / `xai-` at a boundary so
 * ordinary words ("risk-management-…", "task-oriented-…") are never mistaken
 * for keys.
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
  // OpenAI classic secret key (alphanumeric body — no internal hyphen).
  {
    regex: /(?<![A-Za-z0-9-])sk-[A-Za-z0-9]{20,}/g,
    replacement: '[REDACTED:openai_key]',
  },
  // xAI (Grok) API key — historically missing from this scrubber (sentinel +
  // pattern gap); kept here as well as via REUSED so the label is stable even
  // if SECRET_PATTERNS ordering changes.
  {
    regex: /(?<![A-Za-z0-9-])xai-[A-Za-z0-9_-]{20,}/gi,
    replacement: '[REDACTED:xai_key]',
  },
  // GitHub classic PAT — open-ended length so trailing body chars cannot leak
  // when a slightly-too-long token is logged (fail-closed vs exact {36}).
  {
    regex: /ghp_[a-zA-Z0-9]{36,}/g,
    replacement: '[REDACTED:github_token]',
  },
  {
    regex: /github_pat_[a-zA-Z0-9_]{82,}/g,
    replacement: '[REDACTED:github_token]',
  },
  // Slack app/refresh tokens beyond xox[bpors] (xoxa, xoxr, …).
  {
    regex: /xox[a-z]-[A-Za-z0-9-]{10,}/g,
    replacement: '[REDACTED:slack_token]',
  },
  // Generic long Bearer token — keep the scheme, drop the credential (any case).
  {
    regex: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
    replacement: 'Bearer [REDACTED:bearer_token]',
  },
  // HTTP Basic credentials in an Authorization header (base64 of user:password).
  {
    regex: /(Authorization["']?\s*[:=]\s*["']?)Basic\s+[A-Za-z0-9+/]{6,}={0,2}/gi,
    replacement: '$1Basic [REDACTED:basic_auth]',
  },
  // Password inside a URL: scheme://user:password@host (postgres, https, redis, amqp, ...).
  {
    regex: /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:@\/]*:)[^\s@\/]+(@)/g,
    replacement: '$1[REDACTED:url_password]$2',
  },
];

// Full pattern list: ADDED (strong→weak) first so the full PEM block and the
// specific sk-ant-/sk-proj-/xai- keys win before the reused header-only / generic ones.
const SCRUB_PATTERNS: ScrubPattern[] = [...ADDED, ...REUSED];

/** Bound recursion so a cyclic / pathological object can never hang. */
const MAX_DEPTH = 6;

// ============================================================================
// Sensitive environment values (fail-closed for env-passed keys)
// ============================================================================

/**
 * Env var names that typically carry credentials. Exact values are remembered
 * and replaced even when they do not match a known token shape (e.g. a custom
 * opaque secret). Kept deliberately name-based so ordinary PATH / HOME / LANG
 * values are never treated as secrets.
 */
const SENSITIVE_ENV_NAME_RE =
  /(?:API_?KEY|ACCESS_?KEY|SECRET(?:_?KEY)?|PASSWORD|PASSWD|PASSPHRASE|(?:AUTH_?|ACCESS_?|REFRESH_?|BOT_?|SESSION_?|API_?)?TOKEN|PRIVATE_?KEY|SERVICE_?ROLE_?KEY|CLIENT_?SECRET|CREDENTIALS?|CONNECTION_?STRING|DATABASE_?URL|AWS_ACCESS_KEY_ID)$/i;

let envCacheFingerprint = '';
let envCacheValues: string[] = [];
/** Names of env vars that were sensitive at the last full scan (their VALUES are re-read each call). */
let envSensitiveNames: string[] = [];

/**
 * Cheap invalidation: the env key names (a variable added, removed or renamed) plus
 * the CURRENT VALUES of the sensitive variables found at the last scan, so a
 * rotated token of the same length is noticed. The values are only compared as
 * strings, never logged or stored beyond the cache.
 */
function envFingerprint(): string {
  // Key NAMES (a variable added/removed/renamed, even with the same count) ...
  let fp = Object.keys(process.env).join('\u0001');
  for (const name of envSensitiveNames) fp += `\u0000${process.env[name] ?? ''}`;
  return fp;
}

function getEnvSecretValues(): string[] {
  const fp = envFingerprint();
  if (fp === envCacheFingerprint) return envCacheValues;
  const values: string[] = [];
  const names: string[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (!SENSITIVE_ENV_NAME_RE.test(name)) continue;
    names.push(name);
    if (!value || value.length < 8) continue;
    // Skip obvious non-secrets (booleans, tiny flags, file paths without entropy).
    if (/^(true|false|1|0|yes|no)$/i.test(value)) continue;
    values.push(value);
  }
  envSensitiveNames = names;
  envCacheFingerprint = envFingerprint();
  envCacheValues = values;
  return values;
}

/** Test/helper: drop the environment cache (does not clear process.env). */
export function clearRememberedSecrets(): void {
  envCacheFingerprint = '';
  envCacheValues = [];
  envSensitiveNames = [];
}

function redactExactValues(text: string, values: Iterable<string>): string {
  let out = text;
  for (const value of values) {
    if (!value || value.length < 8) continue;
    if (!out.includes(value)) continue;
    // Split/join avoids RegExp special-char issues in the secret body.
    out = out.split(value).join('[REDACTED:env_secret]');
  }
  return out;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Redact every recognised secret in `text`. Secret-free input is returned
 * unchanged (value-identical). Never throws. Fail-closed on internal errors.
 */
export function scrubSecrets(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    const envSecrets = getEnvSecretValues();
    const hasRemembered = envSecrets.length > 0;

    // Fast path: no tell-tale prefix AND no remembered/env secret ⇒ nothing to do.
    if (!SENTINEL_RE.test(text)) {
      if (!hasRemembered) return text;
      // Still may need exact-value redaction even without a known prefix.
      return redactExactValues(text, envSecrets);
    }

    let out = text;
    for (const { regex, replacement } of SCRUB_PATTERNS) {
      regex.lastIndex = 0; // defensive — global regexes are module-shared
      out = out.replace(regex, replacement);
    }
    if (hasRemembered) {
      out = redactExactValues(out, envSecrets);
    }
    return out;
  } catch {
    // Fail-closed: never return the original text after a scrub failure.
    return SCRUB_ERROR_PLACEHOLDER;
  }
}

/**
 * Recursively scrub all string descendants of an arbitrary value (object,
 * array, or primitive). Depth-bounded, never-throws, fail-closed. Returns the
 * SAME reference when nothing was redacted, so secret-free structured payloads
 * are untouched.
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
    // Fail-closed: collapse the unsafe payload rather than leaking it.
    return SCRUB_ERROR_PLACEHOLDER;
  }
}
