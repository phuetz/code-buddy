import { describe, expect, it } from 'vitest';

import {
  PEER_DELEGATE_TOOL_DEF,
  ROUTE_PEER_TOOL_DEF,
} from '../../src/codebuddy/fleet-tool-defs.js';
import {
  PeerDelegateTool,
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
  });

  it('tags formal fleet tools for Hermes dispatch discovery', () => {
    expect(new RoutePeerTool().getMetadata().keywords).toEqual(
      expect.arrayContaining(['hermes', 'dispatch', 'dispatchProfile', 'toolset', 'policy']),
    );
    expect(new PeerDelegateTool().getMetadata().keywords).toEqual(
      expect.arrayContaining(['hermes', 'dispatch', 'toolsets', 'policy']),
    );
  });
});
