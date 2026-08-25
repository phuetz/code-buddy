/**
 * Subprocess environment filtering.
 *
 * Child processes should not inherit provider keys, tokens, JWTs, or private
 * service credentials by default. Callers can add explicit, non-secret runtime
 * variables through `extraEnv`.
 */

export interface FilteredSubprocessEnvOptions {
  sourceEnv?: NodeJS.ProcessEnv;
  allowEnv?: readonly string[];
  denyEnv?: readonly string[];
  extraEnv?: Record<string, string | undefined>;
}

const SAFE_ENV_KEYS = new Set([
  'PATH',
  'Path',
  'HOME',
  'USER',
  'USERNAME',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TERM_PROGRAM',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'PWD',
  'OLDPWD',
  'SHLVL',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'CI',
  'CONTINUOUS_INTEGRATION',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'XDG_RUNTIME_DIR',
  'XDG_CACHE_HOME',
  'EDITOR',
  'VISUAL',
  'PAGER',
  'LESS',
  // NOTE sécurité : PYTHONPATH / LD_LIBRARY_PATH / DYLD_LIBRARY_PATH sont
  // VOLONTAIREMENT absents — substitution de module Python ou de bibliothèque
  // partagée dans les sous-processus (mêmes vecteurs que NODE_PATH). Ils sont
  // dans BLOCKED_ENV_VARS (src/security/env-blocklist.ts). Un appelant qui en a
  // réellement besoin le passe explicitement via `allowEnv`/`extraEnv`.
  // Voir tests/security/pythonpath-injection.test.ts.
  'PYTHONIOENCODING',
  'VIRTUAL_ENV',
  'CUDA_VISIBLE_DEVICES',
  'OMP_NUM_THREADS',
  'MKL_NUM_THREADS',
  'HF_HOME',
  'TRANSFORMERS_CACHE',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'GIT_TERMINAL_PROMPT',
  'NPM_CONFIG_YES',
  'YARN_ENABLE_PROGRESS_BARS',
  'DEBIAN_FRONTEND',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
]);

const SECRET_NAME_PATTERN =
  /(^|_)(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|AUTH|DATABASE_URL|DSN|COOKIE|SESSION)($|_)/i;

const SECRET_VALUE_PATTERNS = [
  /^sk-[a-zA-Z0-9_-]{20,}$/,
  /^xai-[a-zA-Z0-9_-]{20,}$/,
  /^gh[pousr]_[a-zA-Z0-9_]{30,}$/,
  /^github_pat_/i,
  /^AKIA[A-Z0-9]{16}$/,
  /^npm_[a-zA-Z0-9]{20,}$/,
  /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/,
  /^[a-f0-9]{64}$/i,
  /^-----BEGIN [A-Z ]*PRIVATE KEY-----/m,
];

function sanitizeEnvValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, '');
}

function isValidEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key === 'Path';
}

export function isSecretLikeEnv(key: string, value: string): boolean {
  return SECRET_NAME_PATTERN.test(key) || SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

export function buildFilteredSubprocessEnv(
  options: FilteredSubprocessEnvOptions = {},
): NodeJS.ProcessEnv {
  const sourceEnv = options.sourceEnv ?? process.env;
  const allowed = new Set([...SAFE_ENV_KEYS, ...(options.allowEnv ?? [])]);
  const denied = new Set(options.denyEnv ?? []);
  const env: NodeJS.ProcessEnv = {};

  for (const key of allowed) {
    if (denied.has(key)) continue;
    const value = sourceEnv[key];
    if (value === undefined || !isValidEnvKey(key) || isSecretLikeEnv(key, value)) continue;
    env[key] = sanitizeEnvValue(value);
  }

  for (const [key, value] of Object.entries(options.extraEnv ?? {})) {
    if (value === undefined || denied.has(key) || !isValidEnvKey(key) || SECRET_NAME_PATTERN.test(key)) continue;
    env[key] = sanitizeEnvValue(value);
  }

  return env;
}
