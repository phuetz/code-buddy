/** External agents share the skill firewall and are staged, never enabled. */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import * as yaml from 'yaml';
import { getAgentsDir } from '../utils/codebuddy-home.js';
import { scanSkillContent, buildSkillFirewallReport } from '../security/skill-scanner.js';
import { translateClaudeTools } from '../agent/agent-tools.js';

export interface StagedAgent {
  name: string;
  sourcePath: string;
  verdict: string;
  reason: string;
  tools?: string[];
  destination?: string;
}
export interface AgentImportReport {
  total: number;
  review: StagedAgent[];
  quarantined: StagedAgent[];
  skipped: StagedAgent[];
}
export function importAgents(sourceDir: string, options: { source: string; dryRun: boolean; destRoot?: string }): AgentImportReport {
  const report: AgentImportReport = { total: 0, review: [], quarantined: [], skipped: [] };
  const root = path.join(sourceDir, 'agents');
  if (!fs.existsSync(root)) return report;
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) {
    report.skipped.push({ name: 'agents', sourcePath: 'agents', verdict: 'quarantine', reason: 'agents root is not a regular directory' });
    return report;
  }
  const reserved = new Set<string>();
  for (const entry of fs.readdirSync(root).sort()) {
    if (!/\.md$/i.test(entry)) continue;
    report.total++;
    const file = path.join(root, entry);
    const sourcePath = path.relative(sourceDir, file);
    const name = `imported-${path.basename(entry, '.md').toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    const item: StagedAgent = { name, sourcePath, verdict: 'review', reason: 'external agent disabled pending human review' };
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('agent must be a regular file');
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW ?? 0));
      let bytes: Buffer;
      try {
        if (!fs.fstatSync(fd).isFile()) throw new Error('agent must be a regular file');
        bytes = fs.readFileSync(fd);
      } finally { fs.closeSync(fd); }
      const raw = bytes.toString('utf8');
      const scan = scanSkillContent(raw, file);
      // External agents are instruction-bearing: critical or high-risk content is active
      // even when a skill document would retain it for human review.
      scan.findings = scan.findings.map(f => f.severity === 'critical' || f.severity === 'high' ? { ...f, documentary: false } : f);
      const fw = buildSkillFirewallReport(file, [scan]);
      item.verdict = fw.verdict;
      item.reason = fw.summary;
      if (fw.quarantineRequired) { report.quarantined.push(item); continue; }
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      if (!match || !match[2]!.trim()) throw new Error('missing frontmatter or prompt');
      const meta: unknown = yaml.parse(match[1]!);
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('invalid frontmatter');
      const fm = meta as Record<string, unknown>;
      const tools = translateClaudeTools(fm.tools);
      const disallowedTools = fm.disallowedTools === undefined ? undefined : translateClaudeTools(fm.disallowedTools);
      const destination = path.join(options.destRoot ?? getAgentsDir(), 'review', `${name}.md`);
      item.tools = tools;
      item.destination = destination;
      if (reserved.has(destination.toLowerCase())) throw new Error('conflict: duplicate staged agent name');
      reserved.add(destination.toLowerCase());
      if (fs.existsSync(destination)) throw new Error('conflict: staged agent already exists');
      if (!options.dryRun) {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        // Do not carry source permission overrides, hooks, or auto-activation.
        const staged = {
          name, description: typeof fm.description === 'string' ? fm.description : name,
          tools, ...(disallowedTools ? { disallowedTools } : {}), permissionMode: 'suggest',
          imported: true, disabled: true, source: options.source, sourcePath,
          sourceSha256: createHash('sha256').update(bytes).digest('hex'), firewallVerdict: fw.verdict,
        };
        fs.writeFileSync(destination, `---\n${yaml.stringify(staged)}---\n\n${match[2]!.trim()}\n`, { flag: 'wx' });
      }
      item.reason = `${fw.summary} Disabled pending human review.`;
      report.review.push(item);
    } catch (error) {
      item.verdict = 'quarantine';
      item.reason = error instanceof Error ? error.message : String(error);
      report.skipped.push(item);
    }
  }
  return report;
}
