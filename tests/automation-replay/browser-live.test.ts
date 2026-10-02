import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { BrowserManager } from '../../src/browser-automation/browser-manager.js';
import { browserReplayHost } from '../../src/automation-replay/browser-host.js';
import { runSemanticAct } from '../../src/automation-replay/engine.js';
import { ReplayStore } from '../../src/automation-replay/store.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { serveTestPages } from '../helpers/browser-test-page.js';

it('real Chromium maps password type and replays fresh parameters without field-value fingerprints', async () => {
  const pages = await serveTestPages('<input aria-label="Name"><input type="PASSWORD" aria-label="Credential"><textarea aria-label="Notes">field-only-secret</textarea><button onclick="document.querySelector(\'p\').textContent=\'Submitted\'">Submit</button><p></p>');
  const root = await mkdtemp(path.join(os.tmpdir(), 'replay-chromium-'));
  const manager = new BrowserManager({ headless: true });
  const approval = vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockResolvedValue({ confirmed: true });
  try {
    await mkdir(path.join(root, 'home')); await manager.launch(); await manager.navigate({ url: pages.url });
    const host = browserReplayHost(manager);
    const observation = await host.observe();
    expect(JSON.stringify(observation)).not.toContain('field-only-secret');
    expect(observation.nodes.find(n => n.name === 'Credential')?.protected).toBe(true);
    await expect(host.perform({ kind: 'type', target: { role: 'textbox', name: 'Credential' }, valueKey: 'v' }, { v: '1234' })).rejects.toThrow('Protected');
    const actions = [ { kind: 'type', target: { role: 'textbox', name: 'Name' }, valueKey: 'visitor' },
      { kind: 'click', target: { role: 'button', name: 'Submit' } } ];
    let index = 0;
    const model = vi.fn(async () => ({ content: JSON.stringify(actions[index++] ?? actions[1]), tokens: 1 }));
    const store = new ReplayStore(root, path.join(root, 'home'));
    const request = { instruction: 'Fill name and submit', expectedText: 'Submitted' };
    await runSemanticAct(host, { ...request, values: { visitor: 'Alice' } }, { store, model });
    await manager.navigate({ url: pages.url }); model.mockClear();
    expect(await runSemanticAct(host, { ...request, values: { visitor: 'Bob' } }, { store, model })).toMatchObject({ replayed: 2, modelCalls: 0 });
    expect(model).not.toHaveBeenCalled();
    expect(await manager.evaluate({ expression: 'document.querySelector("input").value' })).toMatchObject({ value: 'Bob' });
  } finally {
    approval.mockRestore(); await manager.close(); await pages.close(); await rm(root, { recursive: true, force: true });
  }
}, 30000);
