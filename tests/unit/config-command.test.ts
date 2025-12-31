/**
 * Unit tests for Config Command Handlers
 *
 * Tests cover:
 * - Settings management (reload, save, update)
 * - Theme configuration (/theme)
 * - Avatar configuration (/avatar)
 * - Tools filtering (/tools)
 * - Vim mode toggle (/vim)
 * - Cost configuration (/cost)
 * - Stats management (/stats)
 * - Cache management (/cache)
 * - Self-healing configuration (/heal)
 */

import {
  handleTheme,
  handleAvatar,
} from '../../src/commands/handlers/ui-handlers';

import {
  handleCost,
  handleStats,
  handleCache,
  handleSelfHealing,
} from '../../src/commands/handlers/stats-handlers';

import {
  handleReload,
  handleCompact,
  handleTools,
  handleVimMode,
} from '../../src/commands/handlers/vibe-handlers';

// Mock theme manager
const mockGetCurrentTheme = jest.fn();
const mockSetTheme = jest.fn();
const mockGetAvailableThemes = jest.fn();
const mockGetAvatars = jest.fn();
const mockGetAvatarPresets = jest.fn();
const mockApplyAvatarPreset = jest.fn();
const mockSetCustomAvatar = jest.fn();
const mockClearCustomAvatars = jest.fn();

jest.mock('../../src/themes/theme-manager', () => ({
  getThemeManager: jest.fn(() => ({
    getCurrentTheme: mockGetCurrentTheme,
    setTheme: mockSetTheme,
    getAvailableThemes: mockGetAvailableThemes,
    getAvatars: mockGetAvatars,
    getAvatarPresets: mockGetAvatarPresets,
    applyAvatarPreset: mockApplyAvatarPreset,
    setCustomAvatar: mockSetCustomAvatar,
    clearCustomAvatars: mockClearCustomAvatars,
  })),
}));

// Mock cost tracker
const mockFormatDashboard = jest.fn();
const mockSetBudgetLimit = jest.fn();
const mockSetDailyLimit = jest.fn();
const mockGetReport = jest.fn();
const mockResetSession = jest.fn();

jest.mock('../../src/utils/cost-tracker', () => ({
  getCostTracker: jest.fn(() => ({
    formatDashboard: mockFormatDashboard,
    setBudgetLimit: mockSetBudgetLimit,
    setDailyLimit: mockSetDailyLimit,
    getReport: mockGetReport,
    resetSession: mockResetSession,
  })),
}));

// Mock performance manager
const mockGetSummary = jest.fn();
const mockGetToolCache = jest.fn();
const mockGetRequestOptimizer = jest.fn();
const mockResetStats = jest.fn();

jest.mock('../../src/performance/index', () => ({
  getPerformanceManager: jest.fn(() => ({
    getSummary: mockGetSummary,
    getToolCache: mockGetToolCache,
    getRequestOptimizer: mockGetRequestOptimizer,
    resetStats: mockResetStats,
  })),
}));

// Mock response cache
const mockCacheClear = jest.fn();
const mockCacheGetStats = jest.fn();
const mockFormatStatus = jest.fn();

jest.mock('../../src/utils/response-cache', () => ({
  getResponseCache: jest.fn(() => ({
    clear: mockCacheClear,
    getStats: mockCacheGetStats,
    formatStatus: mockFormatStatus,
  })),
}));

// Mock self-healing engine
const mockUpdateOptions = jest.fn();
const mockGetOptions = jest.fn();
const mockGetHealingStats = jest.fn();

jest.mock('../../src/utils/self-healing', () => ({
  getSelfHealingEngine: jest.fn(() => ({
    updateOptions: mockUpdateOptions,
    getOptions: mockGetOptions,
    getStats: mockGetHealingStats,
  })),
}));

// Mock settings manager
jest.mock('../../src/utils/settings-manager', () => ({
  getSettingsManager: jest.fn(() => ({
    loadUserSettings: jest.fn(() => ({
      provider: 'grok',
      model: 'grok-code-fast-1',
    })),
    updateUserSetting: jest.fn(),
    getCurrentModel: jest.fn(() => 'grok-code-fast-1'),
  })),
}));

// Mock slash commands
jest.mock('../../src/commands/slash-commands', () => ({
  getSlashCommandManager: jest.fn(() => ({
    reload: jest.fn(),
    getAllCommands: jest.fn(() => []),
  })),
}));

