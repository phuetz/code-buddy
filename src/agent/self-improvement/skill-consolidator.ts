/**
 * Skill consolidator — merges a CLUSTER of overlapping authored skills into one
 * "umbrella" skill (Hermes's idea) but with OUR distinctive safety net: the merge
 * is accepted only if the umbrella still passes the firewall AND COVERS EVERY
 * scenario the absorbed siblings covered. A merge that drops coverage is rejected
 * (Hermes consolidates by LLM judgment alone; we gate it empirically).
 *
 * Operates only on authored-* skills; pinned siblings are skipped (kept intact);
 * absorbed siblings are ARCHIVED (recoverable), never deleted; each is recorded in
 * the evolutionary archive with `absorbedInto` for audit.
 *
 * @module agent/self-improvement/skill-consolidator
 */

import { EvolutionaryArchive } from './evolutionary-archive.js';
import { createHash } from 'crypto';
import { coversScenario } from './skill-gate.js';
import { LiveSkillMutator, safetyGateSkill, toAuthoredSkillName } from './skill-mutator.js';
import type { SkillBenchmarkScenario } from './skill-types.js';

export interface ClusterSibling {
  name: string;
  scenario: SkillBenchmarkScenario;
}

export interface ConsolidationCluster {
  siblings: ClusterSibling[];
}

export interface UmbrellaProposal {
  name: string;
  content: string;
}

export interface UmbrellaProposer {
  propose(cluster: ConsolidationCluster): Promise<UmbrellaProposal | null>;
}

export type ConsolidationRejection =
  | 'cluster-too-small'
  | 'no-proposal'
  | 'firewall'
  | 'coverage-loss';

export interface ConsolidationOutcome {
  accepted: boolean;
  umbrellaName?: string;
  absorbed: string[];
  skippedPinned: string[];
  rejectionReason?: ConsolidationRejection;
  reasons: string[];
}

/** Build a cluster from installed authored skills that map to a known scenario. */
export function buildClusterFromInstalled(
  mutator: LiveSkillMutator,
  scenarios: SkillBenchmarkScenario[],
): ConsolidationCluster {
  const installed = new Set(mutator.listAuthored());
  const siblings: ClusterSibling[] = [];
  for (const scenario of scenarios) {
    const name = toAuthoredSkillName(scenario.id);
    if (installed.has(name)) siblings.push({ name, scenario });
  }
  return { siblings };
}

export async function consolidateCluster(
  cluster: ConsolidationCluster,
  proposer: UmbrellaProposer,
  mutator: LiveSkillMutator,
  archive: EvolutionaryArchive,
  options: { keepOnAccept: boolean },
): Promise<ConsolidationOutcome> {
  const skippedPinned = cluster.siblings.filter((s) => mutator.isPinned(s.name)).map((s) => s.name);
  const mergeable = cluster.siblings.filter((s) => !mutator.isPinned(s.name));

  if (mergeable.length < 2) {
    return { accepted: false, absorbed: [], skippedPinned, rejectionReason: 'cluster-too-small', reasons: ['need ≥2 non-pinned authored skills to consolidate'] };
  }

  // Gate 0 — every sibling's coverage must be VERIFIABLE before we risk
  // absorbing it. A scenario with no `expectIncludes` gives coversScenario a
  // vacuous `[].every() === true`, so Gate 2 below could not actually protect
  // that sibling — the umbrella would "cover" it while containing none of its
  // guidance. Fail closed: refuse to consolidate a cluster whose coverage
  // can't be checked, rather than silently archiving a sibling we can't verify.
  const unverifiable = mergeable.filter((s) => s.scenario.expectIncludes.length === 0).map((s) => s.scenario.id);
  if (unverifiable.length > 0) {
    return {
      accepted: false,
      absorbed: [],
      skippedPinned,
      rejectionReason: 'coverage-loss',
      reasons: [`coverage unverifiable (empty expectIncludes) for: ${unverifiable.join(', ')} — refusing to absorb`],
    };
  }

  const proposal = await proposer.propose({ siblings: mergeable });
  if (!proposal || !proposal.content.trim()) {
    return { accepted: false, absorbed: [], skippedPinned, rejectionReason: 'no-proposal', reasons: ['no umbrella proposal'] };
  }

  // Gate 1 — the umbrella content must be safe.
  const gate = safetyGateSkill(proposal.content);
  if (!gate.ok) {
    return { accepted: false, absorbed: [], skippedPinned, rejectionReason: 'firewall', reasons: gate.reasons };
  }

  // Gate 2 (the distinctive one) — the umbrella must still cover EVERY merged
  // sibling's scenario. A consolidation that loses coverage is rejected.
  const lost = mergeable.filter((s) => !coversScenario(proposal.content, s.scenario)).map((s) => s.scenario.id);
  if (lost.length > 0) {
    return { accepted: false, absorbed: [], skippedPinned, rejectionReason: 'coverage-loss', reasons: [`umbrella drops coverage for: ${lost.join(', ')}`] };
  }

  const umbrellaName = availableUmbrellaName(
    toAuthoredSkillName(proposal.name),
    proposal.content,
    mutator,
  );
  if (!options.keepOnAccept) {
    return { accepted: true, umbrellaName, absorbed: [], skippedPinned, reasons: ['accepted (propose-only): umbrella safe + covers all merged scenarios, not installed'] };
  }

  // Install the umbrella, archive the merged siblings (recoverable), audit each.
  mutator.create({ name: umbrellaName, description: `Umbrella skill consolidating ${mergeable.length} authored skills`, content: proposal.content });
  const absorbed: string[] = [];
  for (const s of mergeable) {
    if (s.name === umbrellaName) continue; // never archive the umbrella itself
    if (mutator.archive(s.name)) {
      absorbed.push(s.name);
      archive.append({
        proposalId: `consolidate:${umbrellaName}`,
        kind: 'skill',
        targetScenarioId: s.scenario.id,
        delta: 0,
        scoreAfter: 1,
        appliedRef: umbrellaName,
        absorbedInto: umbrellaName,
      });
    }
  }

  return { accepted: true, umbrellaName, absorbed, skippedPinned, reasons: [`consolidated ${absorbed.length} skill(s) into ${umbrellaName}`] };
}

