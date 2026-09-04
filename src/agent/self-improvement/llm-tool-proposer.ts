/**
 * LLM tool proposer — authors a candidate tool with the agent's own model from a
 * REDACTED scenario view (capability + visible cases only; never the held-out
 * cases). The behavioural held-out gate validates every draft, so even a gamed or
 * broken draft is caught — the LLM is a generator, not a trusted oracle.
 *
 * Lazy + graceful: if no provider is configured the proposer declines (null) and
 * the engine simply finds no proposal.
 *
 * @module agent/self-improvement/llm-tool-proposer
 */

import { AUTHORED_LANGUAGES, toAuthoredName, type AuthoredToolSpec } from './authored-tool-runtime.js';
import type { ProposerScenarioView, ToolProposer } from './tool-proposer.js';
import type { ToolProposal } from './tool-types.js';
import type { ExecuteCodeLanguage } from '../../tools/execute-code-runner.js';

interface MinimalClient {
  chat(
    messages: Array<{ role: string; content: string }>,
    tools?: unknown[],
  ): Promise<{ choices?: Array<{ message?: { content?: string | null } }> }>;
}

export function buildToolDraftPrompt(view: ProposerScenarioView): string {
  const examples = view.visibleCases
    .map(
      (c, i) =>
        `  ${i + 1}. input ${JSON.stringify(c.input)} → output must equal ${JSON.stringify(c.expectedOutput)}`,
    )
    .join('\n');
  return [
    `Author a small, self-contained tool for this capability:`,
    `  ${view.capability}`,
    ``,
    `Example behaviour (these are ONLY examples — the tool must GENERALIZE to any valid input;`,
    `do NOT hardcode these outputs, that will be rejected by a held-out check):`,
    examples,
    ``,
    `The tool runs as a standalone script: it reads its arguments as JSON from the`,
    `environment variable CODEBUDDY_TOOL_INPUT and prints ONLY its result to stdout.`,
    `It must not touch the network or the filesystem.`,
    ``,
    `Return ONLY a JSON object (no prose, no code fence) with exactly these fields:`,
    `{"name": "<short_snake_case>", "description": "<one line>",`,
    ` "params": <JSON Schema for the input object>,`,
    ` "language": "javascript" | "python",`,
    ` "code": "<the full script source>"}`,
  ].join('\n');
}

/** Extract the first balanced top-level JSON object from a model response. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse + validate a model draft into an AuthoredToolSpec, or null. */
export function parseToolDraft(text: string): AuthoredToolSpec | null {
  const json = extractJsonObject(text);
  if (!json) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const name = String(raw.name ?? '').trim();
  const description = String(raw.description ?? '').trim();
  const code = typeof raw.code === 'string' ? raw.code : '';
  const language = String(raw.language ?? 'javascript').toLowerCase() as ExecuteCodeLanguage;
  if (!name || !description || !code.trim()) return null;
  if (!AUTHORED_LANGUAGES.includes(language)) return null;
  const parameters =
    raw.params && typeof raw.params === 'object'
      ? (raw.params as Record<string, unknown>)
      : { type: 'object', properties: {} };
  return { name: toAuthoredName(name), description, parameters, language, code };
}

export interface LlmToolProposerOptions {
  /** Override the chat client (tests). Defaults to provider-detected CodeBuddyClient. */
  client?: MinimalClient | null;
}

export class LlmToolProposer implements ToolProposer {
  private clientPromise: Promise<MinimalClient | null> | null;

  constructor(private readonly options: LlmToolProposerOptions = {}) {
    this.clientPromise = options.client !== undefined ? Promise.resolve(options.client) : null;
  }

  private getClient(): Promise<MinimalClient | null> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        try {
          const { detectProviderFromEnv } = await import('../../utils/provider-detector.js');
          const { CodeBuddyClient } = await import('../../codebuddy/client.js');
          const detected = detectProviderFromEnv();
          if (!detected) return null;
          return new CodeBuddyClient(
            detected.apiKey,
            detected.defaultModel,
            detected.baseURL,
          ) as unknown as MinimalClient;
        } catch {
          return null;
        }
      })();
    }
    return this.clientPromise;
  }

  async propose(view: ProposerScenarioView): Promise<ToolProposal | null> {
    const client = await this.getClient();
    if (!client) return null;
    try {
      const prompt = buildToolDraftPrompt(view);
      const response = await client.chat([{ role: 'user', content: prompt }], []);
      const text = response?.choices?.[0]?.message?.content?.trim();
      if (!text) return null;
      const spec = parseToolDraft(text);
      if (!spec) return null;
      return { id: `llm-tool:${view.id}`, targetScenarioId: view.id, spec };
    } catch {
      return null;
    }
  }
}
