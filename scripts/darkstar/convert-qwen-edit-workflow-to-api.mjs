#!/usr/bin/env node

/** Export a Qwen-Image-Edit UI graph through ComfyUI's native graphToPrompt. */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const [uiPath, outPath, comfyUrl = 'http://127.0.0.1:8188'] = process.argv.slice(2);
if (!uiPath || !outPath) {
  console.error('Usage: node scripts/darkstar/convert-qwen-edit-workflow-to-api.mjs <ui.json> <api-out.json> [comfyUrl]');
  process.exit(2);
}

const workflow = JSON.parse(readFileSync(uiPath, 'utf8'));
const requiredTypes = ['LoadImage', 'TextEncodeQwenImageEditPlus', 'UnetLoaderGGUF'];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error('[pageerror]', error.message));
  await page.goto(comfyUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => {
    const app = window.app ?? window.comfyAPI?.app?.app;
    return Boolean(app?.graph && typeof app.graphToPrompt === 'function');
  }, undefined, { timeout: 90_000 });
  await page.waitForFunction((types) => {
    const registered = window.LiteGraph?.registered_node_types;
    return Boolean(registered && types.every((type) => registered[type]));
  }, requiredTypes, { timeout: 120_000 });
  await page.waitForTimeout(3_000);

  const result = await page.evaluate(async ({ uiWorkflow, types }) => {
    const app = window.app ?? window.comfyAPI?.app?.app;
    await app.loadGraphData(uiWorkflow);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const nodeTypes = app.graph._nodes.map((node) => String(node.type ?? node.comfyClass));
    const missing = types.filter((type) => !nodeTypes.includes(type));
    if (missing.length > 0) {
      throw new Error(`loadGraphData is missing required node types: ${missing.join(', ')}; graph contains: ${nodeTypes.join(', ')}`);
    }
    const prompt = await app.graphToPrompt();
    return prompt.output;
  }, { uiWorkflow: workflow, types: requiredTypes });

  const nodeCount = Object.keys(result).length;
  if (nodeCount === 0) throw new Error('graphToPrompt returned an empty prompt');
  const types = [...new Set(Object.values(result).map((node) => node.class_type))].sort();
  for (const requiredType of requiredTypes) {
    if (!types.includes(requiredType)) throw new Error(`API export is missing ${requiredType}`);
  }
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(`OK ${nodeCount} nodes -> ${outPath}`);
  console.log('class_types:', types.join(', '));
} finally {
  await browser.close();
}