/** Never overwrite a previous umbrella: it may be the sole remaining carrier of old guidance. */
function availableUmbrellaName(
  baseName: string,
  content: string,
  mutator: LiveSkillMutator,
): string {
  if (!mutator.has(baseName)) return baseName;
  const digest = createHash('sha256').update(content).digest('hex').slice(0, 8);
  const contentAddressed = toAuthoredSkillName(`${baseName}-${digest}`);
  if (!mutator.has(contentAddressed)) return contentAddressed;
  let suffix = 2;
  while (mutator.has(`${contentAddressed}-${suffix}`)) suffix += 1;
  return `${contentAddressed}-${suffix}`;
}

// ── proposers ────────────────────────────────────────────────────────────────

/** Deterministic umbrella proposer (fixture for tests). */
export class StaticUmbrellaProposer implements UmbrellaProposer {
  constructor(private readonly umbrella: UmbrellaProposal | null) {}
  async propose(): Promise<UmbrellaProposal | null> {
    return this.umbrella;
  }
}

interface MinimalClient {
  chat(
    messages: Array<{ role: string; content: string }>,
    tools?: unknown[],
  ): Promise<{ choices?: Array<{ message?: { content?: string | null } }> }>;
}

export class LlmUmbrellaProposer implements UmbrellaProposer {
  private clientPromise: Promise<MinimalClient | null> | null;

  constructor(options: { client?: MinimalClient | null } = {}) {
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
          return new CodeBuddyClient(detected.apiKey, detected.defaultModel, detected.baseURL) as unknown as MinimalClient;
        } catch {
          return null;
        }
      })();
    }
    return this.clientPromise;
  }

  async propose(cluster: ConsolidationCluster): Promise<UmbrellaProposal | null> {
    const client = await this.getClient();
    if (!client) return null;
    const terms = cluster.siblings.flatMap((s) => s.scenario.expectIncludes);
    const topics = cluster.siblings.map((s) => `- ${s.scenario.query}`).join('\n');
    const prompt = [
      'Merge these related guidance topics into ONE broader "umbrella" SKILL.md with',
      'labeled subsections — one per topic. Keep ALL the practical guidance; do not drop',
      `any topic. The umbrella MUST still mention every one of these terms: ${JSON.stringify(terms)}.`,
      '',
      'Topics:',
      topics,
      '',
      'Return ONLY the umbrella SKILL.md markdown (a title, then a subsection per topic).',
      'Do NOT include any instruction to ignore safety, reveal/exfiltrate secrets, or run',
      'destructive commands.',
    ].join('\n');
    try {
      const response = await client.chat([{ role: 'user', content: prompt }], []);
      const content = response?.choices?.[0]?.message?.content?.trim();
      if (!content) return null;
      return { name: 'consolidated-skills', content };
    } catch {
      return null;
    }
  }
}
