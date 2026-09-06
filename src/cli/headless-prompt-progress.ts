/**
 * TTY-only wait indicator for `buddy -p` while the local model is still
 * evaluating the prompt (no token yet).
 */

export interface HeadlessPromptProgressIo {
  isTTY?: boolean;
}

export interface HeadlessPromptProgressWriter {
  write: (chunk: string) => void;
}

export function shouldShowHeadlessPromptProgress(
  env: NodeJS.ProcessEnv = process.env,
  stdout: HeadlessPromptProgressIo = process.stdout,
): boolean {
  if (env.CODEBUDDY_HEADLESS !== 'true') return false;
  if (env.CODEBUDDY_QUIET === 'true' || env.CODEBUDDY_QUIET === '1') return false;
  return stdout.isTTY === true;
}

export function formatHeadlessPromptProgress(elapsedSeconds: number): string {
  return `évaluation du prompt… (${Math.max(0, Math.round(elapsedSeconds))} s)\n`;
}

export function startHeadlessPromptProgress(options?: {
  env?: NodeJS.ProcessEnv;
  stdout?: HeadlessPromptProgressIo;
  stderr?: HeadlessPromptProgressWriter;
  now?: () => number;
  intervalMs?: number;
}): { onFirstToken: () => void; stop: () => void } {
  const env = options?.env ?? process.env;
  const stdout = options?.stdout ?? process.stdout;
  if (!shouldShowHeadlessPromptProgress(env, stdout)) {
    return { onFirstToken() {}, stop() {} };
  }
  const write = options?.stderr?.write.bind(options.stderr)
    ?? ((chunk: string) => { process.stderr.write(chunk); });
  const now = options?.now ?? Date.now;
  const started = now();
  const intervalMs = options?.intervalMs ?? 10_000;
  const tick = (): void => {
    const seconds = (now() - started) / 1000;
    write(formatHeadlessPromptProgress(seconds));
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  const stop = (): void => { clearInterval(timer); };
  return { onFirstToken: stop, stop };
}
