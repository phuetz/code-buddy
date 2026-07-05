/**
 * Pure helpers for browser autopilot plans.
 *
 * @module renderer/utils/autopilot-plan
 */

export type NavStepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface NavStep {
  id: string;
  label: string;
  status: NavStepStatus;
  url?: string;
  proof?: string;
}

export function planFromGoal(goal: string): NavStep[] {
  const label = goal.trim() || 'Objectif navigateur';
  return [
    { id: 'open', label: `Ouvrir le site lié à : ${label}`, status: 'pending' },
    { id: 'inspect', label: 'Observer la page et identifier les champs/actions', status: 'pending' },
    { id: 'act', label: 'Exécuter les actions demandées avec preuves', status: 'pending' },
    { id: 'verify', label: 'Vérifier le résultat et capturer la preuve finale', status: 'pending' },
  ];
}

export function progressOf(steps: NavStep[]): number {
  if (steps.length === 0) return 0;
  const completed = steps.filter((step) => step.status === 'done').length;
  return Math.round((completed / steps.length) * 100);
}
