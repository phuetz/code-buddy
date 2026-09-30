import { readFileSync } from 'node:fs';

export interface DoctorLocalModelPolicy {
  preferredModels: string[];
  maxContext: number;
  allowUnbenchmarkedFallback: boolean;
}

/** Doctor preferences are configuration data, separate from model capabilities. */
export function loadDoctorLocalModelPolicy(): DoctorLocalModelPolicy {
  const file = process.env.CODEBUDDY_DOCTOR_LOCAL_POLICY?.trim()
    || new URL('../../docs/doctor-local-models.json', import.meta.url);
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Doctor local model policy must be an object.');
  const policy = raw as Record<string, unknown>;
  if (!Array.isArray(policy.preferredModels) || !policy.preferredModels.length
    || policy.preferredModels.some(model => typeof model !== 'string' || !model.trim())
    || !Number.isSafeInteger(policy.maxContext) || Number(policy.maxContext) < 1024
    || typeof policy.allowUnbenchmarkedFallback !== 'boolean') throw new Error('Invalid doctor local model policy.');
  return { preferredModels: (policy.preferredModels as string[]).map(model => model.trim()), maxContext: Number(policy.maxContext), allowUnbenchmarkedFallback: policy.allowUnbenchmarkedFallback };
}
