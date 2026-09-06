#!/usr/bin/env node
/**
 * Copy mobile PWA static assets into dist/ after tsc (which only emits JS).
 * Same pattern as scripts/copy-bundled-skills.mjs.
 */
import { mkdirSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeMobilePwaIcons } from './generate-mobile-pwa-icons.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src', 'server', 'mobile', 'assets');
const outDir = join(root, 'dist', 'server', 'mobile', 'assets');

if (!existsSync(srcDir)) {
  throw new Error(`copy-mobile-pwa-assets: missing ${srcDir}`);
}

writeMobilePwaIcons(srcDir);
mkdirSync(outDir, { recursive: true });
cpSync(srcDir, outDir, { recursive: true });
writeMobilePwaIcons(outDir);
console.log('copy-mobile-pwa-assets: src/server/mobile/assets → dist/server/mobile/assets');
