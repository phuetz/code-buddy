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
    it('identifies forbidden system and destructive tools', () => {
      expect(isForbiddenCompanionTool('bash')).toBe(true);
      expect(isForbiddenCompanionTool('terminal')).toBe(true);
      expect(isForbiddenCompanionTool('shell_exec')).toBe(true);
      expect(isForbiddenCompanionTool('create_file')).toBe(true);
      expect(isForbiddenCompanionTool('write_file')).toBe(true);
      expect(isForbiddenCompanionTool('str_replace_editor')).toBe(true);
      expect(isForbiddenCompanionTool('patch')).toBe(true);
      expect(isForbiddenCompanionTool('file_write')).toBe(true);
      expect(isForbiddenCompanionTool('file_edit')).toBe(true);
      expect(isForbiddenCompanionTool('apply_patch')).toBe(true);
      expect(isForbiddenCompanionTool('mcp_read')).toBe(true);
      expect(isForbiddenCompanionTool('fleet_ping')).toBe(true);
      expect(isForbiddenCompanionTool('peer_delegate')).toBe(true);
      expect(isForbiddenCompanionTool('delegate_agent')).toBe(true);
      expect(isForbiddenCompanionTool('execute_code')).toBe(true);
    });

    it('permits companion tools', () => {
      expect(isForbiddenCompanionTool('image_generate')).toBe(false);
      expect(isForbiddenCompanionTool('remind')).toBe(false);
      expect(isForbiddenCompanionTool('web_search')).toBe(false);
      expect(isForbiddenCompanionTool('weather')).toBe(false);
      expect(isForbiddenCompanionTool('stock_quote')).toBe(false);
      expect(isForbiddenCompanionTool('camera_analyze')).toBe(false);
      expect(isForbiddenCompanionTool('recall')).toBe(false);
    });
  });

  describe('Toolsets by identity role', () => {
    const env = { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' };

    it('grants full owner toolset to owner', () => {
      const tools = getCompanionToolNames(ownerIdentity, env);
      expect(tools).toEqual(OWNER_COMPANION_TOOLS);
      expect(tools).toContain('image_generate');
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
    it('restricts to configured comma-separated list', () => {
      const env = {
        CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true',
        CODEBUDDY_COMPANION_TOOLS: 'image_generate, weather, stock_quote',
      };
      const tools = getCompanionToolNames(ownerIdentity, env);
      expect(tools).toEqual(['image_generate', 'weather', 'stock_quote']);
    });

    it('filters out forbidden tools even if explicitly in surcharge', () => {
      const env = {
        CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true',
        CODEBUDDY_COMPANION_TOOLS: 'image_generate, bash, create_file, mcp_foo, weather',
      };
      const tools = getCompanionToolNames(ownerIdentity, env);
      expect(tools).toEqual(['image_generate', 'weather']);
      expect(tools).not.toContain('bash');
      expect(tools).not.toContain('create_file');
      expect(tools).not.toContain('mcp_foo');
    });

    it('filters out remind and camera from surcharge for present role', () => {
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
