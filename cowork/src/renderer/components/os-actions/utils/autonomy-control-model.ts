export type AutonomyPosture = 'plan' | 'auto' | 'full';

export interface PostureValidation {
  valid: boolean;
  reason?: string;
}

export interface Guardrail {
  id: string;
  label: string;
  locked: boolean;
}

export function validatePosture(posture: string): PostureValidation {
  if (posture === 'plan' || posture === 'auto' || posture === 'full') return { valid: true };
  return { valid: false, reason: `Unsupported autonomy posture: ${posture}` };
}

export function guardrailsFor(posture: AutonomyPosture): Guardrail[] {
  const shared = [{ id: 'audit-log', label: 'Journaliser chaque action', locked: true }];
  if (posture === 'plan') {
    return [
      ...shared,
      { id: 'human-approval', label: 'Validation humaine avant mutation', locked: true },
      { id: 'read-only-tools', label: 'Outils de lecture uniquement', locked: true },
    ];
  }
  if (posture === 'auto') {
    return [
      ...shared,
      { id: 'cost-cap', label: 'Cap coût obligatoire', locked: true },
      { id: 'danger-confirmation', label: 'Confirmation des actions risquées', locked: true },
    ];
  }
  return [
    ...shared,
    { id: 'cost-cap', label: 'Cap coût obligatoire', locked: true },
    { id: 'rollback-snapshot', label: 'Snapshot de rollback requis', locked: true },
  ];
}
