/**
 * Web Push for the mobile PWA. Opt-in CODEBUDDY_MOBILE_PUSH=true.
 * VAPID keys live under ~/.codebuddy/push/ (0600). Sending uses an injected
 * transport in tests, or `web-push` when that package is installed.
 */

import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isLoopbackHost } from '../../security/dev-origins.js';
import { getSSRFGuard } from '../../security/ssrf-guard.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../../utils/atomic-write.js';
import { logger } from '../../utils/logger.js';

export function isMobilePushEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEBUDDY_MOBILE_PUSH === 'true';
}

export function resolvePushDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEBUDDY_PUSH_DIR?.trim();
  if (configured) return configured;
  return path.join(os.homedir(), '.codebuddy', 'push');
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
  createdAt?: number;
}

export const MAX_PUSH_SUBSCRIPTIONS_PER_IDENTITY = 5;

export type PushSender = (
  subscription: PushSubscriptionJSON,
  payload: { title: string; body: string },
  vapid: VapidKeys,
) => Promise<boolean>;

let testSender: PushSender | undefined;

export function setMobilePushSenderForTests(sender?: PushSender): void {
  testSender = sender;
}

function vapidPath(env: NodeJS.ProcessEnv): string {
  return path.join(resolvePushDir(env), 'vapid.json');
}

function identityDigest(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 32);
}

function identitySubsPath(userId: string, env: NodeJS.ProcessEnv): string | null {
  const id = userId.trim();
  if (!id) return null;
  return path.join(resolvePushDir(env), 'subscriptions', `${identityDigest(id)}.json`);
}

function ensurePushDir(env: NodeJS.ProcessEnv): void {
  const dir = resolvePushDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  mkdirSync(path.join(dir, 'subscriptions'), { recursive: true, mode: 0o700 });
}

export function loadOrCreateVapidKeys(env: NodeJS.ProcessEnv = process.env): VapidKeys | null {
  if (!isMobilePushEnabled(env)) return null;
  ensurePushDir(env);
  const file = vapidPath(env);
  const stored = readJsonAtomicSync<VapidKeys | null>(file, null, {
    mode: 0o600,
    isValid: (value): value is VapidKeys =>
      Boolean(
        value &&
          typeof value === 'object' &&
          typeof (value as VapidKeys).publicKey === 'string' &&
          typeof (value as VapidKeys).privateKey === 'string',
      ),
  });
  if (stored?.publicKey && stored.privateKey) return stored;
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const keys: VapidKeys = {
    publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'),
  };
  writeJsonAtomicSync(file, keys, { mode: 0o600 });
  return keys;
}

function loadSubscriptionsForIdentity(
  userId: string | undefined,
  env: NodeJS.ProcessEnv,
): PushSubscriptionJSON[] {
  const file = userId ? identitySubsPath(userId, env) : null;
  if (!file || !existsSync(file)) return [];
  const stored = readJsonAtomicSync<{ subscriptions: PushSubscriptionJSON[] } | null>(file, null, {
    mode: 0o600,
    isValid: (value): value is { subscriptions: PushSubscriptionJSON[] } =>
      Boolean(value && typeof value === 'object' && Array.isArray((value as { subscriptions?: unknown }).subscriptions)),
  });
  return stored?.subscriptions ?? [];
}

function writeSubscriptionsForIdentity(
  userId: string,
  list: PushSubscriptionJSON[],
  env: NodeJS.ProcessEnv,
): void {
  const file = identitySubsPath(userId, env);
  if (!file) return;
  ensurePushDir(env);
  writeJsonAtomicSync(file, { subscriptions: list }, { mode: 0o600 });
}

function isBlockedPushHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (isLoopbackHost(h)) return true;
  if (h === 'local' || h.endsWith('.local')) return true;
  return false;
}

/** https only + public host via the shared SSRF guard. Fail-closed. */
export async function isPublicHttpsPushEndpoint(raw: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (isBlockedPushHostname(parsed.hostname)) return false;
  try {
    const check = await getSSRFGuard().isSafeUrl(parsed.toString());
    return check.safe === true;
  } catch {
    return false;
  }
}

export async function savePushSubscription(
  sub: PushSubscriptionJSON,
  userId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!isMobilePushEnabled(env)) return false;
  const id = (userId ?? '').trim();
  if (!id) return false;
  const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint.trim() : '';
  if (!endpoint.startsWith('https://')) return false;
  if (!(await isPublicHttpsPushEndpoint(endpoint))) return false;
  const now = Date.now();
  const list = loadSubscriptionsForIdentity(id, env).filter((item) => item.endpoint !== endpoint);
  list.push({
    endpoint,
    keys: {
      p256dh: String(sub.keys?.p256dh || ''),
      auth: String(sub.keys?.auth || ''),
    },
    createdAt: now,
  });
  list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  writeSubscriptionsForIdentity(id, list.slice(-MAX_PUSH_SUBSCRIPTIONS_PER_IDENTITY), env);
  return true;
}

export function deletePushSubscription(
  userId: string | undefined,
  endpoint: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isMobilePushEnabled(env)) return false;
  const id = (userId ?? '').trim();
  if (!id) return false;
  const target = endpoint.trim();
  if (!target.startsWith('https://')) return false;
  const list = loadSubscriptionsForIdentity(id, env).filter((item) => item.endpoint !== target);
  writeSubscriptionsForIdentity(id, list, env);
  return true;
}

async function defaultWebPushSend(
  subscription: PushSubscriptionJSON,
  payload: { title: string; body: string },
  vapid: VapidKeys,
): Promise<boolean> {
  try {
    // Optional runtime dependency (MIT). Absent in this tree on purpose.
    const webpush = await import('web-push' as string) as {
      setVapidDetails: (mailto: string, pub: string, priv: string) => void;
      sendNotification: (sub: PushSubscriptionJSON, payload: string) => Promise<unknown>;
    };
    webpush.setVapidDetails('mailto:mobile@localhost', vapid.publicKey, vapid.privateKey);
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    logger.warn('[mobile-push] send failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function sendMobilePush(
  payload: { title: string; body: string },
  deps: { send?: PushSender; env?: NodeJS.ProcessEnv; userId?: string } = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  if (!isMobilePushEnabled(env)) return 0;
  const userId = (deps.userId ?? '').trim();
  if (!userId) return 0;
  const vapid = loadOrCreateVapidKeys(env);
  if (!vapid) return 0;
  const subs = loadSubscriptionsForIdentity(userId, env);
  const send = deps.send ?? testSender ?? defaultWebPushSend;
  let sent = 0;
  for (const sub of subs) {
    try {
      if (await send(sub, payload, vapid)) sent += 1;
    } catch {
      /* never throw */
    }
  }
  return sent;
}
