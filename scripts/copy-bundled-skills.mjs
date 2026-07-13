#!/usr/bin/env node
/**
 * Copy the bundled SKILL.md files into dist/ after tsc (which only emits JS).
 * getBundledSkillsPath() resolves them relative to the compiled module
 * (dist/skills/index.js → dist/skills/bundled/), so a built or published
 * package ships the same bundled tier a source checkout loads from
 * src/skills/bundled/.
 */
import { mkdirSync, readdirSync, copyFileSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src', 'skills', 'bundled');
const outDir = join(root, 'dist', 'skills', 'bundled');

mkdirSync(outDir, { recursive: true });
let copied = 0;
for (const entry of readdirSync(srcDir)) {
  const srcPath = join(srcDir, entry);
  const outPath = join(outDir, entry);
  if (entry.endsWith('.md')) {
    copyFileSync(srcPath, outPath);
    copied++;
  } else {
    // Skill-creator and the cross-client SKILL.md standard use one directory
    // per skill so UI metadata and future references/assets travel together.
    // Keep supporting the historical flat *.skill.md files as well.
    cpSync(srcPath, outPath, { recursive: true });
    copied++;
  }
}
console.log(`copy-bundled-skills: ${copied} skill package(s) → dist/skills/bundled/`);
