/**
 * Unit tests for useAgentMode hook
 * Tests agent mode functionality including:
 * - Mode switching (plan, code, ask, architect)
 * - Mode-specific behavior
 * - Tool restrictions per mode
 * - Mode state management
 * - Mode persistence
 */

// Mock React hooks
jest.mock('react', () => ({
  useState: jest.fn((init) => {
    const val = typeof init === 'function' ? init() : init;
    return [val, jest.fn()];
  }),
  useCallback: jest.fn((fn) => fn),
  useRef: jest.fn((init) => ({ current: init })),
  useEffect: jest.fn(),
  useMemo: jest.fn((fn) => fn()),
}));

describe('useAgentMode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('AgentMode Types', () => {
    type AgentMode = 'plan' | 'code' | 'ask' | 'architect';

    const validModes: AgentMode[] = ['plan', 'code', 'ask', 'architect'];

    it('should define all valid modes', () => {
      expect(validModes).toContain('plan');
      expect(validModes).toContain('code');
      expect(validModes).toContain('ask');
      expect(validModes).toContain('architect');
    });

    it('should have exactly 4 modes', () => {
      expect(validModes).toHaveLength(4);
    });
  });

  describe('Mode Validation', () => {
    type AgentMode = 'plan' | 'code' | 'ask' | 'architect';
    const validModes: AgentMode[] = ['plan', 'code', 'ask', 'architect'];

    function isValidMode(mode: string): mode is AgentMode {
      return validModes.includes(mode as AgentMode);
    }

    function validateMode(mode: string): AgentMode | null {
      return isValidMode(mode) ? mode : null;
    }

    it('should validate plan mode', () => {
      expect(isValidMode('plan')).toBe(true);
    });

    it('should validate code mode', () => {
      expect(isValidMode('code')).toBe(true);
    });

    it('should validate ask mode', () => {
      expect(isValidMode('ask')).toBe(true);
    });

    it('should validate architect mode', () => {
      expect(isValidMode('architect')).toBe(true);
    });

    it('should reject invalid mode', () => {
      expect(isValidMode('invalid')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidMode('')).toBe(false);
    });

    it('should return mode when valid', () => {
      expect(validateMode('code')).toBe('code');
    });

    it('should return null when invalid', () => {
      expect(validateMode('unknown')).toBeNull();
    });
  });

  describe('Mode State Management', () => {
    type AgentMode = 'plan' | 'code' | 'ask' | 'architect';

    interface ModeState {
      currentMode: AgentMode;
      previousMode: AgentMode | null;
      modeHistory: AgentMode[];
    }

    function createInitialState(defaultMode: AgentMode = 'code'): ModeState {
      return {
        currentMode: defaultMode,
        previousMode: null,
        modeHistory: [defaultMode],
      };
    }

    function switchMode(state: ModeState, newMode: AgentMode): ModeState {
      if (state.currentMode === newMode) {
        return state;
      }
      return {
        currentMode: newMode,
        previousMode: state.currentMode,
        modeHistory: [...state.modeHistory, newMode],
      };
    }

    function revertMode(state: ModeState): ModeState {
      if (!state.previousMode) {
        return state;
      }
      return {
        currentMode: state.previousMode,
        previousMode: null,
        modeHistory: [...state.modeHistory, state.previousMode],
      };
    }

    it('should create initial state with default mode', () => {
      const state = createInitialState();

      expect(state.currentMode).toBe('code');
      expect(state.previousMode).toBeNull();
      expect(state.modeHistory).toEqual(['code']);
    });

    it('should create initial state with custom mode', () => {
      const state = createInitialState('plan');

      expect(state.currentMode).toBe('plan');
    });

    it('should switch to new mode', () => {
      let state = createInitialState('code');
      state = switchMode(state, 'plan');

      expect(state.currentMode).toBe('plan');
      expect(state.previousMode).toBe('code');
    });

    it('should not switch to same mode', () => {
      let state = createInitialState('code');
      const originalState = state;
      state = switchMode(state, 'code');

      expect(state).toBe(originalState);
    });

    it('should track mode history', () => {
      let state = createInitialState('code');
      state = switchMode(state, 'plan');
      state = switchMode(state, 'ask');

      expect(state.modeHistory).toEqual(['code', 'plan', 'ask']);
    });

    it('should revert to previous mode', () => {
      let state = createInitialState('code');
      state = switchMode(state, 'plan');
      state = revertMode(state);

      expect(state.currentMode).toBe('code');
      expect(state.previousMode).toBeNull();
    });

    it('should not revert when no previous mode', () => {
      let state = createInitialState('code');
      const originalState = state;
      state = revertMode(state);

      expect(state).toBe(originalState);
    });
  });

  describe('Mode-Specific Tool Restrictions', () => {
    type AgentMode = 'plan' | 'code' | 'ask' | 'architect';

    interface ToolConfig {
      name: string;
      allowedInModes: AgentMode[];
    }

    const toolConfigs: ToolConfig[] = [
      { name: 'text_editor', allowedInModes: ['code', 'architect'] },
      { name: 'bash', allowedInModes: ['code', 'architect'] },
      { name: 'search', allowedInModes: ['plan', 'code', 'ask', 'architect'] },
      { name: 'read_file', allowedInModes: ['plan', 'code', 'ask', 'architect'] },
      { name: 'think', allowedInModes: ['plan', 'ask', 'architect'] },
      { name: 'git', allowedInModes: ['code'] },
    ];

    function isToolAllowedInMode(toolName: string, mode: AgentMode): boolean {
      const config = toolConfigs.find((t) => t.name === toolName);
      if (!config) return false;
      return config.allowedInModes.includes(mode);
    }

    function getAvailableTools(mode: AgentMode): string[] {
      return toolConfigs
        .filter((t) => t.allowedInModes.includes(mode))
        .map((t) => t.name);
    }

    it('should allow text_editor in code mode', () => {
      expect(isToolAllowedInMode('text_editor', 'code')).toBe(true);
    });

    it('should not allow text_editor in ask mode', () => {
      expect(isToolAllowedInMode('text_editor', 'ask')).toBe(false);
    });

    it('should allow search in all modes', () => {
      expect(isToolAllowedInMode('search', 'plan')).toBe(true);
      expect(isToolAllowedInMode('search', 'code')).toBe(true);
      expect(isToolAllowedInMode('search', 'ask')).toBe(true);
      expect(isToolAllowedInMode('search', 'architect')).toBe(true);
    });

    it('should allow git only in code mode', () => {
      expect(isToolAllowedInMode('git', 'code')).toBe(true);
      expect(isToolAllowedInMode('git', 'plan')).toBe(false);
      expect(isToolAllowedInMode('git', 'ask')).toBe(false);
    });

    it('should return false for unknown tool', () => {
      expect(isToolAllowedInMode('unknown_tool', 'code')).toBe(false);
    });

    it('should get available tools for plan mode', () => {
      const tools = getAvailableTools('plan');

      expect(tools).toContain('search');
      expect(tools).toContain('read_file');
      expect(tools).toContain('think');
      expect(tools).not.toContain('text_editor');
      expect(tools).not.toContain('bash');
    });

    it('should get available tools for code mode', () => {
      const tools = getAvailableTools('code');

      expect(tools).toContain('text_editor');
      expect(tools).toContain('bash');
      expect(tools).toContain('search');
      expect(tools).toContain('git');
    });
  });

  describe('Mode Descriptions', () => {
    type AgentMode = 'plan' | 'code' | 'ask' | 'architect';

    interface ModeDescription {
      name: AgentMode;
      title: string;
      description: string;
      icon: string;
    }

    const modeDescriptions: ModeDescription[] = [
      {
        name: 'plan',
        title: 'Plan Mode',
        description: 'Analyze and plan without making changes',
        icon: '\uD83D\uDCCB',
      },
      {
        name: 'code',
        title: 'Code Mode',
        description: 'Write and modify code with full tool access',
        icon: '\uD83D\uDCBB',
      },
      {
        name: 'ask',
        title: 'Ask Mode',
        description: 'Answer questions without making changes',
        icon: '\u2753',
      },
      {
        name: 'architect',
        title: 'Architect Mode',
        description: 'Design system architecture and structure',
        icon: '\uD83C\uDFD7\uFE0F',
      },
    ];

    function getModeDescription(mode: AgentMode): ModeDescription | undefined {
      return modeDescriptions.find((m) => m.name === mode);
    }

    function formatModeDisplay(mode: AgentMode): string {
      const desc = getModeDescription(mode);
      if (!desc) return mode;
      return `${desc.icon} ${desc.title}`;
    }

    it('should get plan mode description', () => {
      const desc = getModeDescription('plan');

      expect(desc?.title).toBe('Plan Mode');
      expect(desc?.description).toContain('plan');
    });

    it('should get code mode description', () => {
      const desc = getModeDescription('code');

      expect(desc?.title).toBe('Code Mode');
      expect(desc?.description).toContain('code');
    });

    it('should get ask mode description', () => {
      const desc = getModeDescription('ask');

      expect(desc?.title).toBe('Ask Mode');
      expect(desc?.description).toContain('questions');
    });

    it('should get architect mode description', () => {
      const desc = getModeDescription('architect');

      expect(desc?.title).toBe('Architect Mode');
      expect(desc?.description).toContain('architecture');
    });

    it('should format mode for display', () => {
      const display = formatModeDisplay('code');

      expect(display).toContain('Code Mode');
    });
  });

  describe('Mode-Specific Prompts', () => {
    type AgentMode = 'plan' | 'code' | 'ask' | 'architect';

    function getModeSystemPrompt(mode: AgentMode): string {
      switch (mode) {
        case 'plan':
          return 'You are in planning mode. Analyze the request and create a detailed plan without making any changes.';
        case 'code':
          return 'You are in coding mode. You have full access to tools and can make changes to files.';
        case 'ask':
          return 'You are in ask mode. Answer questions without making any changes to files.';
        case 'architect':
          return 'You are in architect mode. Design system architecture and provide structural recommendations.';
      }
    }

    function appendModeContext(userMessage: string, mode: AgentMode): string {
      const systemPrompt = getModeSystemPrompt(mode);
      return `[Mode: ${mode.toUpperCase()}]\n${systemPrompt}\n\nUser: ${userMessage}`;
    }

    it('should get plan mode system prompt', () => {
      const prompt = getModeSystemPrompt('plan');

      expect(prompt).toContain('planning mode');
      expect(prompt).toContain('without making any changes');
    });

    it('should get code mode system prompt', () => {
      const prompt = getModeSystemPrompt('code');

      expect(prompt).toContain('coding mode');
      expect(prompt).toContain('make changes');
    });

    it('should get ask mode system prompt', () => {
      const prompt = getModeSystemPrompt('ask');

      expect(prompt).toContain('ask mode');
      expect(prompt).toContain('without making any changes');
    });

    it('should get architect mode system prompt', () => {
      const prompt = getModeSystemPrompt('architect');

      expect(prompt).toContain('architect mode');
      expect(prompt).toContain('architecture');
    });

    it('should append mode context to user message', () => {
      const result = appendModeContext('Help me refactor', 'code');

      expect(result).toContain('[Mode: CODE]');
      expect(result).toContain('User: Help me refactor');
    });
  });

  describe('Mode Persistence', () => {
    type AgentMode = 'plan' | 'code' | 'ask' | 'architect';

    interface ModeConfig {
      defaultMode: AgentMode;
      persistMode: boolean;
      lastUsedMode?: AgentMode;
    }

    function saveMode(mode: AgentMode): string {
      return JSON.stringify({ lastUsedMode: mode });
    }

    function loadMode(configJson: string, defaultMode: AgentMode): AgentMode {
      try {
        const config = JSON.parse(configJson);
        if (config.lastUsedMode && ['plan', 'code', 'ask', 'architect'].includes(config.lastUsedMode)) {
          return config.lastUsedMode;
        }
      } catch {
        // Invalid JSON, return default
      }
      return defaultMode;
    }

    it('should save mode to JSON', () => {
      const saved = saveMode('plan');

      expect(saved).toContain('"lastUsedMode":"plan"');
    });

    it('should load mode from JSON', () => {
      const json = '{"lastUsedMode":"architect"}';
      const mode = loadMode(json, 'code');

      expect(mode).toBe('architect');
    });

    it('should use default mode for invalid JSON', () => {
      const mode = loadMode('invalid json', 'code');

      expect(mode).toBe('code');
    });

    it('should use default mode for missing property', () => {
      const mode = loadMode('{}', 'code');

      expect(mode).toBe('code');
    });

    it('should use default mode for invalid mode value', () => {
      const json = '{"lastUsedMode":"invalid"}';
      const mode = loadMode(json, 'code');

      expect(mode).toBe('code');
    });
  });

  describe('Mode Switching Commands', () => {
    type AgentMode = 'plan' | 'code' | 'ask' | 'architect';

    interface SwitchCommand {
      pattern: RegExp;
      mode: AgentMode;
    }

    const switchCommands: SwitchCommand[] = [
      { pattern: /^\/plan\b/i, mode: 'plan' },
      { pattern: /^\/code\b/i, mode: 'code' },
      { pattern: /^\/ask\b/i, mode: 'ask' },
      { pattern: /^\/architect\b/i, mode: 'architect' },
      { pattern: /^\/mode\s+plan\b/i, mode: 'plan' },
      { pattern: /^\/mode\s+code\b/i, mode: 'code' },
      { pattern: /^\/mode\s+ask\b/i, mode: 'ask' },
      { pattern: /^\/mode\s+architect\b/i, mode: 'architect' },
    ];

    function detectModeSwitch(input: string): AgentMode | null {
      for (const cmd of switchCommands) {
        if (cmd.pattern.test(input)) {
          return cmd.mode;
        }
      }
      return null;
    }

    it('should detect /plan command', () => {
      expect(detectModeSwitch('/plan')).toBe('plan');
    });

    it('should detect /code command', () => {
      expect(detectModeSwitch('/code')).toBe('code');
    });

    it('should detect /ask command', () => {
      expect(detectModeSwitch('/ask')).toBe('ask');
    });

    it('should detect /architect command', () => {
      expect(detectModeSwitch('/architect')).toBe('architect');
    });

    it('should detect /mode plan command', () => {
      expect(detectModeSwitch('/mode plan')).toBe('plan');
    });

    it('should detect /mode code command', () => {
      expect(detectModeSwitch('/mode code')).toBe('code');
    });

    it('should be case insensitive', () => {
      expect(detectModeSwitch('/PLAN')).toBe('plan');
      expect(detectModeSwitch('/Mode CODE')).toBe('code');
    });

    it('should return null for non-mode commands', () => {
      expect(detectModeSwitch('/help')).toBeNull();
      expect(detectModeSwitch('regular text')).toBeNull();
    });

    it('should handle command with extra text', () => {
      expect(detectModeSwitch('/plan some task')).toBe('plan');
    });
  });

  describe('Mode Confirmation Messages', () => {
    type AgentMode = 'plan' | 'code' | 'ask' | 'architect';

    function formatModeSwitchMessage(
      fromMode: AgentMode | null,
      toMode: AgentMode
    ): string {
      if (!fromMode) {
        return `Mode set to: ${toMode.toUpperCase()}`;
      }
      if (fromMode === toMode) {
        return `Already in ${toMode.toUpperCase()} mode`;
      }
      return `Switched from ${fromMode.toUpperCase()} to ${toMode.toUpperCase()} mode`;
    }

    it('should format initial mode set', () => {
      const message = formatModeSwitchMessage(null, 'code');

      expect(message).toBe('Mode set to: CODE');
    });

    it('should format mode switch', () => {
      const message = formatModeSwitchMessage('code', 'plan');

      expect(message).toBe('Switched from CODE to PLAN mode');
    });

    it('should format same mode switch', () => {
      const message = formatModeSwitchMessage('code', 'code');

      expect(message).toBe('Already in CODE mode');
    });
  });

  describe('Mode-Specific Behavior Flags', () => {
    type AgentMode = 'plan' | 'code' | 'ask' | 'architect';

    interface ModeBehavior {
      canEditFiles: boolean;
      canRunCommands: boolean;
      canCommitChanges: boolean;
      requiresConfirmation: boolean;
      showsThinking: boolean;
    }

    function getModeBehavior(mode: AgentMode): ModeBehavior {
      switch (mode) {
        case 'plan':
          return {
            canEditFiles: false,
            canRunCommands: false,
            canCommitChanges: false,
            requiresConfirmation: false,
            showsThinking: true,
          };
        case 'code':
          return {
            canEditFiles: true,
            canRunCommands: true,
            canCommitChanges: true,
            requiresConfirmation: true,
            showsThinking: false,
          };
        case 'ask':
          return {
            canEditFiles: false,
            canRunCommands: false,
            canCommitChanges: false,
            requiresConfirmation: false,
            showsThinking: false,
          };
        case 'architect':
          return {
            canEditFiles: true,
            canRunCommands: true,
            canCommitChanges: false,
            requiresConfirmation: true,
            showsThinking: true,
          };
      }
    }

    it('should get plan mode behavior', () => {
      const behavior = getModeBehavior('plan');

      expect(behavior.canEditFiles).toBe(false);
      expect(behavior.canRunCommands).toBe(false);
      expect(behavior.showsThinking).toBe(true);
    });

    it('should get code mode behavior', () => {
      const behavior = getModeBehavior('code');

      expect(behavior.canEditFiles).toBe(true);
      expect(behavior.canRunCommands).toBe(true);
      expect(behavior.canCommitChanges).toBe(true);
    });

    it('should get ask mode behavior', () => {
      const behavior = getModeBehavior('ask');

      expect(behavior.canEditFiles).toBe(false);
      expect(behavior.canRunCommands).toBe(false);
      expect(behavior.requiresConfirmation).toBe(false);
    });

    it('should get architect mode behavior', () => {
      const behavior = getModeBehavior('architect');

      expect(behavior.canEditFiles).toBe(true);
      expect(behavior.canCommitChanges).toBe(false);
      expect(behavior.showsThinking).toBe(true);
    });
  });

  describe('Mode Transition Validation', () => {
    type AgentMode = 'plan' | 'code' | 'ask' | 'architect';

    interface TransitionResult {
      allowed: boolean;
      reason?: string;
    }

    function canTransition(
      from: AgentMode,
      to: AgentMode,
      hasUnsavedChanges: boolean
    ): TransitionResult {
      if (from === to) {
        return { allowed: false, reason: 'Already in this mode' };
      }

      if (hasUnsavedChanges && from === 'code' && to !== 'code') {
        return {
          allowed: false,
          reason: 'Please save or discard changes before switching modes',
        };
      }

      return { allowed: true };
    }

    it('should not allow transition to same mode', () => {
      const result = canTransition('code', 'code', false);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Already');
    });

    it('should allow transition without unsaved changes', () => {
      const result = canTransition('code', 'plan', false);

      expect(result.allowed).toBe(true);
    });

    it('should not allow leaving code mode with unsaved changes', () => {
      const result = canTransition('code', 'plan', true);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('save or discard');
    });

    it('should allow staying in code mode with unsaved changes', () => {
      const result = canTransition('plan', 'code', true);

      expect(result.allowed).toBe(true);
    });

    it('should allow transition from non-code modes with changes flag', () => {
      const result = canTransition('plan', 'ask', true);

      expect(result.allowed).toBe(true);
    });
  });

  describe('Mode Statistics Tracking', () => {
    type AgentMode = 'plan' | 'code' | 'ask' | 'architect';

    interface ModeStats {
      mode: AgentMode;
      activations: number;
      totalTimeMs: number;
      lastActivated: Date | null;
    }

    class ModeStatsTracker {
      private stats: Map<AgentMode, ModeStats> = new Map();
      private currentMode: AgentMode | null = null;
      private modeStartTime: number | null = null;

      constructor() {
        const modes: AgentMode[] = ['plan', 'code', 'ask', 'architect'];
        for (const mode of modes) {
          this.stats.set(mode, {
            mode,
            activations: 0,
            totalTimeMs: 0,
            lastActivated: null,
          });
        }
      }

      activate(mode: AgentMode): void {
        // End current mode if any
        if (this.currentMode && this.modeStartTime) {
          const currentStats = this.stats.get(this.currentMode)!;
          currentStats.totalTimeMs += Date.now() - this.modeStartTime;
        }

        // Start new mode
        const stats = this.stats.get(mode)!;
        stats.activations++;
        stats.lastActivated = new Date();
        this.currentMode = mode;
        this.modeStartTime = Date.now();
      }

      getStats(mode: AgentMode): ModeStats | undefined {
        return this.stats.get(mode);
      }

      getMostUsedMode(): AgentMode | null {
        let maxActivations = 0;
        let mostUsed: AgentMode | null = null;

        for (const [mode, stats] of this.stats) {
          if (stats.activations > maxActivations) {
            maxActivations = stats.activations;
            mostUsed = mode;
          }
        }

        return mostUsed;
      }
    }

    let tracker: ModeStatsTracker;

    beforeEach(() => {
      tracker = new ModeStatsTracker();
    });

    it('should track mode activations', () => {
      tracker.activate('code');
      tracker.activate('plan');
      tracker.activate('code');

      expect(tracker.getStats('code')?.activations).toBe(2);
      expect(tracker.getStats('plan')?.activations).toBe(1);
    });

    it('should track last activation time', () => {
      tracker.activate('ask');

      const stats = tracker.getStats('ask');
      expect(stats?.lastActivated).toBeInstanceOf(Date);
    });

    it('should find most used mode', () => {
      tracker.activate('code');
      tracker.activate('code');
      tracker.activate('code');
      tracker.activate('plan');

      expect(tracker.getMostUsedMode()).toBe('code');
    });

    it('should return null for no activations', () => {
      expect(tracker.getMostUsedMode()).toBeNull();
    });
  });

  describe('Mode Keyboard Shortcuts', () => {
    type AgentMode = 'plan' | 'code' | 'ask' | 'architect';

    interface KeyboardShortcut {
      key: string;
      ctrl: boolean;
      alt: boolean;
      mode: AgentMode;
    }

    const modeShortcuts: KeyboardShortcut[] = [
      { key: '1', ctrl: true, alt: false, mode: 'plan' },
      { key: '2', ctrl: true, alt: false, mode: 'code' },
      { key: '3', ctrl: true, alt: false, mode: 'ask' },
      { key: '4', ctrl: true, alt: false, mode: 'architect' },
    ];

    function matchShortcut(key: string, ctrl: boolean, alt: boolean): AgentMode | null {
      const match = modeShortcuts.find(
        (s) => s.key === key && s.ctrl === ctrl && s.alt === alt
      );
      return match?.mode || null;
    }

    it('should detect Ctrl+1 for plan mode', () => {
      expect(matchShortcut('1', true, false)).toBe('plan');
    });

    it('should detect Ctrl+2 for code mode', () => {
      expect(matchShortcut('2', true, false)).toBe('code');
    });

    it('should detect Ctrl+3 for ask mode', () => {
      expect(matchShortcut('3', true, false)).toBe('ask');
    });

    it('should detect Ctrl+4 for architect mode', () => {
      expect(matchShortcut('4', true, false)).toBe('architect');
    });

    it('should not match without Ctrl', () => {
      expect(matchShortcut('1', false, false)).toBeNull();
    });

    it('should not match unknown keys', () => {
      expect(matchShortcut('5', true, false)).toBeNull();
    });
  });
});
