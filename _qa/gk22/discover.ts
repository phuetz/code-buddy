/**
 * Load the real SkillRegistry against HOME + cwd skills and print matches.
 * Usage: HOME=... npx tsx _qa/gk22/discover.ts "<query>"
 */
import os from 'os';
import path from 'path';
import { SkillRegistry } from '../../src/skills/registry.js';
import { resetSkillRegistry } from '../../src/skills/registry.js';
import { resetSkillsHub } from '../../src/skills/hub.js';

const query = process.argv.slice(2).join(' ').trim();
if (!query) {
  console.error('usage: discover.ts "<query>"');
  process.exit(2);
}

resetSkillRegistry();
resetSkillsHub();

const registry = new SkillRegistry({
  workspacePath: path.join(process.cwd(), '.codebuddy', 'skills'),
  managedPath: path.join(os.homedir(), '.codebuddy', 'skills'),
  bundledPath: '',
  lazyLoad: false,
  cacheEnabled: false,
  watchEnabled: false,
  vectorSearchEnabled: false,
});

await registry.load();
const loaded = registry.list().map((s) => `${s.metadata.name} [${s.tier}]`);
const matches = registry.search({ query, minConfidence: 0.15, limit: 8 });
const best = registry.findBestMatch(query);

console.log(JSON.stringify({
  home: os.homedir(),
  cwd: process.cwd(),
  loadedCount: loaded.length,
  loaded,
  query,
  matches: matches.map((m) => ({
    name: m.skill.metadata.name,
    confidence: m.confidence,
    reason: m.reason,
    triggers: m.matchedTriggers,
    imported: m.skill.metadata.imported === true,
    source: m.skill.metadata.source,
  })),
  best: best
    ? {
      name: best.skill.metadata.name,
      confidence: best.confidence,
      reason: best.reason,
      imported: best.skill.metadata.imported === true,
    }
    : null,
}, null, 2));

registry.shutdown();
resetSkillRegistry();
resetSkillsHub();
