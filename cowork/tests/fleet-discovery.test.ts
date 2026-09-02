/**
 * Fleet P6 — discovery layer tests. The Tailscale subprocess and the
 * health probe are not exercised here (they're integration concerns);
 * we focus on the manual-config YAML parser which is the bit most
 * likely to break on edge cases.
 */
import { describe, expect, it } from 'vitest';
import { parseManualYaml } from '../src/main/fleet/discovery';

describe('fleet/discovery — parseManualYaml', () => {
  it('returns [] for empty input', () => {
    expect(parseManualYaml('')).toEqual([]);
  });

  it('returns [] when no `peers:` key is present', () => {
    expect(parseManualYaml('foo: bar\n')).toEqual([]);
  });

  it('parses a single peer with label + url', () => {
    const yaml = `
peers:
  - label: gpuNode
    url: ws://203.0.113.11:3001/ws
`;
    expect(parseManualYaml(yaml)).toEqual([
      {
        label: 'gpuNode',
        url: 'ws://203.0.113.11:3001/ws',
        source: 'manual',
        apiKey: undefined,
      },
    ]);
  });

  it('parses multiple peers', () => {
    const yaml = `
peers:
  - label: ministar
    url: ws://203.0.113.10:3001/ws
  - label: gpuNode
    url: ws://203.0.113.11:3001/ws
    apiKey: secret-token
`;
    const peers = parseManualYaml(yaml);
    expect(peers).toHaveLength(2);
    expect(peers[0].label).toBe('ministar');
    expect(peers[0].apiKey).toBeUndefined();
    expect(peers[1].label).toBe('gpuNode');
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
  # gpuNode is the heavy machine
  - label: gpuNode  # 2x 3090
    url: ws://203.0.113.11:3001/ws
`;
    const peers = parseManualYaml(yaml);
    expect(peers).toHaveLength(1);
    expect(peers[0].label).toBe('gpuNode');
  });
});
