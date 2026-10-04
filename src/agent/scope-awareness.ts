import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CodeBuddyClient } from '../codebuddy/client.js';
import { createAuxiliaryClient } from '../providers/auxiliary-llm.js';
import { AgenticCodingTaskContract } from './autonomous/agentic-coding-contract.js';

const execFileAsync = promisify(execFile);
const MAX_RULE_BYTES = 4096;

const RULES_FILES = [
  ['AGENTS.md', 'agentsMd'],
  ['COLAB.md', 'colabMd'],
  ['CLAUDE.md', 'claudeMd'],
  ['README.md', 'readme'],
] as const;

const DANGEROUS_TASK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bgit\s+push\b/i, reason: 'git push is outside the autonomous coding cell guardrails' },
  { pattern: /\brm\s+-rf\b/i, reason: 'recursive deletion is outside the autonomous coding cell guardrails' },
  { pattern: /\bremove-item\b.*\b-recurse\b/i, reason: 'recursive deletion is outside the autonomous coding cell guardrails' },
  { pattern: /\bdelete\b.*\b(all|everything|repo|repository|project|workspace|directory|folder)\b/i, reason: 'broad deletion requires explicit human handling' },
  { pattern: /\b(format|wipe)\b.*\b(disk|drive|workspace|repository|repo)\b/i, reason: 'destructive workspace operation requires explicit human handling' },
  { pattern: /\b(deploy|publish|release)\b.*\b(prod|production)\b/i, reason: 'production deployment is outside the autonomous coding cell guardrails' },
];

export interface RepoRules {
  agentsMd?: string;
  colabMd?: string;
  claudeMd?: string;
  readme?: string;
  preexistingChanges: string[];
}

export interface ScopeVerdict {
  allowed: boolean;
  reason: string;
  facts: string[];
  inferences: string[];
}

export type ScopeEvaluationResult = ScopeVerdict;

function isAgenticCodingTaskContract(value: unknown): value is AgenticCodingTaskContract {
  const candidate = value as Partial<AgenticCodingTaskContract>;
  return typeof candidate?.repo === 'string'
    && typeof candidate.task === 'string'
    && Array.isArray(candidate.allowedPaths);
}

function hasRulesContent(rules: RepoRules): boolean {
  return Boolean(rules.agentsMd || rules.colabMd || rules.claudeMd || rules.readme);
}

function parseGitStatus(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.startsWith('##'))
    .map((line) => {
      const rawPath = line.length > 3 ? line.slice(3).trim() : line.trim();
      const renameTarget = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath;
      return (renameTarget ?? rawPath).replace(/\\/g, '/').trim();
    })
    .filter(Boolean);
}

export async function loadRepoRules(repo: string): Promise<RepoRules> {
  const rules: RepoRules = { preexistingChanges: [] };

  for (const [fileName, key] of RULES_FILES) {
    const filePath = path.join(repo, fileName);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }
      const content = await fs.readFile(filePath, 'utf8');
      const sliced = content.slice(0, MAX_RULE_BYTES);
      if (sliced.trim()) {
        rules[key] = sliced;
      }
    } catch {
      // Missing or unreadable rule files are not scope violations.
    }
  }

  try {
    const { stdout } = await execFileAsync('git', ['status', '--short', '--branch'], { cwd: repo });
    rules.preexistingChanges = parseGitStatus(stdout);
  } catch {
    rules.preexistingChanges = [];
  }

  return rules;
}

/* eslint-disable no-redeclare */
export function evaluateScope(rules: RepoRules, contract: AgenticCodingTaskContract): ScopeVerdict;
export function evaluateScope(contract: AgenticCodingTaskContract, customClient?: CodeBuddyClient): Promise<ScopeVerdict>;
export function evaluateScope(
  arg1: RepoRules | AgenticCodingTaskContract,
  arg2?: AgenticCodingTaskContract | CodeBuddyClient,
): ScopeVerdict | Promise<ScopeVerdict> {
  if (isAgenticCodingTaskContract(arg1)) {
    return evaluateScopeForContract(arg1, arg2 as CodeBuddyClient | undefined);
  }

  return evaluateScopeWithRules(arg1, arg2 as AgenticCodingTaskContract);
}
/* eslint-enable no-redeclare */

