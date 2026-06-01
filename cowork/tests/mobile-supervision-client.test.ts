import { describe, expect, it, vi } from 'vitest';
import {
  fetchMobileSupervision,
  approveFollowupDraft,
  cancelFollowupDraft,
  loopbackBaseUrl,
} from '../src/main/server/mobile-supervision-client';

function fakeFetch(routes: Record<string, { ok?: boolean; status?: number; body: unknown }>) {
  return vi.fn(async (url: string, init?: { method?: string }) => {
    const key = `${init?.method ?? 'GET'} ${url.replace(/^http:\/\/127\.0\.0\.1:\d+/, '')}`;
    const r = routes[key];
    if (!r) throw new Error(`unexpected ${key}`);
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body };
  });
}

describe('mobile-supervision-client', () => {
  it('returns not-running when the server is down', async () => {
    const snap = await fetchMobileSupervision(null, false, fakeFetch({}));
    expect(snap).toEqual({ running: false, port: null });
  });

  it('reads pairing code + devices + drafts when running', async () => {
    const fetchImpl = fakeFetch({
      'GET /api/mobile/pairing-status': { body: { ok: true, pairingCode: '123456', activeDevices: ['phone'] } },
      'GET /api/mobile/followup-drafts': {
        body: { ok: true, drafts: [{ id: 'd1', prompt: 'do X', status: 'needs_local_operator', source: 'mobile_device', createdAt: 1 }] },
      },
    });
    const snap = await fetchMobileSupervision(3000, true, fetchImpl);
    expect(snap.pairingCode).toBe('123456');
    expect(snap.devices).toEqual(['phone']);
    expect(snap.drafts).toHaveLength(1);
    expect(snap.error).toBeUndefined();
  });

  it('preserves mobile pairing and draft limits for Cowork visibility', async () => {
    const fetchImpl = fakeFetch({
      'GET /api/mobile/pairing-status': {
        body: { ok: true, pairingCode: '123456', activeDevices: ['phone', 'tablet'], activeDeviceLimit: 20 },
      },
      'GET /api/mobile/followup-drafts': {
        body: {
          ok: true,
          drafts: [{ id: 'd1', prompt: 'do X', status: 'needs_local_operator', source: 'mobile_device', createdAt: 1 }],
          counts: { needs_local_operator: 1, approved: 2, cancelled: 3 },
          limits: { maxPendingDrafts: 100, maxResolvedDrafts: 100 },
        },
      },
    });
    const snap = await fetchMobileSupervision(3000, true, fetchImpl);
    expect(snap.activeDeviceLimit).toBe(20);
    expect(snap.draftCounts).toEqual({ needs_local_operator: 1, approved: 2, cancelled: 3 });
    expect(snap.draftLimits).toEqual({ maxPendingDrafts: 100, maxResolvedDrafts: 100 });
  });

  it('surfaces a gateway error without throwing', async () => {
    const fetchImpl = fakeFetch({
      'GET /api/mobile/pairing-status': { ok: false, status: 403, body: { ok: false, error: 'loopback required' } },
      'GET /api/mobile/followup-drafts': { body: { ok: true, drafts: [] } },
    });
    const snap = await fetchMobileSupervision(3000, true, fetchImpl);
    expect(snap.running).toBe(true);
    expect(snap.error).toContain('loopback');
  });

  it('approve posts the reviewer to the loopback approve route', async () => {
    const fetchImpl = fakeFetch({
      'POST /api/mobile/followup-draft/d1/approve': { body: { ok: true, draft: { id: 'd1', status: 'approved' } } },
    });
    const res = await approveFollowupDraft(3000, 'd1', 'patrice', fetchImpl);
    expect((res.draft as { status: string }).status).toBe('approved');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/mobile/followup-draft/d1/approve',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('cancel posts to the cancel route', async () => {
    const fetchImpl = fakeFetch({
      'POST /api/mobile/followup-draft/d1/cancel': { body: { ok: true, draft: { id: 'd1', status: 'cancelled' } } },
    });
    const res = await cancelFollowupDraft(3000, 'd1', fetchImpl);
    expect((res.draft as { status: string }).status).toBe('cancelled');
  });

  it('builds a loopback base url (never a LAN host)', () => {
    expect(loopbackBaseUrl(3001)).toBe('http://127.0.0.1:3001');
  });
});
