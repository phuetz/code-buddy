export type OsActionCategory = 'mission' | 'autonomy' | 'routing' | 'alerts' | 'approvals' | 'fleet' | 'cost';

export interface OsCommandAction {
  id: string;
  label: string;
  category: OsActionCategory;
  callbackName: string;
}

export const osCommandActions: OsCommandAction[] = [
  { id: 'mission.pause', label: 'Pause mission', category: 'mission', callbackName: 'onMissionPause' },
  { id: 'mission.resume', label: 'Reprendre mission', category: 'mission', callbackName: 'onMissionResume' },
  { id: 'mission.cancel', label: 'Annuler mission', category: 'mission', callbackName: 'onMissionCancel' },
  { id: 'mission.branch', label: 'Rebrancher mission', category: 'mission', callbackName: 'onMissionBranch' },
  { id: 'autonomy.posture', label: 'Changer posture autonomie', category: 'autonomy', callbackName: 'onAutonomyPostureChange' },
  { id: 'routing.override', label: 'Forcer routage tâche', category: 'routing', callbackName: 'onRouteOverride' },
  { id: 'alerts.ack', label: 'Acquitter alertes', category: 'alerts', callbackName: 'onAlertAck' },
  { id: 'approvals.bulk', label: 'Traiter approbations en masse', category: 'approvals', callbackName: 'onApprovalBulkAction' },
  { id: 'fleet.peer.pause', label: 'Mettre un pair en pause', category: 'fleet', callbackName: 'onPeerPause' },
  { id: 'cost.cap.edit', label: 'Modifier cap coût', category: 'cost', callbackName: 'onCostCapChange' },
];

export function filterActions(query: string): OsCommandAction[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...osCommandActions];
  return osCommandActions.filter((action) =>
    [action.id, action.label, action.category, action.callbackName].some((value) => value.toLowerCase().includes(normalized)),
  );
}
