/**
 * Fleet — privacy lint (Fleet P8).
 *
 * Pre-dispatch scan to flag prompts that LIKELY contain secrets
 * before they leave the local machine. The router's privacyTag
 * defaults to `'public'` — when the lint flags a prompt as risky,
 * the dispatcher should bump it to `'sensitive'` (vetoes cloud
 * peers) or block outright depending on user preference.
 *
 * The lint is a heuristic: it errs on the side of false positives.
 * The user always has the final say (Cowork modal "found secret —
 * keep, redact, or downgrade?").
 *
 * @module fleet/privacy-lint
 */

export type PrivacyMatchKind =
  | 'env-key'           // API keys (sk-…, AKIA…, AIza…, ghp_…, etc.)
  | 'private-path'      // /home/<user>, C:\Users\<u>, /Users/<u>
  | 'dotenv-block'      // multi-line block starting with KEY=VALUE
  | 'jwt'               // 3-segment dot-separated base64 token
  | 'aws-secret-key'    // 40-char base64 secret
  | 'private-key-pem'   // BEGIN PRIVATE KEY / OPENSSH / RSA blocks
  | 'pii-ssn'           // US SSN (xxx-xx-xxxx), FR NIR (15 digits)
  | 'pii-iban'          // IBAN (FR, BE, DE, ES, IT, NL, ...)
  | 'pii-phone'         // phone numbers FR / E.164 international
  | 'pii-credit-card';  // Visa/MC/Amex/Discover with Luhn check

export interface PrivacyMatch {
  kind: PrivacyMatchKind;
  /** Where in the prompt the match was found (chars). */
  start: number;
  end: number;
  /** Short snippet for the UI, with the match itself partially redacted. */
  preview: string;
}

export interface PrivacyLintResult {
  matches: PrivacyMatch[];
  /** True when any match was found — caller should treat as sensitive. */
  hasSecrets: boolean;
  /** True when the matches strongly suggest secrets (e.g., real-looking
      API key prefixes, BEGIN PRIVATE KEY, etc.). Cowork can block
      cloud dispatch entirely instead of just downgrading. */
  highConfidence: boolean;
}

/**
 * Patterns to detect. Order matters — we run them sequentially and
 * dedup by overlapping range.
 */
const PATTERNS: Array<{
  kind: PrivacyMatchKind;
  regex: RegExp;
  highConfidence: boolean;
}> = [
  // PEM private keys are unambiguous.
  {
    kind: 'private-key-pem',
    regex:
      /-----BEGIN (?:RSA |OPENSSH |EC |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |OPENSSH |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/g,
    highConfidence: true,
  },
  // Common API-key prefixes — these are high-confidence and
  // shouldn't appear in any code that's not configured.
  {
    kind: 'env-key',
    // OpenAI sk-, Anthropic sk-ant-, Google AIza, GitHub ghp_, Slack xoxb,
    // Stripe sk_live_, Vercel vc_, Anthropic AUTH_TOKEN sk-ant-…
    regex:
      /(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ghp_[A-Za-z0-9]{36}|xox[bp]-[A-Za-z0-9-]{10,}|sk_live_[A-Za-z0-9]{24,}|vc_[A-Za-z0-9]{32,})/g,
    highConfidence: true,
  },
  // JWTs — three base64-url segments dot-separated.
  {
    kind: 'jwt',
    regex:
      /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    highConfidence: true,
  },
  // .env-style block — ≥2 KEY=VALUE on consecutive lines.
  {
    kind: 'dotenv-block',
    regex:
      /(?:^|\n)\s*([A-Z_][A-Z0-9_]{2,})\s*=\s*['"]?([^\n'"]+)['"]?(?:\r?\n\s*([A-Z_][A-Z0-9_]{2,})\s*=\s*['"]?([^\n'"]+)['"]?)+/g,
    highConfidence: false,
  },
  // AWS secret access key — 40 chars of base64.
  {
    kind: 'aws-secret-key',
    regex: /\b[A-Za-z0-9+/]{40}\b/g,
    highConfidence: false,
  },
  // Private user paths.
  {
    kind: 'private-path',
    regex:
      /(?:\/home\/[a-zA-Z0-9._-]+|\/Users\/[a-zA-Z0-9._-]+|C:\\Users\\[a-zA-Z0-9._-]+)/g,
    highConfidence: false,
  },
  // PII — US Social Security Numbers (xxx-xx-xxxx, not all-zero blocks).
  // Word-boundary anchored so it doesn't fire on arbitrary digit groups.
  {
    kind: 'pii-ssn',
    regex: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    highConfidence: true,
  },
  // PII — IBAN (2 letters country + 2 check digits + up to 30 alnum).
  // Accepted spellings: contiguous or grouped in 4. We normalise away
  // spaces below in the test, the regex matches both forms.
  {
    kind: 'pii-iban',
    regex:
      /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g,
    highConfidence: false,
  },
  // PII — phone numbers. E.164 (+ then 8-15 digits, optional spaces),
  // or French national format (0[1-9] + 8 digits with optional spaces).
  {
    kind: 'pii-phone',
    regex:
      /(?:\+\d{1,3}[\s.-]?(?:\d[\s.-]?){7,14}\d|\b0[1-9](?:[\s.-]?\d{2}){4}\b)/g,
    highConfidence: false,
  },
  // PII — credit card numbers (Visa/MC/Amex/Discover/JCB/Diners). Luhn
  // check applied after the regex matches to reduce false positives on
  // arbitrary 13-19 digit strings.
  {
    kind: 'pii-credit-card',
    regex:
      /\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13}|6(?:011|5\d{2})\d{12}|(?:2131|1800|35\d{3})\d{11})\b/g,
    highConfidence: true,
  },
];