// Mock custom agent loader
jest.mock('../../src/agent/custom/custom-agent-loader', () => ({
  resetCustomAgentLoader: jest.fn(),
}));

// Mock tool filter
jest.mock('../../src/utils/tool-filter', () => ({
  getToolFilter: jest.fn(() => ({
    enabledPatterns: [],
    disabledPatterns: [],
  })),
  setToolFilter: jest.fn(),
  resetToolFilter: jest.fn(),
  filterTools: jest.fn((tools: unknown[]) => ({
    tools,
    filtered: [],
    originalCount: tools.length,
    filteredCount: tools.length,
  })),
  parsePatterns: jest.fn((pattern: string) => pattern.split(',')),
}));

// Mock tools
jest.mock('../../src/codebuddy/tools', () => ({
  CODEBUDDY_TOOLS: [
    { function: { name: 'bash' } },
    { function: { name: 'search' } },
    { function: { name: 'file_viewer' } },
    { function: { name: 'git_status' } },
  ],
}));

// Mock interactive setup
jest.mock('../../src/utils/interactive-setup', () => ({
  formatLogInfo: jest.fn(() => 'Log file info'),
}));

describe('Theme Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAvailableThemes.mockReturnValue([
      { id: 'default', name: 'Default', description: 'Default theme', isBuiltin: true },
      { id: 'dark', name: 'Dark', description: 'Dark theme', isBuiltin: true },
      { id: 'neon', name: 'Neon', description: 'Neon theme', isBuiltin: true },
    ]);
    mockGetCurrentTheme.mockReturnValue({ id: 'default', name: 'Default' });
  });

  describe('handleTheme', () => {
    it('should list themes when no action provided', () => {
      const result = handleTheme([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Available Themes');
    });

    it('should list themes with "list" action', () => {
      const result = handleTheme(['list']);

      expect(result.entry?.content).toContain('Available Themes');
      expect(result.entry?.content).toContain('Default');
      expect(result.entry?.content).toContain('Dark');
      expect(result.entry?.content).toContain('Neon');
    });

    it('should mark current theme', () => {
      mockGetCurrentTheme.mockReturnValue({ id: 'dark', name: 'Dark' });

      const result = handleTheme([]);

      expect(mockGetCurrentTheme).toHaveBeenCalled();
    });

    it('should set theme when valid theme name provided', () => {
      mockSetTheme.mockReturnValue(true);
      mockGetCurrentTheme.mockReturnValue({ id: 'neon', name: 'Neon', description: 'Neon theme' });

      const result = handleTheme(['neon']);

      expect(mockSetTheme).toHaveBeenCalledWith('neon');
      expect(result.entry?.content).toContain('Theme Changed');
      expect(result.entry?.content).toContain('Neon');
    });

    it('should show error for invalid theme', () => {
      mockSetTheme.mockReturnValue(false);

      const result = handleTheme(['invalid-theme']);

      expect(result.entry?.content).toContain('not found');
      expect(result.entry?.content).toContain('Available themes');
    });

    it('should be case insensitive for theme names', () => {
      mockSetTheme.mockReturnValue(true);
      mockGetCurrentTheme.mockReturnValue({ id: 'dark', name: 'Dark', description: 'Dark theme' });

      handleTheme(['DARK']);

      expect(mockSetTheme).toHaveBeenCalledWith('dark');
    });

    it('should show usage hint', () => {
      const result = handleTheme([]);

      expect(result.entry?.content).toContain('Usage:');
      expect(result.entry?.content).toContain('/theme');
    });

    it('should mark custom themes', () => {
      mockGetAvailableThemes.mockReturnValue([
        { id: 'default', name: 'Default', description: 'Default', isBuiltin: true },
        { id: 'custom', name: 'Custom', description: 'Custom theme', isBuiltin: false },
      ]);

      const result = handleTheme([]);

      expect(result.entry?.content).toContain('(custom)');
    });

    it('should have timestamp in entry', () => {
      const result = handleTheme([]);

      expect(result.entry?.timestamp).toBeInstanceOf(Date);
    });
  });
});

