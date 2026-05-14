/**
 * Fleet P6 — discovery layer tests. The Tailscale subprocess and the
 * health probe are not exercised here (they're integration concerns);
 * we focus on the manual-config YAML parser which is the bit most
 * likely to break on edge cases.
 */
import { describe, expect, it } from 'vitest';
import {
  findCodeBuddyPort,
  parseManualYaml,
  resolveDiscoveryPorts,
} from '../src/main/fleet/discovery';

describe('fleet/discovery — parseManualYaml', () => {
  it('prefers the buddy server port and keeps the legacy gateway fallback', () => {
    expect(resolveDiscoveryPorts()).toEqual([3000, 3001]);
  });

  it('honours explicit discovery port overrides', () => {
    expect(resolveDiscoveryPorts('3002, 3000, nope, 3002')).toEqual([3002, 3000]);
  });

  it('uses the first reachable Code Buddy port', async () => {
    const probes: number[] = [];
    const port = await findCodeBuddyPort('100.98.18.76', [3000, 3001], async (_host, p) => {
      probes.push(p);
      return p === 3001;
    });

    expect(port).toBe(3001);
    expect(probes).toEqual([3000, 3001]);
  });

  it('returns [] for empty input', () => {
    expect(parseManualYaml('')).toEqual([]);
  });

  it('returns [] when no `peers:` key is present', () => {
    expect(parseManualYaml('foo: bar\n')).toEqual([]);
  });

  it('parses a single peer with label + url', () => {
    const yaml = `
peers:
  - label: darkstar
    url: ws://100.65.42.7:3001/ws
`;
    expect(parseManualYaml(yaml)).toEqual([
      {
        label: 'darkstar',
        url: 'ws://100.65.42.7:3001/ws',
        source: 'manual',
        apiKey: undefined,
      },
    ]);
  });

  it('parses multiple peers', () => {
    const yaml = `
peers:
  - label: ministar
    url: ws://100.98.18.76:3001/ws
  - label: darkstar
    url: ws://100.65.42.7:3001/ws
    apiKey: secret-token
`;
    const peers = parseManualYaml(yaml);
    expect(peers).toHaveLength(2);
    expect(peers[0].label).toBe('ministar');
    expect(peers[0].apiKey).toBeUndefined();
    expect(peers[1].label).toBe('darkstar');
    expect(peers[1].apiKey).toBe('secret-token');
  });

  it('strips quotes from values', () => {
    const yaml = `
peers:
  - label: "with quotes"
    url: 'ws://localhost:3001/ws'
`;
    expect(parseManualYaml(yaml)[0].label).toBe('with quotes');
    expect(parseManualYaml(yaml)[0].url).toBe('ws://localhost:3001/ws');
  });

  it('falls back to hostname when label is missing', () => {
    const yaml = `
peers:
  - url: ws://example.com:3001/ws
`;
    const peers = parseManualYaml(yaml);
    expect(peers[0].label).toBe('example.com');
  });

  it('ignores entries without a url', () => {
    const yaml = `
peers:
  - label: orphan
  - label: real
    url: ws://x:3001/ws
`;
    const peers = parseManualYaml(yaml);
    expect(peers).toHaveLength(1);
    expect(peers[0].label).toBe('real');
  });

  it('ignores comments', () => {
    const yaml = `
# fleet config
peers:
  # darkstar is the heavy machine
  - label: darkstar  # 2x 3090
    url: ws://100.65.42.7:3001/ws
`;
    const peers = parseManualYaml(yaml);
    expect(peers).toHaveLength(1);
    expect(peers[0].label).toBe('darkstar');
  });
});
