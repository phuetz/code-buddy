import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { resolveParakeetModelDir } from '../../src/sensory/speech-engine-config.js';
import { resolveResidentVoicePermissionMode } from '../../src/sensory/voice-loop.js';
import { resolveOrGenerate } from '../../src/widgets/widget-engine.js';
import { ASSISTANT_SETTINGS } from '../../src/companion/assistant-config.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const distIndex = path.join(repoRoot, 'dist', 'index.js');

function readRepoFile(...segments: string[]): string {
  return readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [distIndex, ...args], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: execError.stdout ?? '',
      stderr: execError.stderr ?? '',
      exitCode: execError.status ?? 1,
    };
  }
}

describe('DOC1 — concordance entre la documentation et les contrats exécutables', () => {
  describe('1. Valeurs par défaut CLI vs Documentation', () => {
    it('CLAUDE.md:50 et docs/getting-started.md:298 promettent un défaut de 50 tool calls (400 en YOLO)', () => {
      // Documentation claim: "Tool calls (max 50, YOLO 400)" / "up to 50, or 400 in YOLO mode"
      // Reality in src/index.ts:1373: --max-tool-rounds <rounds> defaults to "400"
      const res = runCli(['--help']);
      expect(res.exitCode).toBe(0);
      // Ce test ROUGE échoue car le CLI affiche (default: "400") et non (default: "50")
      expect(res.stdout).toMatch(/--max-tool-rounds <rounds>\s+maximum number of tool execution rounds \(default: "?50"?\)/);
    });

    it('documente le mode résident default et sa migration depuis plan', () => {
      const mode = resolveResidentVoicePermissionMode({});
      const claude = readRepoFile('CLAUDE.md');
      expect(mode).toBe('default');
      expect(claude).toMatch(/SENSORY_SPEAK_PERMISSION_MODE[^\n]+`default` \(\*\*default\*\*/);
      expect(claude).toContain('legacy resident value of `plan` is migrated to `default`');
    });

    it('documente la fenêtre d’attention réelle de 120000 ms', () => {
      const setting = ASSISTANT_SETTINGS.find((s) => s.key === 'CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS');
      expect(setting).toBeDefined();
      expect(setting?.default).toBe('120000');
      expect(readRepoFile('CLAUDE.md')).toMatch(/SENSORY_ENGAGE_WINDOW_MS[^\n]+default 120000/);
    });

    it('précise que YOLO doit être armé explicitement', () => {
      const claude = readRepoFile('CLAUDE.md');
      expect(claude).toContain('Arm YOLO explicitly with `buddy --yolo` or `/yolo on`');
      expect(claude).toContain('setting `YOLO_MODE=true` alone only emits a warning');
    });

    it('nomme sans abréviation la variable du plancher compagnon', () => {
      const claude = readRepoFile('CLAUDE.md');
      expect(claude).toMatch(/`CODEBUDDY_COMPANION_PROACTIVE` \/ `CODEBUDDY_COMPANION_MIN_GAP_MS`/);
      expect(readRepoFile('src', 'companion', 'orchestrator.ts')).toContain(
        'process.env.CODEBUDDY_COMPANION_MIN_GAP_MS'
      );
    });
  });

  describe('2. Variables d\'environnement inexistantes ou ignorées', () => {
    it('CLAUDE.md:257 promet que BUDDY_SENSE_STT_MODEL_DIR surcharge le dossier du modèle Parakeet', () => {
      // Documentation claim: "Override the buddy-sense stt binary path ..., the Parakeet model dir (BUDDY_SENSE_STT_MODEL_DIR)"
      // Reality in src/sensory/speech-engine-config.ts:108-114: it ONLY reads CODEBUDDY_PARAKEET_MODEL_DIR / CODEBUDDY_SHERPA_ONNX_MODEL_DIR
      const originalEnv = process.env.BUDDY_SENSE_STT_MODEL_DIR;
      try {
        process.env.BUDDY_SENSE_STT_MODEL_DIR = '/opt/custom/parakeet-model';
        delete process.env.CODEBUDDY_PARAKEET_MODEL_DIR;
        delete process.env.CODEBUDDY_SHERPA_ONNX_MODEL_DIR;

        const resolved = resolveParakeetModelDir();
        // Ce test ROUGE échoue car la fonction ignore BUDDY_SENSE_STT_MODEL_DIR et renvoie le chemin par défaut
        expect(resolved).toBe('/opt/custom/parakeet-model');
      } finally {
        if (originalEnv !== undefined) {
          process.env.BUDDY_SENSE_STT_MODEL_DIR = originalEnv;
        } else {
          delete process.env.BUDDY_SENSE_STT_MODEL_DIR;
        }
      }
    });

    it('retire la variable fantôme WIDGETS_AUTOGEN du contrat courant', async () => {
      const index = readRepoFile('docs', 'cb2', 'README.md');
      const guide = readRepoFile('docs', 'cb2', 'generative-ui.md');
      expect(index).not.toContain('CODEBUDDY_WIDGETS_AUTOGEN');
      expect(guide).not.toContain('CODEBUDDY_WIDGETS_AUTOGEN');
      expect(guide).toContain('Le chemin automatique n’appelle aucun LLM');
      expect(guide).toContain('buddy widgets gen <kind>');

      const result = await resolveOrGenerate({ kind: 'custom_chart', value: 42 }, {
        env: { CODEBUDDY_WIDGETS_AUTOGEN: 'true' } as NodeJS.ProcessEnv,
      });
      expect(result).toBeNull();
    });
  });

  describe('3. Commandes CLI documentées et réellement exposées', () => {
    it('route les tâches goal-mode par buddy autonomy plutôt que buddy fleet', () => {
      const fleetGuide = readRepoFile('docs', 'fleet-guide.md');
      const parity = readRepoFile('docs', 'hermes-openclaw-parity.md');
      expect(fleetGuide).toContain('buddy autonomy tasks add "<title>" --goal-mode');
      expect(parity).toContain('buddy autonomy tasks add --goal-mode');
      expect(fleetGuide).not.toContain('buddy fleet tasks add');
      expect(parity).not.toContain('buddy fleet tasks add');

      const res = runCli(['autonomy', 'tasks', 'add', '--help']);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('--goal-mode');
    });

    it('confirme les sous-commandes nodes et dément la promesse reject attribuée à CLAUDE.md', () => {
      expect(readRepoFile('CLAUDE.md')).not.toContain('buddy nodes list|status|approve|reject');
      const res = runCli(['nodes', '--help']);
      expect(res.exitCode).toBe(0);
      for (const command of ['list', 'pair', 'approve', 'describe', 'remove', 'invoke', 'pending']) {
        expect(res.stdout).toContain(command);
      }
      expect(res.stdout).not.toContain('reject');
    });

    it('confirme todo done et dément la promesse complete attribuée à CLAUDE.md', () => {
      expect(readRepoFile('CLAUDE.md')).not.toContain('buddy todo [list|add|complete]');
      const res = runCli(['todo', '--help']);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('done <id>');
      expect(res.stdout).not.toContain('complete <id>');
    });

    it('confirme secrets remove et dément la promesse delete attribuée à CLAUDE.md', () => {
      expect(readRepoFile('CLAUDE.md')).not.toContain('buddy secrets list|set|delete');
      const res = runCli(['secrets', '--help']);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('remove <name>');
      expect(res.stdout).not.toContain('delete <name>');
    });

    it('confirme approvals approve/deny/policy et dément revoke/grant dans CLAUDE.md', () => {
      expect(readRepoFile('CLAUDE.md')).not.toContain('buddy approvals list|revoke|grant');
      const res = runCli(['approvals', '--help']);
      expect(res.exitCode).toBe(0);
      for (const command of ['approve <id>', 'deny <id>', 'policy [action] [mode]']) {
        expect(res.stdout).toContain(command);
      }
      expect(res.stdout).not.toMatch(/\b(revoke|grant)\b/);
    });

    it('confirme que tunnel expose seulement start', () => {
      expect(readRepoFile('CLAUDE.md')).not.toContain('buddy tunnel [start|stop|status]');
      const res = runCli(['tunnel', '--help']);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('start [options]');
      expect(res.stdout).not.toMatch(/^\s+(stop|status)\b/m);
    });

    it('confirme les shells de completions sans promettre uninstall', () => {
      expect(readRepoFile('CLAUDE.md')).not.toContain('buddy completions [install|uninstall]');
      const res = runCli(['completions', '--help']);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Generate or install shell completion scripts');
      expect(res.stdout).not.toContain('uninstall');
    });

    it('confirme lsp status et diagnostics sans start/stop', () => {
      expect(readRepoFile('CLAUDE.md')).not.toContain('buddy lsp [start|status|stop]');
      const res = runCli(['lsp', '--help']);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('status [options]');
      expect(res.stdout).toContain('diagnostics [options] <file>');
      expect(res.stdout).not.toMatch(/^\s+(start|stop)\b/m);
    });

    it('confirme deploy platforms/init/nix sans preview/apply', () => {
      expect(readRepoFile('CLAUDE.md')).not.toContain('buddy deploy [init|preview|apply]');
      const res = runCli(['deploy', '--help']);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('platforms');
      expect(res.stdout).toContain('init [options] <platform>');
      expect(res.stdout).toContain('nix [options]');
      expect(res.stdout).not.toMatch(/^\s+(preview|apply)\b/m);
    });

    it('confirme les commandes execpolicy sans clear', () => {
      expect(readRepoFile('CLAUDE.md')).not.toContain('buddy execpolicy [check|list|clear]');
      const res = runCli(['execpolicy', '--help']);
      expect(res.exitCode).toBe(0);
      for (const command of ['check', 'check-argv', 'list', 'list-prefix', 'add-prefix', 'show-dangerous', 'dashboard']) {
        expect(res.stdout).toContain(command);
      }
      expect(res.stdout).not.toMatch(/^\s+clear\b/m);
    });

    it('documente correctement buddy import', () => {
      const guide = readRepoFile('docs', 'getting-started.md');
      expect(guide).toContain('Import project rules and MCP servers from Cursor, Cline, Copilot, or Claude Code');
      expect(guide).not.toMatch(/`buddy import`[^\n]+(?:memory|history)/i);
      const res = runCli(['import', '--help']);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('règles et serveurs MCP');
    });

    it('documente buddy explain comme analyse de dépôt', () => {
      const guide = readRepoFile('docs', 'getting-started.md');
      expect(guide).toMatch(/`buddy explain`[^\n]+repository explanation report/);
      const res = runCli(['explain', '--help']);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Dossier du dépôt à analyser');
    });

    it('documente buddy dev explain sans argument fichier', () => {
      const guide = readRepoFile('docs', 'getting-started.md');
      expect(guide).toMatch(/`buddy dev explain`[^\n]+Summarise repository conventions/);
      expect(guide).not.toContain('buddy dev explain <file>');
      const res = runCli(['dev', 'explain', '--help']);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Usage: buddy dev explain [options]');
    });

    it('confirme que proxy et desktop sont des commandes directes avec options', () => {
      const proxy = runCli(['proxy', '--help']);
      const desktop = runCli(['desktop', '--help']);
      expect(proxy.exitCode).toBe(0);
      expect(desktop.exitCode).toBe(0);
      expect(proxy.stdout).toContain('Usage: buddy proxy [options]');
      expect(proxy.stdout).not.toContain('Commands:');
      expect(desktop.stdout).toContain("Alias for 'buddy gui'");
      expect(desktop.stdout).not.toContain('Commands:');
      expect(readRepoFile('CLAUDE.md')).not.toMatch(/buddy (?:proxy|desktop) \[(?:start|stop|status|logs|install)/);
    });

    it('confirme cloud submit/status/list/cancel/logs/delete', () => {
      expect(readRepoFile('CLAUDE.md')).not.toContain('buddy cloud [status|sync]');
      const handler = readRepoFile('src', 'commands', 'handlers', 'cloud-handlers.ts');
      for (const command of ['submit', 'status', 'list', 'cancel', 'logs', 'delete']) {
        expect(handler).toContain(`case '${command}':`);
      }
      expect(handler).not.toContain("case 'sync':");
    });

    it('confirme bundles list/create/show/remove', () => {
      expect(readRepoFile('CLAUDE.md')).not.toContain('buddy bundles list|pack|unpack|verify');
      const res = runCli(['bundles', '--help']);
      expect(res.exitCode).toBe(0);
      for (const command of ['list [options]', 'create [options]', 'show [options]', 'remove [options]']) {
        expect(res.stdout).toContain(command);
      }
      expect(res.stdout).not.toMatch(/^\s+(pack|unpack|verify)\b/m);
    });
  });
});
