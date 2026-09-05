/**
 * Rule templates — ready-to-install, VALIDATED sensory rules for the event-driven
 * monitoring surface (system vitals + schedule ticks). None are active by default:
 * `buddy rules add --template <name>` installs one after `validateRule`, so the
 * anti-runaway fix (and the other monitors) is one command away, not hand-typed JSON.
 *
 * Each template returns a fresh `SensoryRule` (disabled:false but only present once
 * installed). They deliberately stay conservative: `alert` (Telegram/log) actions and
 * one read-only `agent` probe — never a `shell kill`, which the operator must opt into
 * explicitly (the destructive gate would vet it, but we don't ship an auto-kill).
 *
 * @module sensory/rule-templates
 */
import type { SensoryRule } from './sensory-rules-engine.js';

export interface RuleTemplate {
  /** Stable name used by `buddy rules add --template <name>`. */
  name: string;
  /** One-line human description for `buddy rules templates`. */
  description: string;
  /** Build a fresh rule instance (already valid per `validateRule`). */
  build: () => SensoryRule;
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    name: 'process-runaway-alert',
    description:
      'Alerte quand un processus enfant reste collé au CPU (le correctif de l’incident du 05/09).',
    build: () => ({
      id: 'tpl-process-runaway-alert',
      name: 'Processus emballé → alerte',
      enabled: true,
      match: { modality: 'system', kind: 'process_runaway' },
      action: {
        type: 'alert',
        message:
          '⚠️ Processus emballé détecté (CPU élevé sur plusieurs passes). Vérifie et arrête-le si besoin.',
      },
      cooldownMs: 300_000,
    }),
  },
  {
    name: 'disk-low-alert',
    description: 'Alerte quand le disque est plein à 90 % ou plus (seuil numérique sur diskPct).',
    build: () => ({
      id: 'tpl-disk-low-alert',
      name: 'Disque plein ≥ 90 % → alerte',
      enabled: true,
      match: {
        modality: 'system',
        kind: 'resource_threshold',
        filters: { diskPct: { op: 'gte', value: 90 } },
      },
      action: { type: 'alert', message: '💽 Disque plein à ≥ 90 %. Fais de la place.' },
      cooldownMs: 1_800_000,
    }),
  },
  {
    name: 'fleet-saturated-alert',
    description: 'Alerte quand la flotte atteint sa capacité configurée (utilization ≥ 1).',
    build: () => ({
      id: 'tpl-fleet-saturated-alert',
      name: 'Flotte saturée → alerte',
      enabled: true,
      match: { modality: 'system', kind: 'fleet_saturated' },
      action: { type: 'alert', message: '🚦 Flotte saturée (capacité atteinte).' },
      cooldownMs: 600_000,
    }),
  },
  {
    name: 'agent-loop-alert',
    description:
      'Alerte quand l’agent détecte une boucle (via le pont d’événements de domaine, kind:loop_detected).',
    build: () => ({
      id: 'tpl-agent-loop-alert',
      name: 'Boucle agent détectée → alerte',
      enabled: true,
      match: { modality: 'agent', kind: 'loop_detected' },
      action: {
        type: 'alert',
        message: '🔁 Boucle détectée dans l’agent. Vérifie la tâche en cours.',
      },
      cooldownMs: 300_000,
    }),
  },
  {
    name: 'codex-quota-probe',
    description:
      'Chaque jour vers 04:20, lance un agent qui sonde le quota Codex et rapporte (surveillance horaire, sans boucle).',
    build: () => ({
      id: 'tpl-codex-quota-probe',
      name: 'Sonde quota Codex à 04:20',
      enabled: true,
      // BUG-04: a strict hhmm equality drops the target minute on any sampling jitter.
      // A 3-minute window + the 1h cooldown guarantees exactly one reliable daily fire.
      match: { modality: 'time', kind: 'tick', between: ['04:20', '04:22'] },
      action: {
        type: 'agent',
        prompt:
          'Sonde le quota Codex/ChatGPT disponible et rapporte le pourcentage restant et la prochaine réinitialisation.',
        timeoutMs: 120_000,
      },
      cooldownMs: 3_600_000,
    }),
  },
];

/** Find a template by name (case-insensitive). */
export function getRuleTemplate(name: string): RuleTemplate | undefined {
  const n = name.trim().toLowerCase();
  return RULE_TEMPLATES.find((t) => t.name.toLowerCase() === n);
}

/** List available template names + descriptions. */
export function listRuleTemplates(): Array<{ name: string; description: string }> {
  return RULE_TEMPLATES.map((t) => ({ name: t.name, description: t.description }));
}
