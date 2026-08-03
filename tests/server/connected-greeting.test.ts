import { describe, it, expect } from 'vitest';
import { buildConnectedGreeting, buildGatewayStatus } from '../../src/server/websocket/handler';

describe('buildConnectedGreeting', () => {
  const base = {
    connectionId: 'ws_1',
    authRequired: true,
    pairingRequired: false,
    serverVersion: '1.0.0-test',
    protocolVersion: 2,
    methods: ['chat', 'authenticate', 'ping'],
  };

  it('preserves the existing connectionId + authRequired fields (backward compatible)', () => {
    const greeting = buildConnectedGreeting(base);
    expect(greeting.type).toBe('connected');
    const payload = greeting.payload as Record<string, unknown>;
    expect(payload.connectionId).toBe('ws_1');
    expect(payload.authRequired).toBe(true);
  });

  it('advertises server identity, protocol, pairing, and sorted/deduped capabilities', () => {
    const greeting = buildConnectedGreeting({ ...base, pairingRequired: true, methods: ['chat', 'chat', 'authenticate', 'ping'] });
    const payload = greeting.payload as {
      server: { version: string };
      protocolVersion: number;
      pairingRequired: boolean;
      capabilities: { methods: string[] };
    };
    expect(payload.server).toEqual({ version: '1.0.0-test' });
    expect(payload.protocolVersion).toBe(2);
    expect(payload.pairingRequired).toBe(true);
    expect(payload.capabilities.methods).toEqual(['authenticate', 'chat', 'ping']);
  });
});

describe('buildGatewayStatus', () => {
  const input = {
    connection: {
      connectionId: 'ws_1',
      authenticated: true,
      deviceId: 'dev-1',
      scopes: ['chat'],
      streaming: false,
      lastActivity: 1_700_000_000_000,
      connectedAt: 1_699_999_000_000,
    },
    server: { version: '1.0.0-test', protocolVersion: 2, uptimeMs: 5_000, pairingRequired: true },
    connections: { total: 3, authenticated: 2, streaming: 1 },
  };

  it('keeps per-connection fields and adds a gateway-wide server snapshot', () => {
    const status = buildGatewayStatus(input);
    expect(status.type).toBe('status');
    const payload = status.payload as {
      connectionId: string;
      deviceId?: string;
      scopes: string[];
      connectedAt: string;
      lastActivityAt: string;
      server: { version: string; protocolVersion: number; uptimeMs: number; pairingRequired: boolean; connections: { total: number } };
    };
    expect(payload.connectionId).toBe('ws_1');
    expect(payload.deviceId).toBe('dev-1');
    expect(payload.scopes).toEqual(['chat']);
    // connectedAt reported the LAST ACTIVITY before this fix, so a listener
    // connected hours ago looked like it had just connected.
    expect(payload.connectedAt).toBe(new Date(1_699_999_000_000).toISOString());
    expect(payload.lastActivityAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(payload.server).toMatchObject({
      version: '1.0.0-test',
      protocolVersion: 2,
      uptimeMs: 5_000,
      pairingRequired: true,
      connections: { total: 3, authenticated: 2, streaming: 1 },
    });
  });

  it('omits optional identity fields when absent', () => {
    const status = buildGatewayStatus({
      ...input,
      connection: { connectionId: 'ws_2', authenticated: false, scopes: [], streaming: false, lastActivity: 1, connectedAt: 1 },
    });
    const payload = status.payload as Record<string, unknown>;
    expect(payload.deviceId).toBeUndefined();
    expect(payload.userId).toBeUndefined();
    expect(payload.keyId).toBeUndefined();
  });
});
