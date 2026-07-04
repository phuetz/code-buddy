/**
 * `pairing.*` IPC — the DM pairing / allowlist surface ("who is allowed to DM
 * the agent"), branching onto the core `DMPairingManager`
 * (`src/channels/dm-pairing.ts`). The allowlist is file-backed
 * (`~/.codebuddy/credentials/<type>-allowFrom.json`), so the GUI (a separate
 * process from a running `buddy server`) manages the SAME persisted allowlist:
 * we `loadAllowlist()` before every read and the mutating ops persist to disk.
 *
 *   - `pairing.status`      — stats roll-up (enabled + approved/pending/blocked counts).
 *   - `pairing.list`        — the persisted allowlist (approved senders).
 *   - `pairing.pending`     — pending requests + their codes. NB: pending lives
 *     in-memory in whichever process runs the channel intake, so from the GUI's
 *     own process this is typically empty (documented cross-process caveat).
 *   - `pairing.approve`     — approve a pending request BY CODE (+ persist).
 *   - `pairing.approveDirect` — add a sender straight to the allowlist (+ persist).
 *   - `pairing.revoke`      — revoke a sender (+ persist).
 *
 * The core module loads lazily via loadCoreModule (never bundled). All handlers
 * never-throw: an unavailable core module degrades to a clean `{ ok: false }`.
 *
 * @module main/ipc/pairing-ipc
 */

import { ipcMain } from 'electron';
import { loadCoreModule } from '../utils/core-loader';
import { logError } from '../utils/logger';

interface ApprovedSenderRaw {
  channelType: string;
  senderId: string;
  displayName?: string;
  approvedAt: Date | string;
  approvedBy: string;
  notes?: string;
}
interface PendingRequestRaw {
  code: string;
  channelType: string;
  senderId: string;
  displayName?: string;
  messageExcerpt?: string;
  createdAt: Date | string;
  expiresAt: Date | string;
  attempts: number;
}
interface PairingStatsRaw {
  enabled: boolean;
  totalApproved: number;
  totalPending: number;
  totalBlocked: number;
  approvedByChannel: Record<string, number>;
}
interface DMPairingManagerLike {
  loadAllowlist: () => Promise<void>;
  persistAllowlist: () => Promise<void>;
  listApproved: () => ApprovedSenderRaw[];
  listPending: () => PendingRequestRaw[];
  approve: (channelType: string, code: string, approvedBy?: string) => ApprovedSenderRaw | null;
  approveDirectly: (channelType: string, senderId: string, approvedBy?: string, displayName?: string) => ApprovedSenderRaw;
  revoke: (channelType: string, senderId: string) => boolean;
  getStats: () => PairingStatsRaw;
}
interface PairingModule {
  getDMPairing: (config?: unknown) => DMPairingManagerLike;
}

// Renderer-facing DTOs — Dates normalised to ISO strings.
export interface ApprovedSenderView {
  channelType: string;
  senderId: string;
  displayName?: string;
  approvedAt: string;
  approvedBy: string;
  notes?: string;
}
export interface PendingRequestView {
  code: string;
  channelType: string;
  senderId: string;
  displayName?: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
}
export interface PairingStatusResult {
  ok: boolean;
  error?: string;
  enabled: boolean;
  totalApproved: number;
  totalPending: number;
  totalBlocked: number;
  approvedByChannel: Record<string, number>;
}
export interface PairingListResult {
  ok: boolean;
  error?: string;
  approved: ApprovedSenderView[];
}
export interface PairingPendingResult {
  ok: boolean;
  error?: string;
  pending: PendingRequestView[];
}
export interface PairingMutationResult {
  ok: boolean;
  error?: string;
  approved?: ApprovedSenderView | null;
  revoked?: boolean;
}

function isValidType(type: unknown): type is string {
  return typeof type === 'string' && /^[a-z][a-z0-9-]{1,40}$/.test(type);
}

function toIso(v: Date | string | undefined): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? String(v) : parsed.toISOString();
}

function toApprovedView(s: ApprovedSenderRaw): ApprovedSenderView {
  const view: ApprovedSenderView = {
    channelType: s.channelType,
    senderId: s.senderId,
    approvedAt: toIso(s.approvedAt),
    approvedBy: s.approvedBy,
  };
  if (s.displayName) view.displayName = s.displayName;
  if (s.notes) view.notes = s.notes;
  return view;
}

function toPendingView(r: PendingRequestRaw): PendingRequestView {
  const view: PendingRequestView = {
    code: r.code,
    channelType: r.channelType,
    senderId: r.senderId,
    createdAt: toIso(r.createdAt),
    expiresAt: toIso(r.expiresAt),
    attempts: typeof r.attempts === 'number' ? r.attempts : 0,
  };
  if (r.displayName) view.displayName = r.displayName;
  return view;
}

