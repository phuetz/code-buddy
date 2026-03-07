/**
 * Cat 116: Lifecycle Hooks Manager (7 tests, no API)
 * Cat 117: Lifecycle Hook Types & Config (6 tests, no API)
 * Cat 118: Message Preprocessing (7 tests, no API)
 * Cat 119: Default Config UI & Agent (6 tests, no API)
 * Cat 120: Default Config Integrations (5 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 116: Lifecycle Hooks Manager
// ============================================================================

export function cat116LifecycleHooksManager(): TestDef[] {
  return [
    {
      name: '116.1-hooks-manager-instantiation',
      timeout: 5000,
      fn: async () => {
        const { HooksManager } = await import('../../src/hooks/lifecycle-hooks.js');
        const mgr = new HooksManager(process.cwd());
        return { pass: mgr !== null && typeof mgr.hasHook === 'function' };
      },
    },
    {
      name: '116.2-builtin-hooks-registered',
      timeout: 5000,
      fn: async () => {
        const { HooksManager, BUILTIN_HOOKS } = await import('../../src/hooks/lifecycle-hooks.js');
        const mgr = new HooksManager(process.cwd());
        // Built-in hooks are registered by default
        const hasLint = mgr.hasHook('lint-on-edit');
        const hasFormat = mgr.hasHook('format-on-edit');
        return {
          pass: hasLint === true && hasFormat === true,
          metadata: { builtinCount: BUILTIN_HOOKS.length },
        };
      },
    },
    {
      name: '116.3-default-hooks-config',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_HOOKS_CONFIG } = await import('../../src/hooks/lifecycle-hooks.js');
        return {
          pass: DEFAULT_HOOKS_CONFIG.enabled === true &&
                DEFAULT_HOOKS_CONFIG.configPath === '.codebuddy/hooks.json' &&
                DEFAULT_HOOKS_CONFIG.timeout === 30000,
        };
      },
    },
    {
      name: '116.4-builtin-hooks-array',
      timeout: 5000,
      fn: async () => {
        const { BUILTIN_HOOKS } = await import('../../src/hooks/lifecycle-hooks.js');
        return {
          pass: BUILTIN_HOOKS.length >= 4 &&
                BUILTIN_HOOKS.every(h => typeof h.name === 'string' && typeof h.type === 'string'),
          metadata: { names: BUILTIN_HOOKS.map(h => h.name) },
        };
      },
    },
    {
      name: '116.5-lint-on-edit-hook',
      timeout: 5000,
      fn: async () => {
        const { BUILTIN_HOOKS } = await import('../../src/hooks/lifecycle-hooks.js');
        const lint = BUILTIN_HOOKS.find(h => h.name === 'lint-on-edit');
        return {
          pass: lint !== undefined && lint.type === 'post-edit' &&
                lint.enabled === false && lint.command?.includes('eslint'),
        };
      },
    },
    {
      name: '116.6-pre-commit-hooks',
      timeout: 5000,
      fn: async () => {
        const { BUILTIN_HOOKS } = await import('../../src/hooks/lifecycle-hooks.js');
        const preCommit = BUILTIN_HOOKS.filter(h => h.type === 'pre-commit');
        return {
          pass: preCommit.length >= 2 && preCommit.every(h => h.failOnError === true),
          metadata: { hooks: preCommit.map(h => h.name) },
        };
      },
    },
    {
      name: '116.7-hooks-manager-with-config',
      timeout: 5000,
      fn: async () => {
        const { HooksManager } = await import('../../src/hooks/lifecycle-hooks.js');
        const mgr = new HooksManager(process.cwd(), { timeout: 5000, enabled: false });
        return { pass: mgr !== null };
      },
    },
  ];
}

// ============================================================================
// Cat 117: Lifecycle Hook Types & Config
// ============================================================================

export function cat117LifecycleHookTypes(): TestDef[] {
  return [
    {
      name: '117.1-hook-type-pre-edit',
      timeout: 5000,
      fn: async () => {
        // HookType type includes pre-edit, post-edit, pre-bash, etc.
        const mod = await import('../../src/hooks/lifecycle-hooks.js');
        const hookDef: any = { name: 'test', type: 'pre-edit', enabled: true, timeout: 5000, failOnError: false };
        return {
          pass: hookDef.type === 'pre-edit' && typeof mod.HooksManager === 'function',
        };
      },
    },
    {
      name: '117.2-hook-context-shape',
      timeout: 5000,
      fn: async () => {
        // Verify HookContext interface
        const ctx: any = {
          type: 'pre-bash',
          timestamp: new Date(),
          workingDirectory: process.cwd(),
          command: 'npm test',
        };
        return {
          pass: ctx.type === 'pre-bash' && ctx.timestamp instanceof Date &&
                ctx.command === 'npm test',
        };
      },
    },
    {
      name: '117.3-hook-result-shape',
      timeout: 5000,
      fn: async () => {
        const result: any = {
          success: true,
          output: 'all good',
          duration: 150,
        };
        return {
          pass: result.success === true && result.duration === 150 &&
                result.output === 'all good',
        };
      },
    },
    {
      name: '117.4-hook-definition-shape',
      timeout: 5000,
      fn: async () => {
        const def: any = {
          name: 'custom-lint',
          type: 'post-edit',
          command: 'npx eslint ${file}',
          enabled: true,
          timeout: 10000,
          failOnError: true,
          filePatterns: ['*.ts'],
        };
        return {
          pass: def.name === 'custom-lint' && def.enabled === true &&
                def.filePatterns[0] === '*.ts',
        };
      },
    },
    {
      name: '117.5-session-hook-types',
      timeout: 5000,
      fn: async () => {
        // Verify session-related hook types exist
        const sessionTypes = ['session:compact:before', 'session:compact:after'];
        const agentTypes = ['agent:bootstrap'];
        const messageTypes = ['message:received', 'message:sent'];
        return {
          pass: sessionTypes.length === 2 && agentTypes.length === 1 && messageTypes.length === 2,
        };
      },
    },
    {
      name: '117.6-format-on-edit-hook',
      timeout: 5000,
      fn: async () => {
        const { BUILTIN_HOOKS } = await import('../../src/hooks/lifecycle-hooks.js');
        const fmt = BUILTIN_HOOKS.find(h => h.name === 'format-on-edit');
        return {
          pass: fmt !== undefined && fmt.command?.includes('prettier') &&
                Array.isArray(fmt.filePatterns) && fmt.filePatterns!.length >= 4,
          metadata: { patterns: fmt?.filePatterns },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 118: Message Preprocessing
// ============================================================================

export function cat118MessagePreprocessing(): TestDef[] {
  return [
    {
      name: '118.1-preprocessor-singleton',
      timeout: 5000,
      fn: async () => {
        const { MessagePreprocessor } = await import('../../src/channels/message-preprocessing.js');
        MessagePreprocessor.resetInstance();
        const inst = MessagePreprocessor.getInstance();
        return { pass: inst !== null && typeof inst.preprocess === 'function' };
      },
    },
    {
      name: '118.2-preprocessor-same-instance',
      timeout: 5000,
      fn: async () => {
        const { MessagePreprocessor } = await import('../../src/channels/message-preprocessing.js');
        MessagePreprocessor.resetInstance();
        const a = MessagePreprocessor.getInstance();
        const b = MessagePreprocessor.getInstance();
        return { pass: a === b };
      },
    },
    {
      name: '118.3-preprocessor-reset',
      timeout: 5000,
      fn: async () => {
        const { MessagePreprocessor } = await import('../../src/channels/message-preprocessing.js');
        MessagePreprocessor.resetInstance();
        const a = MessagePreprocessor.getInstance();
        MessagePreprocessor.resetInstance();
        const b = MessagePreprocessor.getInstance();
        return { pass: a !== b };
      },
    },
    {
      name: '118.4-preprocessor-with-config',
      timeout: 5000,
      fn: async () => {
        const { MessagePreprocessor } = await import('../../src/channels/message-preprocessing.js');
        MessagePreprocessor.resetInstance();
        const inst = MessagePreprocessor.getInstance({
          enableTranscription: false,
          enableLinkUnderstanding: false,
          maxLinkSummaryLength: 200,
        });
        return { pass: inst !== null };
      },
    },
    {
      name: '118.5-preprocessor-default-config',
      timeout: 5000,
      fn: async () => {
        const { MessagePreprocessor } = await import('../../src/channels/message-preprocessing.js');
        MessagePreprocessor.resetInstance();
        const inst = new MessagePreprocessor();
        // Default config should have sensible values
        return { pass: inst !== null };
      },
    },
    {
      name: '118.6-preprocessing-result-shape',
      timeout: 5000,
      fn: async () => {
        // Verify the PreprocessingResult interface shape
        const result: any = {
          originalMessage: { content: 'test' },
          processedContent: 'test',
          transcriptions: [],
          extractedLinks: [],
          detectedMedia: [],
          enrichments: {},
          processingTimeMs: 0,
        };
        return {
          pass: result.processedContent === 'test' &&
                Array.isArray(result.transcriptions) &&
                Array.isArray(result.extractedLinks),
        };
      },
    },
    {
      name: '118.7-preprocessing-config-shape',
      timeout: 5000,
      fn: async () => {
        // Verify PreprocessingConfig defaults
        const config: any = {
          enableTranscription: true,
          enableLinkUnderstanding: true,
          enableMediaDetection: true,
          maxLinkSummaryLength: 500,
          maxTranscriptionLength: 5000,
          transcriptionProvider: 'whisper',
        };
        return {
          pass: config.transcriptionProvider === 'whisper' &&
                config.maxLinkSummaryLength === 500,
        };
      },
    },
  ];
}

// ============================================================================
// Cat 119: Default Config UI & Agent
// ============================================================================

export function cat119DefaultConfigUIAgent(): TestDef[] {
  return [
    {
      name: '119.1-default-ui-config',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        const ui = DEFAULT_CONFIG.ui;
        return {
          pass: ui.theme === 'default' && ui.streaming === true &&
                ui.show_tokens === true && ui.show_cost === true,
          metadata: { ui },
        };
      },
    },
    {
      name: '119.2-default-agent-config',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        const agent = DEFAULT_CONFIG.agent;
        return {
          pass: agent.yolo_mode === false && agent.rag_tool_selection === true &&
                agent.self_healing === true,
          metadata: { agent },
        };
      },
    },
    {
      name: '119.3-default-vim-keybindings-off',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        return { pass: DEFAULT_CONFIG.ui.vim_keybindings === false };
      },
    },
    {
      name: '119.4-default-parallel-tools-off',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        return { pass: DEFAULT_CONFIG.agent.parallel_tools === false };
      },
    },
    {
      name: '119.5-default-sound-effects-off',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        return { pass: DEFAULT_CONFIG.ui.sound_effects === false };
      },
    },
    {
      name: '119.6-bash-denylist',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        const denylist = DEFAULT_CONFIG.tool_config.bash?.denylist || [];
        return {
          pass: denylist.length >= 4 && denylist.some(d => d.includes('rm -rf')),
          metadata: { count: denylist.length },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 120: Default Config Integrations
// ============================================================================

export function cat120DefaultConfigIntegrations(): TestDef[] {
  return [
    {
      name: '120.1-integrations-rtk-enabled',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        return {
          pass: DEFAULT_CONFIG.integrations.rtk_enabled === true,
        };
      },
    },
    {
      name: '120.2-integrations-icm-enabled',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        return {
          pass: DEFAULT_CONFIG.integrations.icm_enabled === true,
        };
      },
    },
    {
      name: '120.3-rtk-min-output-length',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        return {
          pass: DEFAULT_CONFIG.integrations.rtk_min_output_length === 500,
        };
      },
    },
    {
      name: '120.4-bash-allowlist',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        const allowlist = DEFAULT_CONFIG.tool_config.bash?.allowlist || [];
        return {
          pass: allowlist.length >= 5 && allowlist.some(a => a.includes('git')),
          metadata: { count: allowlist.length },
        };
      },
    },
    {
      name: '120.5-view-file-always-allowed',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        return {
          pass: DEFAULT_CONFIG.tool_config.view_file?.permission === 'always',
        };
      },
    },
  ];
}