describe('Avatar Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAvatarPresets.mockReturnValue([
      {
        id: 'default',
        name: 'Default',
        description: 'Default avatars',
        avatars: { user: 'U', assistant: 'A', tool: 'T' },
      },
      {
        id: 'emoji',
        name: 'Emoji',
        description: 'Emoji avatars',
        avatars: { user: '👤', assistant: '🤖', tool: '🔧' },
      },
    ]);
    mockGetAvatars.mockReturnValue({ user: 'U', assistant: 'A', tool: 'T' });
  });

  describe('handleAvatar', () => {
    it('should list presets when no action provided', () => {
      const result = handleAvatar([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Avatar Presets');
    });

    it('should list presets with "list" action', () => {
      const result = handleAvatar(['list']);

      expect(result.entry?.content).toContain('Avatar Presets');
      expect(result.entry?.content).toContain('Default');
      expect(result.entry?.content).toContain('Emoji');
    });

    it('should show current avatars', () => {
      const result = handleAvatar([]);

      expect(result.entry?.content).toContain('Current avatars');
      expect(mockGetAvatars).toHaveBeenCalled();
    });

    it('should apply preset when valid preset name provided', () => {
      mockApplyAvatarPreset.mockReturnValue(true);
      mockGetAvatars.mockReturnValue({ user: '👤', assistant: '🤖', tool: '🔧' });

      const result = handleAvatar(['emoji']);

      expect(mockApplyAvatarPreset).toHaveBeenCalledWith('emoji');
      expect(result.entry?.content).toContain('Avatar Preset Applied');
    });

    it('should show error for invalid preset', () => {
      mockApplyAvatarPreset.mockReturnValue(false);

      const result = handleAvatar(['invalid-preset']);

      expect(result.entry?.content).toContain('not found');
      expect(result.entry?.content).toContain('Available presets');
    });

    it('should handle custom avatar syntax', () => {
      const result = handleAvatar(['custom', 'user', '🦊']);

      expect(mockSetCustomAvatar).toHaveBeenCalledWith('user', '🦊');
      expect(result.entry?.content).toContain('Custom avatar set');
    });

    it('should show usage when custom without args', () => {
      const result = handleAvatar(['custom']);

      expect(result.entry?.content).toContain('Usage:');
      expect(result.entry?.content).toContain('/avatar custom');
    });

    it('should reject invalid avatar type', () => {
      const result = handleAvatar(['custom', 'invalid', '🦊']);

      expect(result.entry?.content).toContain('Invalid avatar type');
      expect(result.entry?.content).toContain('Valid types');
    });

    it('should reset avatars with "reset" action', () => {
      const result = handleAvatar(['reset']);

      expect(mockClearCustomAvatars).toHaveBeenCalled();
      expect(result.entry?.content).toContain('reset to theme defaults');
    });

    it('should show preview in preset list', () => {
      const result = handleAvatar([]);

      expect(result.entry?.content).toContain('Preview:');
    });
  });
});

describe('Cost Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFormatDashboard.mockReturnValue('Cost Dashboard Content');
    mockGetReport.mockReturnValue({ totalCost: 0.50, requests: 10 });
  });

  describe('handleCost', () => {
    it('should show status when no action provided', () => {
      const result = handleCost([]);

      expect(result.handled).toBe(true);
      expect(mockFormatDashboard).toHaveBeenCalled();
    });

    it('should show status with "status" action', () => {
      handleCost(['status']);

      expect(mockFormatDashboard).toHaveBeenCalled();
    });

    it('should set budget with "budget" action', () => {
      const result = handleCost(['budget', '5.00']);

      expect(mockSetBudgetLimit).toHaveBeenCalledWith(5.00);
      expect(result.entry?.content).toContain('budget set to');
      expect(result.entry?.content).toContain('$5.00');
    });

    it('should show usage when budget without amount', () => {
      const result = handleCost(['budget']);

      expect(result.entry?.content).toContain('Usage:');
      expect(result.entry?.content).toContain('/cost budget');
    });

    it('should set daily limit with "daily" action', () => {
      const result = handleCost(['daily', '2.50']);

      expect(mockSetDailyLimit).toHaveBeenCalledWith(2.50);
      expect(result.entry?.content).toContain('Daily limit set');
      expect(result.entry?.content).toContain('$2.50');
    });

    it('should show usage when daily without amount', () => {
      const result = handleCost(['daily']);

      expect(result.entry?.content).toContain('Usage:');
      expect(result.entry?.content).toContain('/cost daily');
    });

    it('should export report with "export" action', () => {
      const result = handleCost(['export']);

      expect(mockGetReport).toHaveBeenCalled();
      expect(result.entry?.content).toContain('Cost Report');
    });

    it('should reset with "reset" action', () => {
      const result = handleCost(['reset']);

      expect(mockResetSession).toHaveBeenCalled();
      expect(result.entry?.content).toContain('reset');
    });
  });
});

