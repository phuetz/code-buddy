import { findModelToolConfig } from '../config/model-tools.js';
import type { OllamaModelCandidate } from '../wizard/environment-detection.js';
import { loadDoctorLocalModelPolicy, localModelInstallGuidance, type DoctorLocalModelPolicy } from './local-model-policy.js';

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
 * Recommendations win, then installed tool-capable fallbacks. Known models
 * fitting free RAM rank first among fallbacks; unknown or larger sizes remain
 * usable with an explicit resource warning. No download is performed.
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
    .filter((candidate) => findModelToolConfig(candidate.name)?.supportsToolCalls === true);
  const eligible = policy.allowUnbenchmarkedFallback ? normalized
    : normalized.filter(candidate => policy.preferredModels.includes(candidate.name));

  if (eligible.length === 0) {
    return {
      model: null,
      reason: `no installed model meets the configured tool-calling agent policy; ${localModelInstallGuidance(policy)}`,
    };
  }

  const ranked = [...eligible].sort((left, right) => {
    const rank = (name: string) => { const index = policy.preferredModels.indexOf(name); return index < 0 ? policy.preferredModels.length : index; };
    const preferredDelta = rank(left.name) - rank(right.name);
    if (preferredDelta) return preferredDelta;
    const fits = (candidate: OllamaModelCandidate) => hasKnownSize(candidate) && candidate.sizeBytes < availableMemory;
    const memoryDelta = Number(fits(right)) - Number(fits(left));
    if (memoryDelta) return memoryDelta;
    const codingDelta = Number(isCodingModel(right)) - Number(isCodingModel(left));
    if (codingDelta !== 0) return codingDelta;
    const leftSize = left.sizeBytes ?? Infinity;
    const rightSize = right.sizeBytes ?? Infinity;
    if (leftSize !== rightSize) return leftSize - rightSize;
    return left.name.localeCompare(right.name);
  });
  const selected = ranked[0]!;
  const family = isCodingModel(selected) ? ', instruct/coder family' : '';
  const fallback = policy.preferredModels.includes(selected.name) ? ''
    : `AVERTISSEMENT : modèle de repli, qualité réduite ; ${localModelInstallGuidance(policy)}. `;
  const memory = hasKnownSize(selected) && selected.sizeBytes < availableMemory
    ? `${formatGiB(selected.sizeBytes)} < ${formatGiB(availableMemory)} free RAM`
    : 'AVERTISSEMENT : mémoire suffisante non garantie (taille inconnue ou supérieure à la RAM libre)';
  return {
    model: selected.name,
    maxContext: policy.maxContext,
    reason: `${fallback}tool-calling, ${memory}${family}, context capped at ${policy.maxContext}`,
  };
}
