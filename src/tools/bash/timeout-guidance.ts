/** Shared model-facing guidance for bounded foreground shell execution. */
export const BASH_TIMEOUT_DESCRIPTION =
  'Command timeout in milliseconds (1 to 600000, default: 30000). For long tests or builds, set a larger timeout and keep the command in the foreground.';

export function formatCommandTimeout(timeout: number, backend?: string): string {
  return `Command timed out after ${timeout}ms${backend ? `\n[sandbox:${backend}]` : ''}\nFor a longer command, retry with the timeout parameter (maximum 600000 ms), keeping execution in the foreground.`;
}
