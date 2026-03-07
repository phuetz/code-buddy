/**
 * Cat 66: Skill Parser (6 tests, no API)
 * Cat 67: Skill Registry (6 tests, no API)
 * Cat 68: Auto-Sandbox Router (6 tests, no API)
 * Cat 69: Confirmation Service (5 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 66: Skill Parser
// ============================================================================

export function cat66SkillParser(): TestDef[] {
  return [
    {
      name: '66.1-parse-valid-skill-file',
      timeout: 5000,
      fn: async () => {
        const { parseSkillFile } = await import('../../src/skills/parser.js');
        const content = `---
name: test-skill
description: A test skill
version: "1.0"
triggers:
  - /test
---
# Test Skill

This skill does testing.

## Steps

1. Run the tests
2. Report results
`;
        const skill = parseSkillFile(content, '/test/SKILL.md', 'workspace');
        return {
          pass: skill.metadata.name === 'test-skill' &&
                skill.metadata.description === 'A test skill' &&
                skill.tier === 'workspace',
          metadata: { name: skill.metadata.name, tier: skill.tier },
        };
      },
    },
    {
      name: '66.2-parse-invalid-no-frontmatter-throws',
      timeout: 5000,
      fn: async () => {
        const { parseSkillFile } = await import('../../src/skills/parser.js');
        try {
          parseSkillFile('no frontmatter here', '/test.md', 'bundled');
          return { pass: false, metadata: { reason: 'should throw' } };
        } catch (e: any) {
          return {
            pass: e.message.includes('frontmatter') || e.message.includes('format'),
            metadata: { error: e.message },
          };
        }
      },
    },
    {
      name: '66.3-parse-missing-name-throws',
      timeout: 5000,
      fn: async () => {
        const { parseSkillFile } = await import('../../src/skills/parser.js');
        try {
          parseSkillFile('---\ndescription: no name\n---\nBody', '/test.md', 'bundled');
          return { pass: false };
        } catch (e: any) {
          return {
            pass: e.message.includes('name') || e.message.includes('required'),
            metadata: { error: e.message },
          };
        }
      },
    },
    {
      name: '66.4-validate-skill-export',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/skills/parser.js');
        const hasValidate = typeof mod.validateSkill === 'function';
        return {
          pass: typeof mod.parseSkillFile === 'function' && hasValidate,
          metadata: { exports: Object.keys(mod) },
        };
      },
    },
    {
      name: '66.5-parse-with-tags',
      timeout: 5000,
      fn: async () => {
        const { parseSkillFile } = await import('../../src/skills/parser.js');
        const content = `---
name: tagged-skill
description: Has tags
tags:
  - deploy
  - automation
---
Deploy steps here.
`;
        const skill = parseSkillFile(content, '/test.md', 'managed');
        return {
          pass: skill.metadata.tags !== undefined && skill.metadata.tags.length === 2,
          metadata: { tags: skill.metadata.tags },
        };
      },
    },
    {
      name: '66.6-skill-has-loaded-at',
      timeout: 5000,
      fn: async () => {
        const { parseSkillFile } = await import('../../src/skills/parser.js');
        const content = `---
name: timed-skill
description: Check loadedAt
---
Content.
`;
        const skill = parseSkillFile(content, '/test.md', 'bundled');
        return {
          pass: skill.loadedAt instanceof Date && skill.enabled === true,
          metadata: { loadedAt: skill.loadedAt.toISOString() },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 67: Skill Registry
// ============================================================================

export function cat67SkillRegistry(): TestDef[] {
  return [
    {
      name: '67.1-instantiation',
      timeout: 5000,
      fn: async () => {
        const { SkillRegistry } = await import('../../src/skills/registry.js');
        const registry = new SkillRegistry({ watchEnabled: false, cacheEnabled: false });
        return { pass: registry !== undefined };
      },
    },
    {
      name: '67.2-get-nonexistent-skill',
      timeout: 5000,
      fn: async () => {
        const { SkillRegistry } = await import('../../src/skills/registry.js');
        const registry = new SkillRegistry({ watchEnabled: false });
        const skill = registry.get('nonexistent-skill');
        return { pass: skill === undefined };
      },
    },
    {
      name: '67.3-list-before-load',
      timeout: 5000,
      fn: async () => {
        const { SkillRegistry } = await import('../../src/skills/registry.js');
        const registry = new SkillRegistry({ watchEnabled: false });
        const all = registry.list();
        return {
          pass: all.length === 0,
          metadata: { count: all.length },
        };
      },
    },
    {
      name: '67.4-has-search-method',
      timeout: 5000,
      fn: async () => {
        const { SkillRegistry } = await import('../../src/skills/registry.js');
        const registry = new SkillRegistry({ watchEnabled: false });
        const hasSearch = typeof registry.search === 'function';
        const hasGet = typeof registry.get === 'function';
        const hasList = typeof registry.list === 'function';
        return {
          pass: hasSearch && hasGet && hasList,
          metadata: { hasSearch, hasGet, hasList },
        };
      },
    },
    {
      name: '67.5-count-and-tags',
      timeout: 5000,
      fn: async () => {
        const { SkillRegistry } = await import('../../src/skills/registry.js');
        const registry = new SkillRegistry({ watchEnabled: false, cacheEnabled: false });
        const count = registry.count;
        const tags = registry.getTags();
        return {
          pass: count === 0 && Array.isArray(tags),
          metadata: { count, tagCount: tags.length },
        };
      },
    },
    {
      name: '67.6-event-emitter',
      timeout: 5000,
      fn: async () => {
        const { SkillRegistry } = await import('../../src/skills/registry.js');
        const registry = new SkillRegistry({ watchEnabled: false });
        let reloaded = false;
        registry.on('registry:reloaded', () => { reloaded = true; });
        // The event fires on load()
        return {
          pass: typeof registry.on === 'function',
          metadata: { isEmitter: true },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 68: Auto-Sandbox Router
// ============================================================================

export function cat68AutoSandbox(): TestDef[] {
  return [
    {
      name: '68.1-instantiation',
      timeout: 5000,
      fn: async () => {
        const { AutoSandboxRouter } = await import('../../src/sandbox/auto-sandbox.js');
        const router = new AutoSandboxRouter({ enabled: true });
        return { pass: router !== undefined };
      },
    },
    {
      name: '68.2-disabled-never-sandboxes',
      timeout: 5000,
      fn: async () => {
        const { AutoSandboxRouter } = await import('../../src/sandbox/auto-sandbox.js');
        const router = new AutoSandboxRouter({ enabled: false });
        const result = router.shouldSandbox('rm -rf /');
        return {
          pass: result.sandbox === false,
          metadata: { reason: result.reason },
        };
      },
    },
    {
      name: '68.3-safe-commands-not-sandboxed',
      timeout: 5000,
      fn: async () => {
        const { AutoSandboxRouter } = await import('../../src/sandbox/auto-sandbox.js');
        const router = new AutoSandboxRouter({ enabled: true });
        const safeCommands = ['ls -la', 'cat file.txt', 'git status', 'echo hello'];
        const results = safeCommands.map(cmd => ({
          cmd,
          result: router.shouldSandbox(cmd),
        }));
        const allSafe = results.every(r => r.result.sandbox === false);
        return {
          pass: allSafe,
          metadata: { results: results.map(r => ({ cmd: r.cmd, sandbox: r.result.sandbox })) },
        };
      },
    },
    {
      name: '68.4-npm-always-sandboxed',
      timeout: 5000,
      fn: async () => {
        const { AutoSandboxRouter } = await import('../../src/sandbox/auto-sandbox.js');
        const router = new AutoSandboxRouter({ enabled: true });
        const result = router.shouldSandbox('npm install express');
        return {
          pass: result.sandbox === true,
          metadata: { reason: result.reason },
        };
      },
    },
    {
      name: '68.5-never-sandbox-override',
      timeout: 5000,
      fn: async () => {
        const { AutoSandboxRouter } = await import('../../src/sandbox/auto-sandbox.js');
        const router = new AutoSandboxRouter({
          enabled: true,
          neverSandbox: new Set(['npm']),
        });
        const result = router.shouldSandbox('npm install');
        return {
          pass: result.sandbox === false,
          metadata: { reason: result.reason },
        };
      },
    },
    {
      name: '68.6-custom-always-sandbox',
      timeout: 5000,
      fn: async () => {
        const { AutoSandboxRouter } = await import('../../src/sandbox/auto-sandbox.js');
        const router = new AutoSandboxRouter({
          enabled: true,
          alwaysSandbox: new Set(['my-dangerous-cmd']),
        });
        const result = router.shouldSandbox('my-dangerous-cmd --flag');
        return {
          pass: result.sandbox === true,
          metadata: { reason: result.reason },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 69: Confirmation Service
// ============================================================================

export function cat69ConfirmationService(): TestDef[] {
  return [
    {
      name: '69.1-singleton-instance',
      timeout: 5000,
      fn: async () => {
        const { ConfirmationService } = await import('../../src/utils/confirmation-service.js');
        const inst1 = ConfirmationService.getInstance();
        const inst2 = ConfirmationService.getInstance();
        return { pass: inst1 === inst2 };
      },
    },
    {
      name: '69.2-session-flags',
      timeout: 5000,
      fn: async () => {
        const { ConfirmationService } = await import('../../src/utils/confirmation-service.js');
        const svc = ConfirmationService.getInstance();
        svc.setSessionFlag('bashCommands', true);
        const flags = svc.getSessionFlags();
        svc.setSessionFlag('bashCommands', false);
        return {
          pass: flags.bashCommands === true,
          metadata: { flags },
        };
      },
    },
    {
      name: '69.3-event-emitter',
      timeout: 5000,
      fn: async () => {
        const { ConfirmationService } = await import('../../src/utils/confirmation-service.js');
        const svc = ConfirmationService.getInstance();
        return {
          pass: typeof svc.on === 'function' && typeof svc.emit === 'function',
        };
      },
    },
    {
      name: '69.4-request-confirmation-method',
      timeout: 5000,
      fn: async () => {
        const { ConfirmationService } = await import('../../src/utils/confirmation-service.js');
        const svc = ConfirmationService.getInstance();
        return {
          pass: typeof svc.requestConfirmation === 'function',
        };
      },
    },
    {
      name: '69.5-session-flags-shape',
      timeout: 5000,
      fn: async () => {
        const { ConfirmationService } = await import('../../src/utils/confirmation-service.js');
        const svc = ConfirmationService.getInstance();
        const flags = svc.getSessionFlags();
        return {
          pass: 'fileOperations' in flags && 'bashCommands' in flags && 'allOperations' in flags,
          metadata: { keys: Object.keys(flags) },
        };
      },
    },
  ];
}
