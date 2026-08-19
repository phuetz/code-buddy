/**
 * Reproduction / proof harness for the App Studio confirmation-delivery bug.
 *
 * Boots Cowork with the embedded Code Buddy engine (CODEBUDDY_ENGINE_PATH),
 * configures a local Ollama tool-capable model, opens App Studio, launches a
 * tiny "Generate with AI" run, and watches whether the tool-confirmation modal
 * (`permission-dialog`) is DELIVERED to the active renderer.
 *
 *   REPRO_MODEL=qwen3.8:27b npx playwright test e2e/appstudio-confirm-repro.spec.ts --config=playwright.config.ts
 */
import { _electron as electron, test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electronBinary from 'electron';

const PROVIDER = process.env.REPRO_PROVIDER || 'chatgpt'; // 'chatgpt' | 'ollama'
const MODEL = process.env.REPRO_MODEL || (PROVIDER === 'chatgpt' ? 'gpt-5.5' : 'qwen3.8:27b');
const SHOT_DIR = process.env.SHOT_DIR || path.resolve('/tmp/appstudio-confirm');
mkdirSync(SHOT_DIR, { recursive: true });

async function launch(): Promise<{ app: ElectronApplication; page: Page; work: string }> {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'cowork-repro-'));
  const modelPath = path.join(userDataDir, 'models', 'buffalo_s.onnx');
  mkdirSync(path.dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, '');
  const work = mkdtempSync(path.join(os.tmpdir(), 'appstudio-work-'));

  const app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    cwd: process.cwd(),
    args: ['e2e/electron-main.cjs', '--lang=en-US', '--no-sandbox', '--disable-gpu'],
    env: {
      ...process.env,
      COWORK_E2E: '1',
      COWORK_E2E_USER_DATA_DIR: userDataDir,
      CODEBUDDY_RUNS_DIR: path.join(userDataDir, 'codebuddy-runs'),
      CODEBUDDY_ENGINE_PATH: process.env.CODEBUDDY_ENGINE_PATH || '/home/patrice/code-buddy/dist',
      CI: '1',
    },
  });

  // Stream main-process logs — the `[ipc-main-bridge] dropped ...` warning and
  // the `[PermissionBridge]` lines are the smoking gun.
  app.process().stdout?.on('data', (d) => process.stdout.write(`[main] ${d}`));
  app.process().stderr?.on('data', (d) => process.stdout.write(`[main:err] ${d}`));

  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('app-root')).toBeVisible({ timeout: 30_000 });
  page.on('console', (m) => process.stdout.write(`[renderer:${m.type()}] ${m.text()}\n`));
  return { app, page, work };
}

async function configure(page: Page): Promise<void> {
  // Enable the new shell (App Studio lives there) + point at Ollama.
  await page.evaluate(async ({ model, provider }) => {
    try {
      localStorage.setItem('COWORK_NEW_SHELL', 'true');
      localStorage.setItem('cowork.tourSeen', '1');
    } catch { /* ignore */ }
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    const cfg = await api.config.get();
    const patch = provider === 'chatgpt'
      ? { provider: 'openai', baseUrl: 'https://chatgpt.com/backend-api/codex', model, apiKey: 'oauth-chatgpt' }
      : { provider: 'ollama', baseUrl: 'http://localhost:11434', model, apiKey: 'ollama' };
    const configSets = Array.isArray(cfg.configSets) && cfg.configSets.length
      ? cfg.configSets.map((c: any, i: number) => (i === 0 ? { ...c, ...patch } : c))
      : [{ name: 'Default', ...patch }];
    await api.config.save({ ...cfg, ...patch, configSets });
  }, { model: MODEL, provider: PROVIDER });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('app-root')).toBeVisible({ timeout: 30_000 });
  await dismissOnboarding(page);
  await page.waitForTimeout(1000);
}

