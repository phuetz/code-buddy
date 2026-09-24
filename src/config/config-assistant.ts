/**
 * Assistant de configuration par sections, réutilisable après l'accueil.
 * Il n'écrit que par `buddy config set`, donc le schéma et les sauvegardes
 * s'appliquent. Les réponses viennent d'un objet déjà parsé (fichier ou
 * entrée standard). Il n'y a pas de dialogue au terminal.
 */

import { classifyConfigPath, validateConfigValue } from './config-schema.js';
import { runConfigSet, type ConfigCliReport, type ConfigOperation } from './config-cli.js';

export const CONFIG_ASSISTANT_SECTIONS = ['model', 'gateway', 'channels', 'mcp', 'sandbox', 'exec'] as const;
export type ConfigAssistantSection = typeof CONFIG_ASSISTANT_SECTIONS[number];

const SECTION_KEY: Record<ConfigAssistantSection, RegExp> = {
  model: /^(?:active_model|model_roles\.primary)$/,
  gateway: /^gateway\.(?:bind|port|auth_mode)$/,
  channels: /^channels\.[a-z][a-z0-9_-]{0,32}\.(?:enabled|group_policy|dm_policy)$/,
  mcp: /^mcp\.(?:allow_write|enabled_servers)$/,
  sandbox: /^sandbox\.(?:mode|backend)$/,
  exec: /^exec\.(?:approvals|allow_commands|deny_commands)$/,
};

export function isAssistantSection(value: string): value is ConfigAssistantSection {
  return (CONFIG_ASSISTANT_SECTIONS as readonly string[]).includes(value);
}

export function keyBelongsToSection(section: ConfigAssistantSection, key: string): boolean {
  return SECTION_KEY[section].test(key);
}

export function parseAnswersText(text: string): { ok: true; answers: Record<string, unknown> } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Réponses illisibles : ${message}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Les réponses doivent être un objet JSON de clés.' };
  }
  return { ok: true, answers: parsed as Record<string, unknown> };
}

function refused(errors: string[]): ConfigCliReport {
  return {
    ok: false,
    operations: [],
    checks: [
      { name: 'known-key', ok: false },
      { name: 'type', ok: errors.every((error) => !error.includes('Type mismatch') && !error.includes('Valeur refusée')) },
      { name: 'document', ok: false },
      { name: 'backup', ok: true, detail: 'non exécuté' },
    ],
    errors,
  };
}

export async function runConfigAssistant(input: {
  section: string;
  answers: Record<string, unknown>;
  dryRun?: boolean;
}): Promise<ConfigCliReport> {
  if (!isAssistantSection(input.section)) {
    return refused([
      `Section inconnue « ${input.section} ». Sections : ${CONFIG_ASSISTANT_SECTIONS.join(', ')}.`,
    ]);
  }
  const section: ConfigAssistantSection = input.section;
  const dryRun = input.dryRun === true;
  const errors: string[] = [];
  const batch: Record<string, unknown> = {};
  for (const key of Object.keys(input.answers)) {
    if (!Object.hasOwn(input.answers, key)) continue;
    if (!keyBelongsToSection(section, key)) {
      errors.push(`La clé « ${key} » n'appartient pas à la section ${section}.`);
      continue;
    }
    const classified = classifyConfigPath(key);
    if (!classified.ok) {
      errors.push(classified.message);
      continue;
    }
    const value = input.answers[key];
    const schemaError = validateConfigValue(key, value);
    if (schemaError) errors.push(schemaError);
    else batch[key] = value;
  }
  if (errors.length > 0) return refused(errors);
  if (Object.keys(batch).length === 0) {
    return {
      ok: true,
      operations: [],
      checks: [
        { name: 'known-key', ok: true },
        { name: 'type', ok: true },
        { name: 'document', ok: true },
        { name: 'backup', ok: true, detail: dryRun ? 'non exécuté' : 'rien à écrire' },
      ],
      errors: [],
    };
  }
  const report = await runConfigSet({ batch, dryRun });
  const operations: ConfigOperation[] = report.operations.map((operation) => ({ ...operation, op: 'set' }));
  return { ...report, operations };
}
