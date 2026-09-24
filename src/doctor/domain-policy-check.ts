/**
 * Constat de politique de domaine pour `buddy doctor`.
 * La réparation passe par le même cycle que `buddy policy repair`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { assessPolicy, repairPolicy } from '../config/policy-cycle.js';
import { resolveUserConfigFile, parseTOML } from '../config/toml-config.js';
import type { DoctorCheck, FixResult } from './index.js';

export interface DomainPolicyCheckPaths {
  systemPath?: string;
  userPath?: string;
  configFile?: string;
}

function readUserDocument(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try {
    return parseTOML(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function checkDomainPolicy(paths: DomainPolicyCheckPaths = {}): DoctorCheck {
  const systemPath = paths.systemPath ?? '/etc/codebuddy/managed-settings.json';
  const userPath = paths.userPath ?? join(homedir(), '.codebuddy', 'managed-settings.json');
  const configFile = paths.configFile ?? resolveUserConfigFile();
  try {
    if (!existsSync(systemPath) && !existsSync(userPath)) {
      return {
        name: 'Domain policy',
        status: 'ok',
        message: 'DIAGNOSTIC NON APPLIQUÉ — no domain policy',
      };
    }
    const userConfig = readUserDocument(configFile);
    const report = assessPolicy({ systemPath, userPath, userConfig });
    if (report.findings.length === 0) {
      return {
        name: 'Domain policy',
        status: 'ok',
        message: report.source
          ? `DIAGNOSTIC NON APPLIQUÉ — matches ${report.source}`
          : 'DIAGNOSTIC NON APPLIQUÉ — no domain policy',
      };
    }
    const repairable = report.repairs.length;
    const first = report.findings[0]?.id ?? 'policy';
    const check: DoctorCheck = {
      name: 'Domain policy',
      status: 'warn',
      message: `DIAGNOSTIC NON APPLIQUÉ — ${report.findings.length} finding(s), ${repairable} repairable, first ${first}`,
      ...(repairable > 0 ? { fixable: true } : {}),
    };
    if (repairable > 0) {
      check.fix = async (): Promise<FixResult> => {
        const repaired = await repairPolicy({ systemPath, userPath, userConfig, dryRun: false });
        if (repaired.errors.length > 0) {
          return {
            success: false,
            action: 'restrict-domain-policy',
            message: repaired.errors.join('; '),
          };
        }
        return {
          success: true,
          action: 'restrict-domain-policy',
          message: `${repaired.repairs.length} restriction(s) written`,
        };
      };
    }
    return check;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: 'Domain policy',
      status: 'warn',
      message: `check skipped: ${message}`,
    };
  }
}
