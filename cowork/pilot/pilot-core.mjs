/**
 * cowork-pilot core — programmatic control of the Cowork Electron GUI for
 * testing/automation. Built on Playwright's `_electron` (already a Cowork
 * dependency), so it can launch its own isolated instance OR attach to a
 * running Cowork started with `--remote-debugging-port`.
 *
 * This is the shared engine behind both the CLI (`cli.mjs`) and the MCP
 * server (`mcp-server.mjs`). It encodes the real selectors/flows discovered
 * during the 2026-06-15 audit (welcome→chat, real ChatGPT profile, Test
 * Runner bundles, the Fleet Command overlay).
 */
import { _electron as electron, chromium } from 'playwright';
import electronPath from 'electron';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COWORK_DIR = path.resolve(__dirname, '..'); // cowork/
const REPO_DIR = path.resolve(COWORK_DIR, '..'); // code-buddy/

/** The real ChatGPT (Codex Responses) profile — uses the user's subscription. */
export const CHATGPT_PROFILE = {
  provider: 'chatgpt',
  model: 'gpt-5.5',
  baseUrl: 'https://chatgpt.com/backend-api/codex',
  apiKey: 'oauth-chatgpt',
  customProtocol: 'anthropic',
};

export class CoworkPilot {
  /**
   * @param {object} opts
   * @param {string} [opts.userDataDir]  persistent profile dir (default: temp, wiped on close)
   * @param {boolean} [opts.keepUserData] keep the temp userDataDir after close
   * @param {string}  [opts.display]      X DISPLAY (default: process.env.DISPLAY || ':10.0')
   * @param {boolean} [opts.headless]     pass --headless to electron (rarely useful)
   * @param {string}  [opts.lang]         UI language (default en-US)
   * @param {(line:string)=>void} [opts.log]
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.app = null; // ElectronApplication | null (launch mode)
    this.browser = null; // Browser | null (attach mode)
    this.page = null; // Page
    this._ownsUserData = false;
    this.userDataDir = opts.userDataDir || null;
    this.log = opts.log || (() => {});
  }

  // ---- lifecycle ---------------------------------------------------------

  async launch() {
    if (this.page) return this.page;
    if (!this.userDataDir) {
      this.userDataDir = mkdtempSync(path.join(os.tmpdir(), 'cowork-pilot-'));
      this._ownsUserData = !this.opts.keepUserData;
    }
    // ArcFace model placeholder so presence init doesn't block (mirrors e2e fixture)
    const modelPath = path.join(this.userDataDir, 'models', 'buffalo_s.onnx');
    mkdirSync(path.dirname(modelPath), { recursive: true });
    if (!existsSync(modelPath)) writeFileSync(modelPath, '');

    const display = this.opts.display || process.env.DISPLAY || ':10.0';
    const args = ['e2e/electron-main.cjs', `--lang=${this.opts.lang || 'en-US'}`];
    if (this.opts.headless) args.push('--headless');

    this.log(`[pilot] launching Electron (userData=${this.userDataDir}, DISPLAY=${display})`);
    this.app = await electron.launch({
      executablePath: electronPath,
      cwd: COWORK_DIR,
      args,
      env: {
        ...process.env,
        DISPLAY: display,
        COWORK_E2E: '1',
        COWORK_E2E_USER_DATA_DIR: this.userDataDir,
        CODEBUDDY_RUNS_DIR: path.join(this.userDataDir, 'codebuddy-runs'),
        CI: '1',
      },
    });
    this.page = await this.app.firstWindow({ timeout: 60_000 });
    await this.waitReady();
    return this.page;
  }

  /** Attach to an already-running Cowork (started with --remote-debugging-port=N). */
  async attach(cdpEndpoint = 'http://localhost:9222') {
    this.log(`[pilot] attaching over CDP: ${cdpEndpoint}`);
    this.browser = await chromium.connectOverCDP(cdpEndpoint);
    const ctx = this.browser.contexts()[0];
    const pages = ctx ? ctx.pages() : [];
    this.page = pages.find((p) => !p.url().startsWith('devtools://')) || pages[0];
    if (!this.page) throw new Error('No renderer page found over CDP');
    await this.waitReady();
    return this.page;
  }

  async waitReady(timeout = 30_000) {
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.getByTestId('app-root').waitFor({ state: 'visible', timeout });
    await this.dismissOnboarding();
    return true;
  }

  async dismissOnboarding() {
    const wiz = this.page.getByTestId('onboarding-wizard');
    if (await wiz.isVisible({ timeout: 1500 }).catch(() => false)) {
      await this.page.getByTestId('onboarding-skip').click().catch(() => {});
      await wiz.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    }
  }

