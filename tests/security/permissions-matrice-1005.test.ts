/**
 * CB-PERMISSIONS-MATRICE-1005 — matrice modes × écriture/exé/réseau
 * + contournements mode plan (alias, apply_patch, MCP, sous-agents, /batch).
 *
 * Attendu doc (04-permissions-and-sandbox + plan lecture seule) :
 * - plan = lecture seule, aucune écriture / exécution mutante / MCP write
 * - sous-agents et /batch n'escaladent pas au-delà du parent en plan
 * - alias d'outils d'écriture restent bloqués
 * - allowlist de motifs ne contourne pas plan pour une action mutante
 * - /plan (OperatingMode) aligne PermissionModeManager sur plan
 * - ≥100 binaires de lecture sûrs restent non bloqués en plan
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PermissionModeManager,
  getPermissionModeManager,
  resetPermissionModeManager,
  type PermissionMode,
} from '../../src/security/permission-modes.js';
import { TOOL_ALIASES } from '../../src/tools/registry/tool-alias-map.js';
import { SAFE_BINARIES, SafeBinariesChecker } from '../../src/security/safe-binaries.js';
import {
  getOperatingModeManager,
  resetOperatingModeManager,
} from '../../src/agent/operating-modes.js';
import { handleChangeMode } from '../../src/commands/handlers/missing-handlers.js';

const MODES: PermissionMode[] = [
  'default',
  'plan',
  'acceptEdits',
  'dontAsk',
  'bypassPermissions',
];

const WRITE_TOOLS = [
  'create_file',
  'write_file',
  'file_write',
  'edit_file',
  'str_replace_editor',
  'apply_patch',
  'patch',
  'multi_edit',
  'edit',
] as const;

const EXEC_TOOLS = ['bash', 'terminal', 'shell_exec', 'delete_file', 'rm'] as const;

const NETWORK_TOOLS = [
  'web_search',
  'web_fetch',
  'browser_search',
  'browser_fetch',
  'web_scrape',
] as const;

const MCP_WRITE = 'mcp__fs__write_file';
const MCP_READ = 'mcp__docs__search';

describe('CB-PERMISSIONS-MATRICE-1005', () => {
  beforeEach(() => {
    resetPermissionModeManager();
    resetOperatingModeManager();
    SafeBinariesChecker.resetInstance();
  });

  afterEach(() => {
    resetPermissionModeManager();
    resetOperatingModeManager();
    SafeBinariesChecker.resetInstance();
  });

  describe('matrice modes × catégories (PermissionModeManager)', () => {
    it('documente allowed/prompted pour écriture / exécution / réseau', () => {
      const matrix: Array<Record<string, unknown>> = [];
      for (const mode of MODES) {
        const m = new PermissionModeManager({ mode });
        for (const tool of WRITE_TOOLS) {
          const d = m.checkPermission('execute', tool);
          matrix.push({ mode, cat: 'write', tool, ...d });
        }
        for (const tool of EXEC_TOOLS) {
          const action = tool === 'bash' || tool === 'terminal' || tool === 'shell_exec'
            ? 'npm test'
            : 'execute';
          const d = m.checkPermission(action, tool);
          matrix.push({ mode, cat: 'exec', tool, ...d });
        }
        for (const tool of NETWORK_TOOLS) {
          const d = m.checkPermission('execute', tool);
          matrix.push({ mode, cat: 'network', tool, ...d });
        }
        matrix.push({ mode, cat: 'mcp_write', tool: MCP_WRITE, ...m.checkPermission('execute', MCP_WRITE) });
        matrix.push({ mode, cat: 'mcp_read', tool: MCP_READ, ...m.checkPermission('execute', MCP_READ) });
      }

      // plan : aucune écriture / exécution mutante / MCP write
      for (const row of matrix.filter((r) => r.mode === 'plan' && (r.cat === 'write' || r.cat === 'mcp_write'))) {
        expect(row.allowed, JSON.stringify(row)).toBe(false);
      }
      for (const row of matrix.filter((r) => r.mode === 'plan' && r.cat === 'exec')) {
        expect(row.allowed, JSON.stringify(row)).toBe(false);
      }

      // réseau lecture (fleetSafe) autorisé en plan
      for (const row of matrix.filter((r) => r.mode === 'plan' && r.cat === 'network')) {
        expect(row.allowed, JSON.stringify(row)).toBe(true);
        expect(row.prompted).toBe(false);
      }

      // bypass : tout auto
      for (const row of matrix.filter((r) => r.mode === 'bypassPermissions')) {
        expect(row.allowed).toBe(true);
        expect(row.prompted).toBe(false);
      }

      // acceptEdits : écriture auto, bash prompt
      for (const row of matrix.filter((r) => r.mode === 'acceptEdits' && r.cat === 'write')) {
        // aliases normalisés vers edit → auto ; noms non normalisables peuvent prompt
        if (['patch', 'write_file', 'file_write', 'create_file', 'edit_file', 'str_replace_editor', 'apply_patch', 'multi_edit', 'edit'].includes(row.tool as string)) {
          expect(row.allowed).toBe(true);
          expect(row.prompted, JSON.stringify(row)).toBe(false);
        }
      }

      // dontAsk : écriture auto, destructive encore prompt (écart doc « tout » documenté)
      for (const row of matrix.filter((r) => r.mode === 'dontAsk' && r.cat === 'write')) {
        expect(row.allowed).toBe(true);
        expect(row.prompted).toBe(false);
      }
      const dontAskBash = matrix.find((r) => r.mode === 'dontAsk' && r.tool === 'bash');
      expect(dontAskBash?.allowed).toBe(true);
      expect(dontAskBash?.prompted).toBe(true);
    });
  });

  describe('contournements mode plan', () => {
    it('bloque tous les alias d\'écriture en plan', () => {
      const m = new PermissionModeManager({ mode: 'plan' });
      const writeAliases = Object.entries(TOOL_ALIASES).filter(([, canonical]) =>
        ['bash', 'create_file', 'str_replace_editor', 'git'].includes(canonical) ||
        canonical === 'bash',
      );
      // alias → outils d'écriture / shell
      for (const [alias, canonical] of Object.entries(TOOL_ALIASES)) {
        if (['create_file', 'str_replace_editor', 'bash'].includes(canonical)) {
          const d = m.checkPermission(
            canonical === 'bash' ? 'rm -rf /tmp/x' : 'execute',
            alias,
          );
          expect(d.allowed, `alias ${alias}→${canonical}`).toBe(false);
        }
      }
      expect(writeAliases.length).toBeGreaterThan(0);
    });

    it('bloque apply_patch et ses casse variants en plan', () => {
      const m = new PermissionModeManager({ mode: 'plan' });
      for (const t of ['apply_patch', 'ApplyPatch', 'APPLY_PATCH', 'applyPatch']) {
        expect(m.checkPermission('execute', t).allowed, t).toBe(false);
      }
    });

    it('bloque MCP write en plan ; MCP inconnu lecture aussi non classé = refus', () => {
      const m = new PermissionModeManager({ mode: 'plan' });
      expect(m.checkPermission('execute', MCP_WRITE).allowed).toBe(false);
      expect(m.checkPermission('execute', MCP_READ).allowed).toBe(false);
    });

    it('refuse qu\'un motif allowlist autorise une mutation en plan', () => {
      const m = new PermissionModeManager({ mode: 'plan' });
      m.addAllowedPattern('Bash(*)');
      const d = m.checkPermission('Bash(rm -rf /tmp/evil)', 'bash');
      expect(d.allowed).toBe(false);
      expect(String(d.reason).toLowerCase()).toMatch(/plan/);
    });

    it('autorise encore un motif allowlist pour une lecture sûre en plan', () => {
      const m = new PermissionModeManager({ mode: 'plan' });
      m.addAllowedPattern('Bash(git status)');
      const d = m.checkPermission('Bash(git status)', 'bash');
      expect(d.allowed).toBe(true);
      expect(d.prompted).toBe(false);
    });

    it('clamp le mode sous-agent sur plan quand le parent est plan (batch/team)', () => {
      const m = new PermissionModeManager({ mode: 'plan', subagentMode: 'acceptEdits' });
      expect(m.getSubagentMode()).toBe('plan');
      m.setSubagentMode('bypassPermissions');
      expect(m.getSubagentMode()).toBe('plan');
    });

    it('laisse le sous-agent plus permissif si le parent n\'est pas plan', () => {
      const m = new PermissionModeManager({ mode: 'default', subagentMode: 'acceptEdits' });
      expect(m.getSubagentMode()).toBe('acceptEdits');
    });

    it('/plan (OperatingMode) aligne PermissionModeManager sur plan', async () => {
      const pm = getPermissionModeManager();
      expect(pm.getMode()).toBe('default');
      await handleChangeMode(['plan']);
      expect(getOperatingModeManager().getMode()).toBe('plan');
      expect(pm.getMode()).toBe('plan');
    });

    it('quitter /plan restaure une posture non-plan (default)', async () => {
      await handleChangeMode(['plan']);
      expect(getPermissionModeManager().getMode()).toBe('plan');
      await handleChangeMode(['balanced']);
      expect(getOperatingModeManager().getMode()).toBe('balanced');
      expect(getPermissionModeManager().getMode()).not.toBe('plan');
    });

    it('autorise les outils de cycle de vie plan en PermissionMode plan', () => {
      const m = new PermissionModeManager({ mode: 'plan' });
      for (const t of ['submit_plan', 'exit_plan_mode', 'ask_human', 'think', 'mixture_of_agents']) {
        expect(m.checkPermission('execute', t).allowed, t).toBe(true);
      }
    });
  });

  describe('100 commandes dév lecture non bloquées en plan', () => {
    it('SAFE_BINARIES contient au moins 100 entrées', () => {
      expect(SAFE_BINARIES.length).toBeGreaterThanOrEqual(100);
    });

    it('100 expressions lecture sont autorisées via bash en plan', () => {
      const m = new PermissionModeManager({ mode: 'plan' });
      const checker = SafeBinariesChecker.getInstance();
      const versionBins = new Set([
        'node', 'python3', 'python', 'php', 'ruby', 'perl', 'java', 'javac',
        'dotnet', 'bun', 'deno', 'rustc',
      ]);
      const samples: string[] = [];
      for (const bin of SAFE_BINARIES) {
        if (bin.includes('-')) continue; // PowerShell : syntaxe différente
        if (bin === 'git') {
          samples.push('git status');
          samples.push('git log -1');
          samples.push('git rev-parse HEAD');
          continue;
        }
        if (bin === 'find') {
          samples.push('find . -name "*.ts"');
          continue;
        }
        if (bin === 'env') {
          samples.push('env');
          continue;
        }
        if (bin === 'hostname') {
          samples.push('hostname');
          continue;
        }
        if (bin === 'date') {
          samples.push('date');
          continue;
        }
        if (bin === 'sort') {
          samples.push('sort');
          continue;
        }
        if (bin === 'file') {
          samples.push('file package.json');
          continue;
        }
        if (bin === 'go') {
          samples.push('go version');
          samples.push('go env');
          continue;
        }
        if (bin === 'cargo') {
          samples.push('cargo metadata');
          samples.push('cargo version');
          continue;
        }
        if (versionBins.has(bin)) {
          samples.push(`${bin} --version`);
          continue;
        }
        samples.push(bin);
      }
      // Compléter jusqu'à 100 avec chaînes sûres
      const extras = [
        'ls -la', 'pwd', 'cat README.md', 'rg TODO', 'wc -l package.json',
        'git status && git log -1', 'test -f package.json && echo ok',
        'head -n 5 package.json', 'tail -n 5 package.json', 'which node',
      ];
      for (const e of extras) {
        if (samples.length >= 100) break;
        samples.push(e);
      }
      while (samples.length < 100) {
        samples.push(`echo sample-${samples.length}`);
      }
      const first100 = samples.slice(0, 100);
      expect(first100.length).toBe(100);
      for (const cmd of first100) {
        expect(checker.isSafeChain(cmd), `safe? ${cmd}`).toBe(true);
        const d = m.checkPermission(cmd, 'bash');
        expect(d.allowed, `plan allows ${cmd}`).toBe(true);
      }
    });
  });

  describe('headless vs interactif (simulé via prompted)', () => {
    it('default : écriture allowed+prompted (interactif doit confirmer ; headless fail-closed ailleurs)', () => {
      const m = new PermissionModeManager({ mode: 'default' });
      const d = m.checkPermission('execute', 'create_file');
      expect(d.allowed).toBe(true);
      expect(d.prompted).toBe(true);
    });

    it('plan : écriture allowed=false prompted=false (blocage dur, pas de prompt)', () => {
      const m = new PermissionModeManager({ mode: 'plan' });
      const d = m.checkPermission('execute', 'create_file');
      expect(d.allowed).toBe(false);
      expect(d.prompted).toBe(false);
    });

    it('bypassPermissions : écriture allowed sans prompt (headless OK)', () => {
      const m = new PermissionModeManager({ mode: 'bypassPermissions' });
      const d = m.checkPermission('execute', 'create_file');
      expect(d.allowed).toBe(true);
      expect(d.prompted).toBe(false);
    });
  });
});