describe('Stats Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSummary.mockReturnValue({
      lazyLoader: { loadedModules: 5, totalModules: 10, averageLoadTime: 50 },
      toolCache: { hitRate: 0.75, savedCalls: 100 },
      requestOptimizer: { totalRequests: 50, deduplicatedRequests: 5 },
      apiCache: { entries: 20, hitRate: 0.60 },
      overall: { totalOperations: 200, cacheHitRate: 0.65, estimatedTimeSaved: 5000 },
    });
  });

  describe('handleStats', () => {
    it('should show summary when no action provided', () => {
      const result = handleStats([]);

      expect(result.handled).toBe(true);
      expect(mockGetSummary).toHaveBeenCalled();
      expect(result.entry?.content).toContain('Performance Summary');
    });

    it('should show summary with "summary" action', () => {
      handleStats(['summary']);

      expect(mockGetSummary).toHaveBeenCalled();
    });

    it('should show cache stats with "cache" action', () => {
      mockGetToolCache.mockReturnValue({
        getStats: () => ({
          hits: 50,
          misses: 10,
          hitRate: 0.83,
          savedCalls: 50,
          savedTime: 2000,
        }),
      });

      const result = handleStats(['cache']);

      expect(result.entry?.content).toContain('Tool Cache Statistics');
      expect(result.entry?.content).toContain('Hits:');
      expect(result.entry?.content).toContain('Hit Rate:');
    });

    it('should handle missing tool cache', () => {
      mockGetToolCache.mockReturnValue(null);

      const result = handleStats(['cache']);

      expect(result.entry?.content).toContain('not initialized');
    });

    it('should show request stats with "requests" action', () => {
      mockGetRequestOptimizer.mockReturnValue({
        getStats: () => ({
          totalRequests: 100,
          successfulRequests: 95,
          failedRequests: 5,
          retriedRequests: 3,
          deduplicatedRequests: 10,
          averageLatency: 150,
          currentConcurrency: 2,
        }),
      });

      const result = handleStats(['requests']);

      expect(result.entry?.content).toContain('Request Optimizer Statistics');
      expect(result.entry?.content).toContain('Total Requests:');
      expect(result.entry?.content).toContain('Average Latency:');
    });

    it('should handle missing request optimizer', () => {
      mockGetRequestOptimizer.mockReturnValue(null);

      const result = handleStats(['requests']);

      expect(result.entry?.content).toContain('not initialized');
    });

    it('should reset stats with "reset" action', () => {
      const result = handleStats(['reset']);

      expect(mockResetStats).toHaveBeenCalled();
      expect(result.entry?.content).toContain('reset');
    });

    it('should include all sections in summary', () => {
      const result = handleStats(['summary']);

      expect(result.entry?.content).toContain('Lazy Loader');
      expect(result.entry?.content).toContain('Tool Cache');
      expect(result.entry?.content).toContain('Requests');
      expect(result.entry?.content).toContain('API Cache');
      expect(result.entry?.content).toContain('Overall');
    });
  });
});

describe('Cache Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFormatStatus.mockReturnValue('Cache Status Content');
    mockCacheGetStats.mockReturnValue({
      totalEntries: 50,
      cacheSize: '2.5 MB',
      totalHits: 200,
      totalMisses: 50,
      oldestEntry: new Date('2024-01-01'),
      newestEntry: new Date('2024-01-15'),
    });
  });

  describe('handleCache', () => {
    it('should show status when no action provided', () => {
      const result = handleCache([]);

      expect(result.handled).toBe(true);
      expect(mockFormatStatus).toHaveBeenCalled();
    });

    it('should show status with "status" action', () => {
      handleCache(['status']);

      expect(mockFormatStatus).toHaveBeenCalled();
    });

    it('should clear cache with "clear" action', () => {
      const result = handleCache(['clear']);

      expect(mockCacheClear).toHaveBeenCalled();
      expect(result.entry?.content).toContain('Cache cleared');
    });

    it('should show stats with "stats" action', () => {
      const result = handleCache(['stats']);

      expect(mockCacheGetStats).toHaveBeenCalled();
      expect(result.entry?.content).toContain('Cache Statistics');
      expect(result.entry?.content).toContain('Entries:');
      expect(result.entry?.content).toContain('Hit Rate:');
    });

    it('should calculate hit rate correctly', () => {
      mockCacheGetStats.mockReturnValue({
        totalEntries: 50,
        cacheSize: '2.5 MB',
        totalHits: 80,
        totalMisses: 20,
        oldestEntry: null,
        newestEntry: null,
      });

      const result = handleCache(['stats']);

      // 80 / (80 + 20) = 80%
      expect(result.entry?.content).toContain('80');
    });

    it('should handle zero stats', () => {
      mockCacheGetStats.mockReturnValue({
        totalEntries: 0,
        cacheSize: '0 B',
        totalHits: 0,
        totalMisses: 0,
        oldestEntry: null,
        newestEntry: null,
      });

      const result = handleCache(['stats']);

      expect(result.entry?.content).toContain('0');
    });
  });
});

