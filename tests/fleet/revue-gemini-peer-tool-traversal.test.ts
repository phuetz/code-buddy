import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('Revue G6 - Trou 1 : Outil pair qui lit hors du workspace', () => {
  let defaultCtx: PeerMethodContext;

  beforeEach(() => {
    vi.spyOn(getToolRegistry(), 'isFleetSafe').mockReturnValue(true);
    vi.spyOn(PolicyEngine.getInstance(), 'evaluate').mockReturnValue({
      decision: 'allow',
      reason: 'Allowed',
    });

    defaultCtx = {
      connectionId: 'peer-attacker',
      scopes: ['*'],
      traceId: 'trace-leak',
      depth: 0,
    };

    _resetPeerRpcForTests();
  });

  afterEach(() => {
    unwirePeerToolBridge();
    _unwireForTests();
    delete process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT;
    delete process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST;
    vi.restoreAllMocks();
  });

  it('doit refuser la configuration de workspace root="/" qui permet à l’outil pair de lire tout le système (/etc/hosts)', async () => {
    // Si la racine de workspace est configurée à la racine du système "/" (ex: conteneur mal isolé)
    process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT = '/';
    process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST = 'view_file';

    wirePeerToolBridge();

    const request = {
      id: 'req-leak-system',
      method: 'peer.tool.invoke',
      params: {
        tool: 'view_file',
        args: { file_path: '/etc/hosts' },
      },
    };

    const res = await dispatchPeerRequest(request, defaultCtx);

    // VULNÉRABILITÉ : isPathInsideOrEqual fait candidate.startsWith(rootPrefix).
    // Quand root="/", rootPrefix="/", donc TOUT chemin absolu du système est considéré "dans le workspace" !
    // L'outil pair lit et retourne /etc/hosts à distance avec res.ok === true.
    expect(res.ok).toBe(false);
    expect(res.error?.message).toMatch(/ROOT_FORBIDDEN|PATH_OUTSIDE_PEER_WORKSPACE|INVALID_WORKSPACE/i);
  });
});
