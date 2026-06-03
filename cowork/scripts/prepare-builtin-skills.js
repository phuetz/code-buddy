'use strict';

const fs = require('fs');
const path = require('path');

function parseSkillName(content, fallbackName) {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = frontmatterMatch?.[1] ?? '';
  const nameMatch = frontmatter.match(/^name:\s*["']?([^"'\r\n]+)["']?/m);
  const name = (nameMatch?.[1] ?? fallbackName).trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid bundled skill name: ${name}`);
  }
  return name;
}

function readSkillSources(repoRoot) {
  const sources = [];
  const seen = new Set();

  const addSource = (name, sourcePath) => {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    sources.push({ name, sourcePath });
  };

  const sourceBundledDir = path.join(repoRoot, 'src', 'skills', 'bundled');
  if (fs.existsSync(sourceBundledDir)) {
    const entries = fs.readdirSync(sourceBundledDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.skill.md')) {
        continue;
      }
      const sourcePath = path.join(sourceBundledDir, entry.name);
      const fallbackName = entry.name.replace(/\.skill\.md$/, '');
      const content = fs.readFileSync(sourcePath, 'utf8');
      addSource(parseSkillName(content, fallbackName), sourcePath);
    }
  }

  return sources.sort((a, b) => a.name.localeCompare(b.name));
}

function copySkillSource(source, targetDir) {
  const skillDir = path.join(targetDir, source.name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(source.sourcePath, path.join(skillDir, 'SKILL.md'));
}

function stageBuiltinSkills(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? path.join(__dirname, '..', '..'));
  const coworkRoot = path.resolve(options.coworkRoot ?? path.join(__dirname, '..'));
  const targetDir = path.resolve(options.targetDir ?? path.join(coworkRoot, '.claude', 'skills'));

  const sources = readSkillSources(repoRoot);
  if (sources.length === 0) {
    throw new Error('No bundled SKILL.md sources found');
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  for (const source of sources) {
    copySkillSource(source, targetDir);
  }

  return {
    count: sources.length,
    names: sources.map((source) => source.name),
    targetDir,
  };
}

function main() {
  const result = stageBuiltinSkills();
  console.log(
    `[prepare:builtin-skills] Staged ${result.count} built-in skill(s) at ${path.relative(
      path.join(__dirname, '..'),
      result.targetDir
    )}`
  );
  console.log(`[prepare:builtin-skills] ${result.names.join(', ')}`);
}

module.exports = { stageBuiltinSkills, readSkillSources, parseSkillName };

if (require.main === module) {
  main();
}
