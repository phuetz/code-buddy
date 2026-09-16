import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const envRef = z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$/);
const schema = z.record(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/), z.object({
  url: z.string().optional(), inboundTokenEnv: envRef.optional(), outboundTokenEnv: envRef.optional(),
}).strict());
export type A2APeers = z.infer<typeof schema>;

export function readA2APeers(raw = process.env.CODEBUDDY_A2A_PEERS): A2APeers {
  if (!raw) return {};
  try {
    if (raw.length > 16384) throw new Error();
    const result = schema.parse(JSON.parse(raw));
    if (Object.keys(result).length > 32) throw new Error();
    for (const peer of Object.values(result)) if (peer.url) validateA2AUrl(peer.url);
    return result;
  } catch { throw new Error('Invalid CODEBUDDY_A2A_PEERS configuration (URLs and environment references only)'); }
}
export function validateA2AUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid configured A2A URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('A2A requires HTTPS or loopback HTTP, without URL credentials/query/fragment');
  }
  return url;
}
export function a2aToken(reference?: string): string | undefined {
  const value = reference ? process.env[reference] : undefined;
  return value && value.length >= 16 && value.length <= 16384 && !/[\r\n]/.test(value) ? value : undefined;
}
export function authenticateA2APeer(peers: A2APeers, authorization?: string): string | undefined {
  if (!authorization?.startsWith('Bearer ') || authorization.length > 16400) return undefined;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  const presented = hash(authorization.slice(7));
  const matches = Object.entries(peers).filter(([, config]) => {
    const token = a2aToken(config.inboundTokenEnv);
    return token && timingSafeEqual(hash(token), presented);
  });
  // Duplicate credentials are ambiguous identities; fail closed.
  return matches.length === 1 ? matches[0]?.[0] : undefined;
}