/**
 * Luhn (mod 10) checksum — used to validate that a digit run looks
 * like a real credit card before we flag it. Returns true on valid
 * cards. Keeps the credit-card pattern from drowning users in false
 * positives on long alphanumeric strings that happen to start with 4 / 5.
 */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Scan a prompt for secrets. Returns matches with previews.
 */
export function scanForSecrets(prompt: string): PrivacyLintResult {
  const matches: PrivacyMatch[] = [];
  const seen: Array<[number, number]> = [];
  let highConfidence = false;

  for (const { kind, regex, highConfidence: hc } of PATTERNS) {
    // Reset lastIndex for each fresh match — patterns are stateful.
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(prompt)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const matched = m[0];
      // Skip if this range overlaps with an earlier (higher priority) match.
      if (seen.some(([s, e]) => start < e && end > s)) continue;
      // Credit-card pattern: filter through Luhn to drop arbitrary
      // digit runs that just happened to start with 4 or 5.
      if (kind === 'pii-credit-card' && !luhnValid(matched.replace(/\D/g, ''))) {
        continue;
      }
      seen.push([start, end]);
      if (hc) highConfidence = true;
      matches.push({
        kind,
        start,
        end,
        preview: redactPreview(prompt, start, end),
      });
    }
  }

  return {
    matches,
    hasSecrets: matches.length > 0,
    highConfidence,
  };
}

/**
 * Build a ~80-char preview centered on the match, with the match
 * itself partially redacted ("sk-...xxxxx").
 */
function redactPreview(text: string, start: number, end: number): string {
  const before = text.slice(Math.max(0, start - 30), start);
  const matched = text.slice(start, end);
  const after = text.slice(end, Math.min(text.length, end + 30));
  const redacted =
    matched.length <= 8
      ? '****'
      : matched.slice(0, 4) + '…[redacted]…' + matched.slice(-4);
  return `${before}${redacted}${after}`.replace(/\s+/g, ' ').trim();
}

/**
 * Replace every secret/PII match with a `[REDACTED:<kind>]` marker.
 *
 * Run this on FULL text before any truncation — cutting a PEM block (or
 * any multi-line secret) in half can hide it from the patterns above.
 * Used by every memory-persistence path (WS3 guard-rail).
 */
export function redactSecrets(text: string): string {
  const lint = scanForSecrets(text);
  if (!lint.hasSecrets) return text;
  let out = '';
  let cursor = 0;
  for (const match of [...lint.matches].sort((a, b) => a.start - b.start)) {
    if (match.start < cursor) continue; // overlapping match already covered
    out += text.slice(cursor, match.start) + `[REDACTED:${match.kind}]`;
    cursor = match.end;
  }
  out += text.slice(cursor);
  return out;
}
