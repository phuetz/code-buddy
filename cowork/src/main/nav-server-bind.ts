import type { Server } from 'http';

export const NAV_PORT = 19888;
export const NAV_PORT_ATTEMPTS = 10;

export function navPortCandidates(
  startPort = NAV_PORT,
  attempts = NAV_PORT_ATTEMPTS,
): number[] {
  return Array.from({ length: attempts }, (_, index) => startPort + index);
}

/**
 * Bind `server` on `startPort`, then startPort+1, … if EADDRINUSE.
 * Rejects when every candidate is taken or a non-EADDRINUSE error occurs.
 */
export function listenOnFreePort(
  server: Server,
  host: string,
  startPort = NAV_PORT,
  attempts = NAV_PORT_ATTEMPTS,
): Promise<number> {
  const candidates = navPortCandidates(startPort, attempts);
  return new Promise((resolve, reject) => {
    let index = 0;

    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && index < candidates.length - 1) {
        index += 1;
        server.listen(candidates[index], host);
        return;
      }
      cleanup();
      reject(error);
    };

    const onListening = () => {
      cleanup();
      resolve(candidates[index] as number);
    };

    function cleanup() {
      server.off('error', onError);
      server.off('listening', onListening);
    }

    server.on('error', onError);
    server.on('listening', onListening);
    server.listen(candidates[0], host);
  });
}
