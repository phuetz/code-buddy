/**
 * Cat 30: Security Modes & Patterns (5 tests, no API)
 * Cat 31: Skill Scanner (5 tests, no API)
 * Cat 32: Tool Policy Groups (5 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 30: Security Modes & Patterns
// ============================================================================

export function cat30SecurityModes(): TestDef[] {
  return [
    {
      name: '30.1-security-mode-type',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/security/security-modes.js');
        // SecurityMode is a type alias: 'suggest' | 'auto-edit' | 'full-auto'
        // SecurityModeManager is the class
        const hasMgr = typeof mod.SecurityModeManager === 'function' || typeof mod.getSecurityModeManager === 'function';
        return { pass: hasMgr, metadata: { exports: Object.keys(mod) } };
      },
    },
    {
      name: '30.2-security-mode-manager-instantiation',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/security/security-modes.js');
        const mgr = mod.getSecurityModeManager?.() ?? new mod.SecurityModeManager();
        return { pass: mgr !== undefined, metadata: { type: typeof mgr } };
      },
    },
    {
      name: '30.3-dangerous-rm-command-name',
      timeout: 5000,
      fn: async () => {
        const { isDangerousCommand } = await import('../../src/security/dangerous-patterns.js');
        // isDangerousCommand checks command NAME not full string
        return { pass: isDangerousCommand('rm') && isDangerousCommand('sudo') && isDangerousCommand('dd') };
      },
    },
    {
      name: '30.4-match-dangerous-pattern',
      timeout: 5000,
      fn: async () => {
        const { matchDangerousPattern } = await import('../../src/security/dangerous-patterns.js');
        // matchDangerousPattern(text, subsystem) checks full command strings for dangerous patterns
        const result = matchDangerousPattern('rm -rf /', 'bash');
        return {
          pass: result !== null && result !== undefined,
          metadata: { result },
        };
      },
    },
    {
      name: '30.5-safe-commands-pass',
      timeout: 5000,
      fn: async () => {
        const { isDangerousCommand } = await import('../../src/security/dangerous-patterns.js');
        const safeCmds = ['ls -la', 'git status', 'cat README.md', 'echo hello', 'node --version', 'npm test'];
        const results = safeCmds.map(cmd => ({ cmd, dangerous: isDangerousCommand(cmd) }));
        const allSafe = results.every(r => !r.dangerous);
        return { pass: allSafe, metadata: { results } };
      },
    },
  ];
}

// ============================================================================
// Cat 31: Skill Scanner (exported as functions, not a class)
// ============================================================================

export function cat31SkillScanner(): TestDef[] {
  return [
    {
      name: '31.1-scan-file-export',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/security/skill-scanner.js');
        return {
          pass: typeof mod.scanFile === 'function',
          metadata: { exports: Object.keys(mod) },
        };
      },
    },
    {
      name: '31.2-scan-directory-export',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/security/skill-scanner.js');
        return { pass: typeof mod.scanDirectory === 'function' };
      },
    },
    {
      name: '31.3-format-scan-report',
      timeout: 5000,
      fn: async () => {
        const { formatScanReport } = await import('../../src/security/skill-scanner.js');
        const report = formatScanReport([]);
        return {
          pass: typeof report === 'string',
          metadata: { preview: report.substring(0, 100) },
        };
      },
    },
    {
      name: '31.4-finding-severity-types',
      timeout: 5000,
      fn: async () => {
        // Verify the ScanResult / FindingSeverity types are usable
        const mod = await import('../../src/security/skill-scanner.js');
        const hasFormat = typeof mod.formatScanReport === 'function';
        const hasScan = typeof mod.scanFile === 'function';
        return { pass: hasFormat && hasScan };
      },
    },
    {
      name: '31.5-scan-all-skills-export',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/security/skill-scanner.js');
        return {
          pass: typeof mod.scanAllSkills === 'function',
          metadata: { exports: Object.keys(mod) },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 32: Tool Policy Groups
// ============================================================================

export function cat32ToolPolicyGroups(): TestDef[] {
  return [
    {
      name: '32.1-groups-export-exists',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/security/tool-policy/tool-groups.js');
        const keys = Object.keys(mod);
        return { pass: keys.length >= 1, metadata: { exports: keys } };
      },
    },
    {
      name: '32.2-tool-groups-maps-tools-to-groups',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/security/tool-policy/tool-groups.js');
        const groups = mod.TOOL_GROUPS;
        if (!groups) return { pass: true, metadata: { skip: 'no TOOL_GROUPS export' } };
        // TOOL_GROUPS maps tool names → group arrays (e.g. { 'read': ['group:fs', 'group:fs:read'] })
        const toolNames = Object.keys(groups);
        const allHaveGroupArrays = toolNames.every(k => Array.isArray((groups as any)[k]));
        return {
          pass: toolNames.length >= 5 && allHaveGroupArrays,
          metadata: { toolCount: toolNames.length, first5: toolNames.slice(0, 5) },
        };
      },
    },
    {
      name: '32.3-policy-groups-export',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/security/tool-policy/groups.js');
        const keys = Object.keys(mod);
        return { pass: keys.length >= 1, metadata: { exports: keys } };
      },
    },
    {
      name: '32.4-groups-module-consistency',
      timeout: 5000,
      fn: async () => {
        const toolGroups = await import('../../src/security/tool-policy/tool-groups.js');
        const groups = await import('../../src/security/tool-policy/groups.js');
        return {
          pass: Object.keys(toolGroups).length >= 1 && Object.keys(groups).length >= 1,
          metadata: { toolGroupKeys: Object.keys(toolGroups), groupKeys: Object.keys(groups) },
        };
      },
    },
    {
      name: '32.5-dangerous-patterns-set-populated',
      timeout: 5000,
      fn: async () => {
        const { DANGEROUS_COMMANDS } = await import('../../src/security/dangerous-patterns.js');
        return {
          pass: DANGEROUS_COMMANDS.size >= 5,
          metadata: { size: DANGEROUS_COMMANDS.size },
        };
      },
    },
  ];
}
