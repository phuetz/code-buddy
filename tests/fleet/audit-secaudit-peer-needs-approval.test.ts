import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  wirePeerToolBridge,
  unwirePeerToolBridge,
  _unwireForTests,
} from '../../src/fleet/peer-tool-bridge.js';
import {
  dispatchPeerRequest,
  _resetPeerRpcForTests,
  type PeerMethodContext,
} from '../../src/server/websocket/peer-rpc.js';
import { getToolRegistry } from '../../src/tools/registry.js';

/**
 * AUDIT SECAUDIT-FLOTTE (Opus, 2026-09-05) — Surface 1.
 * Preuve de REFUS : une invocation peer qui atteint `needs_approval`
 * (ici via le garde secrets du PolicyEngine — nom de fichier contenant
 * un mot-clé sensible) DOIT échouer fermée sur un pair HEADLESS (pas de
 * TTY, pas de canal d'approbation distant). PolicyEngine et
 * ConfirmationService NE SONT PAS mockés — on prouve le chemin réel.
 */
describe('SECAUDIT surface 1 — needs_approval headless échoue fermé', () => {
  let root: string;
  let ctx: PeerMethodContext;
  const savedAutoConfirm = process.env.CODEBUDDY_AUTO_CONFIRM;
  const savedMode = process.env.CODEBUDDY_PERMISSION_MODE;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'secaudit-approval-'));
    // Fichier BIEN dans le workspace, mais dont le nom déclenche le garde
    // secrets (isSecretsOrDeployment) -> PolicyEngine renvoie needs_approval.
    await fs.writeFile(path.join(root, 'api-secret-token.txt'), 'not-a-real-token');
    process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT = root;
    process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST = 'view_file';
    delete process.env.CODEBUDDY_AUTO_CONFIRM;
    delete process.env.CODEBUDDY_PERMISSION_MODE;
    vi.spyOn(getToolRegistry(), 'isFleetSafe').mockReturnValue(true);
    ctx = { connectionId: 'headless-peer', scopes: ['*'], traceId: 't', depth: 0 };
    _resetPeerRpcForTests();
    wirePeerToolBridge();
  });

  afterEach(async () => {
    unwirePeerToolBridge();
    _unwireForTests();
    _resetPeerRpcForTests();
    vi.restoreAllMocks();
    delete process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT;
    delete process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST;
    if (savedAutoConfirm === undefined) delete process.env.CODEBUDDY_AUTO_CONFIRM;
    else process.env.CODEBUDDY_AUTO_CONFIRM = savedAutoConfirm;
    if (savedMode === undefined) delete process.env.CODEBUDDY_PERMISSION_MODE;
    else process.env.CODEBUDDY_PERMISSION_MODE = savedMode;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('refuse la lecture d\'un fichier "secret" sans confirmant (fail-closed)', async () => {
    // Environnement de test = pas de TTY (process.stdin.isTTY falsy),
    // pas de canal d'approbation distant, pas d'auto-confirm.
    const res = await dispatchPeerRequest(
      {
        id: 'r',
        method: 'peer.tool.invoke',
        params: { tool: 'view_file', args: { file_path: 'api-secret-token.txt' } },
      },
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(String(res.error?.message)).toMatch(/PEER_INVOKE_DENIED|approval/i);
    // Le contenu du fichier ne doit pas revenir.
    expect(JSON.stringify(res)).not.toContain('not-a-real-token');
  });
});
