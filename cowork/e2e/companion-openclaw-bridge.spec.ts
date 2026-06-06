import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';

async function completeOnboardingForTest(appPage: Page) {
  await appPage.evaluate(async () => {
    await window.electronAPI?.config?.save?.({
      onboardingCompleted: true,
    } as Record<string, unknown>);
  });

  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible().catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toBeHidden();
  }
}

async function mockOpenClawCompanionBackend(
  electronApp: ElectronApplication,
  workspacePath: string,
) {
  await electronApp.evaluate(({ ipcMain }, cwd) => {
    const now = new Date().toISOString();
    const stats = {
      storePath: `${cwd}/.codebuddy/companion/percepts.jsonl`,
      exists: true,
      total: 1,
      byModality: { self: 1 },
      latestTimestamp: now,
    };
    const status = {
      cwd,
      authPath: `${cwd}/.codebuddy/auth.json`,
      chatGptCredentialsPresent: true,
      model: 'gpt-5.5',
      identity: {
        soulLoaded: true,
        soulSource: `${cwd}/.codebuddy/BUDDY_SOUL.md`,
        soulIsCompanion: true,
        bootLoaded: true,
        bootSource: `${cwd}/.codebuddy/BUDDY_BOOT.md`,
        bootIsCompanion: true,
      },
      voice: {
        enabled: true,
        available: true,
        provider: 'chatgpt-pro',
        language: 'fr-FR',
        autoSend: false,
      },
      wakeWord: {
        available: true,
        engine: 'text-match',
        wakeWords: ['buddy'],
        picovoiceAccessKeyPresent: false,
      },
      tts: {
        enabled: true,
        available: true,
        provider: 'system',
        voice: 'default',
        autoSpeak: false,
      },
      camera: {
        available: false,
        ffmpegAvailable: false,
        platform: 'e2e',
        reason: 'Camera is skipped in deterministic e2e.',
      },
      percepts: stats,
    };
    const percept = {
      id: 'percept_openclaw_e2e',
      modality: 'self',
      source: 'e2e',
      timestamp: now,
      confidence: 1,
      summary: 'OpenClaw bridge is visible in the companion cockpit.',
      payload: {},
      tags: ['e2e', 'openclaw'],
    };
    const lifecycleReport = {
      schemaVersion: 1,
      cwd,
      generatedAt: now,
      inboxPath: `${cwd}/.codebuddy/companion/gateway-inbox.json`,
      summary: {
        channelCount: 1,
        enabledCount: 1,
        readyChannelCount: 1,
        attentionChannelCount: 0,
        queuedCount: 0,
        draftCount: 0,
        replyDraftCount: 0,
        outboundSendCount: 0,
        failedSendCount: 0,
        blockedSendCount: 0,
      },
      safety: {
        requiresLocalApproval: true,
        secretsIncluded: false,
        autoDispatch: false,
      },
      channels: [
        {
          channel: 'openclaw',
          enabled: true,
          mode: 'assist',
          state: 'ready',
          queueCount: 0,
          draftCount: 0,
          replyDraftCount: 0,
        },
      ],
      recommendations: [],
      paths: {
        profile: `${cwd}/.codebuddy/companion/gateway.json`,
        inbox: `${cwd}/.codebuddy/companion/gateway-inbox.json`,
      },
    };
    const adminPlan = {
      schemaVersion: 1,
      cwd,
      generatedAt: now,
      summary: {
        actionCount: 0,
        replayablePreviewCount: 0,
        failedSendCount: 0,
        blockedSendCount: 0,
      },
      safety: {
        requiresLocalApproval: true,
        secretsIncluded: false,
        executesChannelAdmin: false,
      },
      actions: [],
      deliveryDiagnostics: {
        replayablePreviews: [],
      },
    };
    const inbox = {
      schemaVersion: 1,
      cwd,
      storePath: `${cwd}/.codebuddy/companion/gateway-inbox.json`,
      updatedAt: now,
      safety: {
        autoDispatch: false,
      },
      counts: {
        queued: 0,
        highPriority: 0,
        total: 0,
      },
      items: [],
    };
    const privacyReport = {
      schemaVersion: 1,
      cwd,
      generatedAt: now,
      stores: [
        {
          kind: 'gateway',
          path: `${cwd}/.codebuddy/companion/gateway.json`,
          exists: true,
          bytes: 256,
          entries: 1,
        },
      ],
      totalBytes: 256,
      totalEntries: 1,
    };

    const channels = [
      'companion.status',
      'companion.percepts.recent',
      'companion.percepts.stats',
      'companion.impulses',
      'companion.missions.list',
      'companion.safety.recent',
      'companion.safety.stats',
      'companion.cards.list',
      'companion.gateway.profile',
      'companion.gateway.lifecycle',
      'companion.gateway.adminPlan',
      'companion.gateway.inbox',
      'companion.openclaw.status',
      'companion.openclaw.attachPreview',
      'companion.openclaw.draft',
      'companion.openclaw.sendPreview',
      'companion.skills.list',
      'companion.privacy.report',
      'voice.conversationStatus',
      'voice.status',
      'voice.ttsStatus',
    ];
    for (const channel of channels) ipcMain.removeHandler(channel);

    ipcMain.handle('companion.status', async () => ({ ok: true, status }));
    ipcMain.handle('companion.percepts.recent', async () => ({ ok: true, items: [percept] }));
    ipcMain.handle('companion.percepts.stats', async () => ({ ok: true, stats }));
    ipcMain.handle('companion.impulses', async () => ({
      ok: true,
      brief: {
        id: 'impulse_openclaw_e2e',
        timestamp: now,
        cwd,
        summary: 'OpenClaw bridge is ready for reviewed handoff.',
        nextPrompt: 'Review OpenClaw bridge actions before live dispatch.',
        impulses: [],
        context: {
          perceptTotal: 1,
          openMissions: 0,
          inProgressMissions: 0,
          safetyEvents: 0,
        },
      },
    }));
    ipcMain.handle('companion.missions.list', async () => ({ ok: true, items: [] }));
    ipcMain.handle('companion.safety.recent', async () => ({ ok: true, items: [] }));
    ipcMain.handle('companion.safety.stats', async () => ({
      ok: true,
      stats: {
        ledgerPath: `${cwd}/.codebuddy/companion/safety.jsonl`,
        exists: true,
        total: 0,
        byKind: {},
        byRisk: {},
        byStatus: {},
      },
    }));
    ipcMain.handle('companion.cards.list', async () => ({ ok: true, items: [] }));
    ipcMain.handle('companion.gateway.profile', async () => ({
      ok: true,
      profile: {
        schemaVersion: 1,
        cwd,
        storePath: `${cwd}/.codebuddy/companion/gateway.json`,
        updatedAt: now,
        defaultMode: 'assist',
        channels: [
          {
            channel: 'openclaw',
            enabled: true,
            mode: 'assist',
            allowOutbound: false,
            requireApprovalForTools: true,
            recordPercepts: true,
            tags: ['bridge', 'openclaw'],
          },
        ],
      },
    }));
    ipcMain.handle('companion.gateway.lifecycle', async () => ({
      ok: true,
      report: lifecycleReport,
    }));
    ipcMain.handle('companion.gateway.adminPlan', async () => ({
      ok: true,
      plan: adminPlan,
    }));
    ipcMain.handle('companion.gateway.inbox', async () => ({ ok: true, inbox }));
    ipcMain.handle('companion.openclaw.status', async () => ({
      ok: true,
      discovery: {
        detected: true,
        found: true,
        endpoint: 'http://127.0.0.1:8787/rpc',
        tokenPresent: true,
      },
      descriptor: {
        id: 'openclaw-e2e',
        name: 'OpenClaw E2E Bridge',
        transport: 'http',
        capabilities: ['gateway.attach', 'handoff.draft', 'reply.send'],
      },
    }));
    ipcMain.handle('companion.openclaw.attachPreview', async () => ({
      ok: true,
      result: { kind: 'attach-preview', logPath: `${cwd}/.codebuddy/openclaw-preview.json` },
    }));
    ipcMain.handle('companion.openclaw.draft', async () => ({
      ok: true,
      result: { kind: 'handoff-draft', draftFile: `${cwd}/.codebuddy/openclaw-handoff.json` },
    }));
    ipcMain.handle('companion.openclaw.sendPreview', async () => ({
      ok: true,
      result: { kind: 'send-preview', logPath: `${cwd}/.codebuddy/openclaw-send-preview.json` },
    }));
    ipcMain.handle('companion.skills.list', async () => ({ ok: true, items: [] }));
    ipcMain.handle('companion.privacy.report', async () => ({ ok: true, report: privacyReport }));
    ipcMain.handle('voice.conversationStatus', async () => ({
      phase: 'idle',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      turnId: 0,
      interruptionCount: 0,
    }));
    ipcMain.handle('voice.status', async () => ({
      available: true,
      provider: 'chatgpt-pro',
      bootError: null,
    }));
    ipcMain.handle('voice.ttsStatus', async () => ({
      available: true,
      provider: 'system',
      bootError: null,
    }));
  }, workspacePath);
}

