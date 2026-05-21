export const CONTROLLED_SUBPROCESS_ENV: Record<string, string> = {
  HISTFILE: '/dev/null',
  HISTSIZE: '0',
  CI: 'true',
  NO_COLOR: '1',
  TERM: 'dumb',
  NO_TTY: '1',
  GIT_TERMINAL_PROMPT: '0',
  NPM_CONFIG_YES: 'true',
  YARN_ENABLE_PROGRESS_BARS: 'false',
  LC_ALL: 'C.UTF-8',
  LANG: 'C.UTF-8',
  PYTHONIOENCODING: 'utf-8',
  DEBIAN_FRONTEND: 'noninteractive',
};

function quoteForBash(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildBashEnvPrelude(
  env: Record<string, string> = CONTROLLED_SUBPROCESS_ENV,
): string {
  return Object.entries(env)
    .map(([key, value]) => `export ${key}=${quoteForBash(value)}`)
    .join('; ');
}
