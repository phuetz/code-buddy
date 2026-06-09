/**
 * demo-tour — records short Cowork videos for the docs, one per use-case scene.
 *
 * On-demand only (RECORD_DEMO=1): each scene launches Cowork with `recordVideo`
 * (the only way to capture an Electron window — `use.video` does NOT apply to
 * _electron.launch), dismisses the first-run onboarding, then walks that scene's
 * panels. Each webm lands under cowork/demo-video/<scene>/.
 *
 *   RECORD_DEMO=1 npx playwright test e2e/demo-tour.spec.ts
 */
import { _electron as electron, test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electronBinary from 'electron';

async function launchCowork(videoDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'cowork-demo-'));
  const modelPath = path.join(userDataDir, 'models', 'buffalo_s.onnx');
  mkdirSync(path.dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, '');

  const app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    cwd: process.cwd(),
    args: ['e2e/electron-main.cjs', '--lang=en-US'],
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
    env: {
      ...process.env,
      COWORK_E2E: '1',
      COWORK_E2E_USER_DATA_DIR: userDataDir,
      CODEBUDDY_RUNS_DIR: path.join(userDataDir, 'codebuddy-runs'),
      CI: '1',
    },
  });

  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('app-root')).toBeVisible({ timeout: 30_000 });

  // Dismiss the first-run onboarding wizard (fresh userDataDir → it's shown).
  const onboarding = page.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 2500 }).catch(() => false)) {
    await page.getByTestId('onboarding-skip').click().catch(() => {});
    await expect(onboarding).toHaveCount(0).catch(() => {});
  }
  await page.waitForTimeout(1200);
  return { app, page };
}

// Point Cowork at a local Ollama model via the config IPC (the store is
// encrypted, so we can't pre-seed a file) and reload so isConfigured flips.
async function configureOllama(page: Page, model: string): Promise<Page> {
  await page.evaluate(async (m) => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    const cfg = await api.config.get();
    // enableThinking + thinkingLevel so the reasoning zone is shown during the turn.
    const patch = { provider: 'ollama', baseUrl: 'http://localhost:11434', model: m, apiKey: 'ollama', enableThinking: true, thinkingLevel: 'high' };
    const configSets = Array.isArray(cfg.configSets) && cfg.configSets.length
      ? cfg.configSets.map((c: any, i: number) => (i === 0 ? { ...c, ...patch } : c))
      : [{ name: 'Default', ...patch }];
    await api.config.save({ ...cfg, ...patch, configSets });
  }, model);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('app-root')).toBeVisible({ timeout: 30_000 });
  const onboarding = page.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.getByTestId('onboarding-skip').click().catch(() => {});
  }
  await page.waitForTimeout(1200);
  return page;
}

async function visit(page: Page, ids: string[], pauseMs = 1600): Promise<void> {
  for (const id of ids) {
    try {
      await page.getByTestId(id).click({ timeout: 4000 });
      await page.waitForTimeout(pauseMs);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(450);
    } catch {
      // skip missing/disabled stop, keep recording
    }
  }
}

// One video per scene → covers a maximum of use cases.
const SCENES: Record<string, string[]> = {
  // Multi-AI fleet: spawn a team, command center, peer events, agent team, devices.
  fleet: ['orchestrator-button', 'fleet-command-center-button', 'fleet-panel-button', 'team-panel-button', 'devices-button'],
  // The agent's "brain": autonomous queue, persistent memory, reasoning traces.
  intelligence: ['autonomy-panel-button', 'memory-panel-button', 'reasoning-viewer-button'],
  // Companion: voice/vision/presence + delivery channels + mobile supervision.
  companion: ['companion-panel-button', 'channels-button', 'mobile-supervision-button'],
  // Insights & learning: activity, session insights, test runner, lessons, user model, spec, bookmarks, focus.
  insights: ['activity-button', 'session-insights-button', 'test-runner-button', 'lesson-candidate-button', 'user-model-button', 'spec-panel-button', 'bookmarks-button', 'focus-view-button'],
  // Automation: the mission board and desktop snapshot surfaces.
  automation: ['mission-board-button', 'desktop-snapshot-button'],
};

for (const [scene, ids] of Object.entries(SCENES)) {
  test(`demo ${scene}`, async () => {
    test.skip(!process.env.RECORD_DEMO, 'set RECORD_DEMO=1 to record demo videos');
    const dir = path.resolve('demo-video', scene);
    const { app, page } = await launchCowork(dir);
    await page.waitForTimeout(1000);
    await visit(page, ids);
    await page.waitForTimeout(1200);
    const video = page.video();
    await app.close();
    // eslint-disable-next-line no-console
    if (video) console.log(`SCENE ${scene}=${await video.path()}`);
  });
}

