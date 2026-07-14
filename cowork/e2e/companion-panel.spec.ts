import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';

function makeE2eMediaPipeAnalysis() {
  return {
    engine: 'mediapipe_tasks_vision',
    runningMode: 'IMAGE',
    status: 'ok',
    models: ['face_detector_blaze_face_short_range', 'hand_landmarker', 'pose_landmarker_lite'],
    faceCount: 1,
    handCount: 1,
    poseCount: 1,
    elapsedMs: 24,
    faces: [
      {
        boundingBox: { x: 10, y: 20, width: 120, height: 120 },
        confidence: 0.93,
        keypoints: [],
      },
    ],
    hands: [
      {
        handedness: 'Right',
        confidence: 0.88,
        landmarks: [],
        fingerTips: {
          thumb: { x: 0.1, y: 0.2 },
          index: { x: 0.2, y: 0.1 },
          middle: { x: 0.3, y: 0.1 },
        },
      },
    ],
    poses: [
      {
        landmarkCount: 33,
        landmarks: [],
      },
    ],
  };
}

function makeE2eNoPresenceMediaPipeAnalysis() {
  return {
    ...makeE2eMediaPipeAnalysis(),
    faceCount: 0,
    handCount: 0,
    poseCount: 0,
    faces: [],
    hands: [],
    poses: [],
  };
}

function makeE2eVisionInspection(
  cwd: string,
  capturedAt?: number,
  mediaPipe = makeE2eMediaPipeAnalysis(),
) {
  return {
    ok: true,
    result: {
      success: true,
      path: `${cwd}/.codebuddy/companion/camera/e2e-frame.png`,
      snapshot: {
        success: true,
        path: `${cwd}/.codebuddy/companion/camera/e2e-frame.png`,
        output: 'deterministic camera frame captured',
        command: 'deterministic-camera-frame',
        perceptId: 'percept_e2e_camera',
        ...(capturedAt === undefined ? {} : { capturedAt }),
        mediaPipe,
      },
      analysis: {
        description: 'Deterministic e2e frame with the companion cockpit in view.',
        labels: ['cockpit', 'camera', 'companion'],
        dimensions: { width: 640, height: 360 },
        format: 'png',
        size: 4096,
        channels: 4,
      },
      ocrText: 'Buddy companion',
      summary: 'Camera frame inspected by deterministic e2e backend.',
      perceptId: 'percept_e2e_camera',
      safetyEventId: 'safety_e2e_camera',
    },
  };
}

async function installBrowserSpeechFallback(page: Page) {
  await page.evaluate(() => {
    type E2EWindow = typeof window & { __coworkSpokenTexts?: string[] };
    const e2eWindow = window as E2EWindow;
    e2eWindow.localStorage.setItem('cowork.voice.tts.enabled', '1');
    e2eWindow.__coworkSpokenTexts = [];
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class E2ESpeechSynthesisUtterance {
        lang = 'fr-FR';
        onend: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisEvent) => unknown) | null = null;
        pitch = 1;
        rate = 1;
        volume = 1;

        constructor(public text: string) {}
      },
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speaking: false,
        pending: false,
        cancel: () => undefined,
        speak: (utterance: SpeechSynthesisUtterance) => {
          e2eWindow.__coworkSpokenTexts?.push(utterance.text);
          utterance.onend?.call(utterance, new Event('end') as SpeechSynthesisEvent);
        },
      },
    });
  });
}

async function expectSpokenText(page: Page, expected: string) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        type E2EWindow = typeof window & { __coworkSpokenTexts?: string[] };
        return ((window as E2EWindow).__coworkSpokenTexts ?? []).join('\n');
      }),
    )
    .toContain(expected);
}

