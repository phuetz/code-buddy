/**
 * Programmatic tool calling (`code_exec`) policy per model (comparatif plan P5).
 *
 * - `offer` (default, unchanged behaviour): `code_exec` is selected by relevance
 *   or when the user explicitly asks for programmatic tool calling.
 * - `prefer`: `code_exec` is always offered and the model gets a short hint to
 *   batch multi-step reads/computations into one program.
 * - `off`: `code_exec` is never offered, even on explicit request; the model is
 *   told why through the runtime settings snapshot.
 *
 * Promotion rule: NO model ships with `prefer`. A `prefer` entry in
 * `model-tools.ts` must carry `codeExecEvidence` (a Buddy recette report proving
 * ADV01–ADV09 on that model). Other projects' "preferred" lists are not evidence.
 * `CODEBUDDY_CODE_EXEC_POLICY` is an explicit operator override for trials.
 */

import { getModelToolConfig } from './model-tools.js';

export type CodeExecPolicy = 'off' | 'offer' | 'prefer';

export interface ResolvedCodeExecPolicy {
  policy: CodeExecPolicy;
  source: 'env' | 'model' | 'default';
  evidence?: string;
}

const POLICIES: ReadonlySet<string> = new Set(['off', 'offer', 'prefer']);

export function isCodeExecPolicy(value: unknown): value is CodeExecPolicy {
  return typeof value === 'string' && POLICIES.has(value);
}

export function resolveCodeExecPolicy(model: string | undefined): ResolvedCodeExecPolicy {
  const override = process.env.CODEBUDDY_CODE_EXEC_POLICY?.trim().toLowerCase();
  if (isCodeExecPolicy(override)) return { policy: override, source: 'env' };
  if (model) {
    const config = getModelToolConfig(model);
    if (isCodeExecPolicy(config.codeExec)) {
      return {
        policy: config.codeExec,
        source: 'model',
        ...(config.codeExecEvidence ? { evidence: config.codeExecEvidence } : {}),
      };
    }
  }
  return { policy: 'offer', source: 'default' };
}

export const CODE_EXEC_PREFER_HINT =
  'Programmatic tool calling is preferred for this model: when a task needs several reads, searches or computations whose results feed each other, run them in ONE code_exec program (tools.call) instead of many separate tool rounds. Keep single-step tasks as direct tool calls.';

export const CODE_EXEC_OFF_NOTICE =
  'Programmatic tool calling (code_exec) is disabled by the model policy for this model. If the user asks for code_exec or tools.call, say that it is disabled for this model and use direct tool calls instead.';
