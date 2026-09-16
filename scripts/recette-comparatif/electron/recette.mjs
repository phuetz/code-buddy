// Real Electron recette for P4 / P6 / P8 (Cowork window, throwaway profile, loopback only).
// Run: RECETTE_WORKTREE=<repo> RECETTE_ELECTRON_DIR=<private dir> xvfb-run -a -s "-screen 0 1440x900x24" node <private dir>/recette.mjs <label>
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

if (!process.env.RECETTE_WORKTREE || !process.env.RECETTE_ELECTRON_DIR) throw new Error('set RECETTE_WORKTREE (repo under test) and RECETTE_ELECTRON_DIR (private output dir)');
const worktree = process.env.RECETTE_WORKTREE;
const cowork = `${worktree}/cowork`;
const here = process.env.RECETTE_ELECTRON_DIR;
// Engine under test: an installed package dist (RECETTE_ENGINE_DIST) or the private tsc build.
const engineDist = process.env.RECETTE_ENGINE_DIST ?? path.join(here, 'core', 'dist');
const label = process.argv[2] || 'run1';
const runDir = path.join(here, label);
fs.rmSync(runDir, { recursive: true, force: true });
const home = path.join(runDir, 'home');
const userData = path.join(runDir, 'user-data');
const shots = path.join(runDir, 'screenshots');
for (const dir of [home, userData, shots]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

const require = createRequire(`${cowork}/package.json`);
const electronBinary = require('electron');
const { _electron: electron } = await import(`${cowork}/node_modules/@playwright/test/index.mjs`);

// Loopback CONTROL server standing for resource endpoints: a read-only view must never call it.
const controlRequests = [];
const control = http.createServer((req, res) => { controlRequests.push(req.url); res.end('{"ok":true}'); });
await new Promise((r) => control.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${control.address().port}/`;

// Deterministic FIXTURE chat provider (not a model).
const chatRequests = [];
const fixture = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture-cowork-model', object: 'model' }] }));
    return;
  }
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* empty */ }
  chatRequests.push(body);
  const reply = 'FIXTURE-COWORK-REPLY: remise corrigée';
  const created = Math.floor(Date.now() / 1000);
  if (body.stream === false) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'fx', object: 'chat.completion', created, model: 'fixture-cowork-model', choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ id: 'fx', object: 'chat.completion.chunk', created, model: 'fixture-cowork-model', choices: [{ index: 0, delta: { role: 'assistant', content: reply }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ id: 'fx', object: 'chat.completion.chunk', created, model: 'fixture-cowork-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 } })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/v1`;

// 2-resource catalog in the throwaway HOME: one stale RagChat observation, one never probed.
const catalog = path.join(home, '.codebuddy', 'resources', 'catalog.json');
fs.mkdirSync(path.dirname(catalog), { recursive: true, mode: 0o700 });
const old = Date.now() - 3_600_000;
const fingerprint = crypto.createHash('sha256').update(`${origin}api/health`).digest('hex');
fs.writeFileSync(catalog, JSON.stringify({ version: 1, entries: [
  { resource: { id: 'ragchat-local', kind: 'rag', hostId: 'host-alpha', declaredCapabilities: ['pdf-search'], endpointRef: 'RAGCHAT_BASE_URL', healthPath: '/api/health', permissions: { probe: true, use: true }, ttlMs: 60000, timeoutMs: 1000 },
    observation: { state: 'online', checkedAt: old, lastSeen: old, latencyMs: 12, endpointFingerprint: fingerprint, reason: 'HTTP_HEALTH_OK_NOT_USAGE_PROOF' } },
  { resource: { id: 'gpu-inference', kind: 'inference', hostId: 'host-beta', declaredCapabilities: ['chat'], endpointRef: 'GPU_INFER_URL', healthPath: '/v1/models', permissions: { probe: false, use: true }, ttlMs: 60000, timeoutMs: 1000 }, observation: null },
] }), { mode: 0o600 });
const catalogBytes = fs.readFileSync(catalog);

const env = {};
for (const [k, v] of Object.entries(process.env)) if (!/(API_KEY|TOKEN|SECRET|PASSWORD|OAUTH|_KEY$)/i.test(k)) env[k] = v;
Object.assign(env, {
  HOME: home,
  XDG_CONFIG_HOME: path.join(home, '.config'),
  XDG_DATA_HOME: path.join(home, '.local', 'share'),
  XDG_CACHE_HOME: path.join(home, '.cache'),
  COWORK_E2E: '1', PI_PACKAGE_DIR: `${worktree}/cowork`,
  RECETTE_WORKTREE: worktree,
  COWORK_E2E_USER_DATA_DIR: userData,
  CODEBUDDY_ENGINE_PATH: engineDist,
  CODEBUDDY_RUNS_DIR: path.join(userData, 'codebuddy-runs'),
  CODEBUDDY_SESSIONS_DIR: path.join(home, '.codebuddy', 'sessions'),
  CODEBUDDY_TELEMETRY: 'off',
  RAGCHAT_BASE_URL: origin,
  GPU_INFER_URL: origin,
  CI: '1',
  NODE_OPTIONS: `--require ${worktree}/scripts/recette-comparatif/no-external-network.cjs`,
});

const git = (...args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8' }).trim();
const result = {
  label, head: git('rev-parse', 'HEAD'), dirtyWorktree: git('status', '--porcelain') !== '',
  version: JSON.parse(fs.readFileSync(path.join(worktree, 'package.json'), 'utf8')).version,
  engineBuild: engineDist, steps: {}, screenshots: [], consoleErrors: [], mainLog: '',
};
const step = async (name, fn) => {
  try {
    result.steps[name] = { ok: true, ...(await fn()) };
  } catch (error) {
    result.steps[name] = { ok: false, error: String(error?.message ?? error).slice(0, 800) };
  }
};

const app = await electron.launch({
  executablePath: electronBinary,
  cwd: cowork,
  args: [path.join(here, 'electron-main.cjs'), '--lang=fr-FR', '--no-sandbox', '--disable-gpu'],
  env,
  timeout: 90_000,
});
const mainLog = [];
app.process().stdout?.on('data', (d) => mainLog.push(String(d)));
app.process().stderr?.on('data', (d) => mainLog.push(String(d)));

let page;
// Screenshots are evidence, not assertions: a capture timeout (page busy streaming) is recorded, not fatal.
const shot = async (name) => {
  const file = path.join(shots, `${name}.png`);
  try {
    await page.screenshot({ path: file, timeout: 15_000 });
    result.screenshots.push(path.relative(runDir, file));
  } catch (error) {
    result.screenshotFailures = [...(result.screenshotFailures ?? []), `${name}: ${String(error?.message ?? error).split('\n')[0]}`];
  }
};

try {
  await step('launch', async () => {
    page = await app.firstWindow({ timeout: 90_000 });
    page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text().slice(0, 300)); });
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('app-root').waitFor({ state: 'visible', timeout: 60_000 });
    await shot('01-app-root');
    return { title: await page.title() };
  });

  await step('configure-fixture-provider', async () => {
    await page.evaluate(async ({ url }) => {
      localStorage.setItem('cowork.tourSeen', '1');
      const current = await window.electronAPI.config.get();
      const saved = await window.electronAPI.config.save({
        provider: 'ollama', customProtocol: 'openai', activeProfileKey: 'ollama',
        profiles: { ...current.profiles, ollama: { apiKey: '', baseUrl: url, model: 'fixture-cowork-model' } },
        apiKey: '', baseUrl: url, model: 'fixture-cowork-model', onboardingCompleted: true,
      });
      if (!saved.success) throw new Error(saved.error ?? 'config save failed');
    }, { url: fixtureUrl });
    await page.reload();
    await page.getByTestId('app-root').waitFor({ state: 'visible', timeout: 60_000 });
    await page.evaluate(() => {
      const s = window.useAppStore?.getState?.();
      s?.setShowEnrollmentDialog?.(false); s?.setShowModelInstallDialog?.(false); s?.setShowOnboardingTour?.(false);
    });
    return {};
  });

  await step('real-session-with-message', async () => {
    const composer = page.locator('[data-testid="home-input"]:visible, [data-testid="welcome-prompt-input"]:visible, [data-testid="chat-prompt-input"]:visible').first();
    await composer.waitFor({ state: 'visible', timeout: 30_000 });
    await composer.fill('Corrige la remise dans facture.ts');
    await composer.press('Enter');
    await page.getByText('FIXTURE-COWORK-REPLY', { exact: false }).first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(1500);
    await shot('02-chat-fixture-reply');
    return { chatRequests: chatRequests.filter((b) => JSON.stringify(b).includes('Corrige la remise')).length };
  });

  await step('P4-palette-disabled-with-reason', async () => {
    const input = page.getByTestId('chat-prompt-input');
    await input.waitFor({ state: 'visible', timeout: 20_000 });
    await input.click();
    await input.fill('/yolo');
    const yolo = page.getByRole('button', { name: /\/yolo/ }).first();
    await yolo.waitFor({ state: 'visible', timeout: 15_000 });
    const disabled = await yolo.isDisabled();
    const reason = await yolo.getAttribute('title');
    await shot('03-palette-yolo-disabled');
    await yolo.click({ force: true });
    await page.waitForTimeout(800);
    const stillInInput = await input.inputValue();
    await input.fill('/reso');
    const resources = page.getByRole('button', { name: /\/resources/ }).first();
    await resources.waitFor({ state: 'visible', timeout: 15_000 });
    const resourcesDisabled = await resources.isDisabled();
    await shot('04-palette-resources-enabled');
    await input.fill('');
    return { yoloDisabled: disabled, reason, inputAfterClickingDisabled: stillInInput, resourcesDisabled };
  });

  await step('P4-server-side-refusal-and-first-tip', async () => {
    const [first, second] = await page.evaluate(async () => {
      const a = await window.electronAPI.command.execute('yolo', ['on']);
      const b = await window.electronAPI.command.execute('memory', []);
      return [a, b];
    });
    return { first: first?.message, second: second?.message, hintMarkers: fs.existsSync(path.join(home, '.codebuddy', 'hints')) ? fs.readdirSync(path.join(home, '.codebuddy', 'hints')) : [] };
  });

  await step('P8-slash-resources-in-window', async () => {
    const out = await page.evaluate(async () => window.electronAPI.command.execute('resources', []));
    return { handled: out?.handled, output: String(out?.output ?? out?.message ?? '').slice(0, 900) };
  });

  await step('P8-rail-resources-readonly', async () => {
    const open = page.getByTitle('Ouvrir le rail universel');
    if (await open.isVisible().catch(() => false)) await open.click();
    const view = page.getByTestId('resource-catalog-view');
    await view.waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByText('ragchat-local', { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
    const text = await view.innerText();
    const ipc = await page.evaluate(async () => window.electronAPI.tools.resourceCatalog.list());
    await shot('05-rail-resources-readonly');
    return { text, ipcStates: ipc?.resources?.map((r) => `${r.id}:${r.state}`), ipcHasUrl: JSON.stringify(ipc).includes('127.0.0.1'), ipcHasFingerprint: JSON.stringify(ipc).includes(fingerprint) };
  });

  await step('P6-continue-in-terminal', async () => {
    const button = page.getByRole('button', { name: 'Continuer dans le terminal' });
    await button.waitFor({ state: 'visible', timeout: 15_000 });
    await button.click();
    const box = page.getByTestId('continue-in-terminal');
    await page.waitForFunction(() => /buddy --resume cowork-/.test(document.querySelector('[data-testid="continue-in-terminal"]')?.textContent ?? ''), null, { timeout: 20_000 });
    const notice = await box.innerText();
    const systemClipboard = await app.evaluate(({ clipboard }) => clipboard.readText()).catch((e) => `unreadable: ${e}`);
    await shot('06-continue-in-terminal');
    const id = /buddy --resume (cowork-[^\s]+)/.exec(notice)?.[1];
    const file = id ? path.join(home, '.codebuddy', 'sessions', `${id}.json`) : null;
    const exists = file ? fs.existsSync(file) : false;
    const content = exists ? fs.readFileSync(file, 'utf8') : '';
    return {
      notice,
      exportedFile: exists ? path.relative(runDir, file) : null,
      mode: exists ? (fs.statSync(file).mode & 0o777).toString(8) : null,
      containsUserText: content.includes('Corrige la remise'),
      containsFixtureReply: content.includes('FIXTURE-COWORK-REPLY'),
      copiedToClipboard: /^Commande copiée/.test(notice.split('\n').find((l) => l.includes('buddy --resume')) ?? ''),
      systemClipboardHasCommand: String(systemClipboard).includes('buddy --resume cowork-'),
    };
  });
} finally {
  await app.close().catch(() => {});
  control.close();
  fixture.close();
  result.mainLog = mainLog.join('').slice(-6000);
  result.controlRequests = controlRequests.length;
  result.catalogUnchanged = fs.readFileSync(catalog).equals(catalogBytes);
  result.blockedExternal = [...result.mainLog.matchAll(/external (?:network|fetch) blocked \(([^)]*)\)/g)].map((m) => m[1]);
  const s = result.steps;
  result.pass = Boolean(
    s.launch?.ok && s['real-session-with-message']?.ok
    && s['P4-palette-disabled-with-reason']?.ok && s['P4-palette-disabled-with-reason'].yoloDisabled === true && /terminal/i.test(s['P4-palette-disabled-with-reason'].reason ?? '')
    && s['P4-palette-disabled-with-reason'].resourcesDisabled === false
    && s['P4-server-side-refusal-and-first-tip']?.ok && /pas encore pilotable/.test(s['P4-server-side-refusal-and-first-tip'].first ?? '') && /Astuce/.test(s['P4-server-side-refusal-and-first-tip'].first ?? '') && !/Astuce/.test(s['P4-server-side-refusal-and-first-tip'].second ?? '')
    && s['P8-slash-resources-in-window']?.ok && /ragchat-local/.test(s['P8-slash-resources-in-window'].output) && !/127\.0\.0\.1/.test(s['P8-slash-resources-in-window'].output)
    && s['P8-rail-resources-readonly']?.ok && /observation périmée/.test(s['P8-rail-resources-readonly'].text) && !s['P8-rail-resources-readonly'].ipcHasUrl && !s['P8-rail-resources-readonly'].ipcHasFingerprint
    && s['P6-continue-in-terminal']?.ok && s['P6-continue-in-terminal'].mode === '600' && s['P6-continue-in-terminal'].containsUserText
    && result.controlRequests === 0 && result.catalogUnchanged,
  );
  fs.writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ...result, mainLog: `${result.mainLog.length} chars` }, null, 2));
  process.exit(result.pass ? 0 : 1);
}
