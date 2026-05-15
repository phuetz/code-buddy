export const SUDO_COMMAND_COMPLETED_WITH_NO_OUTPUT = 'Command completed successfully with no output.';

export function finalizeSudoCommandOutput(
  stdout: string,
  stderr: string,
  code: number | null,
  signal: NodeJS.Signals | null
): string {
  const output = stdout + stderr;
  if (code !== 0) {
    const exitReason = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`;
    const details = output.trim() ? `: ${output.trim()}` : '';
    throw new Error(`Sudo command failed with ${exitReason}${details}`);
  }
  return output || SUDO_COMMAND_COMPLETED_WITH_NO_OUTPUT;
}
