/**
 * Env scrubbing (Phase C): build an environment with secret-looking variables removed, for running
 * an untrusted variant's deterministic fitness (typecheck/tests need no secrets). This closes the
 * audited gap where authored/variant code inherited the full host env (API keys, tokens) and could
 * exfiltrate them. NOTE: stochastic eval-tasks DO need a provider key — run those only in a trusted
 * context with keys passed explicitly, never with a scrubbed env.
 *
 * @module agent/self-improvement/evolution/scrub-env
 */

/** A key is treated as secret if its NAME matches any of these (over-strip on purpose). */
const SECRET_KEY_RE = new RegExp(
  '(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|API[_-]?KEY|_KEY$|ACCESS[_-]?KEY|PRIVATE|_DSN$|_PAT$|AUTH|SESSION|COOKIE)',
  'i',
);

/** Return a copy of `base` with secret-looking keys removed. Keeps PATH, HOME, NODE_ vars, etc. */
export function scrubbedEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (SECRET_KEY_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/** The names that scrubbedEnv would strip from `base` (for logging / tests). */
export function strippedKeys(base: NodeJS.ProcessEnv = process.env): string[] {
  return Object.keys(base).filter((k) => SECRET_KEY_RE.test(k));
}