describe('Self-Healing Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOptions.mockReturnValue({
      enabled: true,
      maxRetries: 3,
      autoFix: true,
      verbose: false,
    });
    mockGetHealingStats.mockReturnValue({
      totalAttempts: 10,
      successfulHeals: 8,
      failedHeals: 2,
      successRate: '80%',
    });
  });

  describe('handleSelfHealing', () => {
    it('should show status when no action provided', () => {
      const result = handleSelfHealing([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Self-Healing Status');
    });

    it('should show status with "status" action', () => {
      handleSelfHealing(['status']);

      expect(mockGetOptions).toHaveBeenCalled();
    });

    it('should enable with "on" action', () => {
      const result = handleSelfHealing(['on']);

      expect(mockUpdateOptions).toHaveBeenCalledWith({ enabled: true });
      expect(result.entry?.content).toContain('ENABLED');
    });

    it('should disable with "off" action', () => {
      const result = handleSelfHealing(['off']);

      expect(mockUpdateOptions).toHaveBeenCalledWith({ enabled: false });
      expect(result.entry?.content).toContain('DISABLED');
    });

    it('should show stats with "stats" action', () => {
      const result = handleSelfHealing(['stats']);

      expect(mockGetHealingStats).toHaveBeenCalled();
      expect(result.entry?.content).toContain('Self-Healing Statistics');
      expect(result.entry?.content).toContain('Total Attempts:');
      expect(result.entry?.content).toContain('Success Rate:');
    });

    it('should show current settings in status', () => {
      const result = handleSelfHealing([]);

      expect(result.entry?.content).toContain('Enabled:');
      expect(result.entry?.content).toContain('Max Retries:');
      expect(result.entry?.content).toContain('Auto-Fix:');
    });

    it('should show commands in status', () => {
      const result = handleSelfHealing([]);

      expect(result.entry?.content).toContain('/heal on');
      expect(result.entry?.content).toContain('/heal off');
      expect(result.entry?.content).toContain('/heal stats');
    });
  });
});

describe('Reload Handler', () => {
  describe('handleReload', () => {
    it('should reload configuration', async () => {
      const result = await handleReload();

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Reloading Configuration');
    });

    it('should show OK for successful reloads', async () => {
      const result = await handleReload();

      expect(result.entry?.content).toContain('[OK]');
    });

    it('should have timestamp', async () => {
      const result = await handleReload();

      expect(result.entry?.timestamp).toBeInstanceOf(Date);
    });
  });
});

describe('Compact Handler', () => {
  describe('handleCompact', () => {
    it('should show message when no history', async () => {
      const result = await handleCompact([], []);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('No conversation history');
    });

    it('should show message when history is undefined', async () => {
      const result = await handleCompact([], undefined);

      expect(result.entry?.content).toContain('No conversation history');
    });

    it('should show current stats when history exists', async () => {
      const history = [
        { type: 'user', content: 'Hello' },
        { type: 'assistant', content: 'Hi there!' },
      ];

      const result = await handleCompact([], history);

      expect(result.entry?.content).toContain('Current messages:');
      expect(result.entry?.content).toContain('Estimated tokens:');
    });

    it('should estimate tokens from content', async () => {
      const history = [
        { type: 'user', content: 'Hello' }, // 5 chars = ~2 tokens
        { type: 'assistant', content: 'Hi there!' }, // 9 chars = ~3 tokens
      ];

      const result = await handleCompact([], history);

      expect(result.entry?.content).toContain('Estimated tokens:');
    });

    it('should provide tip about /clear', async () => {
      const history = [{ type: 'user', content: 'Hello' }];

      const result = await handleCompact([], history);

      expect(result.entry?.content).toContain('/clear');
    });
  });
});

