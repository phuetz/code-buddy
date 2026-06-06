/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MissionControlStrip,
  buildMissionControlFocus,
} from '../src/renderer/components/fleet-mission-control-strip';
import type { MissionControlSnapshot } from '../src/main/fleet/mission-control-snapshot';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snapshot: MissionControlSnapshot = {
  agents: [
    {
      actions: [
        {
          enabled: true,
          id: 'reconnect',
          label: 'Reconnect',
          targetId: 'ministar-linux',
          targetKind: 'fleet-peer',
        },
      ],
      activeWork: 0,
      id: 'ministar-linux',
      kind: 'fleet-peer',
      label: 'MiniStar',
      machine: 'ministar-linux',
      status: 'error',
      statusDetail: 'health probe failed',
    },
  ],
  generatedAt: '2026-06-06T06:45:00.000Z',
  hostname: 'patrice-win',
  schemaVersion: 1,
  summary: {
    activeAgents: 0,
    activeWork: 1,
    agentCount: 1,
    errorAgents: 1,
    failedProof: 0,
    incompleteProof: 0,
    needsAttention: 1,
    offlineAgents: 0,
    provenWork: 1,
    workCount: 1,
  },
  work: [
    {
      actions: [
        {
          enabled: true,
          id: 'audit',
          label: 'Audit',
          targetId: 'saga-review123456',
          targetKind: 'saga',
        },
      ],
      agentId: 'ministar-linux',
      filesChanged: ['src/observability/proof-ledger.ts'],
      id: 'saga-review123456',
      kind: 'saga',
      proof: {
        artifactCount: 1,
        commandCount: 1,
        failedTests: 0,
        highRiskCount: 0,
        lastCommandDurationMs: 912,
        lastCommandStatus: 'passed',
        lastCommandText: 'npm test -- tests/cowork/proof.test.ts --run',
        lastCommandTool: 'shell_exec',
        passedTests: 2,
        redactionCount: 1,
        riskCount: 2,
        status: 'proven',
        testCommandCount: 1,
        totalTests: 2,
      },
      source: 'fleet',
      startedAt: 1_780_000_000_000,
      status: 'running',
      title: 'Review Fleet UI',
      updatedAt: 1_780_000_000_000,
    },
  ],
};

describe('MissionControlStrip', () => {
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    document.body.innerHTML = '';
  });

  it('renders mission metrics and emits action intents', () => {
    const target = document.createElement('div');
    const onAction = vi.fn();
    document.body.appendChild(target);
    root = createRoot(target);

    act(() => {
      root?.render(React.createElement(MissionControlStrip, { onAction, snapshot }));
    });

    expect(target.textContent).toContain('Mission Control');
    expect(target.textContent).toContain('MiniStar');
    expect(target.textContent).toContain('Review Fleet UI');
    expect(target.textContent).toContain('Now: Review Fleet UI');
    expect(target.textContent).toContain('MiniStar · fleet · passed 912ms npm test -- tests/cowork/proof.test.ts --run');
    expect(target.textContent).toContain('proof proven');
    expect(target.textContent).toContain('2/2 tests');
    expect(target.textContent).toContain('1 cmd');
    expect(target.textContent).toContain('1 files');
    expect(target.textContent).toContain('npm test -- tests/cowork/proof.test.ts --run passed 912ms');
    expect(target.textContent).toContain('2 risks');
    expect(target.textContent).toContain('1 redaction');
    expect(target.textContent).toContain('attention');

    const reconnectButton = target.querySelector('button[aria-label="Reconnect"]');
    const auditButton = target.querySelector('button[aria-label="Audit"]');
    expect(reconnectButton).not.toBeNull();
    expect(auditButton).not.toBeNull();

    act(() => {
      reconnectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      auditButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'reconnect' }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'audit' }));
  });

  it('builds a Codex-like focus line for the active work item', () => {
    expect(buildMissionControlFocus(snapshot)).toEqual({
      chips: [
        { label: 'saga' },
        { label: 'running' },
        { label: 'proof proven', tone: 'ok' },
        { label: '2/2 tests', tone: 'ok' },
        { label: '1 cmd' },
        { label: '1 files' },
        { label: '2 risks', tone: undefined },
        { label: '1 redaction', tone: 'ok' },
      ],
      detail: 'MiniStar · fleet · passed 912ms npm test -- tests/cowork/proof.test.ts --run',
      headline: 'Now: Review Fleet UI',
      tone: 'running',
    });
  });

  it('describes unpaired discovered peers without marking them ready', () => {
    expect(buildMissionControlFocus({
      ...snapshot,
      agents: [
        {
          actions: [
            {
              enabled: true,
              id: 'pair',
              label: 'Pair',
              targetId: 'discovered-tailscale-100-64-0-10',
              targetKind: 'fleet-peer',
            },
            {
              enabled: false,
              id: 'refresh',
              label: 'Refresh',
              reason: 'Pair this discovered peer first',
              targetId: 'discovered-tailscale-100-64-0-10',
              targetKind: 'fleet-peer',
            },
          ],
          activeWork: 0,
          id: 'discovered-tailscale-100-64-0-10',
          kind: 'fleet-peer',
          label: 'claude-ministar',
          machine: 'claude-ministar',
          status: 'unknown',
          statusDetail: 'discovered via Tailscale; not paired yet',
        },
      ],
      summary: {
        ...snapshot.summary,
        activeAgents: 0,
        activeWork: 0,
        agentCount: 1,
        errorAgents: 0,
        needsAttention: 0,
        workCount: 0,
      },
      work: [],
    })).toEqual({
      chips: [{ label: 'unknown' }],
      detail: 'claude-ministar · discovered via Tailscale; not paired yet',
      headline: 'Agent discovered: claude-ministar',
      tone: 'neutral',
    });
  });
});
