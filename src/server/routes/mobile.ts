import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { logger } from '../../utils/logger.js';
import { buildMobileSupervisionGatewayContract } from '../../observability/mobile-supervision-gateway-contract.js';
import { buildMobileSupervisionSnapshot } from '../../observability/mobile-supervision-snapshot.js';
import { buildMobileSupervisionGatewayReviewDraft } from '../../observability/mobile-supervision-gateway-policy.js';
import { getActiveRunStore } from '../../observability/run-store.js';
import { buildRunRecallPackAsync } from '../../observability/run-recall-pack.js';

export const mobileRouter = Router();

const DEFAULT_PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
const MAX_PAIRING_CODE_TTL_MS = 15 * 60 * 1000;
const MIN_PAIRING_CODE_TTL_MS = 50;
const MAX_DEVICE_LABEL_CHARS = 120;

/** Mint a fresh 6-digit pairing code with a CSPRNG (never the literal default). */
function generatePairingCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

function getPairingCodeTtlMs(): number {
  const configured = Number(process.env.CODEBUDDY_MOBILE_PAIRING_CODE_TTL_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_PAIRING_CODE_TTL_MS;
  }
  return Math.min(MAX_PAIRING_CODE_TTL_MS, Math.max(MIN_PAIRING_CODE_TTL_MS, Math.floor(configured)));
}

// In-memory store for active pairing code and tokens. The code is randomized at
// module load — there is no static default that a LAN host could guess.
export let activePairingCode = generatePairingCode();
export let activePairingCodeExpiresAt = Date.now() + getPairingCodeTtlMs();
export const activeTokens = new Map<string, { deviceLabel: string; expiresAt: number }>();

function rotatePairingCode(): string {
  let nextCode = generatePairingCode();
  while (nextCode === activePairingCode) {
    nextCode = generatePairingCode();
  }
  activePairingCode = nextCode;
  activePairingCodeExpiresAt = Date.now() + getPairingCodeTtlMs();
  return activePairingCode;
}

function ensureActivePairingCodeFresh(): void {
  if (Date.now() > activePairingCodeExpiresAt) {
    rotatePairingCode();
  }
}

/**
 * A follow-up prompt review draft. The mobile device (or a draft-only call) can
 * *propose* a prompt, but it never executes: it lands here as
 * `needs_local_operator` and only a local operator (loopback) can `approve` or
 * `cancel` it. Approval is a review-gate marker — it records who/when but never
 * dispatches work, matching the gateway contract's `autoDispatch:false` /
 * `remoteExecutionDisabled:true` invariants.
 */
export type FollowupDraftStatus = 'needs_local_operator' | 'approved' | 'cancelled';

export interface FollowupDraft {
  id: string;
  prompt: string;
  status: FollowupDraftStatus;
  source: 'mobile_device' | 'draft_only';
  createdAt: number;
  approvedBy?: string;
  approvedAt?: number;
  cancelledAt?: number;
  [key: string]: unknown;
}

export const followupDrafts: FollowupDraft[] = [];

function pruneExpiredTokens(now = Date.now()): void {
  for (const [token, tokenData] of activeTokens) {
    if (now > tokenData.expiresAt) {
      activeTokens.delete(token);
    }
  }
}

// Helper to check if a token is valid
function isValidToken(token: string): boolean {
  pruneExpiredTokens();
  const tokenData = activeTokens.get(token);
  return !!tokenData;
}

/**
 * Decide whether a request originates from the loopback interface. We read the
 * raw socket address (`req.socket.remoteAddress`) on purpose: `req.ip` and the
 * `X-Forwarded-For` header are caller-controlled and therefore spoofable, while
 * the kernel-reported socket peer address is not. Dual-stack listeners surface
 * IPv4 loopback as the IPv4-mapped IPv6 form `::ffff:127.0.0.1`.
 */
export function isLoopbackRequest(req: Request): boolean {
  const addr = req.socket?.remoteAddress ?? '';
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr.startsWith('127.') ||
    addr.startsWith('::ffff:127.')
  );
}

/**
 * Local-operator-only guard. The pairing code is a bearer-equivalent secret —
 * reading or rotating it must never be possible from another host, even one on
 * the same LAN. The mobile listener's contract pins it to `loopback_only`
 * (`mobile-supervision-gateway-listener-shell.ts`), and the main server may bind
 * a non-loopback host, so we enforce loopback per-route here rather than relying
 * on the listen address.
 */
export function loopbackOnlyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isLoopbackRequest(req)) {
    logger.warn('mobileRouter: rejected non-loopback access to local-operator endpoint', {
      path: req.path,
      remoteAddress: req.socket?.remoteAddress,
    });
    res.status(403).json({
      ok: false,
      error: 'Forbidden: this endpoint is local-operator-only (loopback access required)',
    });
    return;
  }
  next();
}

function isPathInsideDirectory(rootDir: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootDir), path.resolve(candidatePath));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRequiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'string' ? value.trim() : null;
}

function isWithinCharLimit(value: string, maxChars: number): boolean {
  return Array.from(value).length <= maxChars;
}

