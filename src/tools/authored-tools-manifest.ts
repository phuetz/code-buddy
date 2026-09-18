export interface ToolWiring {
  name: string;
  classFile: string;
  className: string;
  definitionFile: string;
  registryFactory: string;
  metadata: { keywords: string[]; priority: number; fleetSafe: boolean };
  readOnly: boolean;
  testFile: string;
}

export const AUTHORED_TOOLS: ToolWiring[] = [
  { name: 'scaffold_app', classFile: 'src/tools/scaffold-app-tool.ts', className: 'ScaffoldAppTool', definitionFile: 'src/tools/scaffold-app-tool.ts#SCAFFOLD_APP_TOOL_DEFINITION', registryFactory: 'src/tools/registry/index.ts', metadata: { keywords: ['scaffold', 'template', 'app', 'project', 'generate', 'node-cli', 'react', 'express', 'expo', 'mobile'], priority: 85, fleetSafe: false }, readOnly: false, testFile: 'tests/tools/scaffold-app-tool.test.ts' },
  { name: 'project_map', classFile: 'src/tools/project-map-tool.ts', className: 'ProjectMapTool', definitionFile: 'src/tools/project-map-tool.ts#PROJECT_MAP_TOOL_DEFINITION', registryFactory: 'src/tools/registry/index.ts', metadata: { keywords: ['project', 'map', 'tree', 'structure', 'entrypoint', 'languages'], priority: 80, fleetSafe: true }, readOnly: true, testFile: 'tests/tools/project-map-tool.test.ts' },
  { name: 'dep_inspect', classFile: 'src/tools/dep-inspect-tool.ts', className: 'DepInspectTool', definitionFile: 'src/tools/dep-inspect-tool.ts#DEP_INSPECT_TOOL_DEFINITION', registryFactory: 'src/tools/registry/index.ts', metadata: { keywords: ['dependencies', 'package.json', 'scripts', 'engines', 'lockfile', 'npm'], priority: 78, fleetSafe: true }, readOnly: true, testFile: 'tests/tools/dep-inspect-tool.test.ts' },
  { name: 'code_stats', classFile: 'src/tools/code-stats-tool.ts', className: 'CodeStatsTool', definitionFile: 'src/tools/code-stats-tool.ts#CODE_STATS_TOOL_DEFINITION', registryFactory: 'src/tools/registry/index.ts', metadata: { keywords: ['code', 'stats', 'lines', 'languages', 'comments', 'largest files'], priority: 76, fleetSafe: true }, readOnly: true, testFile: 'tests/tools/code-stats-tool.test.ts' },
  { name: 'git_summary', classFile: 'src/tools/git-summary-tool.ts', className: 'GitSummaryTool', definitionFile: 'src/tools/git-summary-tool.ts#GIT_SUMMARY_TOOL_DEFINITION', registryFactory: 'src/tools/registry/index.ts', metadata: { keywords: ['git', 'summary', 'status', 'branch', 'commit', 'ahead', 'behind'], priority: 82, fleetSafe: true }, readOnly: true, testFile: 'tests/tools/git-summary-tool.test.ts' },
  { name: 'todo_scan', classFile: 'src/tools/todo-scan-tool.ts', className: 'TodoScanTool', definitionFile: 'src/tools/todo-scan-tool.ts#TODO_SCAN_TOOL_DEFINITION', registryFactory: 'src/tools/registry/index.ts', metadata: { keywords: ['todo', 'fixme', 'hack', 'xxx', 'scan', 'markers'], priority: 72, fleetSafe: true }, readOnly: true, testFile: 'tests/tools/todo-scan-tool.test.ts' },
  { name: 'json_query', classFile: 'src/tools/json-query-tool.ts', className: 'JsonQueryTool', definitionFile: 'src/tools/json-query-tool.ts#JSON_QUERY_TOOL_DEFINITION', registryFactory: 'src/tools/registry/index.ts', metadata: { keywords: ['json', 'query', 'path', 'inspect', 'data'], priority: 70, fleetSafe: true }, readOnly: true, testFile: 'tests/tools/json-query-tool.test.ts' },
  { name: 'csv_preview', classFile: 'src/tools/csv-preview-tool.ts', className: 'CsvPreviewTool', definitionFile: 'src/tools/csv-preview-tool.ts#CSV_PREVIEW_TOOL_DEFINITION', registryFactory: 'src/tools/registry/index.ts', metadata: { keywords: ['csv', 'preview', 'columns', 'rows', 'types', 'data'], priority: 70, fleetSafe: true }, readOnly: true, testFile: 'tests/tools/csv-preview-tool.test.ts' },
  { name: 'env_doctor', classFile: 'src/tools/env-doctor-tool.ts', className: 'EnvDoctorTool', definitionFile: 'src/tools/env-doctor-tool.ts#ENV_DOCTOR_TOOL_DEFINITION', registryFactory: 'src/tools/registry/index.ts', metadata: { keywords: ['environment', 'doctor', 'node', 'node_modules', 'scripts', 'config', 'git', 'docker'], priority: 75, fleetSafe: true }, readOnly: true, testFile: 'tests/tools/env-doctor-tool.test.ts' },
  { name: 'port_check', classFile: 'src/tools/port-check-tool.ts', className: 'PortCheckTool', definitionFile: 'src/tools/port-check-tool.ts#PORT_CHECK_TOOL_DEFINITION', registryFactory: 'src/tools/registry/index.ts', metadata: { keywords: ['port', 'check', 'loopback', 'available', 'listening', 'server'], priority: 74, fleetSafe: true }, readOnly: true, testFile: 'tests/tools/port-check-tool.test.ts' },
];
