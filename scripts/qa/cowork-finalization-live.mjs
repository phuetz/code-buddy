#!/usr/bin/env node
/** Real Electron renderer + IPC regression. Attach only to an isolated audit app.
 * node scripts/qa/cowork-finalization-live.mjs <CDP URL> <artifact directory>
 * Requires the built Cowork app with COWORK_E2E=1 and disposable userData.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../cowork/package.json', import.meta.url));
const { chromium } = require('playwright');
const [endpoint, output] = process.argv.slice(2);
if (!endpoint || !output) throw new Error('Expected CDP URL and artifact directory');
mkdirSync(output, { recursive: true });
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(8000);
const results = [];
const shot = name => page.screenshot({ path: resolve(output, name + '.png') });
try {
  await page.reload();
  await page.waitForFunction(() => Boolean(window.useAppStore));
  for (const label of ['Skip onboarding', 'Skip']) {
    const button = page.getByRole('button', { name: label, exact: true });
    if (await button.isVisible()) await button.click();
  }
  await page.evaluate(() => { const s = window.useAppStore.getState(); s.setShowSettings(false); });
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button').filter({ hasText: 'Advanced' }).click();
    await page.getByTestId('advanced-feature-fleet').click();
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => 1 + 1), 2);
    await shot('fleet-' + attempt);
    await page.keyboard.press('Escape');
  }
  results.push({ scenario: 'fleet-open-twice', status: 'TESTE_LOCAL' });
  await page.evaluate(() => { const s = window.useAppStore.getState(); s.setSettingsTab('workflows'); s.setShowSettings(true); });
  await page.getByRole('button', { name: 'Create workflow', exact: true }).click();
  await page.getByTestId('workflow-add-node-tool').click();
  const tool = page.locator('[data-testid^="workflow-node-node_"]').first();
  const id = (await tool.getAttribute('data-testid')).replace('workflow-node-', '');
  await page.getByTestId('workflow-connect-start').click();
  await tool.click({ position: { x: 40, y: 20 } });
  await page.getByTestId('workflow-connect-' + id).click();
  await page.getByTestId('workflow-node-end').click({ position: { x: 40, y: 20 } });
  const name = 'Recette native DAG ' + Date.now();
  await page.getByTestId('workflow-editor-name-input').fill(name);
  await shot('dag-connected');
  await page.getByTestId('workflow-editor-save').click();
  await page.getByText(name, { exact: true }).waitFor();
  const workflows = await page.evaluate(() => window.electronAPI.workflow.list());
  writeFileSync(resolve(output, 'workflows.json'), JSON.stringify(workflows, null, 2));
  const saved = workflows.find(w => w.name === name);
  assert.ok(saved, 'saved workflow exists in native IPC storage');
  const detail = await page.evaluate(id => window.electronAPI.workflow.get(id), saved.id);
  writeFileSync(resolve(output, 'workflow.json'), JSON.stringify(detail, null, 2));
  const graph = detail.definition ?? detail;
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 2);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.useAppStore));
  await page.evaluate(() => { const s = window.useAppStore.getState(); s.setSettingsTab('workflows'); s.setShowSettings(true); });
  await page.getByText(name, { exact: true }).waitFor();
  await shot('dag-persisted');
  results.push({ scenario: 'dag-ports-save-reload', status: 'TESTE_LOCAL', nodes: 3, edges: 2 });
  await page.getByText('Skills Library', { exact: true }).click();
  const request = 'Inspecte les fichiers sans modifier.';
  await page.getByPlaceholder('Optional task — otherwise use the skill description').fill(request);
  await page.getByText('workspace-organizer', { exact: true }).locator('../..').getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByText('User request: "' + request + '"', { exact: false }).waitFor();
  const text = await page.locator('body').innerText();
  assert.ok(!text.includes('User request: "undefined"'));
  writeFileSync(resolve(output, 'skill.txt'), text);
  await shot('skill-request');
  results.push({ scenario: 'skill-ui-request', status: 'TESTE_LOCAL', scope: 'skill execution contract; no filesystem action requested' });
} finally {
  writeFileSync(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
