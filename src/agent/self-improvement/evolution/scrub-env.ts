/**
 * Env scrubbing (Phase C): build an environment with secret-looking variables removed, for running
 * an untrusted variant's deterministic fitness (typecheck/tests need no secrets). This closes the
 * audited gap where authored/variant code inherited the full host env (API keys, tokens) and could
 * exfiltrate them. NOTE: stochastic eval-tasks DO need a provider key — run those only in a trusted
 * context with keys passed explicitly, never with a scrubbed env.
 *
 * @module agent/self-improvement/evolution/scrub-env
 */

/**
 * A key is treated as secret if its NAME matches any of these (over-strip on
 * purpose). Beyond the obvious `*_KEY`/`*_TOKEN`, this also strips value-bearing
 * connection strings whose key name is innocuous — `DATABASE_URL`, `REDIS_URL`,
 * `MONGODB_URI`, `SUPABASE_URL` all embed credentials yet dodged the original
 * filter. The scrubbed env feeds only the deterministic fitness (typecheck +
 * tests), which needs no URLs, so stripping every `*_URL`/`*_URI` is safe.
 */
const SECRET_KEY_RE = new RegExp(
  '(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|API[_-]?KEY|_KEY$|ACCESS[_-]?KEY|PRIVATE|_DSN$|_PAT$|AUTH|SESSION|COOKIE' +
    '|_URL$|_URI$|CONNECTION|DATABASE|REDIS|MONGO|SUPABASE|POSTGRES|MYSQL|AMQP)',
  'i',
);

export interface ScrubOptions {
  /**
   * Redirect HOME/USERPROFILE to this dir. Env scrubbing alone does NOT stop a
   * variant from READING credential files by path (`~/.codebuddy/*.json`);
   * pointing HOME at a throwaway dir makes the real home unreachable so the
   * OAuth/token files there can't be read and exfiltrated during scoring.
   */
  homeDir?: string;
}

/** Return a copy of `base` with secret-looking keys removed, optionally with HOME redirected. */
export function scrubbedEnv(base: NodeJS.ProcessEnv = process.env, options: ScrubOptions = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (SECRET_KEY_RE.test(k)) continue;
    out[k] = v;
  }
  if (options.homeDir) {
    out.HOME = options.homeDir;
    out.USERPROFILE = options.homeDir;
  }
  return out;
}

/** The names that scrubbedEnv would strip from `base` (for logging / tests). */
export function strippedKeys(base: NodeJS.ProcessEnv = process.env): string[] {
  return Object.keys(base).filter((k) => SECRET_KEY_RE.test(k));
}
