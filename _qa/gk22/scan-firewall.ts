import { scanSkillFirewall } from '../../src/security/skill-scanner.js';

const target = process.argv[2];
if (!target) {
  console.error('usage: scan-firewall.ts <dir-or-file>');
  process.exit(2);
}
const report = scanSkillFirewall(target);
console.log(JSON.stringify({
  target: report.target,
  verdict: report.verdict,
  quarantineRequired: report.quarantineRequired,
  score: report.score,
  summary: report.summary,
  capabilities: report.capabilities,
  findingCounts: report.findingCounts,
  findings: report.findings.map((f) => ({
    pattern: f.pattern,
    severity: f.severity,
    file: f.file,
    line: f.line,
    evidence: f.evidence,
  })),
}, null, 2));
