import { describe, expect, it } from 'vitest';

import {
  PEER_DELEGATE_TOOL_DEF,
  PEER_CHAIN_TOOL_DEF,
  PEER_TOOL_INVOKE_TOOL_DEF,
  ROUTE_PEER_TOOL_DEF,
} from '../../src/codebuddy/fleet-tool-defs.js';
import {
  PeerChainTool,
  PeerDelegateTool,
  PeerToolInvokeTool,
  RoutePeerTool,
} from '../../src/tools/registry/fleet-tools.js';

describe('Fleet tool validation', () => {
  it('accepts known dispatch profiles on peer_delegate and route_peer', () => {
    expect(new PeerDelegateTool().validate({
      peer: 'loopback',
      prompt: 'review this',
      dispatchProfile: 'review',
    })).toEqual({ valid: true });

    expect(new RoutePeerTool().validate({
      prompt: 'research this',
      dispatchProfile: 'research',
      chainRoles: ['code', 'review', 'safe'],
    })).toEqual({ valid: true });

    expect(new PeerChainTool().validate({
      prompt: 'implement then review',
      chainRoles: ['code', 'review'],
    })).toEqual({ valid: true });
  });

  it('rejects unknown dispatch profiles before execution', () => {
    const peerDelegate = new PeerDelegateTool().validate({
      peer: 'loopback',
      prompt: 'review this',
      dispatchProfile: 'chaos',
    });
    expect(peerDelegate.valid).toBe(false);
    expect(peerDelegate.errors?.join('\n')).toContain('dispatchProfile must be one of');

    const routePeer = new RoutePeerTool().validate({
      prompt: 'review this',
      dispatchProfile: 'chaos',
    });
    expect(routePeer.valid).toBe(false);
    expect(routePeer.errors?.join('\n')).toContain('dispatchProfile must be one of');

    const routePeerChain = new RoutePeerTool().validate({
      prompt: 'review this',
      chainRoles: ['code', 'chaos'],
    });
    expect(routePeerChain.valid).toBe(false);
    expect(routePeerChain.errors?.join('\n')).toContain('chainRoles must contain only');

    const peerChain = new PeerChainTool().validate({
      prompt: 'review this',
      chainRoles: ['code', 'chaos'],
    });
    expect(peerChain.valid).toBe(false);
    expect(peerChain.errors?.join('\n')).toContain('chainRoles must contain only');
  });

  it('enforces unknown dispatch profiles in direct execute calls too', async () => {
    const peerDelegate = await new PeerDelegateTool().execute({
      peer: 'loopback',
      prompt: 'review this',
      dispatchProfile: 'chaos',
    });
    expect(peerDelegate.success).toBe(false);
    expect(peerDelegate.error).toContain('dispatchProfile must be one of');

    const routePeer = await new RoutePeerTool().execute({
      prompt: 'review this',
      dispatchProfile: 'chaos',
    });
    expect(routePeer.success).toBe(false);
    expect(routePeer.error).toContain('dispatchProfile must be one of');

    const routePeerChain = await new RoutePeerTool().execute({
      prompt: 'review this',
      chainRoles: ['code', 'chaos'],
    });
    expect(routePeerChain.success).toBe(false);
    expect(routePeerChain.error).toContain('chainRoles must contain only');

    const peerChain = await new PeerChainTool().execute({
      prompt: 'review this',
      chainRoles: ['code', 'chaos'],
    });
    expect(peerChain.success).toBe(false);
    expect(peerChain.error).toContain('chainRoles must contain only');
  });

  it('rejects route_peer chain roles combined with parallelism', () => {
    const routePeer = new RoutePeerTool().validate({
      prompt: 'review this',
      chainRoles: ['code', 'review'],
      parallelism: 2,
    });

    expect(routePeer.valid).toBe(false);
    expect(routePeer.errors?.join('\n')).toContain('chainRoles and parallelism');
  });

  it('documents dispatch profile selection in both fleet tool registries', () => {
    const formalPeerDescription = new PeerDelegateTool()
      .getSchema()
      .parameters
      .properties
      ?.dispatchProfile
      ?.description;
    const formalRouteDescription = new RoutePeerTool()
      .getSchema()
      .parameters
      .properties
      ?.dispatchProfile
      ?.description;

    expect(formalPeerDescription).toContain('Selection guide: balanced: general delegation');
    expect(formalPeerDescription).toContain('safe: high-risk');
    expect(formalRouteDescription).toContain('review: read-first code review');

    expect(
      PEER_DELEGATE_TOOL_DEF.function.parameters.properties.dispatchProfile.description,
    ).toContain('research: source-aware investigation');
    expect(
      ROUTE_PEER_TOOL_DEF.function.parameters.properties.dispatchProfile.description,
    ).toContain('code: implementation');
    expect(
      ROUTE_PEER_TOOL_DEF.function.parameters.properties.chainRoles.description,
    ).toContain('sequential peer_delegate calls');
    expect(
      PEER_CHAIN_TOOL_DEF.function.parameters.properties.chainRoles.description,
    ).toContain('Ordered Fleet dispatch profiles');
  });

  it('registers peer_tool_invoke as outbound (fleetSafe false) with read-only schema', () => {
    const tool = new PeerToolInvokeTool();
    expect(tool.name).toBe('peer_tool_invoke');
    expect(tool.getMetadata().fleetSafe).toBe(false);
    expect(tool.getSchema().parameters.required).toEqual(['peer', 'tool']);
    expect(tool.getSchema().description).toContain('{"peer":"B","tool":"view_file","args":{"path":"oracle.txt"}}');
    expect(tool.getSchema().parameters.properties?.peer?.description).toContain('Required');
    expect(tool.getSchema().parameters.properties?.tool?.enum).toEqual([
      'view_file',
      'list_directory',
      'search',
    ]);
    expect(tool.validate({ peer: 'B', tool: 'view_file', args: { file_path: 'oracle.txt' } })).toEqual({
      valid: true,
    });
    expect(tool.validate({ peer: 'B', tool: 'view_file', args: { nested: { x: 1 } } }).valid).toBe(false);
    expect(PEER_TOOL_INVOKE_TOOL_DEF.function.name).toBe('peer_tool_invoke');
    expect(PEER_TOOL_INVOKE_TOOL_DEF.function.description).toContain('read-only');
    expect(PEER_TOOL_INVOKE_TOOL_DEF.function.description).toContain('allowlist');
    expect(PEER_TOOL_INVOKE_TOOL_DEF.function.parameters.required).toEqual(['peer', 'tool']);
    expect(PEER_TOOL_INVOKE_TOOL_DEF.function.description).toContain(
      '{"peer":"B","tool":"view_file","args":{"path":"oracle.txt"}}',
    );
  });

  it('tags formal fleet tools for Hermes dispatch discovery', () => {
    expect(new RoutePeerTool().getMetadata().keywords).toEqual(
      expect.arrayContaining(['hermes', 'dispatch', 'chain', 'roles', 'toolset', 'policy']),
    );
    expect(new PeerDelegateTool().getMetadata().keywords).toEqual(
      expect.arrayContaining(['hermes', 'dispatch', 'toolsets', 'policy']),
    );
    expect(new PeerChainTool().getMetadata().keywords).toEqual(
      expect.arrayContaining(['hermes', 'chain', 'handoff', 'roles']),
    );
  });
});
