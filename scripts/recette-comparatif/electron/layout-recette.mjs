// Real Electron layout recette: chat composer width with the universal rail (activity center) closed/open,
// at common window sizes, with keyboard checks. Throwaway profile, loopback fixture provider only.
// Run: RECETTE_WORKTREE=<repo> RECETTE_ELECTRON_DIR=<private dir> [RECETTE_ENGINE_DIST=<dist>] \
//   xvfb-run -a -s "-screen 0 1920x1080x24" node <private dir>/layout-recette.mjs <label>
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

if (!process.env.RECETTE_WORKTREE || !process.env.RECETTE_ELECTRON_DIR) throw new Error('set RECETTE_WORKTREE and RECETTE_ELECTRON_DIR');
const worktree = process.env.RECETTE_WORKTREE;
const here = process.env.RECETTE_ELECTRON_DIR;
const engineDist = process.env.RECETTE_ENGINE_DIST ?? path.join(here, 'core', 'dist');
const cowork = `${worktree}/cowork`;
const label = process.argv[2] || 'layout';
const sizes = (process.env.LAYOUT_SIZES ?? '1024x768,1280x800,1440x900').split(',').map((s) => s.split('x').map(Number));
// Usable composer: the textarea gets at least min(280 px, 85 % of the composer form width).
// A fixed width cannot be met by a 380 px chat pane, so the target scales down with the form;
// 280 px keeps the unchanged one-line layout (about 300 px of textarea) at the 736 px form cap.
const MIN_USABLE_COMPOSER_PX = Number(process.env.LAYOUT_MIN_COMPOSER_PX ?? 280);
const USABLE_FORM_RATIO = 0.85;
const composerUsable = (m) => (m.textarea?.width ?? 0) >= Math.min(MIN_USABLE_COMPOSER_PX, USABLE_FORM_RATIO * (m.composerForm?.width ?? 0));
const runDir = path.join(here, label);
fs.rmSync(runDir, { recursive: true, force: true });
const home = path.join(runDir, 'home');
const userData = path.join(runDir, 'user-data');
const shots = path.join(runDir, 'screenshots');
for (const dir of [home, userData, shots]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

const require = createRequire(`${cowork}/package.json`);
const electronBinary = require('electron');
const { _electron: electron } = await import(`${cowork}/node_modules/@playwright/test/index.mjs`);

const fixture = http.createServer(async (req, res) => {
  for await (const _ of req) { /* drain */ }
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture-layout-model', object: 'model' }] }));
    return;
  }
  const created = Math.floor(Date.now() / 1000);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ id: 'fx', object: 'chat.completion.chunk', created, model: 'fixture-layout-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'FIXTURE-LAYOUT-REPLY' }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ id: 'fx', object: 'chat.completion.chunk', created, model: 'fixture-layout-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 } })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/v1`;

const env = {};
for (const [k, v] of Object.entries(process.env)) if (!/(API_KEY|TOKEN|SECRET|PASSWORD|OAUTH|_KEY$)/i.test(k)) env[k] = v;
Object.assign(env, {
  HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local', 'share'), XDG_CACHE_HOME: path.join(home, '.cache'),
  COWORK_E2E: '1', PI_PACKAGE_DIR: cowork, RECETTE_WORKTREE: worktree, COWORK_E2E_USER_DATA_DIR: userData,
  CODEBUDDY_ENGINE_PATH: engineDist, CODEBUDDY_RUNS_DIR: path.join(userData, 'codebuddy-runs'),
  CODEBUDDY_SESSIONS_DIR: path.join(home, '.codebuddy', 'sessions'), CODEBUDDY_TELEMETRY: 'off', CI: '1',
  NODE_OPTIONS: `--require ${worktree}/scripts/recette-comparatif/no-external-network.cjs`,
});

const git = (...args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8' }).trim();
const result = {
  label, head: git('rev-parse', 'HEAD'), dirtyWorktree: git('status', '--porcelain') !== '', engineBuild: engineDist,
  usableComposerRule: `textarea >= min(${MIN_USABLE_COMPOSER_PX}px, ${USABLE_FORM_RATIO} * form width)`, measurements: [], keyboard: {}, screenshots: [], errors: [],
};

const app = await electron.launch({ executablePath: electronBinary, cwd: cowork, args: [path.join(here, 'electron-main.cjs'), '--lang=fr-FR', '--no-sandbox', '--disable-gpu'], env, timeout: 90_000 });
const mainLog = [];
app.process().stdout?.on('data', (d) => mainLog.push(String(d)));
app.process().stderr?.on('data', (d) => mainLog.push(String(d)));

async function setSize(width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.unmaximize();
    win.setContentSize(w, h);
  }, [width, height]);
  await page.waitForTimeout(700);
}

async function measure() {
  return page.evaluate(() => {
    const box = (el) => (el ? (({ x, width }) => ({ x: Math.round(x), width: Math.round(width) }))(el.getBoundingClientRect()) : null);
    const textarea = document.querySelector('[data-testid="chat-prompt-input"]');
    const form = textarea?.closest('form') ?? null;
    const railOpen = document.querySelector('[data-testid="universal-preview-rail"]');
    const railClosed = document.querySelector('[data-testid="universal-preview-rail-collapsed"]');
    const rail = railOpen ?? railClosed;
    const row = rail?.parentElement ?? null;
    const chatColumn = row ? [...row.children].find((c) => c !== rail && c.contains(textarea)) ?? null : null;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      railState: railOpen ? 'open' : railClosed ? 'closed' : 'absent',
      row: box(row), chatColumn: box(chatColumn), rail: box(rail), composerForm: box(form), textarea: box(textarea),
      textareaHeight: textarea ? Math.round(textarea.getBoundingClientRect().height) : null, textareaEmpty: textarea ? textarea.value === '' : null,
      railLayout: railOpen?.getAttribute('data-layout') ?? null, composerCompact: form?.getAttribute('data-compact') ?? null,
      textareaVisible: Boolean(textarea && textarea.getClientRects().length && textarea.getBoundingClientRect().width > 0),
    };
  });
}

async function shot(name) {
  const file = path.join(shots, `${name}.png`);
  try { await page.screenshot({ path: file, timeout: 15_000 }); result.screenshots.push(path.relative(runDir, file)); } catch (e) { result.errors.push(`shot ${name}: ${String(e).split('\n')[0]}`); }
}

let page;
try {
  page = await app.firstWindow({ timeout: 90_000 });
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('app-root').waitFor({ state: 'visible', timeout: 60_000 });
  await page.evaluate(async ({ url }) => {
    localStorage.setItem('cowork.tourSeen', '1');
    const current = await window.electronAPI.config.get();
    const saved = await window.electronAPI.config.save({ provider: 'ollama', customProtocol: 'openai', activeProfileKey: 'ollama',
      profiles: { ...current.profiles, ollama: { apiKey: '', baseUrl: url, model: 'fixture-layout-model' } },
      apiKey: '', baseUrl: url, model: 'fixture-layout-model', onboardingCompleted: true });
    if (!saved.success) throw new Error(saved.error ?? 'config save failed');
  }, { url: fixtureUrl });
  await page.reload();
  await page.getByTestId('app-root').waitFor({ state: 'visible', timeout: 60_000 });
  await page.evaluate(() => { const s = window.useAppStore?.getState?.(); s?.setShowEnrollmentDialog?.(false); s?.setShowModelInstallDialog?.(false); s?.setShowOnboardingTour?.(false); });
  const start = page.locator('[data-testid="home-input"]:visible, [data-testid="welcome-prompt-input"]:visible, [data-testid="chat-prompt-input"]:visible').first();
  await start.waitFor({ state: 'visible', timeout: 30_000 });
  await start.fill('Mesure de mise en page');
  await start.press('Enter');
  await page.getByText('FIXTURE-LAYOUT-REPLY', { exact: false }).first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByTestId('chat-prompt-input').waitFor({ state: 'visible', timeout: 20_000 });

  for (const [width, height] of sizes) {
    await setSize(width, height);
    if (await page.getByTestId('universal-preview-rail').isVisible().catch(() => false)) await page.getByTitle('Réduire le rail').click();
    const closed = await measure();
    await shot(`${width}x${height}-rail-closed`);
    // Keyboard: open the rail from its button without the mouse.
    await page.getByTitle('Ouvrir le rail universel').focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('universal-preview-rail').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(500);
    const open = await measure();
    await shot(`${width}x${height}-rail-open`);
    // Composer stays usable with the rail open: focus, type, read back, clear.
    const input = page.getByTestId('chat-prompt-input');
    let typed = null;
    let shiftTabTarget = null;
    try {
      await input.focus({ timeout: 5_000 });
      await page.keyboard.type('clavier ok', { delay: 5 });
      typed = await input.inputValue();
      await input.fill('');
      await input.focus();
      await page.keyboard.press('Shift+Tab');
      shiftTabTarget = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null);
    } catch (e) { result.errors.push(`type ${width}x${height}: ${String(e).split('\n')[0]}`); }
    // Keyboard: close the rail again.
    await page.getByTitle('Réduire le rail').focus();
    await page.keyboard.press('Enter');
    const closedAgain = await page.getByTestId('universal-preview-rail-collapsed').isVisible({ timeout: 10_000 }).catch(() => false);
    result.measurements.push({ size: `${width}x${height}`, closed, open, typedWithRailOpen: typed, shiftTabFromComposer: shiftTabTarget, keyboardClosedRail: closedAgain });
  }
} catch (error) {
  result.errors.push(String(error?.message ?? error).slice(0, 800));
} finally {
  await app.close().catch(() => {});
  fixture.close();
  result.mainLogTail = mainLog.join('').slice(-3000);
  result.checks = result.measurements.map((m) => ({
    size: m.size,
    composerUsableClosed: composerUsable(m.closed),
    composerUsableOpen: composerUsable(m.open),
    noHorizontalOverflow: (m.closed.composerForm?.x ?? -1) >= (m.closed.chatColumn?.x ?? 0) && (m.open.composerForm?.x ?? -1) >= (m.open.chatColumn?.x ?? 0),
    typedWithRailOpen: m.typedWithRailOpen === 'clavier ok',
    tabOrderKept: m.shiftTabFromComposer === 'chat-goal-mode-toggle',
    emptyComposerSingleRow: [m.closed, m.open].every((x) => !x.textareaEmpty || (x.textareaHeight ?? 999) <= 80),
    keyboardClosedRail: m.keyboardClosedRail,
    railInsideViewport: m.open.rail ? m.open.rail.x + m.open.rail.width <= m.open.viewport.width + 1 : false,
  }));
  result.pass = result.errors.length === 0 && result.checks.length === sizes.length
    && result.checks.every((c) => c.composerUsableClosed && c.composerUsableOpen && c.noHorizontalOverflow && c.typedWithRailOpen && c.tabOrderKept && c.emptyComposerSingleRow && c.keyboardClosedRail && c.railInsideViewport);
  fs.writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ...result, mainLogTail: `${result.mainLogTail.length} chars` }, null, 2));
  process.exit(result.pass ? 0 : 1);
}
