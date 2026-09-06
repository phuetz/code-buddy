/**
 * Candidates for `buddy autonomy bench`.
 *
 * The CLI used to probe Tailnet Ollama peers only, so a box with a working
 * local Ollama (the actual autonomy local tier) reported
 * "No Tailnet Ollama peers were discovered" and skipped the model it runs on.
 */

export interface AutonomyBenchPeer {
  hostname: string;
  ip: string;
  baseURL: string;
  models: string[];
}

export interface AutonomyBenchCandidate {
  model: string;
  baseUrl: string;
  label?: string;
}

export interface CollectAutonomyBenchCandidatesInput {
  local?: { model: string; baseUrl: string; label?: string };
  tailnet: AutonomyBenchPeer[];
  peerFilter?: string;
  modelFilters?: string[];
}

export interface CollectAutonomyBenchCandidatesResult {
  candidates: AutonomyBenchCandidate[];
  error?: string;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function matchesPeer(peer: AutonomyBenchPeer, filter: string): boolean {
  const needle = filter.toLowerCase();
  return peer.hostname.toLowerCase().includes(needle) || peer.ip.includes(filter.trim());
}

function matchesModel(model: string, filters: string[]): boolean {
  if (filters.length === 0) return true;
  const hay = model.toLowerCase();
  return filters.some((filter) => hay.includes(filter.toLowerCase()));
}

function candidateKey(candidate: AutonomyBenchCandidate): string {
  return `${normalizeBaseUrl(candidate.baseUrl)}::${candidate.model}`;
}

export function collectAutonomyBenchCandidates(
  input: CollectAutonomyBenchCandidatesInput,
): CollectAutonomyBenchCandidatesResult {
  const modelFilters = input.modelFilters ?? [];
  const seen = new Set<string>();
  const candidates: AutonomyBenchCandidate[] = [];

  const push = (candidate: AutonomyBenchCandidate): void => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      model: candidate.model,
      baseUrl: normalizeBaseUrl(candidate.baseUrl),
      ...(candidate.label ? { label: candidate.label } : {}),
    });
  };

  if (input.local?.model && input.local.baseUrl && matchesModel(input.local.model, modelFilters)) {
    if (!input.peerFilter || 'local'.includes(input.peerFilter.toLowerCase())
      || input.local.label?.toLowerCase().includes(input.peerFilter.toLowerCase())
      || input.local.baseUrl.includes(input.peerFilter.trim())) {
      push({
        model: input.local.model,
        baseUrl: input.local.baseUrl,
        label: input.local.label ?? 'local',
      });
    }
  }

  const filteredPeers = input.peerFilter
    ? input.tailnet.filter((peer) => matchesPeer(peer, input.peerFilter!))
    : input.tailnet;

  for (const peer of filteredPeers) {
    for (const model of peer.models) {
      if (!matchesModel(model, modelFilters)) continue;
      push({ model, baseUrl: peer.baseURL, label: peer.hostname });
    }
  }

  if (candidates.length === 0) {
    const error = input.peerFilter
      ? `No local Ollama or Tailnet Ollama peers matched "${input.peerFilter}".`
      : 'No local Ollama model is configured and no Tailnet Ollama peers were discovered.';
    return { candidates, error };
  }
  return { candidates };
}
