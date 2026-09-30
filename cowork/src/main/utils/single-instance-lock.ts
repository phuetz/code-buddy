import type { App } from 'electron';
import { logWarn } from './logger.js';

// Chromium 134 creates TMPDIR/scoped_dirXXXXXX/SingletonSocket. Linux's
// sockaddr_un.sun_path has 108 bytes including the terminating NUL. Its
// SetupSocket CHECK crashes the process (int3/ud2) before bind on overflow.
const SINGLETON_SOCKET_SUFFIX = '/scoped_dirXXXXXX/SingletonSocket';
const LINUX_SOCKET_PATH_BYTES = 108;

/** Acquire the real Electron lock with a socket path that fits the Linux ABI. */
export function requestSingleInstanceLock(
  app: Pick<App, 'requestSingleInstanceLock'>,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const originalTmpdir = process.env.TMPDIR;
  if (
    platform !== 'linux' ||
    originalTmpdir === undefined ||
    Buffer.byteLength(originalTmpdir.replace(/\/+$/, '') + SINGLETON_SOCKET_SUFFIX) <
      LINUX_SOCKET_PATH_BYTES
  ) {
    return app.requestSingleInstanceLock();
  }

  // Chromium reads getenv("TMPDIR") for this synchronous call; app.setPath
  // ('temp', ...) does not affect it. Keep the caller's temp policy everywhere
  // else and retain the native lock, cookie, second-instance events and cleanup.
  logWarn('[App] TMPDIR exceeds the Linux single-instance socket path limit; using /tmp for the lock socket');
  process.env.TMPDIR = '/tmp';
  try {
    return app.requestSingleInstanceLock();
  } finally {
    process.env.TMPDIR = originalTmpdir;
  }
}
