import { describe, it, expect, vi } from 'vitest';
import {
  isCompanionToolsEnabled,
  isForbiddenCompanionTool,
  getCompanionToolNames,
  getCompanionToolWaitingWord,
  getCompanionToolDefinitions,
  executeCompanionTool,
  extractImagePathFromToolResult,
  OWNER_COMPANION_TOOLS,
  PRESENT_COMPANION_TOOLS,
} from '../../src/companion/companion-toolset.js';
import type { CompanionIdentity } from '../../src/companion/companion-identity.js';
import { FormalToolRegistry } from '../../src/tools/registry/tool-registry.js';
import type { ITool, ToolSchema } from '../../src/tools/registry/types.js';

describe('companion-toolset', () => {
  const ownerIdentity: CompanionIdentity = {
    role: 'owner',
    channel: 'telegram',
    confidence: 'high',
    reason: 'test',
  };

  const presentIdentity: CompanionIdentity = {
    role: 'present',
    channel: 'voice',
    confidence: 'medium',
    reason: 'test',
  };

  const guestIdentity: CompanionIdentity = {
    role: 'guest',
    channel: 'unknown',
    confidence: 'none',
    reason: 'test',
  };

  describe('Circuit-breaker (CODEBUDDY_COMPANION_TOOLS_ENABLED)', () => {
    it('is disabled by default or when false', () => {
      expect(isCompanionToolsEnabled({})).toBe(false);
      expect(isCompanionToolsEnabled({ CODEBUDDY_COMPANION_TOOLS_ENABLED: 'false' })).toBe(false);
      expect(isCompanionToolsEnabled({ CODEBUDDY_COMPANION_TOOLS_ENABLED: '0' })).toBe(false);
      expect(isCompanionToolsEnabled({ CODEBUDDY_COMPANION_TOOLS_ENABLED: 'off' })).toBe(false);
    });

    it('is enabled when set to true, 1, or on', () => {
      expect(isCompanionToolsEnabled({ CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' })).toBe(true);
      expect(isCompanionToolsEnabled({ CODEBUDDY_COMPANION_TOOLS_ENABLED: '1' })).toBe(true);
      expect(isCompanionToolsEnabled({ CODEBUDDY_COMPANION_TOOLS_ENABLED: 'yes' })).toBe(true);
      expect(isCompanionToolsEnabled({ CODEBUDDY_COMPANION_TOOLS_ENABLED: 'on' })).toBe(true);
    });

    it('returns empty list for all roles when circuit-breaker is OFF', () => {
      const env = { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'false' };
      expect(getCompanionToolNames(ownerIdentity, env)).toEqual([]);
      expect(getCompanionToolNames(presentIdentity, env)).toEqual([]);
      expect(getCompanionToolNames(guestIdentity, env)).toEqual([]);
    });
  });

  describe('Hard forbidden tools check', () => {
    it('identifies forbidden system and destructive tools across all forbidden families', () => {
      // bash* family
      expect(isForbiddenCompanionTool('bash')).toBe(true);
      expect(isForbiddenCompanionTool('bash_exec')).toBe(true);
      expect(isForbiddenCompanionTool('terminal')).toBe(true);
      expect(isForbiddenCompanionTool('interactive_shell')).toBe(true);

      // shell* family
      expect(isForbiddenCompanionTool('shell_exec')).toBe(true);
      expect(isForbiddenCompanionTool('shell_git')).toBe(true);
      expect(isForbiddenCompanionTool('shell_process')).toBe(true);
      expect(isForbiddenCompanionTool('shell_docker')).toBe(true);
      expect(isForbiddenCompanionTool('shell_k8s')).toBe(true);

      // *_exec & execution family
      expect(isForbiddenCompanionTool('code_exec')).toBe(true);
      expect(isForbiddenCompanionTool('execute_code')).toBe(true);
      expect(isForbiddenCompanionTool('js_repl')).toBe(true);
      expect(isForbiddenCompanionTool('office_macro_execute')).toBe(true);

      // write_* family & file creation
      expect(isForbiddenCompanionTool('create_file')).toBe(true);
      expect(isForbiddenCompanionTool('write_file')).toBe(true);
      expect(isForbiddenCompanionTool('file_write')).toBe(true);

      // patch family
      expect(isForbiddenCompanionTool('patch')).toBe(true);
      expect(isForbiddenCompanionTool('apply_patch')).toBe(true);

      // str_replace* family — EXPLICIT REFUSAL
      expect(isForbiddenCompanionTool('str_replace')).toBe(true);
      expect(isForbiddenCompanionTool('str_replace_editor')).toBe(true);

      // multi_edit & edit_* family — EXPLICIT REFUSAL
      expect(isForbiddenCompanionTool('multi_edit')).toBe(true);
      expect(isForbiddenCompanionTool('edit_file')).toBe(true);
      expect(isForbiddenCompanionTool('file_edit')).toBe(true);

      // delete_* family
      expect(isForbiddenCompanionTool('delete_file')).toBe(true);

      // A2A / MCP / delegation / registration
      expect(isForbiddenCompanionTool('mcp_read')).toBe(true);
      expect(isForbiddenCompanionTool('mcp_server')).toBe(true);
      expect(isForbiddenCompanionTool('fleet_ping')).toBe(true);
      expect(isForbiddenCompanionTool('peer_delegate')).toBe(true);
      expect(isForbiddenCompanionTool('delegate_agent')).toBe(true);
      expect(isForbiddenCompanionTool('register_tool')).toBe(true);
    });

    it('explicitly refuses str_replace and multi_edit', () => {
      expect(isForbiddenCompanionTool('str_replace')).toBe(true);
      expect(isForbiddenCompanionTool('multi_edit')).toBe(true);
    });

    it('permits companion tools', () => {
      expect(isForbiddenCompanionTool('image_generate')).toBe(false);
      expect(isForbiddenCompanionTool('image_edit')).toBe(false);
      expect(isForbiddenCompanionTool('remind')).toBe(false);
      expect(isForbiddenCompanionTool('web_search')).toBe(false);
      expect(isForbiddenCompanionTool('weather')).toBe(false);
      expect(isForbiddenCompanionTool('stock_quote')).toBe(false);
      expect(isForbiddenCompanionTool('camera_analyze')).toBe(false);
      expect(isForbiddenCompanionTool('understand_video')).toBe(false);
      expect(isForbiddenCompanionTool('recall')).toBe(false);
    });
  });

  describe('Toolsets by identity role', () => {
    const env = { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' };

    it('grants full owner toolset to owner', () => {
      const tools = getCompanionToolNames(ownerIdentity, env);
      expect(tools).toEqual(OWNER_COMPANION_TOOLS);
      expect(tools).toContain('image_generate');
      expect(tools).toContain('image_edit');
      expect(tools).toContain('remind');
      expect(tools).toContain('camera_analyze');
      expect(tools).toContain('weather');
      expect(tools).toContain('recall');
    });

    it('grants present toolset without remind and without camera to present', () => {
      const tools = getCompanionToolNames(presentIdentity, env);
      expect(tools).toEqual(PRESENT_COMPANION_TOOLS);
      expect(tools).not.toContain('remind');
      expect(tools).not.toContain('camera_analyze');
      expect(tools).toContain('image_generate');
      expect(tools).toContain('weather');
      expect(tools).toContain('stock_quote');
    });

    it('grants NO tools to guest (fail closed)', () => {
      const tools = getCompanionToolNames(guestIdentity, env);
      expect(tools).toEqual([]);
    });
  });

  describe('Surcharge via CODEBUDDY_COMPANION_TOOLS', () => {
    it('restricts to configured comma-separated list by intersecting role baseline', () => {
      const env = {
        CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true',
        CODEBUDDY_COMPANION_TOOLS: 'image_generate, weather, stock_quote',
      };
      const tools = getCompanionToolNames(ownerIdentity, env);
      expect(tools).toEqual(['image_generate', 'weather', 'stock_quote']);
    });

    it('only intersects baseline and NEVER extends it with unlisted tools (e.g. view_file)', () => {
      const env = {
        CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true',
        CODEBUDDY_COMPANION_TOOLS: 'view_file, read_file, search, image_generate',
      };
      const tools = getCompanionToolNames(ownerIdentity, env);
      expect(tools).toEqual(['image_generate']);
      expect(tools).not.toContain('view_file');
      expect(tools).not.toContain('read_file');
      expect(tools).not.toContain('search');
    });

    it('filters out forbidden tools even if explicitly in surcharge, including str_replace and multi_edit', () => {
      const env = {
        CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true',
        CODEBUDDY_COMPANION_TOOLS: 'image_generate, bash, create_file, mcp_foo, str_replace, multi_edit, weather',
      };
      const tools = getCompanionToolNames(ownerIdentity, env);
      expect(tools).toEqual(['image_generate', 'weather']);
      expect(tools).not.toContain('bash');
      expect(tools).not.toContain('create_file');
      expect(tools).not.toContain('mcp_foo');
      expect(tools).not.toContain('str_replace');
      expect(tools).not.toContain('multi_edit');
    });

    it('filters out remind and camera from surcharge for present role via baseline intersection', () => {
      const env = {
        CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true',
        CODEBUDDY_COMPANION_TOOLS: 'image_generate, remind, camera_analyze, weather',
      };
      const tools = getCompanionToolNames(presentIdentity, env);
      expect(tools).toEqual(['image_generate', 'weather']);
      expect(tools).not.toContain('remind');
      expect(tools).not.toContain('camera_analyze');
    });

    it('never grants tools to guest even if surcharge is set', () => {
      const env = {
        CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true',
        CODEBUDDY_COMPANION_TOOLS: 'image_generate, weather',
      };
      const tools = getCompanionToolNames(guestIdentity, env);
      expect(tools).toEqual([]);
    });

    it('verifies that NO write/exec tool from TOOL_METADATA passes, regardless of CSV', async () => {
      const { TOOL_METADATA } = await import('../../src/tools/metadata.js');
      const writeOrExecTools = TOOL_METADATA.filter(
        (t) =>
          t.category === 'file_write' ||
          t.category === 'system' ||
          t.category === 'git' ||
          /^(?:write_|edit_|delete_|apply_patch|bash|shell|create_file|patch|str_replace|multi_edit|_exec)/i.test(
            t.name,
          ),
      );

      // Verify each individual tool is marked forbidden
      for (const tool of writeOrExecTools) {
        expect(isForbiddenCompanionTool(tool.name)).toBe(true);
      }

      // Massive CSV containing ALL tools from the registry
      const allToolsCsv = TOOL_METADATA.map((t) => t.name).join(',');
      const env = {
        CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true',
        CODEBUDDY_COMPANION_TOOLS: allToolsCsv,
      };

      const ownerTools = getCompanionToolNames(ownerIdentity, env);
      const presentTools = getCompanionToolNames(presentIdentity, env);

      // Owner tools must only be the 9 approved companion tools
      expect(ownerTools).toEqual(OWNER_COMPANION_TOOLS);
      // Present tools must only be the 7 approved present tools
      expect(presentTools).toEqual(PRESENT_COMPANION_TOOLS);

      // Not a single write/exec tool can pass
      for (const forbidden of writeOrExecTools) {
        expect(ownerTools).not.toContain(forbidden.name);
        expect(presentTools).not.toContain(forbidden.name);
      }
    });
  });

  describe('Waiting words', () => {
    it('returns appropriate waiting words for slow tools', () => {
      expect(getCompanionToolWaitingWord('image_generate')).toBe('Je dessine…');
      expect(getCompanionToolWaitingWord('camera_analyze')).toBe('Je regarde…');
      expect(getCompanionToolWaitingWord('weather')).toBe('Je regarde la météo…');
      expect(getCompanionToolWaitingWord('web_search')).toBe('Je cherche sur le web…');
      expect(getCompanionToolWaitingWord('remind')).toBe('Je note ton rappel…');
      expect(getCompanionToolWaitingWord('unknown_tool')).toBe(null);
    });
  });

  describe('executeCompanionTool', () => {
    it('blocks execution of forbidden tool', async () => {
      const res = await executeCompanionTool('bash', { command: 'ls' }, {
        identity: ownerIdentity,
        env: { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' },
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain('strictly forbidden');
    });

    it('explicitly blocks execution of str_replace and multi_edit', async () => {
      const resStrReplace = await executeCompanionTool('str_replace', { path: 'foo.txt' }, {
        identity: ownerIdentity,
        env: { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' },
      });
      expect(resStrReplace.success).toBe(false);
      expect(resStrReplace.error).toContain('strictly forbidden');

      const resMultiEdit = await executeCompanionTool('multi_edit', { path: 'foo.txt' }, {
        identity: ownerIdentity,
        env: { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' },
      });
      expect(resMultiEdit.success).toBe(false);
      expect(resMultiEdit.error).toContain('strictly forbidden');
    });

    it('blocks execution of tool not in role permissions', async () => {
      const res = await executeCompanionTool('remind', { label: 'train', time: '09:00' }, {
        identity: presentIdentity,
        env: { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' },
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain('not permitted for companion identity role "present"');
    });

    it('executes permitted tool via custom registry', async () => {
      const mockTool: ITool = {
        name: 'weather',
        description: 'Mock weather',
        execute: vi.fn(async (args) => ({
          success: true,
          output: `Météo pour ${args.location}: 22°C ensoleillé.`,
        })),
        getSchema: (): ToolSchema => ({
          name: 'weather',
          description: 'Mock weather',
          parameters: { type: 'object', properties: {} },
        }),
      };

      const testRegistry = FormalToolRegistry.getInstance();
      testRegistry.register(mockTool, { override: true });

      const res = await executeCompanionTool('weather', { location: 'Nantes' }, {
        identity: ownerIdentity,
        env: { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' },
        registry: testRegistry,
      });

      expect(res.success).toBe(true);
      expect(res.output).toContain('Météo pour Nantes: 22°C');
      expect(mockTool.execute).toHaveBeenCalled();
    });
  });

  describe('extractImagePathFromToolResult', () => {
    it('extracts imagePath from data object', () => {
      const path = extractImagePathFromToolResult({
        success: true,
        output: 'ok',
        data: { imagePath: '/path/to/cat.png' },
      });
      expect(path).toBe('/path/to/cat.png');
    });

    it('resolves relative path to absolute', () => {
      const path = extractImagePathFromToolResult({
        success: true,
        output: 'ok',
        data: { mediaPath: 'media/images/photo.jpg' },
      }, '/workspace');
      expect(path).toBe('/workspace/media/images/photo.jpg');
    });

    it('extracts from JSON output string', () => {
      const path = extractImagePathFromToolResult({
        success: true,
        output: JSON.stringify({ outputPath: '/workspace/media/images/drawn.webp' }),
      });
      expect(path).toBe('/workspace/media/images/drawn.webp');
    });

    it('returns undefined when tool failed or has no image', () => {
      expect(extractImagePathFromToolResult({ success: false, error: 'err' })).toBeUndefined();
      expect(extractImagePathFromToolResult({ success: true, output: 'No image here' })).toBeUndefined();
    });
  });
});