async function mockCompanionBackend(electronApp: ElectronApplication, workspacePath: string) {
  await electronApp.evaluate(({ ipcMain }, input) => {
    const { cwd, initialVisionInspection } = input;
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
        autoSend: true,
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
        autoSpeak: true,
      },
      camera: {
        available: false,
        ffmpegAvailable: false,
        platform: 'e2e',
        reason: 'Camera is skipped in deterministic e2e.',
      },
      percepts: stats,
    };
    const e2eGlobal = globalThis as typeof globalThis & {
      __coworkE2eCompanionStatus?: typeof status;
    };
    e2eGlobal.__coworkE2eCompanionStatus = status;
    const percept = {
      id: 'percept_e2e_self',
      modality: 'self',
      source: 'e2e',
      timestamp: now,
      confidence: 1,
      summary: 'Buddy is awake enough to report readiness in the cockpit.',
      payload: {},
      tags: ['e2e', 'companion'],
    };
    const percepts = [percept];
    const mission = {
      id: 'mission_e2e_review_delta',
      title: 'Review competitor delta',
      dimension: 'companion cockpit',
      status: 'open',
      priority: 'P1',
      summary: 'Compare the cockpit loop against companion baselines.',
      recommendation: 'Keep the self-improvement loop visible and actionable.',
      sourceGapId: 'gap-e2e',
      sourceRadarId: 'radar_e2e',
      competitorRefs: ['Lisa', 'PromptCommander'],
      command: 'buddy companion improve --run-mission',
      tags: ['e2e'],
      createdAt: now,
      updatedAt: now,
    };
    const board = {
      schemaVersion: 1,
      cwd,
      storePath: `${cwd}/.codebuddy/companion/missions.json`,
      updatedAt: now,
      missions: [mission],
    };
    const radar = {
      id: 'radar_e2e',
      timestamp: now,
      cwd,
      score: 88,
      currentStrengths: ['Bidirectional voice cockpit', 'Project-scoped memory'],
      gaps: [],
      nextMoves: ['Keep the cockpit loop under e2e coverage.'],
      sourceNotes: ['Deterministic e2e backend'],
    };
    const privacyReport = {
      schemaVersion: 1,
      cwd,
      generatedAt: now,
      stores: [
        {
          kind: 'percepts',
          path: `${cwd}/.codebuddy/companion/percepts.jsonl`,
          exists: true,
          bytes: 512,
          entries: 1,
        },
      ],
      totalBytes: 512,
      totalEntries: 1,
    };

    const channels = [
      'companion.setup',
      'companion.status',
      'companion.percepts.recent',
      'companion.percepts.stats',
      'companion.self.record',
      'companion.evaluate',
      'companion.radar',
      'companion.improve',
      'companion.impulses',
      'companion.checkIn',
      'companion.missions.sync',
      'companion.missions.list',
      'companion.missions.runNext',
      'companion.safety.recent',
      'companion.safety.stats',
      'companion.cards.list',
      'companion.avatar.renderers',
      'companion.gateway.profile',
      'companion.skills.list',
      'companion.privacy.report',
      'companion.camera.status',
      'companion.camera.snapshot',
      'companion.camera.rendererSnapshot',
      'companion.camera.inspect',
      'voice.conversationStatus',
      'voice.status',
      'voice.ttsStatus',
      'voice.diagnostics',
    ];
    for (const channel of channels) ipcMain.removeHandler(channel);

    ipcMain.handle('companion.status', async () => ({
      ok: true,
      status: e2eGlobal.__coworkE2eCompanionStatus ?? status,
    }));
    ipcMain.handle('companion.percepts.recent', async (_event, input?: { modality?: string }) => ({
      ok: true,
      items: input?.modality
        ? percepts.filter((item) => item.modality === input.modality)
        : percepts,
    }));
    ipcMain.handle('companion.percepts.stats', async () => ({ ok: true, stats }));
    ipcMain.handle('companion.self.record', async () => ({ ok: true, percept }));
    ipcMain.handle('companion.setup', async () => ({
      ok: true,
      result: {
        setup: {
          cwd,
          wroteSoul: false,
          wroteBoot: false,
          skippedSoul: true,
          skippedBoot: true,
          voiceConfigured: true,
          modelConfigured: true,
          model: 'gpt-5.5',
          status,
        },
        selfPercept: percept,
      },
    }));
    ipcMain.handle('companion.evaluate', async () => ({
      ok: true,
      evaluation: {
        id: 'eval_e2e',
        timestamp: now,
        cwd,
        score: 91,
        level: 'collaborative',
        findings: [
          {
            id: 'finding_e2e',
            area: 'cockpit',
            severity: 'info',
            summary: 'The companion cockpit can be driven from a real Electron window.',
            recommendation: 'Keep this flow covered before changing companion IPC.',
            tags: ['e2e'],
          },
        ],
        strengths: ['Project-aware readiness', 'Self-improvement loop'],
        nextActions: ['Pilot the cockpit before release.'],
        perceptStats: stats,
      },
    }));
    ipcMain.handle('companion.radar', async () => ({ ok: true, radar }));
    ipcMain.handle('companion.improve', async () => ({
      ok: true,
      cycle: {
        id: 'cycle_e2e',
        timestamp: now,
        cwd,
        dryRun: false,
        recorded: true,
        radar,
        board,
        missionRun: {
          success: true,
          dryRun: false,
          message: 'Companion improvement cycle completed.',
          mission,
          board,
          brief: 'E2E improvement loop completed.',
        },
        nextActions: ['Review competitor delta'],
        perceptId: percept.id,
      },
    }));
    ipcMain.handle('companion.impulses', async () => ({
      ok: true,
      brief: {
        id: 'impulse_e2e',
        timestamp: now,
        cwd,
        summary: 'Buddy sees one next move.',
        nextPrompt: 'Ask Buddy to improve the cockpit loop.',
        impulses: [],
        context: {
          perceptTotal: 1,
          openMissions: 1,
          inProgressMissions: 0,
          safetyEvents: 0,
          latestPerceptTimestamp: now,
        },
      },
    }));
    ipcMain.handle('companion.checkIn', async () => ({
      ok: true,
      cue: {
        id: 'checkin_e2e',
        timestamp: now,
        cwd,
        mood: 'steady',
        priority: 'medium',
        spokenText: 'Je suis pret a continuer avec toi.',
        writtenText: 'Je suis pret a continuer avec toi.',
        nextPrompt: 'Continue the cockpit test.',
        evidence: [],
        brief: {
          id: 'brief_e2e',
          timestamp: now,
          cwd,
          summary: 'Ready',
          nextPrompt: 'Continue.',
          impulses: [],
          context: {
            perceptTotal: 1,
            openMissions: 1,
            inProgressMissions: 0,
            safetyEvents: 0,
          },
        },
      },
    }));
    ipcMain.handle('companion.missions.sync', async () => ({
      ok: true,
      result: { board, radarId: radar.id, created: 1, updated: 0, unchanged: 0 },
    }));
    ipcMain.handle('companion.missions.list', async () => ({ ok: true, items: [mission] }));
    ipcMain.handle('companion.missions.runNext', async () => ({
      ok: true,
      result: {
        success: true,
        dryRun: false,
        message: 'Mission completed.',
        mission,
        board,
      },
    }));
    ipcMain.handle('companion.safety.recent', async () => ({ ok: true, items: [] }));
    ipcMain.handle('companion.safety.stats', async () => ({
      ok: true,
      stats: {
        ledgerPath: `${cwd}/.codebuddy/companion/safety.jsonl`,
        exists: false,
        total: 0,
        byKind: {},
        byRisk: {},
        byStatus: {},
      },
    }));
    ipcMain.handle('companion.cards.list', async () => ({ ok: true, items: [] }));
    ipcMain.handle('companion.avatar.renderers', async () => ({
      ok: true,
      snapshot: {
        generatedAt: now,
        bridgeEnabled: true,
        audioPolicy: 'auto',
        audioStreamingActive: true,
        connectedCount: 1,
        readyCount: 1,
        renderers: [
          {
            rendererId: 'darkstar-metahuman-lisa',
            displayName: 'Lisa MetaHuman on Darkstar',
            protocolVersion: 1,
            runtime: 'unreal',
            runtimeVersion: '5.8',
            project: 'D:/DEV/AvatarStudio',
            capabilities: {
              audioDrivenAnimation: true,
              wavStream: true,
              affect: true,
              gestures: true,
              gaze: true,
              interruptionAck: true,
            },
            phase: 'playing',
            lastSequence: 12,
            fps: 60,
            audioBufferMs: 80,
            mouthLatencyMs: 72,
            droppedAudioChunks: 0,
            connected: true,
            connectedAt: now,
            lastSeenAt: now,
          },
        ],
        privacy: {
          textIncluded: false,
          audioIncluded: false,
          connectionCredentialsIncluded: false,
        },
      },
    }));
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
            channel: 'voice',
            enabled: true,
            mode: 'assist',
            allowOutbound: false,
            requireApprovalForTools: true,
            recordPercepts: true,
            tags: ['dialogue'],
          },
        ],
      },
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
      provider: 'piper',
      bootError: null,
    }));
    ipcMain.handle('companion.camera.status', async () => ({
      ok: true,
      status: {
        available: true,
        platform: 'e2e',
        commandPreview: 'deterministic-camera-frame',
      },
    }));
    ipcMain.handle('companion.camera.snapshot', async () => ({
      ok: true,
      result: {
        success: true,
        path: `${cwd}/.codebuddy/companion/camera/e2e-frame.png`,
        output: 'deterministic camera frame captured',
        command: 'deterministic-camera-frame',
        perceptId: 'percept_e2e_camera',
      },
    }));
    ipcMain.handle('companion.camera.rendererSnapshot', async () => ({
      ok: true,
      result: {
        success: true,
        path: `${cwd}/.codebuddy/companion/camera/e2e-renderer-frame.png`,
        output: 'deterministic renderer camera frame captured',
        command: 'renderer-getUserMedia',
        perceptId: 'percept_e2e_renderer_camera',
      },
    }));
    ipcMain.handle('companion.camera.inspect', async () => initialVisionInspection);
    ipcMain.handle('voice.diagnostics', async () => {
      const diagnosticPercept = {
        id: 'percept_e2e_voice_diagnostics',
        modality: 'tool',
        source: 'cowork_voice_diagnostics',
        timestamp: new Date().toISOString(),
        confidence: 0.85,
        summary: 'Voice diagnostics: STT faster-whisper ready; TTS piper ready; Kyutai STT disabled; Kyutai TTS disabled.',
        payload: {},
        tags: ['voice', 'diagnostics', 'cowork'],
      };
      if (!percepts.some((item) => item.id === diagnosticPercept.id)) {
        percepts.unshift(diagnosticPercept);
      }
      return {
        ok: true,
        checkedAt: diagnosticPercept.timestamp,
        stt: {
          provider: 'faster-whisper',
          available: true,
          fallbackProvider: 'faster-whisper',
          fallbackAvailable: true,
          bootError: null,
        },
        tts: {
          provider: 'piper',
          available: true,
          fallbackProvider: 'piper',
          fallbackAvailable: true,
          bootError: null,
        },
        kyutai: {
          sttEnabled: false,
          ttsEnabled: false,
          baseUrl: 'ws://127.0.0.1:8080',
          apiKeyConfigured: false,
          ffmpegBinary: 'ffmpeg',
          ffmpegFound: true,
          ttsVoice: 'default',
        },
      };
    });
  }, {
    cwd: workspacePath,
    initialVisionInspection: makeE2eVisionInspection(workspacePath),
  });
}