async function dismissOnboarding(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const tour = page.getByTestId('onboarding-tour');
    const wiz = page.getByTestId('onboarding-wizard');
    const tourVisible = await tour.isVisible({ timeout: 400 }).catch(() => false);
    const wizVisible = await wiz.isVisible({ timeout: 200 }).catch(() => false);
    if (!tourVisible && !wizVisible) return;
    await page.getByRole('button', { name: 'Skip' }).first().click({ timeout: 800 }).catch(() => {});
    await page.getByText('Skip', { exact: true }).first().click({ timeout: 800 }).catch(() => {});
    await page.getByTestId('onboarding-skip').click({ timeout: 400 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

test('App Studio confirmation modal is delivered to the active renderer', async () => {
  test.setTimeout(240_000);
  const { app, page, work } = await launch();
  await configure(page);

  // Navigate to App Studio (rail button carries title={label}).
  await dismissOnboarding(page);
  await page.getByTitle('App Studio', { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await dismissOnboarding(page);
  await page.screenshot({ path: path.join(SHOT_DIR, '01-appstudio-open.png') });

  const REAL_FLOW = process.env.REAL_FLOW === '1';
  if (REAL_FLOW) {
    // Drive the ACTUAL "Generate with AI" button: onGenerateWithAI ->
    // store.startSession -> setActiveSession -> NewShell swaps the composer
    // for the workbench. This is the exact user path the mission describes.
    const promptBox = page.getByPlaceholder(/Describe the app to build/i);
    await promptBox.fill('Crée une page HTML "hello world" minimaliste : un seul fichier index.html, titre centré. Utilise create_file, aucune commande shell.');
    const dest = page.getByPlaceholder('Destination folder');
    await dest.fill(work);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOT_DIR, '02-composer-filled.png') });
    const genBtn = page.getByRole('button', { name: /Generate with AI/i });
    await expect(genBtn).toBeEnabled({ timeout: 8000 });
    await genBtn.click();
    process.stdout.write('[repro] clicked the real "Generate with AI" button\n');
  } else {
    await page.screenshot({ path: path.join(SHOT_DIR, '02-composer-filled.png') });
    // Trigger the SAME generation path programmatically (identical delivery path).
    await page.evaluate(async (cwd) => {
      const api = (window as unknown as { electronAPI: any }).electronAPI;
      const prompt =
        'Crée une application web minimale. Utilise IMPÉRATIVEMENT l\'outil `create_file` pour ' +
        'créer un fichier `index.html` contenant une page "Hello World" avec un titre centré. ' +
        'N\'utilise AUCUNE commande shell. Crée le fichier puis résume.';
      await api.invoke({
        type: 'session.start',
        payload: { title: 'Repro App Studio', prompt, cwd, memoryEnabled: false, content: [{ type: 'text', text: prompt }] },
      });
    }, work);
    process.stdout.write('[repro] triggered generation (session.start)\n');
  }

  // Poll up to ~150s for the confirmation modal to be delivered to THIS renderer.
  const modal = page.getByTestId('permission-dialog');
  let appeared = false;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (await modal.isVisible().catch(() => false)) { appeared = true; break; }
    await page.waitForTimeout(1000);
  }

  await page.screenshot({ path: path.join(SHOT_DIR, appeared ? '03-modal-DELIVERED.png' : '03-modal-MISSING.png'), fullPage: false });
  process.stdout.write(`[repro] permission modal appeared = ${appeared}\n`);

  // End-to-end response-path check: click Allow ONCE (user-equivalent action on
  // a legitimately shown modal — no global auto-approve) and verify the tool
  // actually proceeds (file written), proving the response reaches the bridge.
  let fileWritten = false;
  if (appeared && process.env.CLICK_ALLOW === '1') {
    await page.getByTestId('permission-allow-button').click().catch(() => {});
    process.stdout.write('[repro] clicked Allow on the delivered modal\n');
    const fs = await import('node:fs');
    const target = path.join(work, 'index.html');
    const end = Date.now() + 30_000;
    while (Date.now() < end) {
      if (fs.existsSync(target)) { fileWritten = true; break; }
      await page.waitForTimeout(1000);
    }
    process.stdout.write(`[repro] file written after Allow = ${fileWritten} (${target})\n`);
    await page.screenshot({ path: path.join(SHOT_DIR, '04-after-allow.png') });
  }

  await app.close();
  expect(appeared, 'permission-dialog should be delivered to the active renderer').toBe(true);
});
