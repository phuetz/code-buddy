import fs from 'fs';
import path from 'path';
import { findSkillDirs } from '../../src/skills/skill-importer.js';
import { scanSkillFirewall } from '../../src/security/skill-scanner.js';
const root = path.resolve(process.argv[2]!);
const items = findSkillDirs(root).map(dir => {
  const fw = scanSkillFirewall(dir);
  return { sourcePath: path.relative(root, dir), verdict: fw.verdict, score: fw.score,
    findings: fw.findings.map(f => ({ pattern: f.pattern, severity: f.severity, file: path.relative(root, f.file), line: f.line })) };
});
fs.writeFileSync(process.argv[3]!, JSON.stringify(items, null, 2) + '\n');
