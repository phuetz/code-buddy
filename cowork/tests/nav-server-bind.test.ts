import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { listenOnFreePort, navPortCandidates, NAV_PORT } from '../src/main/nav-server-bind';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
});

function occupy(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const occupier = http.createServer();
    occupier.once('error', reject);
    occupier.listen(port, '127.0.0.1', () => resolve(occupier));
  });
}

describe('nav-server port fallback', () => {
  it('walks a short range starting at the documented Native Engine port', () => {
    expect(navPortCandidates()[0]).toBe(NAV_PORT);
    expect(navPortCandidates()).toEqual([
      19888, 19889, 19890, 19891, 19892, 19893, 19894, 19895, 19896, 19897,
    ]);
  });

  it('listens on the next port when the preferred one is taken', async () => {
    const occupier = await occupy(0);
    servers.push(occupier);
    const address = occupier.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected a TCP address');
    }
    const taken = address.port;
    const server = http.createServer();
    servers.push(server);
    const bound = await listenOnFreePort(server, '127.0.0.1', taken, 3);
    expect(bound).toBe(taken + 1);
    expect((server.address() as { port: number }).port).toBe(taken + 1);
  });
});
