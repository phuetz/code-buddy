/**
 * Cat 101: HookRegistry (7 tests, no API)
 * Cat 102: AdvancedHookRunner (6 tests, no API)
 * Cat 103: TOML Config (7 tests, no API)
 * Cat 104: EffortLevel & AutoCompact (7 tests, no API)
 * Cat 105: FallbackModel & SettingSources (6 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 101: HookRegistry
// ============================================================================

export function cat101HookRegistry(): TestDef[] {
  return [
    {
      name: '101.1-registry-singleton',
      timeout: 5000,
      fn: async () => {
        const { getHookRegistry, resetAdvancedHooks } = await import('../../src/hooks/advanced-hooks.js');
        resetAdvancedHooks();
        const reg = getHookRegistry();
        return { pass: reg !== null && typeof reg.addHook === 'function' };
      },
    },
    {
      name: '101.2-add-hook',
      timeout: 5000,
      fn: async () => {
        const { getHookRegistry, resetAdvancedHooks, HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        resetAdvancedHooks();
        const reg = getHookRegistry();
        reg.addHook({ name: 'test-hook', event: HookEvent.PreToolUse, type: 'command' });
        return { pass: reg.size === 1 };
      },
    },
    {
      name: '101.3-remove-hook',
      timeout: 5000,
      fn: async () => {
        const { getHookRegistry, resetAdvancedHooks, HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        resetAdvancedHooks();
        const reg = getHookRegistry();
        reg.addHook({ name: 'h1', event: HookEvent.PreBash, type: 'command' });
        const removed = reg.removeHook('h1');
        return { pass: removed === true && reg.size === 0 };
      },
    },
    {
      name: '101.4-get-hook-by-name',
      timeout: 5000,
      fn: async () => {
        const { getHookRegistry, resetAdvancedHooks, HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        resetAdvancedHooks();
        const reg = getHookRegistry();
        reg.addHook({ name: 'my-hook', event: HookEvent.SessionStart, type: 'prompt' });
        const hook = reg.getHook('my-hook');
        return { pass: hook !== undefined && hook.name === 'my-hook' && hook.type === 'prompt' };
      },
    },
    {
      name: '101.5-list-hooks',
      timeout: 5000,
      fn: async () => {
        const { getHookRegistry, resetAdvancedHooks, HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        resetAdvancedHooks();
        const reg = getHookRegistry();
        reg.addHook({ name: 'a', event: HookEvent.PreEdit, type: 'command' });
        reg.addHook({ name: 'b', event: HookEvent.PostEdit, type: 'agent' });
        const list = reg.listHooks();
        return { pass: list.length === 2, metadata: { names: list.map(h => h.name) } };
      },
    },
    {
      name: '101.6-get-hooks-for-event',
      timeout: 5000,
      fn: async () => {
        const { getHookRegistry, resetAdvancedHooks, HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        resetAdvancedHooks();
        const reg = getHookRegistry();
        reg.addHook({ name: 'pre1', event: HookEvent.PreToolUse, type: 'command' });
        reg.addHook({ name: 'post1', event: HookEvent.PostToolUse, type: 'command' });
        const preHooks = reg.getHooksForEvent(HookEvent.PreToolUse);
        return { pass: preHooks.length === 1 && preHooks[0].name === 'pre1' };
      },
    },
    {
      name: '101.7-clear-hooks',
      timeout: 5000,
      fn: async () => {
        const { getHookRegistry, resetAdvancedHooks, HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        resetAdvancedHooks();
        const reg = getHookRegistry();
        reg.addHook({ name: 'x', event: HookEvent.Notification, type: 'command' });
        reg.clear();
        return { pass: reg.size === 0 };
      },
    },
  ];
}

// ============================================================================
// Cat 102: AdvancedHookRunner
// ============================================================================

export function cat102AdvancedHookRunner(): TestDef[] {
  return [
    {
      name: '102.1-runner-instantiation',
      timeout: 5000,
      fn: async () => {
        const { AdvancedHookRunner } = await import('../../src/hooks/advanced-hooks.js');
        const runner = new AdvancedHookRunner();
        return { pass: runner !== null && typeof runner.runHook === 'function' };
      },
    },
    {
      name: '102.2-runner-singleton',
      timeout: 5000,
      fn: async () => {
        const { getAdvancedHookRunner, resetAdvancedHooks } = await import('../../src/hooks/advanced-hooks.js');
        resetAdvancedHooks();
        const runner = getAdvancedHookRunner();
        return { pass: runner !== null && typeof runner.matchesEvent === 'function' };
      },
    },
    {
      name: '102.3-matches-event-basic',
      timeout: 5000,
      fn: async () => {
        const { AdvancedHookRunner, HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        const runner = new AdvancedHookRunner();
        const hook = { name: 'test', event: HookEvent.PreToolUse, type: 'command' as const };
        const matches = runner.matchesEvent(hook, HookEvent.PreToolUse);
        const noMatch = runner.matchesEvent(hook, HookEvent.PostToolUse);
        return { pass: matches === true && noMatch === false };
      },
    },
    {
      name: '102.4-matches-event-with-matcher',
      timeout: 5000,
      fn: async () => {
        const { AdvancedHookRunner, HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        const runner = new AdvancedHookRunner();
        const hook = { name: 'bash-only', event: HookEvent.PreToolUse, type: 'command' as const, matcher: /^bash$/ };
        const matchesBash = runner.matchesEvent(hook, HookEvent.PreToolUse, 'bash');
        const noMatchRead = runner.matchesEvent(hook, HookEvent.PreToolUse, 'read_file');
        return { pass: matchesBash === true && noMatchRead === false };
      },
    },
    {
      name: '102.5-hook-event-enum-values',
      timeout: 5000,
      fn: async () => {
        const { HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        const events = Object.keys(HookEvent);
        return {
          pass: events.includes('PreToolUse') && events.includes('PostToolUse') &&
                events.includes('PreBash') && events.includes('SessionStart') &&
                events.includes('Notification') && events.length >= 10,
          metadata: { count: events.length },
        };
      },
    },
    {
      name: '102.6-once-hook-fired-tracking',
      timeout: 5000,
      fn: async () => {
        const { getHookRegistry, resetAdvancedHooks, HookEvent } = await import('../../src/hooks/advanced-hooks.js');
        resetAdvancedHooks();
        const reg = getHookRegistry();
        reg.addHook({ name: 'once-hook', event: HookEvent.PreToolUse, type: 'command', once: true });
        // Before firing
        const before = reg.getHooksForEvent(HookEvent.PreToolUse);
        reg.markFired('once-hook');
        // After firing
        const after = reg.getHooksForEvent(HookEvent.PreToolUse);
        return { pass: before.length === 1 && after.length === 0 };
      },
    },
  ];
}

// ============================================================================
// Cat 103: TOML Config
// ============================================================================

export function cat103TOMLConfig(): TestDef[] {
  return [
    {
      name: '103.1-default-config-exists',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        return {
          pass: DEFAULT_CONFIG !== null &&
                typeof DEFAULT_CONFIG.active_model === 'string' &&
                typeof DEFAULT_CONFIG.providers === 'object' &&
                typeof DEFAULT_CONFIG.models === 'object',
          metadata: { activeModel: DEFAULT_CONFIG.active_model },
        };
      },
    },
    {
      name: '103.2-parse-toml-basic',
      timeout: 5000,
      fn: async () => {
        const { parseTOML } = await import('../../src/config/toml-config.js');
        const result = parseTOML('active_model = "grok-3"\n');
        return {
          pass: (result as any).active_model === 'grok-3',
          metadata: { result },
        };
      },
    },
    {
      name: '103.3-parse-toml-sections',
      timeout: 5000,
      fn: async () => {
        const { parseTOML } = await import('../../src/config/toml-config.js');
        const toml = `[ui]\ntheme = "dark"\nshow_tokens = true\n`;
        const result = parseTOML(toml);
        const ui = (result as any).ui;
        return {
          pass: ui !== undefined && ui.theme === 'dark' && ui.show_tokens === true,
          metadata: { ui },
        };
      },
    },
    {
      name: '103.4-parse-toml-numbers',
      timeout: 5000,
      fn: async () => {
        const { parseTOML } = await import('../../src/config/toml-config.js');
        const toml = `[middleware]\nmax_turns = 100\nmax_cost = 10.5\n`;
        const result = parseTOML(toml);
        const mw = (result as any).middleware;
        return {
          pass: mw.max_turns === 100 && mw.max_cost === 10.5,
          metadata: { mw },
        };
      },
    },
    {
      name: '103.5-serialize-toml',
      timeout: 5000,
      fn: async () => {
        const { serializeTOML, DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        const output = serializeTOML(DEFAULT_CONFIG);
        return {
          pass: typeof output === 'string' &&
                output.includes('active_model') &&
                output.includes('[ui]') &&
                output.includes('[middleware]'),
          metadata: { len: output.length },
        };
      },
    },
    {
      name: '103.6-default-providers',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        const providers = Object.keys(DEFAULT_CONFIG.providers);
        return {
          pass: providers.includes('xai') && providers.includes('anthropic') &&
                providers.includes('openai') && providers.includes('google'),
          metadata: { providers },
        };
      },
    },
    {
      name: '103.7-default-models',
      timeout: 5000,
      fn: async () => {
        const { DEFAULT_CONFIG } = await import('../../src/config/toml-config.js');
        const models = Object.keys(DEFAULT_CONFIG.models);
        return {
          pass: models.length >= 5 && models.some(m => m.includes('grok')),
          metadata: { models, count: models.length },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 104: EffortLevel & AutoCompact
// ============================================================================

export function cat104EffortAutoCompact(): TestDef[] {
  return [
    {
      name: '104.1-effort-default-medium',
      timeout: 5000,
      fn: async () => {
        const { EffortLevelManager } = await import('../../src/config/advanced-config.js');
        const mgr = new EffortLevelManager();
        return { pass: mgr.getLevel() === 'medium' };
      },
    },
    {
      name: '104.2-effort-set-level',
      timeout: 5000,
      fn: async () => {
        const { EffortLevelManager } = await import('../../src/config/advanced-config.js');
        const mgr = new EffortLevelManager();
        mgr.setLevel('high');
        return { pass: mgr.getLevel() === 'high' };
      },
    },
    {
      name: '104.3-effort-model-params',
      timeout: 5000,
      fn: async () => {
        const { EffortLevelManager } = await import('../../src/config/advanced-config.js');
        const low = new EffortLevelManager('low');
        const high = new EffortLevelManager('high');
        const lowP = low.getModelParams();
        const highP = high.getModelParams();
        return {
          pass: lowP.temperature < highP.temperature &&
                lowP.maxTokens < highP.maxTokens,
          metadata: { low: lowP, high: highP },
        };
      },
    },
    {
      name: '104.4-autocompact-default-80',
      timeout: 5000,
      fn: async () => {
        const { AutoCompactConfig } = await import('../../src/config/advanced-config.js');
        const config = new AutoCompactConfig();
        return { pass: config.getThreshold() === 80 };
      },
    },
    {
      name: '104.5-autocompact-set-threshold',
      timeout: 5000,
      fn: async () => {
        const { AutoCompactConfig } = await import('../../src/config/advanced-config.js');
        const config = new AutoCompactConfig();
        config.setThreshold(90);
        return { pass: config.getThreshold() === 90 };
      },
    },
    {
      name: '104.6-autocompact-invalid-threshold',
      timeout: 5000,
      fn: async () => {
        const { AutoCompactConfig } = await import('../../src/config/advanced-config.js');
        const config = new AutoCompactConfig();
        let threw = false;
        try { config.setThreshold(150); } catch { threw = true; }
        return { pass: threw };
      },
    },
    {
      name: '104.7-autocompact-should-compact',
      timeout: 5000,
      fn: async () => {
        const { AutoCompactConfig } = await import('../../src/config/advanced-config.js');
        const config = new AutoCompactConfig(80);
        const yes = config.shouldCompact(85000, 100000);
        const no = config.shouldCompact(50000, 100000);
        return { pass: yes === true && no === false };
      },
    },
  ];
}

// ============================================================================
// Cat 105: FallbackModel & SettingSources
// ============================================================================

export function cat105FallbackSettingSources(): TestDef[] {
  return [
    {
      name: '105.1-fallback-default-config',
      timeout: 5000,
      fn: async () => {
        const { FallbackModelManager } = await import('../../src/config/advanced-config.js');
        const mgr = new FallbackModelManager();
        return {
          pass: mgr.getCurrentModel() === 'grok-3' && mgr.isFallbackActive() === false,
          metadata: { model: mgr.getCurrentModel() },
        };
      },
    },
    {
      name: '105.2-fallback-activate',
      timeout: 5000,
      fn: async () => {
        const { FallbackModelManager } = await import('../../src/config/advanced-config.js');
        const mgr = new FallbackModelManager();
        mgr.activateFallback();
        return {
          pass: mgr.isFallbackActive() === true && mgr.getCurrentModel() === 'grok-3-mini' &&
                mgr.getFallbackCount() === 1,
        };
      },
    },
    {
      name: '105.3-fallback-deactivate',
      timeout: 5000,
      fn: async () => {
        const { FallbackModelManager } = await import('../../src/config/advanced-config.js');
        const mgr = new FallbackModelManager();
        mgr.activateFallback();
        mgr.deactivateFallback();
        return { pass: mgr.isFallbackActive() === false && mgr.getCurrentModel() === 'grok-3' };
      },
    },
    {
      name: '105.4-fallback-should-on-429',
      timeout: 5000,
      fn: async () => {
        const { FallbackModelManager } = await import('../../src/config/advanced-config.js');
        const mgr = new FallbackModelManager();
        const yes = mgr.shouldFallback({ status: 429, code: 'rate_limit_exceeded' });
        const no = mgr.shouldFallback({ status: 200 });
        return { pass: yes === true && no === false };
      },
    },
    {
      name: '105.5-setting-source-manager',
      timeout: 5000,
      fn: async () => {
        const { SettingSourceManager } = await import('../../src/config/advanced-config.js');
        const mgr = new SettingSourceManager();
        return {
          pass: mgr.isSourceEnabled('user') === true &&
                mgr.isSourceEnabled('project') === true &&
                mgr.getEnabledSources().length === 5,
          metadata: { sources: mgr.getEnabledSources() },
        };
      },
    },
    {
      name: '105.6-setting-source-disable',
      timeout: 5000,
      fn: async () => {
        const { SettingSourceManager } = await import('../../src/config/advanced-config.js');
        const mgr = new SettingSourceManager();
        mgr.disableSource('enterprise');
        return {
          pass: mgr.isSourceEnabled('enterprise') === false &&
                mgr.getEnabledSources().length === 4,
        };
      },
    },
  ];
}
