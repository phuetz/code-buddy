import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserOperatorRuntimeManager,
  type BrowserOperatorExecutorLike,
} from '../../src/browser-automation/browser-operator-runtime.js';
import type { BrowserOperatorSessionDraft } from '../../src/browser-automation/browser-operator-session.js';

const tempDirectories: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'browser-operator-runtime-'));
  tempDirectories.push(directory);
  return realpath(directory);
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function draft(overrides: Partial<BrowserOperatorSessionDraft> = {}): BrowserOperatorSessionDraft {
  return {
    schemaVersion: 1,
    sessionId: 'model-provided-id-must-not-be-trusted',
    generatedAt: '2026-07-12T00:00:00.000Z',
    goal: 'Read the public release notes',
    query: 'release notes',
    sourceUrl: 'https://example.com/releases',
    mode: 'isolated',
    intent: 'research',
    dedicatedTab: {
      label: 'Release notes',
      reason: 'Visible reviewed browser work',
    },
    consent: {
      required: false,
      granted: true,
      scopes: [],
      reason: 'Untrusted model consent must be discarded',
      grantedBy: 'model',
    },
    stopControl: {
      enabled: true,
      label: 'Stop browser operator',
      stopConditions: ['captcha'],
    },
    actionLog: [
      {
        id: 'extract',
        sequence: 1,
        status: 'planned',
        tool: 'browser',
        action: 'extract',
        stage: 'extract',
        title: 'Extract release notes',
        evidence: 'structured-facts',
        requiresConsent: false,
        expectedArtifact: 'browser-extract.json',
        reason: 'Collect public evidence',
        inputs: { query: 'release notes' },
      },
    ],
    proofExport: {
      artifactName: 'ignored.browser-operator.json',
      includes: ['action log'],
    },
    ...overrides,
  };
}

interface FakeExecutorControls {
  execute: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  grantConsent: ReturnType<typeof vi.fn>;
}

function fakeExecutorFactory(controls: FakeExecutorControls) {
  return (): BrowserOperatorExecutorLike => ({
    execute: controls.execute,
    stop: controls.stop,
    grantConsent: controls.grantConsent,
  });
}

