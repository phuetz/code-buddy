/**
 * App Studio DEMO CAPTURE — drives the real App Studio flow (ChatGPT OAuth, $0)
 * to generate a beautiful single-file site (static stack), screenshotting each
 * real screen and saving the generated index.html for a polished render.
 *
 *   REPRO_PROVIDER=chatgpt REPRO_MODEL=gpt-5.5 SHOT_DIR=... WORK_DIR=... \
 *     npx playwright test e2e/appstudio-capture.spec.ts --config=playwright.config.ts
 */
import { _electron as electron, test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electronBinary from 'electron';

const PROVIDER = process.env.REPRO_PROVIDER || 'chatgpt';
const MODEL = process.env.REPRO_MODEL || (PROVIDER === 'chatgpt' ? 'gpt-5.5' : 'qwen3.8:27b');
const SHOT_DIR = process.env.SHOT_DIR || path.resolve('/tmp/appstudio-shots');
const WORK_DIR = process.env.WORK_DIR || '';
mkdirSync(SHOT_DIR, { recursive: true });

const PROMPT = [
  'Crée un site vitrine d\'UNE seule page pour un élevage familial de shar-peï nommé « Les Plis d\'Or ».',
  'Un seul fichier index.html TOTALEMENT autonome : tout le CSS en inline dans une balise <style>,',
  'AUCUNE ressource externe, AUCUN JavaScript, AUCune image externe.',
  'Style éditorial haut de gamme : héro plein écran avec un dégradé cuivré chaleureux (brun profond -> caramel),',
  'un petit label en capitales espacées « ÉLEVAGE FAMILIAL DE SHAR-PEÏ », un grand titre serif élégant « Les Plis d\'Or »,',
  'un sous-titre doux, et trois boutons contour (La race, Nos chiots, Contact).',
  'Palette : crème #fffaf0, sable #e8cfaa, caramel #b97842, brun #5a3825.',
  'Sections : « Un chien pas comme les autres » (texte éditorial + forme décorative douce),',
  '« Nos chiots disponibles » (3 cartes : Moka — 3 mois — Fauve rouge ; Nougat — 4 mois — Chocolat ; Plume — 3 mois — Crème),',
  'et « Contact » (adresse e-mail, téléphone, adresse). Typographie serif pour les titres. Responsive.',
  'Utilise IMPÉRATIVEMENT l\'outil create_file pour écrire index.html. AUCUNE commande shell. Puis résume en une phrase.',
].join(' ');

async function launch(): Promise<{ app: ElectronApplication; page: Page; work: string }> {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'cowork-capture-'));
  // Pré-créer un faux modèle Buffalo_S pour supprimer la modale bloquante de reconnaissance faciale.
  const modelPath = path.join(userDataDir, 'models', 'buffalo_s.onnx');
  mkdirSync(path.dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, '');
  const work = WORK_DIR || mkdtempSync(path.join(os.tmpdir(), 'appstudio-plisdor-'));
  mkdirSync(work, { recursive: true });

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
  app.process().stdout?.on('data', (d) => process.stdout.write(`[main] ${d}`));
  app.process().stderr?.on('data', (d) => process.stdout.write(`[main:err] ${d}`));
  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('app-root')).toBeVisible({ timeout: 30_000 });
  page.on('console', (m) => process.stdout.write(`[renderer:${m.type()}] ${m.text()}\n`));
  return { app, page, work };
}

async function configure(page: Page): Promise<void> {
  await page.evaluate(async ({ model, provider }) => {
    try {
      localStorage.setItem('COWORK_NEW_SHELL', 'true');
      localStorage.setItem('cowork.tourSeen', '1');
    } catch { /* ignore */ }
    const api = (window as unknown as { electronAPI: { config: { get: () => Promise<Record<string, unknown>>; save: (cfg: unknown) => Promise<void> } } }).electronAPI;
    const cfg = await api.config.get();
    const patch = provider === 'chatgpt'
      ? { provider: 'openai', baseUrl: 'https://chatgpt.com/backend-api/codex', model, apiKey: 'oauth-chatgpt' }
      : { provider: 'ollama', baseUrl: 'http://localhost:11434', model, apiKey: 'ollama' };
    const configSets = Array.isArray(cfg.configSets) && cfg.configSets.length
      ? (cfg.configSets as Array<Record<string, unknown>>).map((c, i) => (i === 0 ? { ...c, ...patch } : c))
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

test('App Studio — capture la génération de « Les Plis d\'Or »', async () => {
  test.setTimeout(300_000);
  const { app, page, work } = await launch();
  await configure(page);
  await dismissOnboarding(page);

  // Ouvrir App Studio
  await page.getByTitle('App Studio', { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await dismissOnboarding(page);
  await page.screenshot({ path: path.join(SHOT_DIR, '01-appstudio-open.png') });

  // Remplir le composer (la modale Buffalo_S est déjà neutralisée par le fichier modèle pré-créé)
  const promptBox = page.getByPlaceholder(/Describe the app to build/i);
  await promptBox.waitFor({ state: 'visible', timeout: 15000 });
  await promptBox.fill(PROMPT);
  const dest = page.getByPlaceholder('Destination folder');
  await dest.fill(work).catch(() => {});
  // Stack = Static web (auto-serveur, fiable)
  await page.getByLabel("Type d'application (stack)").selectOption({ label: 'Static web' }).catch(async () => {
    await page.getByLabel("Type d'application (stack)").selectOption('static').catch(() => {});
  });
  await page.getByPlaceholder('projectName').fill('les-plis-dor').catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOT_DIR, '02-composer-rempli.png') });

  // Lancer la génération
  const genBtn = page.getByRole('button', { name: /Generate with AI/i });
  await expect(genBtn).toBeEnabled({ timeout: 8000 });
  await genBtn.click();
  process.stdout.write('[capture] Generate with AI cliqué\n');

  // Auto-allow toute demande de permission + attendre index.html
  const target = path.join(work, 'index.html');
  const deadline = Date.now() + 220_000;
  let shot3 = false;
  while (Date.now() < deadline) {
    // auto-allow
    const modal = page.getByTestId('permission-dialog');
    if (await modal.isVisible().catch(() => false)) {
      await page.getByTestId('permission-allow-button').click().catch(() => {});
      process.stdout.write('[capture] permission -> Allow\n');
    }
    if (!shot3 && Date.now() > deadline - 200_000 + 15_000) {
      await page.screenshot({ path: path.join(SHOT_DIR, '03-generation.png') }).catch(() => {});
      shot3 = true;
    }
    if (existsSync(target)) { process.stdout.write(`[capture] index.html écrit: ${target}\n`); break; }
    await page.waitForTimeout(1500);
  }

  // Laisser l'aperçu démarrer, cliquer Run si besoin
  await page.getByRole('button', { name: 'Run' }).click({ timeout: 4000 }).catch(() => {});
  await page.getByTestId('preview-start').click({ timeout: 3000 }).catch(() => {});
  // Attendre l'iframe d'aperçu
  const iframe = page.locator('iframe[title="App Studio Preview"]');
  await iframe.waitFor({ state: 'attached', timeout: 40_000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(SHOT_DIR, '04-apercu-live.png') });

  writeFileSync(path.join(SHOT_DIR, 'work-dir.txt'), work);
  process.stdout.write(`[capture] terminé. work=${work}\n`);
  await app.close();
});
