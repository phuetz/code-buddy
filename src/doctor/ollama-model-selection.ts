import { findModelToolConfig } from '../config/model-tools.js';
import type { OllamaModelCandidate } from '../wizard/environment-detection.js';
import { loadDoctorLocalModelPolicy, type DoctorLocalModelPolicy } from './local-model-policy.js';

const NON_AGENT_MODEL_NAME = /(?:^|[-_.:/])(?:embed(?:ding)?|rag|vision(?:[-_]?only)?)(?:$|[-_.:/])/i;
const CODING_MODEL_NAME = /(?:code|coder|coding|instruct|instruction)/i;

export interface OllamaModelSelection {
  model: string | null;
  /** A one-line explanation suitable for `buddy doctor --fix` output. */
  reason: string;
  maxContext?: number;
}

function formatGiB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

function hasKnownSize(candidate: OllamaModelCandidate): candidate is OllamaModelCandidate & { sizeBytes: number } {
  return typeof candidate.sizeBytes === 'number' && Number.isFinite(candidate.sizeBytes) && candidate.sizeBytes > 0;
}

function isCodingModel(candidate: OllamaModelCandidate): boolean {
  return CODING_MODEL_NAME.test(
    [candidate.name, candidate.family, candidate.parameterSize].filter(Boolean).join(' '),
  );
}

/**
 * Select an installed Ollama model for the agent loop.
 *
 * The order is deliberate and fail-closed: structured tool calls must be
 * declared by `model-tools.ts`; the model size must be known and fit below
 * currently free host RAM; then an instruct/coder family wins, with size as a
 * stable final tie-breaker. Embedding, RAG, and vision-only names never enter
 * the candidate pool.
 */
export function selectOllamaModel(
  candidates: readonly OllamaModelCandidate[],
  availableMemoryBytes: number,
  policy: DoctorLocalModelPolicy = loadDoctorLocalModelPolicy(),
): OllamaModelSelection {
  const availableMemory = Number.isFinite(availableMemoryBytes) && availableMemoryBytes > 0
    ? availableMemoryBytes
    : 0;
  const normalized = candidates
    .map((candidate) => ({ ...candidate, name: candidate.name.trim() }))
    .filter((candidate) => candidate.name.length > 0)
    .filter((candidate) => !NON_AGENT_MODEL_NAME.test(candidate.name))
    .filter((candidate) => findModelToolConfig(candidate.name)?.supportsToolCalls === true)
    .filter(hasKnownSize)
    .filter((candidate) => candidate.sizeBytes < availableMemory);
  const eligible = policy.allowUnbenchmarkedFallback ? normalized
    : normalized.filter(candidate => policy.preferredModels.includes(candidate.name));

  if (eligible.length === 0) {
    return {
      model: null,
      reason: `no installed model meets the recommended agent policy (${policy.preferredModels.join(', ')}), tool-calling and known-size < ${formatGiB(availableMemory)} free RAM; no unbenchmarked default or download was substituted`,
    };
  }

  const ranked = [...eligible].sort((left, right) => {
    const rank = (name: string) => { const index = policy.preferredModels.indexOf(name); return index < 0 ? policy.preferredModels.length : index; };
    const preferredDelta = rank(left.name) - rank(right.name);
    if (preferredDelta) return preferredDelta;
    const codingDelta = Number(isCodingModel(right)) - Number(isCodingModel(left));
    if (codingDelta !== 0) return codingDelta;
    const sizeDelta = left.sizeBytes - right.sizeBytes;
    if (sizeDelta !== 0) return sizeDelta;
    return left.name.localeCompare(right.name);
  });
  const selected = ranked[0]!;
  const family = isCodingModel(selected) ? ', instruct/coder family' : '';
  return {
    model: selected.name,
    maxContext: policy.maxContext,
    reason: `tool-calling, ${formatGiB(selected.sizeBytes)} < ${formatGiB(availableMemory)} free RAM${family}, context capped at ${policy.maxContext}`,
  };
}
