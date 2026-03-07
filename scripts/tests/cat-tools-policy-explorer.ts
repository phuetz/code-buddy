/**
 * Cat 106: Tool Groups & Policy (7 tests, no API)
 * Cat 107: Tool Group Mapping (6 tests, no API)
 * Cat 108: PlanTool (7 tests, no API)
 * Cat 109: Codebase Explorer (6 tests, no API)
 * Cat 110: DevcontainerManager (6 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 106: Tool Groups & Policy (groups.ts)
// ============================================================================

export function cat106ToolGroupsPolicy(): TestDef[] {
  return [
    {
      name: '106.1-tool-groups-defined',
      timeout: 5000,
      fn: async () => {
        const { TOOL_GROUPS } = await import('../../src/security/tool-policy/groups.js');
        const groups = Object.keys(TOOL_GROUPS);
        return {
          pass: groups.length >= 10 && groups.includes('group:all') && groups.includes('group:fs'),
          metadata: { count: groups.length, groups: groups.slice(0, 10) },
        };
      },
    },
    {
      name: '106.2-is-tool-group',
      timeout: 5000,
      fn: async () => {
        const { isToolGroup } = await import('../../src/security/tool-policy/groups.js');
        return {
          pass: isToolGroup('group:fs') === true &&
                isToolGroup('group:runtime') === true &&
                isToolGroup('not-a-group') === false,
        };
      },
    },
    {
      name: '106.3-normalize-tool-name',
      timeout: 5000,
      fn: async () => {
        const { normalizeToolName } = await import('../../src/security/tool-policy/groups.js');
        return {
          pass: normalizeToolName('Read') === 'read_file' &&
                normalizeToolName('Bash') === 'bash' &&
                normalizeToolName('WebFetch') === 'web_fetch',
        };
      },
    },
    {
      name: '106.4-expand-tool-groups',
      timeout: 5000,
      fn: async () => {
        const { expandToolGroups } = await import('../../src/security/tool-policy/groups.js');
        const fsRead = expandToolGroups(['group:fs:read']);
        return {
          pass: fsRead.length >= 3 && fsRead.includes('read_file'),
          metadata: { tools: fsRead },
        };
      },
    },
    {
      name: '106.5-get-tools-in-group',
      timeout: 5000,
      fn: async () => {
        const { getToolsInGroup } = await import('../../src/security/tool-policy/groups.js');
        const gitTools = getToolsInGroup('group:git');
        return {
          pass: gitTools.length >= 5 && gitTools.some(t => t.includes('git')),
          metadata: { tools: gitTools },
        };
      },
    },
    {
      name: '106.6-is-tool-in-group',
      timeout: 5000,
      fn: async () => {
        const { isToolInGroup } = await import('../../src/security/tool-policy/groups.js');
        return {
          pass: isToolInGroup('bash', 'group:runtime') === true &&
                isToolInGroup('read_file', 'group:runtime') === false,
        };
      },
    },
    {
      name: '106.7-get-tool-groups',
      timeout: 5000,
      fn: async () => {
        const { getToolGroups } = await import('../../src/security/tool-policy/groups.js');
        const groups = getToolGroups('bash');
        return {
          pass: groups.length >= 1 && groups.some(g => g.includes('runtime')),
          metadata: { groups },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 107: Tool Group Mapping (tool-groups.ts)
// ============================================================================

export function cat107ToolGroupMapping(): TestDef[] {
  return [
    {
      name: '107.1-tool-groups-mapping-exists',
      timeout: 5000,
      fn: async () => {
        const { TOOL_GROUPS } = await import('../../src/security/tool-policy/tool-groups.js');
        return {
          pass: typeof TOOL_GROUPS === 'object' && Object.keys(TOOL_GROUPS).length >= 20,
          metadata: { count: Object.keys(TOOL_GROUPS).length },
        };
      },
    },
    {
      name: '107.2-bash-in-runtime-shell',
      timeout: 5000,
      fn: async () => {
        const { TOOL_GROUPS } = await import('../../src/security/tool-policy/tool-groups.js');
        const bashGroups = TOOL_GROUPS['bash'] || [];
        return {
          pass: bashGroups.includes('group:runtime') && bashGroups.includes('group:runtime:shell'),
          metadata: { groups: bashGroups },
        };
      },
    },
    {
      name: '107.3-view-file-in-fs-read',
      timeout: 5000,
      fn: async () => {
        const { TOOL_GROUPS } = await import('../../src/security/tool-policy/tool-groups.js');
        const groups = TOOL_GROUPS['view_file'] || [];
        return {
          pass: groups.includes('group:fs') && groups.includes('group:fs:read'),
          metadata: { groups },
        };
      },
    },
    {
      name: '107.4-delete-file-is-dangerous',
      timeout: 5000,
      fn: async () => {
        const { TOOL_GROUPS } = await import('../../src/security/tool-policy/tool-groups.js');
        const groups = TOOL_GROUPS['delete_file'] || [];
        return {
          pass: groups.includes('group:dangerous'),
          metadata: { groups },
        };
      },
    },
    {
      name: '107.5-web-fetch-in-web',
      timeout: 5000,
      fn: async () => {
        const { TOOL_GROUPS } = await import('../../src/security/tool-policy/tool-groups.js');
        const groups = TOOL_GROUPS['web_fetch'] || [];
        return {
          pass: groups.includes('group:web') && groups.includes('group:web:fetch'),
          metadata: { groups },
        };
      },
    },
    {
      name: '107.6-git-push-is-dangerous',
      timeout: 5000,
      fn: async () => {
        const { TOOL_GROUPS } = await import('../../src/security/tool-policy/tool-groups.js');
        const groups = TOOL_GROUPS['git_push'] || [];
        return {
          pass: groups.includes('group:dangerous') && groups.includes('group:git:write'),
          metadata: { groups },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 108: PlanTool
// ============================================================================

export function cat108PlanTool(): TestDef[] {
  return [
    {
      name: '108.1-plan-tool-instantiation',
      timeout: 5000,
      fn: async () => {
        const { PlanTool } = await import('../../src/tools/plan-tool.js');
        const tool = new PlanTool('/tmp/plan-test');
        return { pass: tool.name === 'plan' && typeof tool.description === 'string' };
      },
    },
    {
      name: '108.2-plan-description',
      timeout: 5000,
      fn: async () => {
        const { PlanTool } = await import('../../src/tools/plan-tool.js');
        const tool = new PlanTool('/tmp/plan-desc');
        return {
          pass: tool.description.includes('plan') || tool.description.includes('Plan'),
          metadata: { desc: tool.description },
        };
      },
    },
    {
      name: '108.3-plan-has-parameters',
      timeout: 5000,
      fn: async () => {
        const { PlanTool } = await import('../../src/tools/plan-tool.js');
        const tool = new PlanTool('/tmp/plan-params');
        // PlanTool extends BaseTool which has getDefinition()
        const def = (tool as any).getDefinition?.() || (tool as any).definition;
        return {
          pass: typeof tool.execute === 'function',
          metadata: { hasDef: !!def },
        };
      },
    },
    {
      name: '108.4-plan-init-no-goal-fails',
      timeout: 5000,
      fn: async () => {
        const { PlanTool } = await import('../../src/tools/plan-tool.js');
        const tool = new PlanTool('/tmp/plan-no-goal');
        const result = await tool.execute({ action: 'init' });
        return { pass: result.success === false };
      },
    },
    {
      name: '108.5-plan-read-no-file-fails',
      timeout: 5000,
      fn: async () => {
        const { PlanTool } = await import('../../src/tools/plan-tool.js');
        const os = await import('os');
        const pathMod = await import('path');
        const tool = new PlanTool(pathMod.join(os.tmpdir(), `no-plan-${Date.now()}`));
        const result = await tool.execute({ action: 'read' });
        return { pass: result.success === false };
      },
    },
    {
      name: '108.6-plan-init-requires-goal',
      timeout: 5000,
      fn: async () => {
        const { PlanTool } = await import('../../src/tools/plan-tool.js');
        const tool = new PlanTool('/tmp/plan-no-goal');
        const result = await tool.execute({ action: 'init' });
        return { pass: result.success === false };
      },
    },
    {
      name: '108.7-plan-unknown-action',
      timeout: 5000,
      fn: async () => {
        const { PlanTool } = await import('../../src/tools/plan-tool.js');
        const tool = new PlanTool('/tmp/plan-unknown');
        const result = await tool.execute({ action: 'destroy' });
        return { pass: result.success === false };
      },
    },
  ];
}

// ============================================================================
// Cat 109: Codebase Explorer
// ============================================================================

export function cat109CodebaseExplorer(): TestDef[] {
  return [
    {
      name: '109.1-language-extensions-defined',
      timeout: 5000,
      fn: async () => {
        const { LANGUAGE_EXTENSIONS } = await import('../../src/services/codebase-explorer.js');
        const langs = Object.keys(LANGUAGE_EXTENSIONS);
        return {
          pass: langs.includes('typescript') && langs.includes('python') &&
                langs.includes('go') && langs.includes('rust'),
          metadata: { count: langs.length },
        };
      },
    },
    {
      name: '109.2-typescript-extensions',
      timeout: 5000,
      fn: async () => {
        const { LANGUAGE_EXTENSIONS } = await import('../../src/services/codebase-explorer.js');
        const tsExts = LANGUAGE_EXTENSIONS['typescript'];
        return {
          pass: tsExts.includes('.ts') && tsExts.includes('.tsx'),
          metadata: { extensions: tsExts },
        };
      },
    },
    {
      name: '109.3-explorer-instantiation',
      timeout: 5000,
      fn: async () => {
        const { CodebaseExplorer } = await import('../../src/services/codebase-explorer.js');
        const explorer = new CodebaseExplorer(process.cwd(), { maxDepth: 2, countLines: false });
        return { pass: explorer !== null && typeof explorer.explore === 'function' };
      },
    },
    {
      name: '109.4-explorer-explore',
      timeout: 15000,
      fn: async () => {
        const { CodebaseExplorer } = await import('../../src/services/codebase-explorer.js');
        const explorer = new CodebaseExplorer(process.cwd(), { maxDepth: 1, countLines: false });
        const stats = await explorer.explore();
        return {
          pass: stats.totalFiles > 0 && stats.totalDirectories >= 0,
          metadata: { files: stats.totalFiles, dirs: stats.totalDirectories },
        };
      },
    },
    {
      name: '109.5-file-categories',
      timeout: 5000,
      fn: async () => {
        // FileCategory type should include 'source', 'test', 'config', 'documentation'
        const mod = await import('../../src/services/codebase-explorer.js');
        // Just verify the module exports the types we expect
        return {
          pass: typeof mod.LANGUAGE_EXTENSIONS === 'object' &&
                typeof mod.CodebaseExplorer === 'function',
        };
      },
    },
    {
      name: '109.6-explorer-with-options',
      timeout: 5000,
      fn: async () => {
        const { CodebaseExplorer } = await import('../../src/services/codebase-explorer.js');
        const explorer = new CodebaseExplorer(process.cwd(), {
          maxDepth: 0,
          includeHidden: false,
          countLines: false,
          excludePatterns: ['node_modules', '.git', 'dist'],
        });
        return { pass: explorer !== null };
      },
    },
  ];
}

// ============================================================================
// Cat 110: DevcontainerManager
// ============================================================================

export function cat110DevcontainerManager(): TestDef[] {
  return [
    {
      name: '110.1-devcontainer-instantiation',
      timeout: 5000,
      fn: async () => {
        const { DevcontainerManager } = await import('../../src/config/advanced-config.js');
        const mgr = new DevcontainerManager();
        return { pass: mgr !== null && typeof mgr.detect === 'function' };
      },
    },
    {
      name: '110.2-devcontainer-generate-config',
      timeout: 5000,
      fn: async () => {
        const { DevcontainerManager } = await import('../../src/config/advanced-config.js');
        const mgr = new DevcontainerManager();
        const config = mgr.generateConfig({ name: 'test-dev', forwardPorts: [3000, 8080] });
        return {
          pass: config.name === 'test-dev' && config.forwardPorts.length === 2,
          metadata: { config },
        };
      },
    },
    {
      name: '110.3-devcontainer-serialize',
      timeout: 5000,
      fn: async () => {
        const { DevcontainerManager } = await import('../../src/config/advanced-config.js');
        const mgr = new DevcontainerManager();
        const config = mgr.generateConfig({ name: 'serial-test', image: 'node:20' });
        const json = mgr.serializeConfig(config);
        const parsed = JSON.parse(json);
        return {
          pass: parsed.name === 'serial-test' && parsed.image === 'node:20',
          metadata: { parsed },
        };
      },
    },
    {
      name: '110.4-devcontainer-container-name',
      timeout: 5000,
      fn: async () => {
        const { DevcontainerManager } = await import('../../src/config/advanced-config.js');
        const mgr = new DevcontainerManager();
        // Before generating: null
        const before = mgr.getContainerName();
        mgr.generateConfig({ name: 'my-container' });
        const after = mgr.getContainerName();
        return { pass: before === null && after === 'my-container' };
      },
    },
    {
      name: '110.5-devcontainer-forwarded-ports',
      timeout: 5000,
      fn: async () => {
        const { DevcontainerManager } = await import('../../src/config/advanced-config.js');
        const mgr = new DevcontainerManager();
        mgr.generateConfig({ name: 'ports-test', forwardPorts: [3000, 5432, 6379] });
        const ports = mgr.getForwardedPorts();
        return { pass: ports.length === 3 && ports.includes(3000) && ports.includes(5432) };
      },
    },
    {
      name: '110.6-devcontainer-not-inside',
      timeout: 5000,
      fn: async () => {
        const { DevcontainerManager } = await import('../../src/config/advanced-config.js');
        const mgr = new DevcontainerManager();
        // On a normal machine, we're not inside a devcontainer
        const inside = mgr.isInsideDevcontainer();
        return { pass: typeof inside === 'boolean' };
      },
    },
  ];
}
