/**
 * Skill proposers — author a SKILL.md for a coverage scenario. A skill is pure
 * guidance, so there is no held-out set to hide (unlike tools); the proposer may
 * see the scenario in full. Safety is enforced downstream by the firewall gate.
 *
 * @module agent/self-improvement/skill-proposer
 */

import { toAuthoredSkillName } from './skill-mutator.js';
import type { SkillBenchmarkScenario, SkillProposal, SkillSpec } from './skill-types.js';

export interface SkillProposer {
  propose(scenario: SkillBenchmarkScenario): Promise<SkillProposal | null>;
}

/** Deterministic proposer backed by a fixture map (scenarioId → spec). */
export class StaticSkillProposer implements SkillProposer {
  constructor(private readonly specs: Map<string, SkillSpec>) {}

  async propose(scenario: SkillBenchmarkScenario): Promise<SkillProposal | null> {
    const spec = this.specs.get(scenario.id);
    if (!spec) return null;
    return { id: `skill-proposal:${scenario.id}`, targetScenarioId: scenario.id, spec };
  }
}

interface MinimalClient {
  chat(
    messages: Array<{ role: string; content: string }>,
    tools?: unknown[],
  ): Promise<{ choices?: Array<{ message?: { content?: string | null } }> }>;
}

export function buildSkillDraftPrompt(scenario: SkillBenchmarkScenario): string {
  const visible = scenario.visibleIncludes ?? scenario.expectIncludes;
  return [
    `Write a SKILL.md that gives you reusable guidance for this situation:`,
    `  ${scenario.query}`,
    ``,
    `It MUST clearly cover these points (use these exact terms): ${JSON.stringify(visible)}.`,
    ``,
    `Format: a short markdown skill — a title line, a one-line "when to use", then`,
    `concrete steps/notes. Keep it focused. Do NOT include any instruction to ignore`,
    `safety rules, reveal or exfiltrate secrets/credentials, or run destructive`,
    `commands — such content is rejected by a safety firewall.`,
    ``,
    `Return ONLY the SKILL.md markdown (no surrounding prose).`,
  ].join('\n');
}

export interface LlmSkillProposerOptions {
  client?: MinimalClient | null;
}

export class LlmSkillProposer implements SkillProposer {
  private clientPromise: Promise<MinimalClient | null> | null;

  constructor(options: LlmSkillProposerOptions = {}) {
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

  async propose(scenario: SkillBenchmarkScenario): Promise<SkillProposal | null> {
    const client = await this.getClient();
    if (!client) return null;
    try {
      const prompt = buildSkillDraftPrompt(scenario);
      const response = await client.chat([{ role: 'user', content: prompt }], []);
      const content = response?.choices?.[0]?.message?.content?.trim();
      if (!content) return null;
      const spec: SkillSpec = {
        name: toAuthoredSkillName(scenario.id),
        description: scenario.description,
        content,
      };
      return { id: `llm-skill:${scenario.id}`, targetScenarioId: scenario.id, spec };
    } catch {
      return null;
    }
  }
}