// Authentication middleware for /api/mobile endpoints
export function mobileAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ ok: false, error: 'Unauthorized: Missing or invalid token format' });
    return;
  }
  const token = authHeader.substring(7).trim();
  if (!isValidToken(token)) {
    res.status(401).json({ ok: false, error: 'Unauthorized: Invalid or expired pairing token' });
    return;
  }
  next();
}

// Pairing status (retrieved by local operator dashboard/CLI only — loopback gated)
mobileRouter.get('/pairing-status', loopbackOnlyMiddleware, (req: Request, res: Response) => {
  pruneExpiredTokens();
  ensureActivePairingCodeFresh();
  res.json({
    ok: true,
    pairingCode: activePairingCode,
    pairingCodeExpiresAt: activePairingCodeExpiresAt,
    pairingCodeTtlSeconds: Math.ceil(Math.max(0, activePairingCodeExpiresAt - Date.now()) / 1000),
    activeDevices: Array.from(activeTokens.values()).map(d => d.deviceLabel),
  });
});

// Generate new pairing code (local operator only — loopback gated)
mobileRouter.post('/pairing-code', loopbackOnlyMiddleware, (req: Request, res: Response) => {
  rotatePairingCode();
  res.json({
    ok: true,
    pairingCode: activePairingCode,
    pairingCodeExpiresAt: activePairingCodeExpiresAt,
    pairingCodeTtlSeconds: Math.ceil(Math.max(0, activePairingCodeExpiresAt - Date.now()) / 1000),
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Follow-up review queue — local-operator (loopback) approve/cancel/list.
// These are deliberately mounted BEFORE the bearer-token auth middleware: the
// review actions belong to the local operator on the host, not to a paired
// mobile device. A device can only *propose* (via /submit-prompt below); it
// can never approve its own request.
// ──────────────────────────────────────────────────────────────────────────

// GET /api/mobile/followup-drafts: local operator lists the review queue.
mobileRouter.get('/followup-drafts', loopbackOnlyMiddleware, (req: Request, res: Response) => {
  res.json({ ok: true, drafts: followupDrafts });
});

// POST /api/mobile/followup-draft/:id/approve: local operator approves a draft.
// Approval is a review-gate marker only — it NEVER dispatches or executes work.
mobileRouter.post('/followup-draft/:id/approve', loopbackOnlyMiddleware, (req: Request, res: Response) => {
  const draft = followupDrafts.find((d) => d.id === req.params.id);
  if (!draft) {
    res.status(404).json({ ok: false, error: 'Draft not found' });
    return;
  }
  if (draft.status !== 'needs_local_operator') {
    res.status(409).json({ ok: false, error: `Draft is not pending approval (status: ${draft.status})` });
    return;
  }
  const reviewer = typeof req.body?.reviewer === 'string' && req.body.reviewer.trim()
    ? req.body.reviewer.trim()
    : 'local-operator';
  draft.status = 'approved';
  draft.approvedBy = reviewer;
  draft.approvedAt = Date.now();
  res.json({
    ok: true,
    message: 'Draft approved by local operator. No work is dispatched automatically — execution stays local and explicit.',
    draft,
  });
});

// POST /api/mobile/followup-draft/:id/cancel: local operator cancels a draft.
mobileRouter.post('/followup-draft/:id/cancel', loopbackOnlyMiddleware, (req: Request, res: Response) => {
  const draft = followupDrafts.find((d) => d.id === req.params.id);
  if (!draft) {
    res.status(404).json({ ok: false, error: 'Draft not found' });
    return;
  }
  if (draft.status !== 'needs_local_operator') {
    res.status(409).json({ ok: false, error: `Draft is not pending (status: ${draft.status})` });
    return;
  }
  draft.status = 'cancelled';
  draft.cancelledAt = Date.now();
  res.json({ ok: true, message: 'Draft cancelled by local operator.', draft });
});

// 1. POST /api/mobile/pair: Validate pairing request and issue short-lived token
mobileRouter.post('/pair', (req: Request, res: Response) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  const deviceLabel = typeof req.body?.deviceLabel === 'string' ? req.body.deviceLabel.trim() : '';
  if (!code || !deviceLabel || !isWithinCharLimit(deviceLabel, MAX_DEVICE_LABEL_CHARS)) {
    res.status(400).json({ ok: false, error: 'Missing or invalid code or deviceLabel' });
    return;
  }
  ensureActivePairingCodeFresh();
  if (code !== activePairingCode) {
    res.status(401).json({ ok: false, error: 'Invalid pairing code' });
    return;
  }

  // Mint a short-lived token (15 mins = 900s)
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 900 * 1000;
  activeTokens.set(token, { deviceLabel, expiresAt });
  rotatePairingCode();

  res.json({
    ok: true,
    token,
    scopes: ['mobile:read', 'mobile:draft'],
    expiresAt,
  });
});

// Apply mobile auth middleware to all remaining routes
mobileRouter.use(mobileAuthMiddleware);

// 2. GET /api/mobile/snapshot: Return active run snapshot summary
mobileRouter.get('/snapshot', async (req: Request, res: Response) => {
  try {
    const query = (req.query.query as string) || '';
    const snapshot = await buildMobileSupervisionSnapshot(query, { includeAllContext: true });
    res.json({ ok: true, snapshot });
  } catch (err) {
    logger.error('mobileRouter: failed to get snapshot', err as Error);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// 3. GET /api/mobile/runs/:runId/artifacts/:artifactPath: Return file content/metadata for path artifact
mobileRouter.get('/runs/:runId/artifacts/*artifactPath', async (req: Request, res: Response) => {
  try {
    const { runId } = req.params;
    let artifactPath = req.params.artifactPath;
    if (Array.isArray(artifactPath)) {
      artifactPath = artifactPath.join('/');
    }
    if (!runId || !artifactPath) {
      res.status(400).json({ ok: false, error: 'Missing runId or artifactPath' });
      return;
    }

    const runStore = getActiveRunStore();
    if (!runStore) {
      res.status(500).json({ ok: false, error: 'RunStore not initialized' });
      return;
    }
    const runDir = path.join(runStore.getRunsDir(), String(runId));
    if (!fs.existsSync(runDir)) {
      res.status(404).json({ ok: false, error: 'Run not found' });
      return;
    }

    const artifactDir = path.resolve(runDir, 'artifacts');
    const filePath = path.resolve(artifactDir, String(artifactPath));

    // Safety check: ensure file is inside the artifact folder (prevent directory traversal)
    if (!isPathInsideDirectory(artifactDir, filePath)) {
      res.status(403).json({ ok: false, error: 'Access denied: Path traversal detected' });
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ ok: false, error: 'Artifact file not found' });
      return;
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      res.status(400).json({ ok: false, error: 'Target path is not a file' });
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({
      ok: true,
      metadata: {
        name: path.basename(filePath),
        size: stat.size,
        mtime: stat.mtimeMs,
      },
      content,
    });
  } catch (err) {
    logger.error('mobileRouter: failed to open artifact', err as Error);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// 4. GET /api/mobile/recall-pack: Render active recall pack prompt
mobileRouter.get('/recall-pack', async (req: Request, res: Response) => {
  try {
    const query = (req.query.query as string) || '';
    const pack = await buildRunRecallPackAsync(query, {
      includeLessons: true,
      includeMemories: true,
      includeSessions: true,
    });
    res.json({
      ok: true,
      recallPack: pack,
    });
  } catch (err) {
    logger.error('mobileRouter: failed to get recall pack', err as Error);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Build and enqueue a pending follow-up draft. Shared by `/followup-draft`
 * (draft-only) and `/submit-prompt` (device submission). The draft always lands
 * as `needs_local_operator` — it never dispatches work — so "dangerous ops
 * blocked" holds structurally: there is no execution path from here.
 */
async function enqueuePendingFollowupDraft(
  prompt: string,
  query: string,
  source: FollowupDraft['source'],
): Promise<FollowupDraft> {
  const contract = await buildMobileSupervisionGatewayContract(query || '', { includeSnapshot: false });
  const reviewDraft = buildMobileSupervisionGatewayReviewDraft(query || '', contract, {
    action: 'draft_followup_prompt',
    method: 'POST',
    path: `${contract.basePath}/followup-draft`,
    hasLocalOperator: false,
  });

  const savedDraft: FollowupDraft = {
    ...reviewDraft,
    prompt,
    source,
    id: `draft_${crypto.randomBytes(8).toString('hex')}`,
    status: 'needs_local_operator',
    createdAt: Date.now(),
  };
  followupDrafts.push(savedDraft);
  return savedDraft;
}

// 5. POST /api/mobile/followup-draft: Save a local operator followup review draft
mobileRouter.post('/followup-draft', async (req: Request, res: Response) => {
  try {
    const prompt = normalizeRequiredString(req.body?.prompt);
    const query = normalizeOptionalString(req.body?.query);
    if (!prompt || query === null) {
      res.status(400).json({ ok: false, error: 'Missing or invalid prompt or query' });
      return;
    }

    const savedDraft = await enqueuePendingFollowupDraft(prompt, query, 'draft_only');

    res.json({
      ok: true,
      message: 'Follow-up prompt saved as local review draft. Pending operator approval.',
      draft: savedDraft,
    });
  } catch (err) {
    logger.error('mobileRouter: failed to save followup draft', err as Error);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// 6. POST /api/mobile/submit-prompt: a paired device proposes a prompt. It is
// queued for explicit local-operator approval — never executed directly.
mobileRouter.post('/submit-prompt', async (req: Request, res: Response) => {
  try {
    const prompt = normalizeRequiredString(req.body?.prompt);
    const query = normalizeOptionalString(req.body?.query);
    if (!prompt || query === null) {
      res.status(400).json({ ok: false, error: 'Missing or invalid prompt or query' });
      return;
    }

    const savedDraft = await enqueuePendingFollowupDraft(prompt, query, 'mobile_device');

    res.json({
      ok: true,
      message: 'Prompt submitted for local-operator review. It will not run until a local operator approves it.',
      draft: savedDraft,
    });
  } catch (err) {
    logger.error('mobileRouter: failed to submit prompt', err as Error);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

export default mobileRouter;