describe('Tools Handler', () => {
  describe('handleTools', () => {
    it('should list tools when no action provided', async () => {
      const result = await handleTools([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Available Tools');
    });

    it('should list tools with "list" action', async () => {
      const result = await handleTools(['list']);

      expect(result.entry?.content).toContain('Available Tools');
      expect(result.entry?.content).toContain('Total:');
    });

    it('should show usage with "filter" and no pattern', async () => {
      const result = await handleTools(['filter']);

      expect(result.entry?.content).toContain('Usage:');
      expect(result.entry?.content).toContain('/tools filter');
    });

    it('should reset filter with "reset" action', async () => {
      const result = await handleTools(['reset']);

      expect(result.entry?.content).toContain('Tool filter reset');
    });

    it('should show usage for unknown action', async () => {
      const result = await handleTools(['unknown']);

      expect(result.entry?.content).toContain('Usage:');
    });
  });
});

describe('Vim Mode Handler', () => {
  const originalEnv = process.env.GROK_VIM_MODE;

  beforeEach(() => {
    delete process.env.GROK_VIM_MODE;
  });

  afterEach(() => {
    process.env.GROK_VIM_MODE = originalEnv;
  });

  describe('handleVimMode', () => {
    it('should show status when no action provided', async () => {
      const result = await handleVimMode([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Vim Mode Status');
    });

    it('should show status with "status" action', async () => {
      const result = await handleVimMode(['status']);

      expect(result.entry?.content).toContain('Vim Mode Status');
      expect(result.entry?.content).toContain('Current:');
    });

    it('should enable with "on" action', async () => {
      const result = await handleVimMode(['on']);

      expect(process.env.GROK_VIM_MODE).toBe('true');
      expect(result.entry?.content).toContain('ENABLED');
      expect(result.entry?.content).toContain('Keybindings:');
    });

    it('should disable with "off" action', async () => {
      process.env.GROK_VIM_MODE = 'true';

      const result = await handleVimMode(['off']);

      expect(process.env.GROK_VIM_MODE).toBe('false');
      expect(result.entry?.content).toContain('DISABLED');
    });

    it('should toggle with "toggle" action', async () => {
      process.env.GROK_VIM_MODE = 'false';

      const result = await handleVimMode(['toggle']);

      expect(process.env.GROK_VIM_MODE).toBe('true');
    });

    it('should show keybinding help when enabling', async () => {
      const result = await handleVimMode(['on']);

      expect(result.entry?.content).toContain('ESC');
      expect(result.entry?.content).toContain('h/j/k/l');
      expect(result.entry?.content).toContain('dd');
      expect(result.entry?.content).toContain('yy');
    });

    it('should show commands in status', async () => {
      const result = await handleVimMode([]);

      expect(result.entry?.content).toContain('/vim on');
      expect(result.entry?.content).toContain('/vim off');
      expect(result.entry?.content).toContain('/vim toggle');
    });
  });
});

describe('Edge Cases and Error Handling', () => {
  it('should handle empty args array', () => {
    const result = handleCost([]);
    expect(result.handled).toBe(true);
  });

  it('should handle undefined in args', () => {
    const result = handleCache([undefined as unknown as string]);
    expect(result.handled).toBe(true);
  });

  it('should be case insensitive', () => {
    const result1 = handleCache(['CLEAR']);
    const result2 = handleCache(['Clear']);

    expect(result1.entry?.content).toContain('Cache cleared');
    expect(result2.entry?.content).toContain('Cache cleared');
  });

  it('should parse numeric arguments correctly', () => {
    const result = handleCost(['budget', '10.50']);
    expect(mockSetBudgetLimit).toHaveBeenCalledWith(10.50);
  });

  it('should handle invalid numeric arguments', () => {
    const result = handleCost(['budget', 'invalid']);
    expect(mockSetBudgetLimit).toHaveBeenCalledWith(NaN);
  });
});

describe('CommandHandlerResult Structure', () => {
  it('should always have handled property', () => {
    const result = handleTheme([]);
    expect(result).toHaveProperty('handled');
    expect(typeof result.handled).toBe('boolean');
  });

  it('should have entry with correct type', () => {
    const result = handleAvatar([]);
    expect(result.entry?.type).toBe('assistant');
  });

  it('should have entry with content', () => {
    const result = handleCost([]);
    expect(typeof result.entry?.content).toBe('string');
    expect((result.entry?.content as string).length).toBeGreaterThan(0);
  });

  it('should have entry with timestamp', () => {
    const result = handleStats([]);
    expect(result.entry?.timestamp).toBeInstanceOf(Date);
  });
});