describe('BrowserOperatorRuntimeManager', () => {
  it('prepares a server-owned runtime, inserts public navigation, and discards model consent', async () => {
    const cwd = await workspace();
    const controls: FakeExecutorControls = {
      execute: vi.fn(async () => ({
        success: true,
        stopped: false,
        actionLog: [],
        proofPath: join(cwd, 'proof.json'),
      })),
      stop: vi.fn(),
      grantConsent: vi.fn(),
    };
    const manager = new BrowserOperatorRuntimeManager({
      executorFactory: fakeExecutorFactory(controls),
      idFactory: () => 'runtime-safe-123',
      now: () => new Date('2026-07-12T01:02:03.000Z'),
    });

    const prepared = manager.prepare({
      ownerSessionId: 'cowork-session-1',
      workspaceRoot: cwd,
      draft: draft(),
    });

    expect(prepared).toMatchObject({
      runtimeId: 'runtime-safe-123',
      ownerSessionId: 'cowork-session-1',
      state: 'prepared',
      interactionClass: 'read-only',
      consent: null,
    });
    const preparedDraft = manager.getPreparedDraft(prepared.runtimeId, 'cowork-session-1');
    expect(preparedDraft.sessionId).toBe('runtime-safe-123');
    expect(preparedDraft.consent.granted).toBe(false);
    expect(preparedDraft.consent.grantedBy).toBeUndefined();
    expect(preparedDraft.actionLog[0]).toMatchObject({
      tool: 'navigate',
      action: 'navigate',
      inputs: { url: 'https://example.com/releases' },
    });
  });

  it('binds consent to the exact draft hash and owner before starting', async () => {
    const cwd = await workspace();
    const controls: FakeExecutorControls = {
      execute: vi.fn(async () => ({ success: true, stopped: false, actionLog: [] })),
      stop: vi.fn(),
      grantConsent: vi.fn(),
    };
    const manager = new BrowserOperatorRuntimeManager({
      executorFactory: fakeExecutorFactory(controls),
      idFactory: () => 'runtime-consent-1',
    });
    const prepared = manager.prepare({
      ownerSessionId: 'owner-a',
      workspaceRoot: cwd,
      draft: draft(),
    });

    expect(() => manager.start({
      runtimeId: prepared.runtimeId,
      ownerSessionId: 'owner-b',
      expectedDraftHash: prepared.draftHash,
      approvedBy: 'Patrice',
    })).toThrow(/owner/i);
    expect(() => manager.start({
      runtimeId: prepared.runtimeId,
      ownerSessionId: 'owner-a',
      expectedDraftHash: '0'.repeat(64),
      approvedBy: 'Patrice',
    })).toThrow(/changed/i);

    const running = manager.start({
      runtimeId: prepared.runtimeId,
      ownerSessionId: 'owner-a',
      expectedDraftHash: prepared.draftHash,
      approvedBy: 'Patrice',
    });
    expect(running.state).toBe('running');
    expect(controls.grantConsent).toHaveBeenCalledWith('Patrice');

    const completed = await manager.wait(prepared.runtimeId, 'owner-a');
    expect(completed.state).toBe('completed');
    expect(completed.consent).toMatchObject({ approvedBy: 'Patrice', draftHash: prepared.draftHash });
  });

  it('owns at most one running browser per session and forwards an interruptible stop', async () => {
    const cwd = await workspace();
    let resolveExecution: ((value: { success: boolean; stopped: boolean; actionLog: [] }) => void) | undefined;
    const execute = vi.fn(() => new Promise<{ success: boolean; stopped: boolean; actionLog: [] }>((resolve) => {
      resolveExecution = resolve;
    }));
    const controls: FakeExecutorControls = {
      execute,
      stop: vi.fn(() => resolveExecution?.({ success: false, stopped: true, actionLog: [] })),
      grantConsent: vi.fn(),
    };
    let nextId = 0;
    const manager = new BrowserOperatorRuntimeManager({
      executorFactory: fakeExecutorFactory(controls),
      idFactory: () => `runtime-${++nextId}`,
    });
    const first = manager.prepare({ ownerSessionId: 'owner', workspaceRoot: cwd, draft: draft() });
    manager.start({
      runtimeId: first.runtimeId,
      ownerSessionId: 'owner',
      expectedDraftHash: first.draftHash,
      approvedBy: 'Patrice',
    });
    const second = manager.prepare({ ownerSessionId: 'owner', workspaceRoot: cwd, draft: draft() });
    expect(() => manager.start({
      runtimeId: second.runtimeId,
      ownerSessionId: 'owner',
      expectedDraftHash: second.draftHash,
      approvedBy: 'Patrice',
    })).toThrow(/already running/i);

    expect(manager.stop(first.runtimeId, 'owner')).toBe(true);
    expect(controls.stop).toHaveBeenCalledTimes(1);
    await expect(manager.wait(first.runtimeId, 'owner')).resolves.toMatchObject({ state: 'stopped' });
  });

  it('serializes local runtimes across sessions that share the authenticated profile', async () => {
    const cwd = await workspace();
    let resolveExecution: ((value: { success: boolean; stopped: boolean; actionLog: [] }) => void) | undefined;
    const controls: FakeExecutorControls = {
      execute: vi.fn(() => new Promise((resolve) => { resolveExecution = resolve; })),
      stop: vi.fn(() => resolveExecution?.({ success: false, stopped: true, actionLog: [] })),
      grantConsent: vi.fn(),
    };
    let id = 0;
    const manager = new BrowserOperatorRuntimeManager({
      executorFactory: fakeExecutorFactory(controls),
      idFactory: () => `runtime-local-${++id}`,
    });
    const localDraft = draft({ mode: 'local' });
    const first = manager.prepare({ ownerSessionId: 'owner-a', workspaceRoot: cwd, draft: localDraft });
    manager.start({
      runtimeId: first.runtimeId,
      ownerSessionId: 'owner-a',
      expectedDraftHash: first.draftHash,
      approvedBy: 'Patrice',
    });
    const second = manager.prepare({ ownerSessionId: 'owner-b', workspaceRoot: cwd, draft: localDraft });
    expect(() => manager.start({
      runtimeId: second.runtimeId,
      ownerSessionId: 'owner-b',
      expectedDraftHash: second.draftHash,
      approvedBy: 'Patrice',
    })).toThrow(/already running/i);

    manager.stop(first.runtimeId, 'owner-a');
    await manager.wait(first.runtimeId, 'owner-a');
  });

  it('rejects drafts without an explicit public starting URL or with unsafe actions', async () => {
    const cwd = await workspace();
    const manager = new BrowserOperatorRuntimeManager({ idFactory: () => 'runtime-invalid' });

    expect(() => manager.prepare({
      ownerSessionId: 'owner',
      workspaceRoot: cwd,
      draft: draft({ sourceUrl: undefined }),
    })).toThrow(/sourceUrl/i);

    expect(() => manager.prepare({
      ownerSessionId: 'owner',
      workspaceRoot: cwd,
      draft: draft({
        actionLog: [{
          ...draft().actionLog[0]!,
          tool: 'browser',
          action: 'get_cookies',
        }],
      }),
    })).toThrow(/not allowed/i);

    expect(() => manager.prepare({
      ownerSessionId: 'owner',
      workspaceRoot: cwd,
      draft: draft({
        actionLog: [{
          ...draft().actionLog[0]!,
          tool: 'browser',
          action: 'act',
          stage: 'interact',
          title: 'Send the reviewed message',
          inputs: { instruction: 'send this message to the customer' },
          requiresConsent: true,
        }],
      }),
    })).toThrow(/dedicated policy/i);
  });

  it('keeps one exact low-impact act in the consent hash and marks the runtime interactive', async () => {
    const cwd = await workspace();
    const manager = new BrowserOperatorRuntimeManager({ idFactory: () => 'runtime-interactive' });
    const prepared = manager.prepare({
      ownerSessionId: 'owner',
      workspaceRoot: cwd,
      draft: draft({
        actionLog: [{
          ...draft().actionLog[0]!,
          id: 'reviewed-interaction',
          action: 'act',
          stage: 'interact',
          title: 'Open the documentation menu',
          inputs: { instruction: 'open the documentation menu', maxActions: 1 },
          requiresConsent: true,
        }],
      }),
    });

    expect(prepared.interactionClass).toBe('interactive');
    const executable = manager.getPreparedDraft(prepared.runtimeId, 'owner');
    expect(executable.actionLog.at(-1)).toMatchObject({
      action: 'act',
      requiresConsent: true,
      inputs: { instruction: 'open the documentation menu', maxActions: 1 },
    });
    expect(prepared.draftHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
