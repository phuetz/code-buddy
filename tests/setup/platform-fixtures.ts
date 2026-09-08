import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';

/** Probe Bash itself: a Windows bash.exe may be an unusable WSL launcher. */
export function hasBash(): boolean {
  return spawnSync('bash', ['-c', 'exit 0'], { timeout: 5_000 }).status === 0;
}

/** Never execute a .sh directly: Windows does not interpret its shebang. */
export function spawnBashScript(
  script: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
) {
  return spawnSync('bash', [script.replace(/\\/g, '/'), ...args.map((arg) =>
    /^[A-Za-z]:[\\/]/.test(arg) ? arg.replace(/\\/g, '/') : arg)], options);
}

/** DISPLAY is a Linux contract; select that backend even on desktop CI hosts. */
export function forceLinuxWithoutDisplay(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...descriptor, value: 'linux' });
  const display = process.env.DISPLAY;
  const wayland = process.env.WAYLAND_DISPLAY;
  delete process.env.DISPLAY;
  delete process.env.WAYLAND_DISPLAY;
  return () => {
    Object.defineProperty(process, 'platform', descriptor);
    if (display === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = display;
    if (wayland === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = wayland;
  };
}
