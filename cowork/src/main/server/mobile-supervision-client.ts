/**
 * Mobile supervision loopback client (S6).
 *
 * The mobile gateway (`src/server/routes/mobile.ts`) is supervision-only: a
 * paired phone can read snapshots and *propose* prompts, but those land as
 * `needs_local_operator` review drafts that NEVER auto-execute. Approval is a
 * local-operator-only (loopback) action.
 *
 * Cowork is the local operator. When the embedded Code Buddy server is running,
 * Cowork's main process is on loopback relative to it, so it can read the
 * pairing code + follow-up queue and approve/cancel drafts through the same
 * loopback-gated routes. These pure helpers take an injected `fetch` so they
 * unit-test without a live server. Approval here remains a review marker — it
 * does not dispatch work (the route guarantees that).
 *
 * @module main/server/mobile-supervision-client
 */

export interface FollowupDraft {
  id: string;
  prompt: string;
  status: 'needs_local_operator' | 'approved' | 'cancelled';
  source: 'mobile_device' | 'draft_only';
  createdAt: number;
  approvedBy?: string;
  approvedAt?: number;
  cancelledAt?: number;
}

export interface MobileSupervisionSnapshot {
  running: boolean;
  port: number | null;
  pairingCode?: string;
  devices?: string[];
  activeDeviceLimit?: number;
  drafts?: FollowupDraft[];
  draftCounts?: {
    needs_local_operator: number;
    approved: number;
    cancelled: number;
  };
  draftLimits?: {
    maxPendingDrafts: number;
    maxResolvedDrafts: number;
  };
  error?: string;
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export function loopbackBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url);
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok || body?.ok === false) {
    throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`);
  }
  return body;
}

async function postJson(
  fetchImpl: FetchLike,
  url: string,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok || body?.ok === false) {
    throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`);
  }
  return body;
}

/** Read the pairing code + devices + follow-up review queue from the gateway. */
export async function fetchMobileSupervision(
  port: number | null,
  running: boolean,
  fetchImpl: FetchLike,
): Promise<MobileSupervisionSnapshot> {
  if (!running || port == null) {
    return { running: false, port: null };
  }
  const base = loopbackBaseUrl(port);
  try {
    const [pairing, drafts] = await Promise.all([
      getJson(fetchImpl, `${base}/api/mobile/pairing-status`),
      getJson(fetchImpl, `${base}/api/mobile/followup-drafts`),
    ]);
    return {
      running: true,
      port,
      pairingCode: typeof pairing.pairingCode === 'string' ? pairing.pairingCode : undefined,
      devices: Array.isArray(pairing.activeDevices) ? (pairing.activeDevices as string[]) : [],
      activeDeviceLimit: typeof pairing.activeDeviceLimit === 'number' ? pairing.activeDeviceLimit : undefined,
      drafts: Array.isArray(drafts.drafts) ? (drafts.drafts as FollowupDraft[]) : [],
      draftCounts: isDraftCounts(drafts.counts) ? drafts.counts : undefined,
      draftLimits: isDraftLimits(drafts.limits) ? drafts.limits : undefined,
    };
  } catch (err) {
    return { running: true, port, error: err instanceof Error ? err.message : String(err) };
  }
}

function isDraftCounts(value: unknown): value is MobileSupervisionSnapshot['draftCounts'] {
  if (!value || typeof value !== 'object') return false;
  const counts = value as Record<string, unknown>;
  return (
    typeof counts.needs_local_operator === 'number'
    && typeof counts.approved === 'number'
    && typeof counts.cancelled === 'number'
  );
}

function isDraftLimits(value: unknown): value is MobileSupervisionSnapshot['draftLimits'] {
  if (!value || typeof value !== 'object') return false;
  const limits = value as Record<string, unknown>;
  return (
    typeof limits.maxPendingDrafts === 'number'
    && typeof limits.maxResolvedDrafts === 'number'
  );
}

/** Local-operator approve. Review marker only — never dispatches work. */
export function approveFollowupDraft(port: number, id: string, reviewer: string | undefined, fetchImpl: FetchLike) {
  return postJson(fetchImpl, `${loopbackBaseUrl(port)}/api/mobile/followup-draft/${encodeURIComponent(id)}/approve`, {
    reviewer: reviewer?.trim() || undefined,
  });
}

export function cancelFollowupDraft(port: number, id: string, fetchImpl: FetchLike) {
  return postJson(fetchImpl, `${loopbackBaseUrl(port)}/api/mobile/followup-draft/${encodeURIComponent(id)}/cancel`);
}

/** Rotate the pairing code (local-operator only). */
export function rotatePairingCode(port: number, fetchImpl: FetchLike) {
  return postJson(fetchImpl, `${loopbackBaseUrl(port)}/api/mobile/pairing-code`);
}