test('shows a public-safe OpenClaw bridge proof in the Companion cockpit', async ({
  electronApp,
  appPage,
  userDataDir,
}) => {
  const workspacePath = path.join(userDataDir, 'openclaw-e2e-workspace');
  mkdirSync(workspacePath, { recursive: true });

  await completeOnboardingForTest(appPage);
  await mockOpenClawCompanionBackend(electronApp, workspacePath);

  await appPage.getByTestId('companion-panel-button').click();
  const bridge = appPage.getByTestId('companion-openclaw-bridge');
  await expect(bridge).toBeVisible({ timeout: 20_000 });
  await expect(bridge.getByText('OpenClaw bridge')).toBeVisible();
  await expect(bridge.getByText('detected')).toBeVisible();
  await expect(bridge).toContainText('Gateway');
  await expect(bridge).toContainText('http://127.0.0.1:8787/rpc');
  await expect(bridge).toContainText('Token');
  await expect(bridge).toContainText('present');
  await expect(bridge.getByRole('button', { name: 'Preview attach' })).toBeVisible();
  await expect(bridge.getByRole('button', { name: 'Attach live' })).toBeVisible();
  await expect(bridge.getByRole('button', { name: 'Draft handoff' })).toBeVisible();
  await expect(bridge.getByRole('button', { name: 'Preview send' })).toBeVisible();
  await expect(bridge.getByRole('button', { name: 'Send live' })).toBeVisible();

  await bridge.screenshot({
    path: path.resolve(
      process.cwd(),
      '../docs/qa/code-buddy-studio/screenshots/111-companion-openclaw-bridge.png',
    ),
  });
});
