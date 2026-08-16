import type { CodeBuddyTool } from '../../src/codebuddy/client.js';
import {
  filterToolNamesForSurface,
  filterToolsForSurface,
  getEffectiveHiddenCapabilities,
  isCommandVisibleForSurface,
  isToolVisibleForSurface,
} from '../../src/config/feature-surface.js';
import {
  DEFAULT_CONFIG,
  getConfigManager,
  resetConfigManager,
  type FeatureSurfaceConfig,
} from '../../src/config/toml-config.js';

const coreSurface: FeatureSurfaceConfig = {
  hidden_capabilities: ['companion', 'film', 'sensory', 'robot', 'vision_train'],
};

function tool(name: string): CodeBuddyTool {
  return {
    type: 'function',
    function: {
      name,
      description: name,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  };
}

describe('focused feature surface', () => {
  afterEach(() => {
    resetConfigManager();
  });

  it('ships additive core and all profiles while keeping the default surface unchanged', () => {
    expect(DEFAULT_CONFIG.surface.hidden_capabilities).toEqual([]);
    expect(DEFAULT_CONFIG.profiles?.core?.surface).toEqual(coreSurface);
    expect(DEFAULT_CONFIG.profiles?.all?.surface).toEqual({ hidden_capabilities: [] });

    const manager = getConfigManager();
    manager.load();
    manager.applyProfile('core');
    expect(manager.getConfig().surface).toEqual(coreSurface);

    manager.applyProfile('all');
    expect(manager.getConfig().surface.hidden_capabilities).toEqual([]);
  });

  it('removes advanced faculties from schemas, names, and commands under core', () => {
    const tools = [
      tool('view_file'),
      tool('video_stitch'),
      tool('camera_snapshot'),
      tool('device_manage'),
      tool('lisa_selfie'),
    ];

    expect(filterToolsForSurface(tools, coreSurface, {}).map((entry) => entry.function.name))
      .toEqual(['view_file']);
    expect(filterToolNamesForSurface(tools.map((entry) => entry.function.name), coreSurface, {}))
      .toEqual(['view_file']);
    expect(isToolVisibleForSurface('video_stitch', coreSurface, {})).toBe(false);
    expect(isCommandVisibleForSurface('film', coreSurface, {})).toBe(false);
    expect(isCommandVisibleForSurface('dev', coreSurface, {})).toBe(true);
  });

  it('keeps the historical surface byte-for-byte when no profile is selected', () => {
    const tools = [tool('view_file'), tool('video_stitch')];

    expect(filterToolsForSurface(tools, { hidden_capabilities: [] }, {})).toBe(tools);
    expect(isCommandVisibleForSurface('film', { hidden_capabilities: [] }, {})).toBe(true);
  });

  it('lets feature-specific environment variables opt capabilities back in', () => {
    const hidden = getEffectiveHiddenCapabilities(coreSurface, {
      CODEBUDDY_COMPANION_PROACTIVE: 'true',
      CODEBUDDY_VIDEO_PROVIDER: 'comfyui',
      CODEBUDDY_SENSORY: 'true',
      CODEBUDDY_ROBOT_NAME: 'Lisa',
      CODEBUDDY_VISION_TRAIN: 'true',
    });

    expect([...hidden]).toEqual([]);
    expect(isToolVisibleForSurface('video_stitch', coreSurface, {
      CODEBUDDY_VIDEO_PROVIDER: 'comfyui',
    })).toBe(true);
    expect(isCommandVisibleForSurface('vision-train', coreSurface, {
      CODEBUDDY_VISION_TRAIN: 'true',
    })).toBe(true);
  });
});
