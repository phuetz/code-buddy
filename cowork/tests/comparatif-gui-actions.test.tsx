// @vitest-environment happy-dom
/**
 * P4 / P6 / P8 — real renderer components driven through the real main-process
 * modules and the real core modules (no Electron window, no IPC transport):
 * - palette: unavailable commands are rendered disabled with their reason and
 *   cannot be selected; /resources is selectable and runs headlessly;
 * - rail: "Ressources déclarées" is read-only (stale state, no URL, no fingerprint);
 * - rail: "Continuer dans le terminal" writes a 0600 CLI session and shows the command.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async (modPath: string) => {
    switch (modPath) {
      case 'commands/slash/index.js': return await import('../../src/commands/slash/index');
      case 'commands/headless-slash.js': return await import('../../src/commands/headless-slash');
      case 'utils/first-use-hints.js': return await import('../../src/utils/first-use-hints');
      case 'fleet/resource-catalog.js': return await import('../../src/fleet/resource-catalog');
      case 'persistence/session-handoff.js': return await import('../../src/persistence/session-handoff');
      default: return null;
    }
  }),
}));

vi.mock('../src/main/commands/custom-commands-service', () => ({
  getCustomCommandsService: () => ({ list: () => [] }),
}));

import { SlashCommandBridge } from '../src/main/commands/slash-command-bridge';
import { listCoworkResources, type ResourceCatalogCoreModule } from '../src/main/fleet/resource-catalog-view';
import { exportCoworkSessionToCli, type SessionHandoffCoreModule } from '../src/main/session/cli-session-continuity';
import { loadCoreModule } from '../src/main/utils/core-loader';
import { SlashCommandPalette } from '../src/renderer/components/SlashCommandPalette';
import { UniversalPreviewRail } from '../src/renderer/components/UniversalPreviewRail';
import { useAppStore } from '../src/renderer/store';

const ORIGIN = 'http://127.0.0.1:43977/';
let tmp: string;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-gui-'));
  for (const key of ['HOME', 'CODEBUDDY_SESSIONS_DIR', 'CODEBUDDY_HINTS_DIR', 'RAGCHAT_BASE_URL']) saved[key] = process.env[key];
  process.env.HOME = path.join(tmp, 'home');
  process.env.CODEBUDDY_SESSIONS_DIR = path.join(tmp, 'sessions');
  process.env.CODEBUDDY_HINTS_DIR = path.join(tmp, 'hints');
  process.env.RAGCHAT_BASE_URL = ORIGIN;
  const catalog = path.join(tmp, 'home', '.codebuddy', 'resources', 'catalog.json');
  fs.mkdirSync(path.dirname(catalog), { recursive: true, mode: 0o700 });
  const old = Date.now() - 3_600_000;
  fs.writeFileSync(catalog, JSON.stringify({ version: 1, entries: [{
    resource: { id: 'ragchat-local', kind: 'rag', hostId: 'host-alpha', declaredCapabilities: ['pdf-search'], endpointRef: 'RAGCHAT_BASE_URL',
      healthPath: '/api/health', permissions: { probe: true, use: true }, ttlMs: 60000, timeoutMs: 1000 },
    observation: { state: 'online', checkedAt: old, lastSeen: old, latencyMs: 9, reason: 'HTTP_HEALTH_OK_NOT_USAGE_PROOF',
      endpointFingerprint: createHash('sha256').update(`${ORIGIN}api/health`).digest('hex') },
  }] }), { mode: 0o600 });
});

// The palette resolves slash metadata through the real core modules. Their first dynamic import
// transforms a large module graph (measured 8.6 s cold, after which the palette test takes 0.3 s); load them once here with
// an explicit hook budget so each test's own timeout measures UI behaviour, not the module graph.
beforeAll(async () => {
  for (const mod of ['commands/slash/index.js', 'commands/headless-slash.js', 'utils/first-use-hints.js', 'fleet/resource-catalog.js', 'persistence/session-handoff.js']) {
    await loadCoreModule(mod);
  }
}, 60_000);

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

afterEach(() => {
  cleanup();
});

describe('Cowork GUI actions (renderer + main + core)', () => {
  it('palette: /yolo is disabled with its reason and cannot be selected; /resources runs headlessly', async () => {
    const bridge = new SlashCommandBridge();
    Object.assign(window, { electronAPI: { command: { autocomplete: (prefix: string, limit: number) => bridge.autocomplete(prefix, limit) } } });
    const onSelect = vi.fn();

    render(<SlashCommandPalette prefix="yolo" anchorPosition={{ top: 0, left: 0 }} onSelect={onSelect} onClose={vi.fn()} />);
    const yolo = await screen.findByRole('button', { name: /\/yolo/ });
    expect(yolo).toHaveProperty('disabled', true);
    expect(yolo.getAttribute('title')).toMatch(/terminal/);
    fireEvent.click(yolo);
    expect(onSelect).not.toHaveBeenCalled();
    // Enter picks the first ENABLED match (/status mentions YOLO), never the disabled /yolo.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect.mock.calls.map(([item]) => item.name)).toEqual(['status']);
    onSelect.mockClear();
    cleanup();

    render(<SlashCommandPalette prefix="resources" anchorPosition={{ top: 0, left: 0 }} onSelect={onSelect} onClose={vi.fn()} />);
    const resources = await screen.findByRole('button', { name: /\/resources/ });
    expect(resources).toHaveProperty('disabled', false);
    fireEvent.click(resources);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'resources' }));

    const result = await bridge.execute('resources', []);
    expect(result.output).toContain('ragchat-local');
    expect(result.output).not.toContain('127.0.0.1');
  });

  it('rail: read-only resources view and "Continuer dans le terminal" export', async () => {
    const session = { id: 'gui-42', title: 'Remise GUI', status: 'idle', cwd: tmp, model: 'fixture', createdAt: Date.now() - 1000, updatedAt: Date.now() };
    const messages = [
      { id: 'm1', sessionId: 'gui-42', role: 'user', content: [{ type: 'text', text: 'Corrige la remise' }], timestamp: Date.now() - 900 },
      { id: 'm2', sessionId: 'gui-42', role: 'assistant', content: [{ type: 'text', text: 'Remise corrigée.' }], timestamp: Date.now() - 800 },
    ];
    const clipboard = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
    Object.assign(window, {
      electronAPI: {
        session: {
          externalList: async () => [],
          exportToCli: (id: string) => exportCoworkSessionToCli({
            session: id === session.id ? session : null,
            messages,
            loadCore: () => loadCoreModule<SessionHandoffCoreModule>('persistence/session-handoff.js'),
          }),
        },
        tools: {
          resourceCatalog: { list: () => listCoworkResources(() => loadCoreModule<ResourceCatalogCoreModule>('fleet/resource-catalog.js')) },
        },
      },
    });
    useAppStore.setState({ sessions: [session as never], activeSessionId: session.id });

    render(<UniversalPreviewRail appPreview={null} appAvailable={false} />);
    fireEvent.click(screen.getByTitle('Ouvrir le rail universel'));

    const view = await screen.findByTestId('resource-catalog-view');
    await waitFor(() => expect(view.textContent).toContain('ragchat-local'));
    expect(view.textContent).toContain('observation périmée');
    expect(view.textContent).toContain('réf. RAGCHAT_BASE_URL');
    expect(view.textContent).not.toContain('127.0.0.1');
    expect(document.body.innerHTML).not.toMatch(/[0-9a-f]{64}/);

    fireEvent.click(screen.getByRole('button', { name: 'Continuer dans le terminal' }));
    await waitFor(() => expect(screen.getByTestId('continue-in-terminal').textContent).toContain('buddy --resume cowork-gui-42'));
    expect(clipboard).toHaveBeenCalledWith('buddy --resume cowork-gui-42');
    const file = path.join(tmp, 'sessions', 'cowork-gui-42.json');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(file, 'utf8')).toContain('Remise corrigée.');
  });
});