/** Get the singleton, refreshed from the persisted allowlist on disk. */
async function loadPairing(): Promise<DMPairingManagerLike | null> {
  const mod = await loadCoreModule<PairingModule>('channels/dm-pairing.js');
  if (!mod?.getDMPairing) return null;
  const mgr = mod.getDMPairing();
  try {
    await mgr.loadAllowlist();
  } catch (error) {
    logError('[pairing] loadAllowlist failed:', error);
  }
  return mgr;
}

export function registerPairingIpcHandlers(): void {
  ipcMain.handle('pairing.status', async (): Promise<PairingStatusResult> => {
    try {
      const mgr = await loadPairing();
      if (!mgr) {
        return { ok: false, error: 'pairing core unavailable', enabled: false, totalApproved: 0, totalPending: 0, totalBlocked: 0, approvedByChannel: {} };
      }
      const s = mgr.getStats();
      return {
        ok: true,
        enabled: s.enabled === true,
        totalApproved: s.totalApproved ?? 0,
        totalPending: s.totalPending ?? 0,
        totalBlocked: s.totalBlocked ?? 0,
        approvedByChannel: s.approvedByChannel ?? {},
      };
    } catch (error) {
      logError('[pairing.status] failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error), enabled: false, totalApproved: 0, totalPending: 0, totalBlocked: 0, approvedByChannel: {} };
    }
  });

  ipcMain.handle('pairing.list', async (): Promise<PairingListResult> => {
    try {
      const mgr = await loadPairing();
      if (!mgr) return { ok: false, error: 'pairing core unavailable', approved: [] };
      return { ok: true, approved: mgr.listApproved().map(toApprovedView) };
    } catch (error) {
      logError('[pairing.list] failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error), approved: [] };
    }
  });

  ipcMain.handle('pairing.pending', async (): Promise<PairingPendingResult> => {
    try {
      const mgr = await loadPairing();
      if (!mgr) return { ok: false, error: 'pairing core unavailable', pending: [] };
      return { ok: true, pending: mgr.listPending().map(toPendingView) };
    } catch (error) {
      logError('[pairing.pending] failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error), pending: [] };
    }
  });

  ipcMain.handle('pairing.approve', async (_event, channelType: unknown, code: unknown, approvedBy?: unknown): Promise<PairingMutationResult> => {
    if (!isValidType(channelType)) return { ok: false, error: 'invalid channel type' };
    if (typeof code !== 'string' || !code.trim()) return { ok: false, error: 'code must be a non-empty string' };
    try {
      const mgr = await loadPairing();
      if (!mgr) return { ok: false, error: 'pairing core unavailable' };
      const approved = mgr.approve(channelType, code.trim(), typeof approvedBy === 'string' ? approvedBy : undefined);
      if (!approved) return { ok: false, error: 'no matching pending request for that code', approved: null };
      await mgr.persistAllowlist();
      return { ok: true, approved: toApprovedView(approved) };
    } catch (error) {
      logError('[pairing.approve] failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    'pairing.approveDirect',
    async (_event, channelType: unknown, senderId: unknown, approvedBy?: unknown, displayName?: unknown): Promise<PairingMutationResult> => {
      if (!isValidType(channelType)) return { ok: false, error: 'invalid channel type' };
      if (typeof senderId !== 'string' || !senderId.trim()) return { ok: false, error: 'senderId must be a non-empty string' };
      try {
        const mgr = await loadPairing();
        if (!mgr) return { ok: false, error: 'pairing core unavailable' };
        const approved = mgr.approveDirectly(
          channelType,
          senderId.trim(),
          typeof approvedBy === 'string' ? approvedBy : undefined,
          typeof displayName === 'string' ? displayName : undefined,
        );
        await mgr.persistAllowlist();
        return { ok: true, approved: toApprovedView(approved) };
      } catch (error) {
        logError('[pairing.approveDirect] failed:', error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  ipcMain.handle('pairing.revoke', async (_event, channelType: unknown, senderId: unknown): Promise<PairingMutationResult> => {
    if (!isValidType(channelType)) return { ok: false, error: 'invalid channel type' };
    if (typeof senderId !== 'string' || !senderId.trim()) return { ok: false, error: 'senderId must be a non-empty string' };
    try {
      const mgr = await loadPairing();
      if (!mgr) return { ok: false, error: 'pairing core unavailable' };
      const revoked = mgr.revoke(channelType, senderId.trim());
      await mgr.persistAllowlist();
      return { ok: true, revoked };
    } catch (error) {
      logError('[pairing.revoke] failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
