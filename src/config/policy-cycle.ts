/**
 * Cycle constats puis réparation. La réparation n'écrit que la configuration
 * utilisateur, via les mêmes commandes que `buddy config set` / `unset`.
 * Le fichier de politique n'est pas modifié : une clause trop ouverte y
 * reste visible, et elle n'est pas appliquée.
 */

import { existsSync, readFileSync } from 'node:fs';

import { runConfigSet, runConfigUnset } from './config-cli.js';
import {
  applyDomainPolicy,
  domainPolicyFromManagedFile,
  POLICY_DOMAIN_STATUS,
  postureFromDocument,
  type DomainPolicy,
  type DomainPosture,
  type PolicyFinding,
  type PolicyRepair,
} from './domain-policy.js';
import { parseTOML, resolveUserConfigFile } from './toml-config.js';

export interface PolicyCycleReport {
  ok: boolean;
  source: string | null;
  policy: DomainPolicy | null;
  findings: PolicyFinding[];
  repairs: PolicyRepair[];
  /** Posture calculée, non branchée aux exécuteurs. */
  effective: DomainPosture;
  application: 'DIAGNOSTIC NON APPLIQUÉ';
  domains: typeof POLICY_DOMAIN_STATUS;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readPolicyFile(filePath: string): {
  source: string | null;
  policy: DomainPolicy | null;
  findings: PolicyFinding[];
  error?: string;
} {
  if (!existsSync(filePath)) return { source: null, policy: null, findings: [] };
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!isRecord(parsed)) {
      return {
        source: filePath,
        policy: null,
        findings: [{
          id: 'policy.file.invalid',
          domain: 'gateway',
          kind: 'policy-invalid',
          message: 'Le fichier de politique n\'est pas un objet JSON. Il est ignoré.',
        }],
        error: 'politique illisible',
      };
    }
    const loaded = domainPolicyFromManagedFile(parsed);
    return { source: filePath, policy: loaded.policy, findings: loaded.findings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      source: filePath,
      policy: null,
      findings: [{
        id: 'policy.file.invalid',
        domain: 'gateway',
        kind: 'policy-invalid',
        message: `Politique illisible (${message}). Elle est ignorée.`,
      }],
      error: message,
    };
  }
}

export function loadPolicy(systemPath: string, userPath: string): ReturnType<typeof readPolicyFile> {
  if (existsSync(systemPath)) return readPolicyFile(systemPath);
  if (existsSync(userPath)) return readPolicyFile(userPath);
  return { source: null, policy: null, findings: [] };
}

export function assessPolicy(input: {
  systemPath: string;
  userPath: string;
  userConfig: Record<string, unknown>;
}): PolicyCycleReport {
  const loaded = loadPolicy(input.systemPath, input.userPath);
  const posture = postureFromDocument(input.userConfig);
  const applied = applyDomainPolicy(posture, loaded.policy);
  const findings = [...loaded.findings, ...applied.findings].sort((left, right) => left.id.localeCompare(right.id));
  const repairs = findings.flatMap((finding) => (finding.repair ? [finding.repair] : []));
  return {
    ok: findings.length === 0,
    source: loaded.source,
    policy: loaded.policy,
    findings,
    repairs,
    effective: applied.effective,
    application: 'DIAGNOSTIC NON APPLIQUÉ',
    domains: POLICY_DOMAIN_STATUS,
    errors: loaded.error ? [loaded.error] : [],
  };
}

export async function repairPolicy(input: {
  systemPath: string;
  userPath: string;
  userConfig: Record<string, unknown>;
  dryRun?: boolean;
}): Promise<PolicyCycleReport> {
  const report = assessPolicy(input);
  const dryRun = input.dryRun === true;
  for (const repair of report.repairs) {
    const result = repair.value === null
      ? await runConfigUnset({ key: repair.key, dryRun })
      : await runConfigSet({ batch: { [repair.key]: repair.value }, dryRun });
    if (!result.ok) {
      report.ok = false;
      report.errors.push(...result.errors);
      break;
    }
  }
  if (!dryRun && report.errors.length === 0 && report.repairs.length > 0) {
    const file = resolveUserConfigFile();
    const userConfig = existsSync(file) ? parseTOML(readFileSync(file, 'utf8')) : {};
    return assessPolicy({ ...input, userConfig });
  }
  return report;
}