function evaluateScopeWithRules(rules: RepoRules, contract: AgenticCodingTaskContract): ScopeVerdict {
  const facts: string[] = [];
  const inferences: string[] = [];

  if (rules.agentsMd) facts.push('Loaded AGENTS.md repository rules.');
  if (rules.colabMd) facts.push('Loaded COLAB.md repository rules.');
  if (rules.claudeMd) facts.push('Loaded CLAUDE.md repository rules.');
  if (rules.readme) facts.push('Loaded README.md repository context.');
  if (rules.preexistingChanges.length > 0) {
    facts.push(`Detected pre-existing changes: ${rules.preexistingChanges.join(', ')}`);
  }

  for (const { pattern, reason } of DANGEROUS_TASK_PATTERNS) {
    if (pattern.test(contract.task)) {
      return {
        allowed: false,
        reason,
        facts,
        inferences: [`Task text matched safety pattern ${pattern.toString()}.`],
      };
    }
  }

  const touchedPreexisting = contract.edits
    .map((edit) => edit.path.replace(/\\/g, '/'))
    .filter((editPath) => rules.preexistingChanges.includes(editPath));
  if (touchedPreexisting.length > 0) {
    inferences.push(
      `Declared edits touch pre-existing changed files (${touchedPreexisting.join(', ')}); caller must preserve user work.`,
    );
  }

  if (!hasRulesContent(rules)) {
    return {
      allowed: true,
      reason: 'No repository rule files were found; deterministic scope checks passed.',
      facts,
      inferences,
    };
  }

  inferences.push('No deterministic repository-scope violation matched.');
  return {
    allowed: true,
    reason: 'Repository rule files loaded and deterministic scope checks passed.',
    facts,
    inferences,
  };
}

async function evaluateScopeForContract(
  contract: AgenticCodingTaskContract,
  customClient?: CodeBuddyClient,
): Promise<ScopeVerdict> {
  const rules = await loadRepoRules(contract.repo);
  const deterministic = evaluateScopeWithRules(rules, contract);
  if (!deterministic.allowed) {
    return deterministic;
  }

  if (!hasRulesContent(rules)) {
    return deterministic;
  }

  const client = customClient ?? createEnvClient();
  if (!client) {
    return {
      ...deterministic,
      inferences: [
        ...deterministic.inferences,
        'Semantic rule interpretation was skipped because no LLM provider is configured.',
      ],
    };
  }

  const semantic = await evaluateRulesSemantically(rules, contract, client);
  if (!semantic) {
    return deterministic;
  }

  return {
    allowed: semantic.allowed,
    reason: semantic.reason || deterministic.reason,
    facts: deterministic.facts,
    inferences: [
      ...deterministic.inferences,
      'Semantic rule interpretation was provided by the configured LLM client.',
    ],
  };
}

function createEnvClient(): CodeBuddyClient | null {
  return createAuxiliaryClient('scope');
}

async function evaluateRulesSemantically(
  rules: RepoRules,
  contract: AgenticCodingTaskContract,
  client: CodeBuddyClient,
): Promise<{ allowed: boolean; reason?: string } | null> {
  const rulesSummary = [
    rules.agentsMd ? `=== File: AGENTS.md ===\n${rules.agentsMd}` : '',
    rules.colabMd ? `=== File: COLAB.md ===\n${rules.colabMd}` : '',
    rules.claudeMd ? `=== File: CLAUDE.md ===\n${rules.claudeMd}` : '',
    rules.readme ? `=== File: README.md ===\n${rules.readme}` : '',
  ].filter(Boolean).join('\n\n');

  const systemPrompt = `You are a repository scope compliance checker.
Determine whether the requested task or declared file edits violate explicit repository rules.
Respond strictly as JSON: {"allowed": boolean, "reason": "short reason when denied"}.`;

  const userPrompt = `Task:
${contract.task}

Allowed paths:
${JSON.stringify(contract.allowedPaths, null, 2)}

Declared edits:
${JSON.stringify(contract.edits, null, 2)}

Pre-existing changes before this agent:
${rules.preexistingChanges.length > 0 ? rules.preexistingChanges.join('\n') : 'Clean'}

Repository rules:
${rulesSummary}`;

  try {
    const response = await client.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    const reply = response.choices?.[0]?.message?.content;
    if (!reply) {
      return null;
    }

    let jsonText = reply.trim();
    const blockMatch = jsonText.match(/```json\s*([\s\S]*?)\s*```/);
    if (blockMatch?.[1]) {
      jsonText = blockMatch[1].trim();
    }
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      jsonText = jsonText.slice(start, end + 1);
    }

    const parsed = JSON.parse(jsonText) as { allowed?: unknown; reason?: unknown };
    if (typeof parsed.allowed !== 'boolean') {
      return null;
    }
    return {
      allowed: parsed.allowed,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
    };
  } catch {
    return null;
  }
}
