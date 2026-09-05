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
import { PolicyEngine } from '../../src/security/policy-engine.js';
import { getToolRegistry } from '../../src/tools/registry.js';

/**
 * AUDIT SECAUDIT-FLOTTE (Opus, 2026-09-05) — Surface 1.
 * Preuve de REFUS pour les vecteurs de traversée non couverts ailleurs :
 * encodage %2e, chemins absolus, `../` profond, et symlink INTERNE pointant
 * hors du workspace. Le contenu sentinelle hors workspace ne doit JAMAIS
 * revenir dans la sortie de l'outil pair.
 */
const SENTINEL = 'SENTINEL_OUTSIDE_WORKSPACE_DO_NOT_LEAK';

describe('SECAUDIT surface 1 — traversée peer.tool.invoke (preuve de refus)', () => {
  let root: string;
  let parent: string;
  let outsideFile: string;
  let ctx: PeerMethodContext;

  beforeEach(async () => {
    parent = await fs.mkdtemp(path.join(os.tmpdir(), 'secaudit-peer-'));
    root = path.join(parent, 'workspace');
    await fs.mkdir(root, { recursive: true });
    outsideFile = path.join(parent, 'SECRET_OUTSIDE.txt');
    await fs.writeFile(outsideFile, SENTINEL);

    process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT = root;
    process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST = 'view_file,list_directory,search';
    vi.spyOn(getToolRegistry(), 'isFleetSafe').mockReturnValue(true);
    // On autorise au niveau Policy pour ISOLER la garde de chemin : si le
    // chemin fuit, ce n'est PAS masqué par un needs_approval.
    vi.spyOn(PolicyEngine.getInstance(), 'evaluate').mockReturnValue({
      decision: 'allow',
      reason: 'test-isolate-path-guard',
    });
    ctx = { connectionId: 'attacker', scopes: ['*'], traceId: 't', depth: 0 };
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
    await fs.rm(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  async function invoke(file_path: string) {
    return dispatchPeerRequest(
      { id: 'r', method: 'peer.tool.invoke', params: { tool: 'view_file', args: { file_path } } },
      ctx,
    );
  }

  it('refuse un chemin absolu hors workspace (/etc/passwd)', async () => {
    const res = await invoke('/etc/passwd');
    expect(res.ok).toBe(false);
    expect(String(res.error?.message)).toMatch(/PATH_OUTSIDE_PEER_WORKSPACE|ROOT_FORBIDDEN/i);
  });

  it('refuse un chemin absolu vers le fichier sentinelle', async () => {
    const res = await invoke(outsideFile);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(SENTINEL);
  });

  it('refuse `../` profond qui remonte hors du workspace', async () => {
    const res = await invoke('../../../../../../../../etc/passwd');
    expect(res.ok).toBe(false);
    expect(String(res.error?.message)).toMatch(/PATH_OUTSIDE_PEER_WORKSPACE/i);
  });

  it('refuse `../SECRET_OUTSIDE.txt` (une seule remontée) sans fuir la sentinelle', async () => {
    const res = await invoke('../SECRET_OUTSIDE.txt');
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(SENTINEL);
  });

  it('ne DÉCODE PAS %2e%2e : traité comme littéral, reste dans le workspace, aucune fuite', async () => {
    // %2e%2e n'est PAS décodé en ".." par le path node : la garde le voit
    // comme un nom de dossier littéral, donc il ne peut pas remonter.
    const res = await invoke('%2e%2e/%2e%2e/%2e%2e/etc/passwd');
    // Soit le chemin est jugé dans le workspace mais le fichier n'existe pas
    // (ENOENT), soit refusé — dans tous les cas AUCUNE fuite système.
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain('root:x:0:0');
  });

  it('refuse un symlink INTERNE pointant hors du workspace (evil -> /etc)', async () => {
    await fs.symlink('/etc', path.join(root, 'evil')).catch(() => {});
    const res = await invoke('evil/passwd');
    expect(res.ok).toBe(false);
    expect(String(res.error?.message)).toMatch(/PATH_OUTSIDE_PEER_WORKSPACE/i);
    expect(JSON.stringify(res)).not.toContain('root:x:0:0');
  });

  it('refuse un symlink INTERNE pointant vers le fichier sentinelle', async () => {
    await fs.symlink(outsideFile, path.join(root, 'link.txt')).catch(() => {});
    const res = await invoke('link.txt');
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(SENTINEL);
  });
});
