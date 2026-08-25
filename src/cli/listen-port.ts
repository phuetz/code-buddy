/**
 * Validate `--port` before the HTTP server tries to listen.
 * Node's Server.listen(NaN) / listen(-1) throws a RangeError stack; we want
 * the received value and the accepted range instead.
 */

export const LISTEN_PORT_MIN = 1;
export const LISTEN_PORT_MAX = 65535;

export function parseListenPort(value: string): number {
  const trimmed = value.trim();
  const range = `${LISTEN_PORT_MIN}–${LISTEN_PORT_MAX}`;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`--port must be an integer between ${range} (received ${JSON.stringify(value)})`);
  }
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < LISTEN_PORT_MIN || port > LISTEN_PORT_MAX) {
    throw new Error(`--port must be an integer between ${range} (received ${JSON.stringify(value)})`);
  }
  return port;
}