async function createProjectThroughSettings(
  appPage: Page,
  userDataDir: string,
): Promise<string> {
  const workspacePath = path.join(userDataDir, 'buddy-workspace');
  mkdirSync(workspacePath, { recursive: true });
  await appPage.evaluate(async (root) => {
    const project = await window.electronAPI.project.create({
      name: 'Buddy E2E Project',
      workspacePath: root,
    });
    await window.electronAPI.project.setActive(project.id);
  }, workspacePath);

  return workspacePath;
}

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
  const tour = appPage.getByTestId('onboarding-tour');
  if (await tour.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await tour.getByRole('button', { name: 'Passer', exact: true }).click();
    await expect(tour).toBeHidden();
  }
}

async function openCompanionPanel(appPage: Page) {
  const advanced = appPage.getByTitle('Avancé', { exact: true });
  if (await advanced.isVisible().catch(() => false)) {
    await advanced.click();
    await appPage.getByTestId('advanced-feature-companion').click();
    return;
  }
  await appPage.getByText('Outils').click();
  await appPage.getByText('Companion').click();
}

test('drives the Buddy companion cockpit from no project to improvement loop', async ({
  electronApp,
  appPage,
  userDataDir,
}) => {
  await completeOnboardingForTest(appPage);

  await openCompanionPanel(appPage);
  await expect(appPage.getByRole('heading', { name: 'Buddy companion' })).toBeVisible();
  await expect(
    appPage.getByText('Select a project before opening Buddy companion senses.'),
  ).toBeVisible();
  await expect(appPage.getByRole('alert')).toContainText(
    'Select a project before opening Buddy companion senses.',
  );
  await expect(appPage.getByTestId('companion-last-sync')).toHaveCount(0);
  await appPage.getByLabel('Close companion panel').click();

  const workspacePath = await createProjectThroughSettings(appPage, userDataDir);
  await mockCompanionBackend(electronApp, workspacePath);
  await completeOnboardingForTest(appPage);

  await openCompanionPanel(appPage);
  await expect(appPage.getByRole('heading', { name: 'Buddy companion' })).toBeVisible();
  await expect(appPage.getByText(workspacePath, { exact: true })).toBeVisible();
  await expect(appPage.getByTestId('companion-last-sync')).toHaveText('Last sync just now');
  await expect(appPage.getByTestId('companion-last-sync')).toHaveAttribute(
    'aria-label',
    'Companion sync healthy just now; cockpit state is current.',
  );
  await expect(appPage.getByText('Brain').first()).toBeVisible();
  await expect(appPage.getByText('Companion identity')).toBeVisible();
  const avatarRenderer = appPage.getByTestId('companion-avatar-renderers');
  await avatarRenderer.scrollIntoViewIfNeeded();
  await expect(avatarRenderer).toContainText('Incarnation MetaHuman');
  await expect(avatarRenderer).toContainText('Lisa MetaHuman on Darkstar');
  await expect(avatarRenderer).toContainText('voix → visage active');
  await expect(avatarRenderer).toContainText('72 ms');
  await avatarRenderer.screenshot({ path: '/tmp/cowork-companion-metahuman-status.png' });
  await expect(appPage.getByText('Ready / chatgpt-pro')).toBeVisible();
  await electronApp.evaluate(() => {
    const e2eGlobal = globalThis as typeof globalThis & {
      __coworkE2eCompanionStatus?: { model: string };
    };
    if (e2eGlobal.__coworkE2eCompanionStatus) {
      e2eGlobal.__coworkE2eCompanionStatus = {
        ...e2eGlobal.__coworkE2eCompanionStatus,
        model: 'gpt-5.5-focus',
      };
    }
  });
  await appPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(appPage.getByText('gpt-5.5-focus').first()).toBeVisible();
  await electronApp.evaluate(() => {
    const e2eGlobal = globalThis as typeof globalThis & {
      __coworkE2eCompanionStatus?: { model: string };
    };
    if (e2eGlobal.__coworkE2eCompanionStatus) {
      e2eGlobal.__coworkE2eCompanionStatus = {
        ...e2eGlobal.__coworkE2eCompanionStatus,
        model: 'gpt-5.5',
      };
    }
  });
  await appPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(appPage.getByText('gpt-5.5').first()).toBeVisible();
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('companion.skills.list');
    ipcMain.handle('companion.skills.list', async () => ({
      ok: false,
      error: 'skills list unavailable during e2e partial sync',
    }));
  });
  await appPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(appPage.getByTestId('companion-last-sync')).toHaveText('Last sync partial just now');
  await expect(appPage.getByTestId('companion-last-sync')).toHaveAttribute(
    'aria-label',
    'Companion sync partial just now; Buddy will retry automatically.',
  );
  const syncPulse = appPage.getByTestId('companion-pulse');
  await expect(syncPulse).toContainText('Buddy pulse needs attention');
  await expect(syncPulse.getByLabel('Sync: Partial / just now; needs attention')).toBeVisible();
  await expect(appPage.getByTestId('companion-pulse-next')).toContainText(
    'Retry companion sync so Buddy refreshes the cockpit before acting.',
  );
  await expect(syncPulse.getByTestId('companion-pulse-action')).toHaveText('Retry companion sync');
  await expect(appPage.getByRole('button', { name: 'Retry companion sync' })).toHaveCount(2);
  await expect(appPage.getByText('skills list unavailable during e2e partial sync')).toBeVisible();
  await expect(appPage.getByRole('alert')).toContainText(
    'skills list unavailable during e2e partial sync',
  );
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('companion.skills.list');
    ipcMain.handle('companion.skills.list', async () => ({ ok: true, items: [] }));
  });
  await syncPulse.getByTestId('companion-pulse-action').click();
  await expect(appPage.getByTestId('companion-last-sync')).toHaveText('Last sync just now', {
    timeout: 15_000,
  });
  await expect(appPage.getByTestId('companion-last-sync')).toHaveAttribute(
    'aria-label',
    'Companion sync healthy just now; cockpit state is current.',
  );
  await expect(
    appPage.getByText('skills list unavailable during e2e partial sync'),
  ).toHaveCount(0);
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('companion.status');
    ipcMain.handle('companion.status', async () => ({
      ok: false,
      error: 'status endpoint unavailable during e2e failed sync',
    }));
  });
  await appPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(appPage.getByTestId('companion-last-sync')).toHaveText('Last sync failed just now');
  await expect(appPage.getByTestId('companion-last-sync')).toHaveAttribute(
    'aria-label',
    'Companion sync failed just now; Buddy will retry automatically.',
  );
  await expect(syncPulse).toContainText('Buddy pulse needs attention');
  await expect(syncPulse.getByLabel('Sync: Failed / just now; needs attention')).toBeVisible();
  await expect(appPage.getByTestId('companion-pulse-next')).toContainText(
    'Retry companion sync so Buddy refreshes the cockpit before acting.',
  );
  await expect(appPage.getByText('status endpoint unavailable during e2e failed sync')).toBeVisible();
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('voice.speak');
    ipcMain.handle('voice.speak', async () => ({
      ok: false,
      error: 'e2e uses browser speech fallback',
    }));
  });
  await installBrowserSpeechFallback(appPage);
  await syncPulse.getByRole('button', { name: 'Speak pulse' }).click();
  await expectSpokenText(appPage, 'Buddy pulse needs attention.');
  await expectSpokenText(appPage, 'companion systems ready');
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('companion.status');
    ipcMain.handle('companion.status', async () => {
      const e2eGlobal = globalThis as typeof globalThis & {
        __coworkE2eCompanionStatus?: unknown;
      };
      return { ok: true, status: e2eGlobal.__coworkE2eCompanionStatus };
    });
  });
  await syncPulse.getByTestId('companion-pulse-action').click();
  await expect(appPage.getByTestId('companion-last-sync')).toHaveText('Last sync just now', {
    timeout: 15_000,
  });
  await expect(
    appPage.getByText('status endpoint unavailable during e2e failed sync'),
  ).toHaveCount(0);

  await appPage.getByRole('button', { name: 'Self-evaluate' }).click();
  await expect(appPage.getByText('Self-evaluation')).toBeVisible();
  await expect(appPage.getByText('Pilot the cockpit before release.')).toBeVisible();

  await appPage.getByRole('button', { name: 'Improve loop' }).click();
  await expect(appPage.getByRole('heading', { name: 'Improvement loop' })).toBeVisible();
  await expect(appPage.getByText('[P1] Review competitor delta', { exact: true })).toBeVisible();

  await appPage.evaluate(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException('No deterministic camera device', 'NotFoundError');
        },
      },
    });
  });

  await appPage.getByRole('button', { name: 'Inspect camera' }).click();
  await expect(appPage.getByText('Vision inspection')).toBeVisible();
  await expect(
    appPage.getByText('Camera frame inspected by deterministic e2e backend.'),
  ).toBeVisible();
  const mediaPipeSummary = appPage.getByTestId('mediapipe-vision-summary');
  await expect(mediaPipeSummary).toContainText('MediaPipe ok: 1 face, 1 hand, 1 pose');
  await expect(mediaPipeSummary).toContainText('Right: thumb, index, middle');
  await expect(mediaPipeSummary).toContainText('mediapipe_tasks_vision');
  const companionPulse = appPage.getByTestId('companion-pulse');
  await expect(companionPulse).toHaveAttribute('role', 'status');
  await expect(companionPulse).toHaveAttribute('aria-live', 'polite');
  await expect(companionPulse).toContainText('Buddy pulse steady');
  await expect(companionPulse).toContainText('6/6 companion systems ready');
  await expect(companionPulse).toContainText('VoiceReady / runtime status');
  await expect(companionPulse).toContainText('WakeReady / text-match: buddy');
  await expect(appPage.getByTestId('status-tile-wake-word')).toContainText(
    'Ready / text-match: buddy',
  );
  await expect(companionPulse).toContainText('VisionMediaPipe ok: 1 face, 1 hand, 1 pose');
  await expect(appPage.getByTestId('status-tile-camera')).toContainText(
    'MediaPipe ok: 1 face, 1 hand, 1 pose',
  );
  await expect(companionPulse).toContainText('ContextFresh / self just now');
  await expect(companionPulse.getByLabel('Brain: gpt-5.5; ready')).toBeVisible();
  await expect(companionPulse.getByLabel('Voice: Ready / runtime status; ready')).toBeVisible();
  await expect(companionPulse.getByLabel('Wake: Ready / text-match: buddy; ready')).toBeVisible();
  await expect(companionPulse.getByLabel('Context: Fresh / self just now; ready')).toBeVisible();
  await expect(appPage.getByTestId('companion-pulse-next')).toContainText(
    'Keep working with Buddy; run a check-in when you want a spoken status.',
  );
  await expect(companionPulse.getByRole('button', { name: 'Buddy check-in' })).toBeVisible();
  await expect(companionPulse.getByRole('button', { name: 'Speak pulse' })).toBeVisible();
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('voice.speak');
    ipcMain.handle('voice.speak', async () => ({
      ok: false,
      error: 'e2e uses browser speech fallback',
    }));
  });
  await installBrowserSpeechFallback(appPage);
  await companionPulse.getByRole('button', { name: 'Speak pulse' }).click();
  await expectSpokenText(appPage, 'Buddy pulse steady. 6/6 companion systems ready.');

  await electronApp.evaluate(() => {
    const e2eGlobal = globalThis as typeof globalThis & {
      __coworkE2eCompanionStatus?: {
        wakeWord?: { available?: boolean };
      };
    };
    if (e2eGlobal.__coworkE2eCompanionStatus?.wakeWord) {
      e2eGlobal.__coworkE2eCompanionStatus.wakeWord.available = false;
    }
  });
  await appPage.getByLabel('Refresh companion panel').click();
  await expect(companionPulse).toContainText('Buddy pulse needs attention');
  await expect(companionPulse).toContainText('5/6 companion systems ready');
  await expect(companionPulse).toContainText('WakeNeeds attention / text-match: buddy');
  await expect(appPage.getByTestId('status-tile-wake-word')).toContainText(
    'Needs attention / text-match: buddy',
  );
  await expect(
    companionPulse.getByLabel('Wake: Needs attention / text-match: buddy; needs attention'),
  ).toBeVisible();
  await expect(appPage.getByTestId('companion-pulse-next')).toContainText(
    'Run Inspect voice or configure wake word so Buddy can hear spoken instructions hands-free.',
  );
  await electronApp.evaluate(() => {
    const e2eGlobal = globalThis as typeof globalThis & {
      __coworkE2eCompanionStatus?: {
        wakeWord?: { available?: boolean };
      };
    };
    if (e2eGlobal.__coworkE2eCompanionStatus?.wakeWord) {
      e2eGlobal.__coworkE2eCompanionStatus.wakeWord.available = true;
    }
  });
  await appPage.getByLabel('Refresh companion panel').click();
  await expect(companionPulse).toContainText('Buddy pulse steady');
  await expect(companionPulse).toContainText('6/6 companion systems ready');
  await expect(appPage.getByTestId('status-tile-wake-word')).toContainText(
    'Ready / text-match: buddy',
  );

  await companionPulse.getByRole('button', { name: 'Buddy check-in' }).click();
  await expect(appPage.getByRole('heading', { name: 'Check-in' })).toBeVisible();
  await expect(appPage.getByText('Je suis pret a continuer avec toi.')).toBeVisible();

  await electronApp.evaluate(({ ipcMain }, cwd) => {
    const staleTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const freshTimestamp = () => new Date().toISOString();
    let contextPercepts = [
      {
        id: 'percept_e2e_stale_self',
        modality: 'self',
        source: 'e2e',
        timestamp: staleTimestamp,
        confidence: 1,
        summary: 'Buddy has not refreshed its local self-state recently.',
        payload: {},
        tags: ['e2e', 'companion', 'stale'],
      },
    ];
    let contextStats = {
      storePath: `${cwd}/.codebuddy/companion/percepts.jsonl`,
      exists: true,
      total: contextPercepts.length,
      byModality: { self: contextPercepts.length },
      latestTimestamp: staleTimestamp,
    };
    const refreshStats = () => {
      contextStats = {
        ...contextStats,
        total: contextPercepts.length,
        byModality: contextPercepts.reduce<Record<string, number>>((acc, percept) => {
          acc[percept.modality] = (acc[percept.modality] ?? 0) + 1;
          return acc;
        }, {}),
        latestTimestamp: contextPercepts
          .map((percept) => percept.timestamp)
          .sort()
          .at(-1),
      };
    };

    ipcMain.removeHandler('companion.percepts.recent');
    ipcMain.handle('companion.percepts.recent', async (_event, input?: { modality?: string }) => ({
      ok: true,
      items: input?.modality
        ? contextPercepts.filter((item) => item.modality === input.modality)
        : contextPercepts,
    }));
    ipcMain.removeHandler('companion.percepts.stats');
    ipcMain.handle('companion.percepts.stats', async () => ({ ok: true, stats: contextStats }));
    ipcMain.removeHandler('companion.self.record');
    ipcMain.handle('companion.self.record', async () => {
      const percept = {
        id: `percept_e2e_self_${Date.now()}`,
        modality: 'self',
        source: 'e2e',
        timestamp: freshTimestamp(),
        confidence: 1,
        summary: 'Buddy refreshed its local self-state from the pulse.',
        payload: {},
        tags: ['e2e', 'companion', 'fresh'],
      };
      contextPercepts = [percept, ...contextPercepts];
      refreshStats();
      return { ok: true, percept };
    });
    ipcMain.removeHandler('voice.diagnostics');
    ipcMain.handle('voice.diagnostics', async () => {
      const diagnosticPercept = {
        id: 'percept_e2e_voice_diagnostics',
        modality: 'tool',
        source: 'cowork_voice_diagnostics',
        timestamp: freshTimestamp(),
        confidence: 0.85,
        summary: 'Voice diagnostics: STT faster-whisper ready; TTS piper ready; Kyutai STT disabled; Kyutai TTS disabled.',
        payload: {},
        tags: ['voice', 'diagnostics', 'cowork'],
      };
      if (!contextPercepts.some((item) => item.id === diagnosticPercept.id)) {
        contextPercepts = [diagnosticPercept, ...contextPercepts];
        refreshStats();
      }
      return {
        ok: true,
        checkedAt: diagnosticPercept.timestamp,
        stt: {
          provider: 'faster-whisper',
          available: true,
          fallbackProvider: 'faster-whisper',
          fallbackAvailable: true,
          bootError: null,
        },
        tts: {
          provider: 'piper',
          available: true,
          fallbackProvider: 'piper',
          fallbackAvailable: true,
          bootError: null,
        },
        kyutai: {
          sttEnabled: false,
          ttsEnabled: false,
          baseUrl: 'ws://127.0.0.1:8080',
          apiKeyConfigured: false,
          ffmpegBinary: 'ffmpeg',
          ffmpegFound: true,
          ttsVoice: 'default',
        },
      };
    });
  }, workspacePath);
  await appPage.getByLabel('Refresh companion panel').click();
  await expect(companionPulse).toContainText('Buddy pulse needs attention');
  await expect(companionPulse).toContainText('5/6 companion systems ready');
  await expect(companionPulse).toContainText('ContextStale / self 2h ago');
  await expect(companionPulse.getByLabel('Context: Stale / self 2h ago; needs attention')).toBeVisible();
  await expect(appPage.getByTestId('companion-pulse-next')).toContainText(
    'Record self-state so Buddy refreshes its local context before acting.',
  );
  await expect(companionPulse.getByRole('button', { name: 'Record self-state' })).toBeVisible();
  await companionPulse.getByRole('button', { name: 'Record self-state' }).click();
  await expect(companionPulse).toContainText('Buddy pulse steady');
  await expect(companionPulse).toContainText('6/6 companion systems ready');
  await expect(companionPulse).toContainText('ContextFresh / self just now');
  await expect(appPage.getByText('Buddy refreshed its local self-state from the pulse.')).toBeVisible();

  await electronApp.evaluate(({ ipcMain }, staleVisionInspection) => {
    ipcMain.removeHandler('companion.camera.inspect');
    ipcMain.handle('companion.camera.inspect', async () => staleVisionInspection);
  }, makeE2eVisionInspection(workspacePath, Date.now() - 60 * 60 * 1000));
  await appPage.getByRole('button', { name: 'Inspect camera' }).click();
  await expect(companionPulse).toContainText('Buddy pulse needs attention');
  await expect(companionPulse).toContainText('5/6 companion systems ready');
  await expect(companionPulse).toContainText('VisionStale MediaPipe / 1h ago');
  await expect(
    companionPulse.getByLabel('Vision: Stale MediaPipe / 1h ago; needs attention'),
  ).toBeVisible();
  await expect(appPage.getByTestId('companion-pulse-next')).toContainText(
    'Run Inspect camera so Buddy can refresh its local visual context.',
  );

  await electronApp.evaluate(({ ipcMain }, freshVisionInspection) => {
    ipcMain.removeHandler('companion.camera.inspect');
    ipcMain.handle('companion.camera.inspect', async () => freshVisionInspection);
  }, makeE2eVisionInspection(workspacePath, Date.now()));
  await companionPulse.getByRole('button', { name: 'Inspect camera' }).click();
  await expect(companionPulse).toContainText('Buddy pulse steady');
  await expect(companionPulse).toContainText('6/6 companion systems ready');
  await expect(companionPulse).toContainText('VisionMediaPipe ok: 1 face, 1 hand, 1 pose');

  await electronApp.evaluate(({ ipcMain }, noPresenceVisionInspection) => {
    ipcMain.removeHandler('companion.camera.inspect');
    ipcMain.handle('companion.camera.inspect', async () => noPresenceVisionInspection);
  }, makeE2eVisionInspection(workspacePath, Date.now(), makeE2eNoPresenceMediaPipeAnalysis()));
  await appPage.getByRole('button', { name: 'Inspect camera' }).click();
  await expect(companionPulse).toContainText('Buddy pulse needs attention');
  await expect(companionPulse).toContainText('5/6 companion systems ready');
  await expect(companionPulse).toContainText(
    'VisionNo presence / MediaPipe ok: 0 faces, 0 hands, 0 poses',
  );
  await expect(appPage.getByTestId('status-tile-camera')).toContainText(
    'No presence / MediaPipe ok: 0 faces, 0 hands, 0 poses',
  );
  await expect(
    companionPulse.getByLabel('Vision: No presence / MediaPipe ok: 0 faces, 0 hands, 0 poses; needs attention'),
  ).toBeVisible();
  await expect(appPage.getByTestId('companion-pulse-next')).toContainText(
    'Run Inspect camera so Buddy can refresh its local visual context.',
  );

  await electronApp.evaluate(({ ipcMain }, freshVisionInspection) => {
    ipcMain.removeHandler('companion.camera.inspect');
    ipcMain.handle('companion.camera.inspect', async () => freshVisionInspection);
  }, makeE2eVisionInspection(workspacePath, Date.now()));
  await companionPulse.getByRole('button', { name: 'Inspect camera' }).click();
  await expect(companionPulse).toContainText('Buddy pulse steady');
  await expect(companionPulse).toContainText('6/6 companion systems ready');
  await expect(companionPulse).toContainText('VisionMediaPipe ok: 1 face, 1 hand, 1 pose');

  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('voice.conversationStatus');
    ipcMain.handle('voice.conversationStatus', async () => ({
      phase: 'idle',
      startedAt: Date.now() - 2 * 60 * 60 * 1000,
      updatedAt: Date.now() - 2 * 60 * 60 * 1000,
      turnId: 3,
      interruptionCount: 0,
    }));
  });
  await appPage.getByLabel('Refresh companion panel').click();
  await expect(companionPulse).toContainText('Buddy pulse needs attention');
  await expect(companionPulse).toContainText('5/6 companion systems ready');
  await expect(companionPulse).toContainText('DialogueStale / idle 2h ago');
  await expect(appPage.getByTestId('status-tile-dialogue')).toContainText('Stale / idle 2h ago');
  await expect(
    companionPulse.getByLabel('Dialogue: Stale / idle 2h ago; needs attention'),
  ).toBeVisible();
  await expect(appPage.getByTestId('companion-pulse-next')).toContainText(
    'Open voice chat or start listening before expecting bidirectional dialogue.',
  );

  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('voice.conversationStatus');
    ipcMain.handle('voice.conversationStatus', async () => ({
      phase: 'interrupted',
      startedAt: Date.now() - 10_000,
      updatedAt: Date.now(),
      turnId: 4,
      interruptionCount: 1,
      lastInterruptionReason: 'barge_in',
      interruptedTurnId: 4,
      pendingInterruption: true,
      resumedAfterInterruption: false,
      resumeInstruction: 'Listen to the next user speech as a correction or higher-priority instruction before continuing.',
      hadPlaybackDuringLastInterruption: true,
    }));
  });
  await appPage.getByLabel('Refresh companion panel').click();
  await expect(companionPulse).toContainText('Buddy pulse needs attention');
  await expect(companionPulse).toContainText('5/6 companion systems ready');
  await expect(companionPulse).toContainText('DialogueInterruption pending / barge_in / 1 interrupt');
  await expect(appPage.getByTestId('status-tile-dialogue')).toContainText(
    'Interruption pending / barge_in / 1 interrupt',
  );
  await expect(
    companionPulse.getByLabel('Dialogue: Interruption pending / barge_in / 1 interrupt; needs attention'),
  ).toBeVisible();
  await expect(appPage.getByTestId('companion-pulse-next')).toContainText(
    'Listen to the next user speech as a correction or higher-priority instruction before continuing.',
  );

  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('voice.conversationStatus');
    ipcMain.handle('voice.conversationStatus', async () => ({
      phase: 'error',
      startedAt: Date.now() - 1000,
      updatedAt: Date.now(),
      turnId: 0,
      interruptionCount: 0,
    }));
  });
  await appPage.getByLabel('Refresh companion panel').click();
  await expect(companionPulse).toContainText('Buddy pulse needs attention');
  await expect(companionPulse).toContainText('5/6 companion systems ready');
  await expect(appPage.getByTestId('companion-pulse-next')).toContainText(
    'Open voice chat or start listening before expecting bidirectional dialogue.',
  );
  await expect(companionPulse.getByRole('button', { name: 'Open voice chat' })).toBeVisible();
  await companionPulse.getByRole('button', { name: 'Open voice chat' }).click();
  await expect(appPage.getByRole('dialog').getByTestId('voice-overlay-mic')).toBeVisible();
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('voice.conversationStatus');
    ipcMain.handle('voice.conversationStatus', async () => ({
      phase: 'idle',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      turnId: 0,
      interruptionCount: 0,
    }));
  });
  await appPage.keyboard.press('Escape');
  await appPage.getByLabel('Refresh companion panel').click();
  await expect(companionPulse).toContainText('Buddy pulse steady');
  await expect(companionPulse).toContainText('6/6 companion systems ready');

  await appPage.getByRole('button', { name: 'Vision' }).click();
  await appPage.getByRole('button', { name: 'Inspect voice' }).click();
  await expect(appPage.getByRole('heading', { name: 'Voice diagnostics' })).toBeVisible();
  await expect(appPage.getByTestId('voice-diagnostics-summary')).toHaveText(
    'Voice path ready: input, output, and fallbacks are available.',
  );
  await expect(appPage.getByTestId('voice-diagnostics-actions')).toHaveCount(0);
  await expect(appPage.getByText('STT route')).toBeVisible();
  await expect(appPage.getByText('TTS route')).toBeVisible();
  await expect(appPage.getByText('tool/cowork_voice_diagnostics')).toBeVisible();
  await expect(appPage.getByText('Voice diagnostics: STT faster-whisper ready')).toBeVisible();
  await expect(companionPulse).toContainText('VoiceReady / diagnostic just now');
  await expect(companionPulse.getByLabel('Voice: Ready / diagnostic just now; ready')).toBeVisible();
  await expect(appPage.getByTestId('status-tile-voice-input')).toContainText(
    'Ready / faster-whisper / faster-whisper',
  );
  await expect(appPage.getByTestId('status-tile-voice-output')).toContainText(
    'Ready / piper / piper',
  );

  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('voice.diagnostics');
    ipcMain.handle('voice.diagnostics', async () => ({
      ok: true,
      checkedAt: new Date().toISOString(),
      stt: {
        provider: 'faster-whisper',
        available: true,
        fallbackProvider: 'faster-whisper',
        fallbackAvailable: true,
        bootError: null,
      },
      tts: {
        provider: 'kyutai',
        available: true,
        fallbackProvider: 'piper',
        fallbackAvailable: false,
        bootError: 'piper voice missing',
      },
      kyutai: {
        sttEnabled: false,
        ttsEnabled: true,
        baseUrl: 'ws://127.0.0.1:8080',
        apiKeyConfigured: false,
        ffmpegBinary: 'ffmpeg',
        ffmpegFound: true,
        ttsVoice: 'default',
        ttsProbe: {
          ok: true,
          endpoint: 'ws://127.0.0.1:8080/api/tts_streaming',
          durationMs: 15,
        },
      },
    }));
  });
  await appPage.getByRole('button', { name: 'Inspect voice' }).click();
  await expect(appPage.getByTestId('voice-diagnostics-summary')).toHaveText(
    'Needs attention: piper fallback offline',
  );
  let voiceActions = appPage.getByTestId('voice-diagnostics-actions');
  await expect(voiceActions).toContainText(
    'Restore the TTS fallback so Buddy can keep speaking if the primary route drops.',
  );
  await expect(companionPulse).toContainText('Buddy pulse needs attention');
  await expect(companionPulse).toContainText('5/6 companion systems ready');
  await expect(companionPulse).toContainText('VoiceNeeds attention / diagnostic just now');
  await expect(appPage.getByTestId('status-tile-voice-input')).toContainText(
    'Ready / faster-whisper / faster-whisper',
  );
  await expect(appPage.getByTestId('status-tile-voice-output')).toContainText(
    'Degraded / kyutai / piper unavailable',
  );
  await expect(appPage.getByTestId('companion-pulse-next')).toContainText(
    'Run Inspect voice and follow the recovery cues before starting a spoken loop.',
  );

  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('companion.status');
    ipcMain.handle('companion.status', async () => ({
      ok: false,
      error: 'NO_ACTIVE_PROJECT',
    }));
  });
  await appPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(appPage.getByRole('alert')).toContainText(
    'Select a project before opening Buddy companion senses.',
  );
  await expect(appPage.getByTestId('companion-last-sync')).toHaveCount(0);
  await expect(appPage.getByRole('heading', { name: 'Vision inspection' })).toHaveCount(0);
  await expect(appPage.getByRole('heading', { name: 'Voice diagnostics' })).toHaveCount(0);
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('companion.status');
    ipcMain.handle('companion.status', async () => {
      const e2eGlobal = globalThis as typeof globalThis & {
        __coworkE2eCompanionStatus?: unknown;
      };
      return { ok: true, status: e2eGlobal.__coworkE2eCompanionStatus };
    });
  });
  await appPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(appPage.getByText(workspacePath, { exact: true })).toBeVisible();
  await expect(appPage.getByTestId('companion-last-sync')).toHaveText('Last sync just now', {
    timeout: 15_000,
  });

  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('voice.diagnostics');
    ipcMain.handle('voice.diagnostics', async () => ({
      ok: true,
      checkedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      stt: {
        provider: 'faster-whisper',
        available: true,
        fallbackProvider: 'faster-whisper',
        fallbackAvailable: true,
        bootError: null,
      },
      tts: {
        provider: 'piper',
        available: true,
        fallbackProvider: 'piper',
        fallbackAvailable: true,
        bootError: null,
      },
      kyutai: {
        sttEnabled: false,
        ttsEnabled: false,
        baseUrl: 'ws://127.0.0.1:8080',
        apiKeyConfigured: false,
        ffmpegBinary: 'ffmpeg',
        ffmpegFound: true,
        ttsVoice: 'default',
      },
    }));
  });
  await appPage.getByRole('button', { name: 'Inspect voice' }).click();
  await expect(companionPulse).toContainText('Buddy pulse needs attention');
  await expect(companionPulse).toContainText('5/6 companion systems ready');
  await expect(companionPulse).toContainText('VoiceStale diagnostic / 45m ago');
  await expect(appPage.getByTestId('status-tile-voice-input')).toContainText(
    'Stale diagnostic / 45m ago',
  );
  await expect(appPage.getByTestId('status-tile-voice-output')).toContainText(
    'Stale diagnostic / 45m ago',
  );
  await expect(
    companionPulse.getByLabel('Voice: Stale diagnostic / 45m ago; needs attention'),
  ).toBeVisible();
  await expect(appPage.getByTestId('companion-pulse-next')).toContainText(
    'Run Inspect voice and follow the recovery cues before starting a spoken loop.',
  );

  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('voice.diagnostics');
    ipcMain.handle('voice.diagnostics', async () => ({
      ok: true,
      checkedAt: new Date().toISOString(),
      stt: {
        provider: 'kyutai',
        available: false,
        fallbackProvider: 'faster-whisper',
        fallbackAvailable: false,
        bootError: 'faster-whisper worker unavailable',
      },
      tts: {
        provider: 'kyutai',
        available: true,
        fallbackProvider: 'piper',
        fallbackAvailable: false,
        bootError: 'piper voice missing',
      },
      kyutai: {
        sttEnabled: true,
        ttsEnabled: true,
        baseUrl: 'ws://127.0.0.1:8080',
        apiKeyConfigured: false,
        ffmpegBinary: 'ffmpeg',
        ffmpegFound: false,
        ttsVoice: 'default',
        sttProbe: {
          ok: false,
          endpoint: 'ws://127.0.0.1:8080/api/asr-streaming',
          durationMs: 750,
          error: 'connect ECONNREFUSED',
        },
        ttsProbe: {
          ok: true,
          endpoint: 'ws://127.0.0.1:8080/api/tts_streaming',
          durationMs: 12,
        },
      },
    }));
  });
  await companionPulse.getByRole('button', { name: 'Inspect voice' }).click();
  await expect(appPage.getByTestId('voice-diagnostics-summary')).toHaveText(
    'Needs attention: STT route offline; faster-whisper fallback offline; piper fallback offline; Kyutai STT offline; ...',
  );
  voiceActions = appPage.getByTestId('voice-diagnostics-actions');
  await expect(voiceActions).toBeVisible();
  await expect(voiceActions).toContainText('STT route offline');
  await expect(voiceActions).toContainText('faster-whisper worker unavailable');
  await expect(voiceActions).toContainText(
    'Start the selected speech-to-text provider or switch voice input to a working fallback.',
  );
  await expect(voiceActions).toContainText(
    'Restore the STT fallback so Buddy can keep listening if the primary route drops.',
  );
  await expect(voiceActions).toContainText('Kyutai STT offline');
  await expect(voiceActions).toContainText('connect ECONNREFUSED');
  await expect(voiceActions).toContainText(
    'Start the Kyutai ASR streaming endpoint or disable Kyutai STT for now.',
  );
  await expect(voiceActions).toContainText('ffmpeg missing');
  await expect(voiceActions).toContainText('ffmpeg was not found for streaming audio conversion');
  await expect(voiceActions).toContainText(
    'Install ffmpeg or configure a valid ffmpeg binary path before streaming audio.',
  );
  await expect(companionPulse).toContainText('Buddy pulse needs attention');
  await expect(companionPulse).toContainText('5/6 companion systems ready');
  await expect(companionPulse).toContainText('VoiceNeeds attention / diagnostic just now');
  await expect(appPage.getByTestId('status-tile-voice-input')).toContainText(
    'Needs attention / kyutai / faster-whisper unavailable',
  );
  await expect(appPage.getByTestId('status-tile-voice-output')).toContainText(
    'Degraded / kyutai / piper unavailable',
  );
  await expect(
    companionPulse.getByLabel('Voice: Needs attention / diagnostic just now; needs attention'),
  ).toBeVisible();
  await expect(appPage.getByTestId('companion-pulse-next')).toContainText(
    'Run Inspect voice and follow the recovery cues before starting a spoken loop.',
  );
  await expect(companionPulse.getByRole('button', { name: 'Inspect voice' })).toBeVisible();
  await companionPulse.getByRole('button', { name: 'Inspect voice' }).click();
  await expect(appPage.getByTestId('voice-diagnostics-summary')).toHaveText(
    'Needs attention: STT route offline; faster-whisper fallback offline; piper fallback offline; Kyutai STT offline; ...',
  );
});
