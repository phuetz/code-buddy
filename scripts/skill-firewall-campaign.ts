/**
 * Skill Firewall Campaign Scanner
 *
 * Runs scanSkillFirewall on each skill in the corpus and outputs:
 * [ { skill: string, verdict: SkillFirewallVerdict, findings: ScanFinding[] } ]
 *
 * Usage:
 *   npx tsx scripts/skill-firewall-campaign.ts [--corpus <dir>] [--out <file.json>] [--json]
 */

import fs from 'fs';
import path from 'path';
import { scanSkillFirewall, type ScanFinding, type SkillFirewallVerdict } from '../src/security/skill-scanner.js';

export interface SkillCampaignResult {
  skill: string;
  verdict: SkillFirewallVerdict;
  findings: ScanFinding[];
  score?: number;
}

export function discoverSkills(corpusDir: string): string[] {
  const skills: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // If this directory contains SKILL.md, it is a skill directory. Do not descend further.
    if (entries.some((e) => e.isFile() && e.name.toLowerCase() === 'skill.md')) {
      skills.push(dir);
      return;
    }

    for (const e of entries) {
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && e.name !== 'node_modules') {
          walk(fullPath);
        }
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.skill.md')) {
        skills.push(fullPath);
      }
    }
  }

  walk(corpusDir);
  return skills.sort();
}

function sanitizePath(rawPath: string, rootDir: string): string {
  const rel = path.relative(rootDir, rawPath);
  return rel.replace(/\\/g, '/');
}

export function runCampaign(corpusDir: string): SkillCampaignResult[] {
  const rootDir = process.cwd();
  const skillPaths = discoverSkills(corpusDir);
  const results: SkillCampaignResult[] = [];

  for (const skillPath of skillPaths) {
    const report = scanSkillFirewall(skillPath);
    const sanitizedFindings: ScanFinding[] = report.findings.map((f) => ({
      ...f,
      file: sanitizePath(f.file, rootDir),
    }));

    results.push({
      skill: sanitizePath(skillPath, corpusDir),
      verdict: report.verdict,
      findings: sanitizedFindings,
      score: report.score,
    });
  }

  return results;
}

function main(): void {
  const args = process.argv.slice(2);
  let corpusDir = path.resolve(process.cwd(), '_qa', 'fw', 'corpus');
  let outFile: string | null = null;
  let jsonOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--corpus' && args[i + 1]) {
      corpusDir = path.resolve(process.cwd(), args[++i]!);
    } else if (args[i] === '--out' && args[i + 1]) {
      outFile = path.resolve(process.cwd(), args[++i]!);
    } else if (args[i] === '--json') {
      jsonOnly = true;
    }
  }

  if (!fs.existsSync(corpusDir)) {
    console.error(`Error: Corpus directory not found: ${corpusDir}`);
    process.exit(1);
  }

  const results = runCampaign(corpusDir);

  const counts = {
    allow: results.filter((r) => r.verdict === 'allow').length,
    review: results.filter((r) => r.verdict === 'review').length,
    quarantine: results.filter((r) => r.verdict === 'quarantine').length,
  };

  const cleanResults = results.map(({ skill, verdict, findings }) => ({
    skill,
    verdict,
    findings,
  }));

  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify(cleanResults, null, 2), 'utf-8');
  }

  if (jsonOnly) {
    console.log(JSON.stringify(cleanResults, null, 2));
    return;
  }

  console.log(`\n=== Skill Firewall Campaign Report ===`);
  console.log(`Corpus: ${path.relative(process.cwd(), corpusDir)}`);
  console.log(`Total skills scanned: ${results.length}`);
  console.log(`  - Allow:      ${counts.allow}`);
  console.log(`  - Review:     ${counts.review}`);
  console.log(`  - Quarantine: ${counts.quarantine}\n`);

  if (counts.quarantine > 0) {
    console.log(`--- Quarantined Skills (${counts.quarantine}) ---`);
    for (const r of results) {
      if (r.verdict === 'quarantine') {
        const patterns = [...new Set(r.findings.map((f) => f.pattern))].join(', ');
        console.log(`[QUARANTINE] ${r.skill} (score: ${r.score})`);
        console.log(`  Patterns: ${patterns || 'score < 55 / critical'}`);
        for (const f of r.findings) {
          if (f.severity === 'critical' || f.severity === 'high') {
            console.log(`    - [${f.severity.toUpperCase()}] ${f.pattern}: ${f.description}`);
            console.log(`      File: ${f.file}:${f.line}`);
            console.log(`      Evidence: ${f.evidence}`);
          }
        }
      }
    }
  }

  if (outFile) {
    console.log(`\nDetailed results saved to: ${path.relative(process.cwd(), outFile)}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
