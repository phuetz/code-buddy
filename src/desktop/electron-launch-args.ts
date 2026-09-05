/**
 * Chromium flags required to boot Cowork on a typical Linux source checkout.
 * Without them, Electron aborts on chrome-sandbox SUID and can freeze on
 * xrdp/VNC (see cowork/DEV-LINUX.md). `buddy gui` must pass these so the
 * documented launcher matches the documented flags.
 */

export function electronLaunchArgs(
  entryPoint: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === 'linux') {
    return ['--no-sandbox', '--disable-gpu', entryPoint];
  }
  return [entryPoint];
}
