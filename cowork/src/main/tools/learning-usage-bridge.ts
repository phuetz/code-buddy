import { isAbsolute, resolve } from 'path';
import { loadCoreModule } from '../utils/core-loader';

export interface LearningSkillUsageSummary {
  averageDurationMs?: number;
  deprecated: boolean;
  failureCount: number;
  invocationCount: number;
  lastDurationMs?: number;
  lastError?: string;
  lastRunId?: string;
  lastUsedAt: string;
  reinforced: boolean;
  skillName: string;
  successCount: number;
}

export interface ListLearningSkillUsageOptions {
  limit?: number;
  rootDir: string;
}

interface LearningAgentModule {
  listLearningSkillUsage: (workDir: string) => LearningSkillUsageSummary[];
}

export async function listLearningSkillUsageForReview(
  options: ListLearningSkillUsageOptions,
): Promise<LearningSkillUsageSummary[]> {
  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  if (!rootDir) return [];

  const mod = await loadCoreModule<LearningAgentModule>('agent/learning-agent.js');
  if (!mod?.listLearningSkillUsage) return [];

  return mod
    .listLearningSkillUsage(rootDir)
    .slice(0, normalizeLimit(options.limit));
}

function normalizeAbsoluteRoot(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  return isAbsolute(trimmed) ? resolve(trimmed) : null;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(50, Math.max(1, Math.trunc(value as number)));
}