  async close() {
    try {
      if (this.app) await this.app.close();
      else if (this.browser) await this.browser.close();
    } catch {
      /* ignore */
    }
    if (this._ownsUserData && this.userDataDir) {
      try {
        const { rmSync } = await import('node:fs');
        rmSync(this.userDataDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    this.page = null;
    this.app = null;
    this.browser = null;
  }

  // ---- config / provider -------------------------------------------------

  async getConfig() {
    return this.page.evaluate(() => window.electronAPI?.config?.get?.());
  }

  /** Apply a provider profile (defaults to the real ChatGPT subscription). */
  async configureProvider(profile = CHATGPT_PROFILE) {
    const result = await this.page.evaluate(async (p) => {
      const current = (await window.electronAPI?.config?.get?.()) || {};
      const profiles = {
        ...current.profiles,
        [p.provider]: {
          ...(current.profiles?.[p.provider] || {}),
          apiKey: p.apiKey,
          baseUrl: p.baseUrl,
          model: p.model,
        },
      };
      const activeConfigSetId =
        current.activeConfigSetId || current.configSets?.[0]?.id || 'default';
      const configSets = (current.configSets || []).map((set) =>
        set.id === activeConfigSetId
          ? {
              ...set,
              provider: p.provider,
              customProtocol: p.customProtocol || 'anthropic',
              activeProfileKey: p.provider,
              profiles,
              enableThinking: false,
              updatedAt: new Date().toISOString(),
            }
          : set
      );
      return window.electronAPI?.config?.save?.({
        provider: p.provider,
        activeProfileKey: p.provider,
        profiles,
        activeConfigSetId,
        configSets,
        apiKey: p.apiKey,
        baseUrl: p.baseUrl,
        model: p.model,
        isConfigured: true,
        onboardingCompleted: true,
      });
    }, profile);
    return result;
  }

  // ---- chat --------------------------------------------------------------

  /**
   * Send a chat prompt and return the assistant reply text.
   * @param {string} prompt
   * @param {object} [opts]
   * @param {string|RegExp} [opts.marker]  wait for reply text matching this (reliable mode)
   * @param {number} [opts.timeoutMs]      max wait for the reply (default 180000)
   * @returns {Promise<{prompt:string, reply:string, mode:string}>}
   */
  async chat(prompt, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const input = (await this.page.getByTestId('welcome-prompt-input').count())
      ? this.page.getByTestId('welcome-prompt-input')
      : this.page.getByTestId('chat-prompt-input');
    await input.fill(prompt);
    await input.press('Enter');
    // confirm the prompt was submitted
    await this.page
      .getByText(prompt, { exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => {});

    if (opts.marker) {
      const re = opts.marker instanceof RegExp ? opts.marker : new RegExp(opts.marker);
      // Poll all elements matching the marker, excluding the echoed prompt
      // bubble (the prompt may itself contain the marker text). Return the
      // last non-prompt match — that is the assistant's reply.
      const deadline = Date.now() + timeoutMs;
      let reply = '';
      while (Date.now() < deadline) {
        const matches = await this.page.getByText(re).allInnerTexts().catch(() => []);
        const nonPrompt = matches
          .map((t) => t.trim())
          .filter((t) => t && t !== prompt.trim() && !prompt.includes(t));
        if (nonPrompt.length) {
          reply = nonPrompt[nonPrompt.length - 1];
          break;
        }
        await this.page.waitForTimeout(800);
      }
      if (!reply) throw new Error(`chat: no reply matching ${re} within ${timeoutMs}ms`);
      return { prompt, reply, mode: 'marker' };
    }

    // settle mode: wait until the rendered text stops growing, then return the tail
    const reply = await this._waitForSettledReply(prompt, timeoutMs);
    return { prompt, reply, mode: 'settle' };
  }

  async _waitForSettledReply(prompt, timeoutMs) {
    const start = Date.now();
    let last = '';
    let stableSince = 0;
    while (Date.now() - start < timeoutMs) {
      const text = await this.page.evaluate(() => document.body.innerText || '');
      if (text === last && text.length > 0) {
        if (!stableSince) stableSince = Date.now();
        // stable for 2.5s after the prompt is present → assume done
        if (Date.now() - stableSince > 2500 && text.includes(prompt)) break;
      } else {
        stableSince = 0;
        last = text;
      }
      await this.page.waitForTimeout(700);
    }
    // best-effort: return everything after the last occurrence of the prompt
    const idx = last.lastIndexOf(prompt);
    const tail = idx >= 0 ? last.slice(idx + prompt.length) : last;
    return tail.trim().slice(0, 4000);
  }

  // ---- generic control ---------------------------------------------------

  /** Run JS in the renderer. `fn` may be a function or a string expression. */
  async evaluate(fn, arg) {
    if (typeof fn === 'string') {
      // wrap as an expression/!statement returning a value
      return this.page.evaluate(
        // eslint-disable-next-line no-new-func
        new Function('arg', `return (async()=>{ ${/return|;/.test(fn) ? fn : 'return (' + fn + ')'} })()`),
        arg
      );
    }
    return this.page.evaluate(fn, arg);
  }

  /** Generic one-shot IPC: window.electronAPI.invoke({type, payload}). */
  async ipc(type, payload = {}) {
    return this.page.evaluate(
      ({ t, p }) => window.electronAPI?.invoke?.({ type: t, payload: p }),
      { t: type, p: payload }
    );
  }

  /** Namespaced IPC: window.electronAPI[namespace][method](...args). */
  async ipcNamespaced(namespace, method, args = []) {
    return this.page.evaluate(
      ({ ns, m, a }) => {
        const fn = window.electronAPI?.[ns]?.[m];
        if (typeof fn !== 'function') throw new Error(`electronAPI.${ns}.${m} is not a function`);
        return fn(...a);
      },
      { ns: namespace, m: method, a: args }
    );
  }

  _loc(selector) {
    if (selector.startsWith('testid=')) return this.page.getByTestId(selector.slice(7));
    if (selector.startsWith('text=')) return this.page.getByText(selector.slice(5));
    if (selector.startsWith('role=')) {
      const [, role, name] = selector.match(/^role=([^:]+)(?::(.+))?$/) || [];
      return this.page.getByRole(role, name ? { name } : undefined);
    }
    return this.page.locator(selector);
  }

  async click(selector, opts = {}) {
    await this._loc(selector).first().click({ timeout: opts.timeout ?? 8000 });
    return true;
  }

  async fill(selector, text, opts = {}) {
    await this._loc(selector).first().fill(text, { timeout: opts.timeout ?? 8000 });
    return true;
  }

  async press(selector, key) {
    await this._loc(selector).first().press(key);
    return true;
  }

  async screenshot(filePath, opts = {}) {
    const buf = await this.page.screenshot({ fullPage: opts.fullPage ?? true });
    if (filePath) {
      mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
      writeFileSync(filePath, buf);
    }
    return { path: filePath || null, base64: buf.toString('base64'), bytes: buf.length };
  }

  /** Best-effort state snapshot: store (if exposed) + visible headings + url. */
  async getState() {
    return this.page.evaluate(() => {
      const store = window.useAppStore?.getState?.();
      const pick = store
        ? {
            activeSessionId: store.activeSessionId,
            sessions: Array.isArray(store.sessions) ? store.sessions.length : undefined,
            showFleetCommandCenter: store.showFleetCommandCenter,
            showTeamPanel: store.showTeamPanel,
            pendingApprovals: Array.isArray(store.pendingApprovals)
              ? store.pendingApprovals.length
              : undefined,
          }
        : { note: 'useAppStore not exposed on window in this build' };
      const headings = Array.from(document.querySelectorAll('h1,h2,[role="heading"]'))
        .map((e) => e.textContent?.trim())
        .filter(Boolean)
        .slice(0, 12);
      return { url: location.href, store: pick, headings };
    });
  }

  // ---- Test Runner bundles ----------------------------------------------

  /** Set the active workspace (required for the Test Runner catalog to populate). */
  async setWorkdir(dirPath = REPO_DIR) {
    return this.ipc('workdir.set', { path: dirPath });
  }

  async openTestRunner(workdir = REPO_DIR) {
    // The catalog only populates once a workspace is set.
    if (workdir) await this.setWorkdir(workdir).catch(() => {});
    // Prefer the Zustand store setter (refactor-proof); fall back to menu nav.
    const viaStore = await this.page
      .evaluate(() => {
        const s = window.useAppStore?.getState?.();
        if (s?.setShowTestRunner) {
          s.setShowTestRunner(true);
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (!viaStore) {
      await this.click('text=Outils').catch(() => {});
      await this.click('text=Test Runner').catch(() => {});
    }
    await this.page
      .getByRole('heading', { name: 'Tests & executions' })
      .waitFor({ timeout: 8000 })
      .catch(() => {});
  }

  /** List bundle rows currently in the Test Runner catalog. */
  async listTestBundles() {
    await this.openTestRunner();
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="test-catalog-row-"]')).map((el) => ({
        id: el.getAttribute('data-testid').replace('test-catalog-row-', ''),
        label: el.textContent?.trim().slice(0, 120),
      }))
    );
  }

  /**
   * Run a Test Runner bundle by id and return its result.
   * @returns {Promise<{id:string, status:string, result:string}>}
   */
  async runTestBundle(bundleId, opts = {}) {
    const timeout = opts.timeoutMs ?? 560_000;
    await this.openTestRunner();
    const row = this.page.getByTestId(`test-catalog-row-${bundleId}`);
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await this.page.getByTestId(`test-catalog-run-${bundleId}`).click();
    const status = this.page.getByTestId(`test-catalog-status-${bundleId}`);
    await status
      .filter({ has: this.page.locator('*') })
      .first()
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    // wait until status aria-label is terminal
    const deadline = Date.now() + timeout;
    let label = '';
    while (Date.now() < deadline) {
      label = (await status.getAttribute('aria-label').catch(() => '')) || '';
      if (['passed', 'failed', 'skipped', 'error'].includes(label)) break;
      await this.page.waitForTimeout(1500);
    }
    const result = await this.page
      .getByTestId(`test-catalog-result-${bundleId}`)
      .innerText()
      .catch(() => '');
    return { id: bundleId, status: label, result: result.trim() };
  }
}

export default CoworkPilot;
