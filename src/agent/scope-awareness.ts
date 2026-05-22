import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CodeBuddyClient } from '../codebuddy/client.js';
import { detectProviderFromEnv } from '../utils/provider-detector.js';
import { AgenticCodingTaskContract } from './autonomous/agentic-coding-contract.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface ScopeEvaluationResult {
  allowed: boolean;
  reason?: string;
}

const RULES_FILES = ['AGENTS.md', 'COLAB.md', 'CLAUDE.md', 'README.md'];

/**
 * Evaluates if the task contract violates any repository-level rules or guidelines.
 * Loads rules files (max 4 KB each) and performs LLM checks.
 */
export async function evaluateScope(
  contract: AgenticCodingTaskContract,
  customClient?: CodeBuddyClient
): Promise<ScopeEvaluationResult> {
  // 1. Load rules files (max 4 KB each)
  const rulesContent: Record<string, string> = {};
  let hasRules = false;

  for (const fileName of RULES_FILES) {
    const filePath = path.join(contract.repo, fileName);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        const content = await fs.readFile(filePath, 'utf8');
        const sliced = content.slice(0, 4096);
        if (sliced.trim()) {
          rulesContent[fileName] = sliced;
          hasRules = true;
        }
      }
    } catch {
      // Ignore if file doesn't exist or can't be read
    }
  }

  // If no rules files are found, default to allowed
  if (!hasRules) {
    return { allowed: true };
  }

  // 2. Get git status / diff to identify pre-existing changes
  let gitStatusText = '';
  try {
    const { stdout } = await execAsync('git status --short --branch', { cwd: contract.repo });
    gitStatusText = stdout.trim();
  } catch {
    // Ignore if not a git repo or git is missing
  }

  // 3. Initialize CodeBuddyClient
  let client: CodeBuddyClient;
  if (customClient) {
    client = customClient;
  } else {
    const detected = detectProviderFromEnv();
    if (!detected) {
      // If no LLM provider is configured, default to allowed (fail-open for scope check if offline)
      return { allowed: true };
    }
    client = new CodeBuddyClient(detected.apiKey, detected.defaultModel, detected.baseURL);
  }

  // 4. Formulate LLM prompt
  const rulesSummary = Object.entries(rulesContent)
    .map(([name, content]) => `=== File: ${name} ===\n${content}`)
    .join('\n\n');

  const systemPrompt = `You are a repository scope compliance checker.
Your job is to determine whether the requested task or the modified files violate any explicit guidelines, restrictions, or instructions defined in the repository guides (e.g. AGENTS.md, COLAB.md, CLAUDE.md, README.md).

For example, look for statements like:
- "Do not modify X"
- "Agents are not allowed to change Y"
- "Only manually edit Z"

Respond STRICTLY in JSON format:
{
  "allowed": boolean,
  "reason": "If allowed is false, provide a clear explanation of which rule/guide was violated. Otherwise omit or keep empty."
}`;

  const userPrompt = `Task Description:
"${contract.task}"

Target Repository:
"${contract.repo}"

Allowed/Declared Edits:
${JSON.stringify(contract.edits, null, 2)}

Allowed Paths:
${JSON.stringify(contract.allowedPaths, null, 2)}

Current Git Status:
${gitStatusText || 'Clean'}

Repository Rules/Guides:
${rulesSummary}

Does this task or the proposed file edits violate the repository rules? Evaluate and return JSON.`;

  try {
    const response = await client.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);

    const reply = response.choices?.[0]?.message?.content;
    if (!reply) {
      return { allowed: true };
    }

    // Extract JSON block if needed
    let jsonText = reply.trim();
    const blockMatch = jsonText.match(/```json\s*([\s\S]*?)\s*```/);
    if (blockMatch && blockMatch[1]) {
      jsonText = blockMatch[1].trim();
    }
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      jsonText = jsonText.substring(start, end + 1);
    }

    const result = JSON.parse(jsonText) as { allowed: boolean; reason?: string };
    return {
      allowed: typeof result.allowed === 'boolean' ? result.allowed : true,
      reason: result.reason,
    };
  } catch (error) {
    // If check fails (network, parsing), default to allowed
    return { allowed: true };
  }
}