// Settings: the regrouped 7-section sidebar + a few tabs (not overlay → no Escape).
test('demo settings', async () => {
  test.skip(!process.env.RECORD_DEMO, 'set RECORD_DEMO=1 to record demo videos');
  const dir = path.resolve('demo-video', 'settings');
  const { app, page } = await launchCowork(dir);
  await page.getByTestId('shell-settings-button').click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1500);
  for (const tab of ['settings-tab-codebuddy', 'settings-tab-connectors', 'settings-tab-skills', 'settings-tab-rules', 'settings-tab-workflows']) {
    await page.getByTestId(tab).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1300);
  }
  const video = page.video();
  await app.close();
  // eslint-disable-next-line no-console
  if (video) console.log(`SCENE settings=${await video.path()}`);
});

// Orchestrator: the multi-agent team spawner (the wow shot) + the Agent Team.
test('demo orchestrator', async () => {
  test.skip(!process.env.RECORD_DEMO, 'set RECORD_DEMO=1 to record demo videos');
  const dir = path.resolve('demo-video', 'orchestrator');
  const { app, page } = await launchCowork(dir);
  await page.getByTestId('orchestrator-button').click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(3200); // linger on the "Spawn a multi-agent team" form
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await page.getByTestId('team-panel-button').click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(2600);
  const video = page.video();
  await app.close();
  // eslint-disable-next-line no-console
  if (video) console.log(`SCENE orchestrator=${await video.path()}`);
});

// Extensibility: the Workflows DAG editor, MCP connectors/marketplace, Skills, Plugins.
test('demo extensibility', async () => {
  test.skip(!process.env.RECORD_DEMO, 'set RECORD_DEMO=1 to record demo videos');
  const dir = path.resolve('demo-video', 'extensibility');
  const { app, page } = await launchCowork(dir);
  await page.getByTestId('shell-settings-button').click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1200);
  for (const tab of ['settings-tab-workflows', 'settings-tab-connectors', 'settings-tab-mcpMarketplace', 'settings-tab-skills', 'settings-tab-skillsBrowser', 'settings-tab-plugins', 'settings-tab-hooks']) {
    await page.getByTestId(tab).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  const video = page.video();
  await app.close();
  // eslint-disable-next-line no-console
  if (video) console.log(`SCENE extensibility=${await video.path()}`);
});

// Command palette: Ctrl+K → fuzzy-find any action.
test('demo command-palette', async () => {
  test.skip(!process.env.RECORD_DEMO, 'set RECORD_DEMO=1 to record demo videos');
  const dir = path.resolve('demo-video', 'command-palette');
  const { app, page } = await launchCowork(dir);
  await page.waitForTimeout(1200);
  await page.mouse.click(640, 70); // blur the autofocused composer so the Ctrl+K handler fires
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(1400);
  await page.keyboard.type('fleet', { delay: 95 });
  await page.waitForTimeout(1600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(900);
  await page.keyboard.type('settings', { delay: 95 });
  await page.waitForTimeout(1800);
  const video = page.video();
  await app.close();
  // eslint-disable-next-line no-console
  if (video) console.log(`SCENE command-palette=${await video.path()}`);
});

// Real chat: configure local Ollama and ask a question — a genuine streamed reply.
test('demo chat', async () => {
  test.skip(!process.env.RECORD_DEMO, 'set RECORD_DEMO=1 to record demo videos');
  test.setTimeout(120_000);
  const dir = path.resolve('demo-video', 'chat');
  const { app, page } = await launchCowork(dir);
  await configureOllama(page, 'qwen3.6:35b-a3b-q4_K_M'); // reasoning model → visible thinking
  const input = page.getByTestId('welcome-prompt-input'); // work-surface composer
  await input.click().catch(() => {});
  await input.fill('Think it through, then write a short, upbeat haiku about a robot companion.');
  await page.waitForTimeout(900);
  await input.press('Enter');
  await page.waitForTimeout(60000); // reasoning model: stream the thinking zone + answer (pre-warmed)
  const video = page.video();
  await app.close();
  // eslint-disable-next-line no-console
  if (video) console.log(`SCENE chat=${await video.path()}`);
});

// Open-cowork-style task: ask the agent to actually create a file (tool use) on a
// local tool-capable model — a real artifact, not just chat.
test('demo task', async () => {
  test.skip(!process.env.RECORD_DEMO, 'set RECORD_DEMO=1 to record demo videos');
  test.setTimeout(200_000);
  const dir = path.resolve('demo-video', 'task');
  const { app, page } = await launchCowork(dir);
  await configureOllama(page, 'qwen3.6:35b-a3b-q4_K_M');
  const input = page.getByTestId('welcome-prompt-input');
  await input.click().catch(() => {});
  await input.fill('Create a file named robot-haiku.md containing a haiku about a robot companion, then confirm it is done.');
  await page.waitForTimeout(800);
  await input.press('Enter');
  await page.waitForTimeout(115000); // reasoning + tool-capable model + agent loop + file write
  const video = page.video();
  await app.close();
  // eslint-disable-next-line no-console
  if (video) console.log(`SCENE task=${await video.path()}`);
});
