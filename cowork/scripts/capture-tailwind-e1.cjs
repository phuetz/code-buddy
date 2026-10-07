// Capture four Cowork views in both themes from an isolated Electron profile.
// Run under xvfb-run; never point DISPLAY at a desktop session.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const outputDir = path.resolve(process.argv[2] || '.');
const phase = process.argv[3] || 'capture';
const themes = (process.argv[4] || 'light,dark').split(',');
const views = (process.argv[5] || 'chat,studio,activity,advanced').split(',');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-e1-'));
fs.mkdirSync(outputDir, { recursive: true });
const port = 19328;
const electron = spawn(path.resolve('node_modules/electron/dist/electron'), [
  '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`,
  'dist-electron/main/index.js',
], {
  cwd: path.resolve('.'),
  env: { ...process.env, HOME: profile, XDG_CONFIG_HOME: profile, XDG_DATA_HOME: profile,
    CODEBUDDY_HOME: path.join(profile, '.codebuddy'), NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
electron.stdout.on('data', (data) => { logs += data.toString(); });
electron.stderr.on('data', (data) => { logs += data.toString(); });

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function getPage() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (electron.exitCode !== null) throw new Error(`Electron exited ${electron.exitCode}: ${logs.slice(-4000)}`);
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = pages.find((item) => item.type === 'page' && item.url.includes('index.html'));
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error(`Renderer did not open: ${logs.slice(-4000)}`);
}
async function main() {
  const page = await getPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let nextId = 0;
  const pending = new Map();
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  });
  function send(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  try {
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await evaluate('Boolean(window.useAppStore && document.querySelector("#root")?.children.length)')) break;
      await sleep(500);
    }
    await evaluate('document.querySelector("[data-testid=onboarding-skip]")?.click()');
    await sleep(500);
    await evaluate('window.useAppStore.getState().setNewShellEnabled(true)');
    await evaluate('localStorage.setItem("cowork.tourSeen", "1"); window.useAppStore.getState().setShowOnboardingTour(false)');
    const probes = {};
    for (const theme of themes) {
      await evaluate(`window.useAppStore.getState().updateSettings({theme:${JSON.stringify(theme)}})`);
      for (const view of views) {
        await evaluate(`window.useAppStore.getState().setPrimaryView(${JSON.stringify(view)})`);
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1390, y: 850 });
        await sleep(700);
        const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(outputDir, `${phase}-${view}-${theme}.png`), Buffer.from(screenshot.data, 'base64'));
        if (view === 'chat') {
          probes[theme] = await evaluate(`(() => {
            const button = document.querySelector('.bg-accent.text-white');
            if (!button) return { found: false };
            const style = getComputedStyle(button);
            const disabled = button.cloneNode(true);
            disabled.disabled = true;
            disabled.classList.add('disabled:bg-surface-muted', 'disabled:text-text-muted');
            document.body.appendChild(disabled);
            const disabledStyle = getComputedStyle(disabled);
            const disabledColor = disabledStyle.color;
            const disabledBackground = disabledStyle.backgroundColor;
            disabled.remove();
            return { found: true, color: style.color, background: style.backgroundColor,
              disabledColor, disabledBackground, theme: document.documentElement.className };
          })()`);
        }
      }
    }
    fs.writeFileSync(path.join(outputDir, `${phase}-styles.json`), JSON.stringify(probes, null, 2));
  } finally {
    ws.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  electron.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => electron.once('exit', resolve)), sleep(3000)]);
  if (electron.exitCode === null) electron.kill('SIGKILL');
  fs.writeFileSync(path.join(outputDir, `${phase}-electron.log`), logs);
  fs.rmSync(profile, { recursive: true, force: true });
});
