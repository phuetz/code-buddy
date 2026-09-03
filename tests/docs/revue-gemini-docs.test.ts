import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { resolveParakeetModelDir } from '../../src/sensory/speech-engine-config.js';
import { resolveResidentVoicePermissionMode } from '../../src/sensory/voice-loop.js';
import { resolveOrGenerate } from '../../src/widgets/widget-engine.js';
import { assistantSettings } from '../../src/companion/assistant-config.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const distIndex = path.join(repoRoot, 'dist', 'index.js');

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

describe('Revue Gemini — Preuves ROUGES des divergences de documentation', () => {
  describe('1. Valeurs par défaut CLI vs Documentation', () => {
    it('CLAUDE.md:50 et docs/getting-started.md:298 promettent un défaut de 50 tool calls (400 en YOLO)', () => {
      // Documentation claim: "Tool calls (max 50, YOLO 400)" / "up to 50, or 400 in YOLO mode"
      // Reality in src/index.ts:1373: --max-tool-rounds <rounds> defaults to "400"
      const res = runCli(['--help']);
      expect(res.exitCode).toBe(0);
      // Ce test ROUGE échoue car le CLI affiche (default: "400") et non (default: "50")
      expect(res.stdout).toMatch(/--max-tool-rounds <rounds>\s+maximum number of tool execution rounds \(default: "?50"?\)/);
    });

    it('CLAUDE.md:265 promet que le mode par défaut de CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE est plan', () => {
      // Documentation claim: "Voice ACT posture: plan (default, read-only)"
      // Reality in src/sensory/voice-loop.ts:429 & assistant-config.ts:253: default is 'default', not 'plan'
      const mode = resolveResidentVoicePermissionMode({});
      // Ce test ROUGE échoue car le code renvoie 'default' (plan est obsolète)
      expect(mode).toBe('plan');
    });

    it('CLAUDE.md:271 promet que CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS a une valeur par défaut de 30000 ms', () => {
      // Documentation claim: "Post-reply window (default 30000)"
      // Reality in src/companion/assistant-config.ts:436 & src/sensory/respond-decider.ts:511: default is 120000 ms
      const setting = assistantSettings.find((s) => s.key === 'CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS');
      expect(setting).toBeDefined();
      // Ce test ROUGE échoue car la valeur par défaut réelle est "120000" et non "30000"
      expect(setting?.default).toBe('30000');
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

    it('docs/cb2/README.md:19 promet la variable CODEBUDDY_WIDGETS_AUTOGEN pour autoriser la génération', async () => {
      // Documentation claim: "CODEBUDDY_WIDGETS_AUTOGEN | off | Autorise la génération LLM d'un nouveau template"
      // Reality in src/widgets/widget-engine.ts:163: widget-engine only checks CODEBUDDY_WIDGETS === 'true'
      const result = await resolveOrGenerate({ kind: 'custom_chart', value: 42 }, {
        env: { CODEBUDDY_WIDGETS_AUTOGEN: 'true' } as NodeJS.ProcessEnv,
      });
      // Ce test ROUGE échoue car CODEBUDDY_WIDGETS_AUTOGEN n'est jamais lu par le moteur, qui renvoie null
      expect(result).not.toBeNull();
    });
  });

  describe('3. Commandes CLI promises dans la documentation mais absentes du binaire', () => {
    it('docs/fleet-guide.md:850 et hermes-openclaw-parity.md:134 promettent buddy fleet tasks add', () => {
      // Documentation claim: "buddy fleet tasks add <title> --goal-mode"
      // Reality: tasks is a subcommand of buddy autonomy / colab, NOT buddy fleet
      const res = runCli(['fleet', 'tasks', 'add', 'demo task']);
      // Ce test ROUGE échoue car Commander renvoie "error: unknown command 'tasks'" (exitCode 1)
      expect(res.exitCode).toBe(0);
    });

    it('CLAUDE.md:334 promet buddy nodes reject', () => {
      // Documentation claim: "buddy nodes list|status|approve|reject"
      // Reality: subcommands are list, pair, approve, describe, remove, invoke, pending (no reject)
      const res = runCli(['nodes', 'reject', 'node-123']);
      // Ce test ROUGE échoue car Commander renvoie "error: unknown command 'reject'" (exitCode 1)
      expect(res.exitCode).toBe(0);
    });

    it('CLAUDE.md:333 promet buddy todo complete', () => {
      // Documentation claim: "buddy todo [list|add|complete]"
      // Reality in src/commands/todo.ts: the subcommand is "done", not "complete"
      const res = runCli(['todo', 'complete', '1']);
      // Ce test ROUGE échoue car Commander renvoie "error: unknown command 'complete'" (exitCode 1)
      expect(res.exitCode).toBe(0);
    });

    it('CLAUDE.md:335 promet buddy secrets delete', () => {
      // Documentation claim: "buddy secrets list|set|delete"
      // Reality in src/commands/cli/secrets-command.ts: the subcommand is "remove", not "delete"
      const res = runCli(['secrets', 'delete', 'TEST_KEY']);
      // Ce test ROUGE échoue car Commander renvoie "error: unknown command 'delete'" (exitCode 1)
      expect(res.exitCode).toBe(0);
    });

    it('CLAUDE.md:336 promet buddy approvals revoke', () => {
      // Documentation claim: "buddy approvals list|revoke|grant"
      // Reality in src/commands/approvals.ts: subcommands are list, approve, deny, policy (no revoke)
      const res = runCli(['approvals', 'revoke', 'appr-123']);
      // Ce test ROUGE échoue car Commander renvoie "error: unknown command 'revoke'" (exitCode 1)
      expect(res.exitCode).toBe(0);
    });

    it('CLAUDE.md:343 promet buddy tunnel stop', () => {
      // Documentation claim: "buddy tunnel [start|stop|status]"
      // Reality in src/index.ts: only "start" exists
      const res = runCli(['tunnel', 'stop']);
      // Ce test ROUGE échoue car Commander renvoie "error: unknown command 'stop'" (exitCode 1)
      expect(res.exitCode).toBe(0);
    });

    it('CLAUDE.md:345 promet buddy completions uninstall', () => {
      // Documentation claim: "buddy completions [install|uninstall]"
      // Reality in src/commands/completions.ts: prints "Unsupported shell: uninstall"
      const res = runCli(['completions', 'uninstall']);
      // Ce test ROUGE échoue car la commande refuse "uninstall"
      expect(res.stdout).not.toContain('Unsupported shell: uninstall');
    });

    it('CLAUDE.md:344 promet buddy lsp start', () => {
      // Documentation claim: "buddy lsp [start|status|stop]"
      // Reality in src/index.ts: only "status" and "diagnostics" exist
      const res = runCli(['lsp', 'start']);
      // Ce test ROUGE échoue car Commander renvoie "error: unknown command 'start'" (exitCode 1)
      expect(res.exitCode).toBe(0);
    });

    it('CLAUDE.md:345 promet buddy deploy preview', () => {
      // Documentation claim: "buddy deploy [init|preview|apply]"
      // Reality in src/index.ts: only "platforms", "init", "nix" exist
      const res = runCli(['deploy', 'preview']);
      // Ce test ROUGE échoue car Commander renvoie "error: unknown command 'preview'" (exitCode 1)
      expect(res.exitCode).toBe(0);
    });

    it('CLAUDE.md:333 promet buddy execpolicy clear', () => {
      // Documentation claim: "buddy execpolicy [check|list|clear]"
      // Reality in src/commands/execpolicy.ts: no "clear" subcommand
      const res = runCli(['execpolicy', 'clear']);
      // Ce test ROUGE échoue car Commander renvoie "error: unknown command 'clear'" (exitCode 1)
      expect(res.exitCode).toBe(0);
    });
  });
});
