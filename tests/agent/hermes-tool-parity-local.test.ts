import { describe, expect, it } from 'vitest';

import {
  buildLocalHermesToolParityManifest,
  collectOfflineBuiltinTools,
} from '../../src/agent/hermes-tool-parity-local.js';

describe('local Hermes tool parity manifest', () => {
  it('builds the official Hermes catalog from real built-in Code Buddy tools', () => {
    const tools = collectOfflineBuiltinTools();
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T16:30:00.000Z');

    expect(tools.length).toBeGreaterThan(100);
    expect(manifest.kind).toBe('hermes_official_tool_parity_manifest');
    expect(manifest.summary.total).toBe(71);
    expect(manifest.codeBuddySource.localToolCount).toBe(tools.length);
    expect(manifest.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'execute_code',
        status: 'exact',
        detectedCodeBuddyTools: expect.arrayContaining(['execute_code']),
      }),
      expect.objectContaining({
        name: 'vision_analyze',
        status: 'exact',
        detectedCodeBuddyTools: expect.arrayContaining(['vision_analyze']),
      }),
      expect.objectContaining({
        name: 'browser_vision',
        status: 'exact',
        detectedCodeBuddyTools: expect.arrayContaining(['browser_vision']),
      }),
      expect.objectContaining({
        name: 'kanban_show',
        status: 'exact',
        detectedCodeBuddyTools: ['kanban_show'],
      }),
      expect.objectContaining({
        name: 'kanban_create',
        status: 'exact',
        detectedCodeBuddyTools: ['kanban_create'],
      }),
      expect.objectContaining({
        name: 'send_message',
        status: 'exact',
        detectedCodeBuddyTools: ['send_message'],
      }),
    ]));
  });
});
