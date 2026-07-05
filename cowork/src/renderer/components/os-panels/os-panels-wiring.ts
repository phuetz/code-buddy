export interface OsPanelWiringEntry {
  id: string;
  title: string;
  componentFile: string;
  logicFile: string;
  testFile: string;
  mount: string;
  needsData: string[];
}

export const osPanelsWiring: OsPanelWiringEntry[] = [
  {
    id: 'autonomy-dashboard',
    title: 'Autonomy dashboard',
    componentFile: 'cowork/src/renderer/components/os-panels/AutonomyDashboard.tsx',
    logicFile: 'cowork/src/renderer/components/os-panels/autonomy-dashboard-model.ts',
    testFile: 'cowork/tests/os-panels/autonomy-dashboard-model.test.ts',
    mount: 'mission-control.main.autonomy',
    needsData: ['posture', 'running', 'queued', 'costUsd', 'capUsd', 'turns', 'maxTurns'],
  },
  {
    id: 'knowledge-graph-view',
    title: 'Knowledge graph view',
    componentFile: 'cowork/src/renderer/components/os-panels/KnowledgeGraphView.tsx',
    logicFile: 'cowork/src/renderer/components/os-panels/knowledge-graph-view-model.ts',
    testFile: 'cowork/tests/os-panels/knowledge-graph-view-model.test.ts',
    mount: 'mission-control.right.knowledge',
    needsData: ['nodes', 'edges'],
  },
  {
    id: 'os-status-bar',
    title: 'OS status bar',
    componentFile: 'cowork/src/renderer/components/os-panels/OsStatusBar.tsx',
    logicFile: 'cowork/src/renderer/components/os-panels/os-status-bar-model.ts',
    testFile: 'cowork/tests/os-panels/os-status-bar-model.test.ts',
    mount: 'mission-control.header.status',
    needsData: ['items'],
  },
  {
    id: 'mission-control-shell',
    title: 'Mission control shell',
    componentFile: 'cowork/src/renderer/components/os-panels/MissionControlShell.tsx',
    logicFile: 'cowork/src/renderer/components/os-panels/mission-control-shell-model.ts',
    testFile: 'cowork/tests/os-panels/mission-control-shell-model.test.ts',
    mount: 'mission-control.root',
    needsData: ['header', 'left', 'main', 'right'],
  },
];
