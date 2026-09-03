/**
 * buddy loop — boucle de développement autonome (façon Claude Code /loop).
 *
 * Poursuit un objectif de dev par itérations : plan → exécute → VÉRIFIE
 * (Verifier indépendant) → juge → décide continuer/arrêter, jusqu'à ce que ce
 * soit prouvé fait, que le budget (tours ou coût $) soit atteint, ou que la
 * boucle stagne. Surcouche mince sur `runDevLoop` — réutilise le juge, le
 * budget de tours et la décision-ladder de `buddy goal`, en ajoutant le gate
 * Verifier (« done » refusé tant que la vérification indépendante ne CONFIRME
 * pas) et un budget de coût.
 *
 * Usage :
 *   buddy loop "Corrige tous les tests qui échouent dans tests/auth/"
 *   buddy loop "Ship la feature X" --max-turns 10 --budget 2 --no-verify
 *
 * Exit codes : 0 = objectif atteint (vérifié), 1 = pause (budget/juge) ou erreur.
 */

import { Command, InvalidArgumentError } from 'commander';
import * as fs from 'fs';
import { resolveCommandProvider } from './llm-provider-resolution.js';
import { applyRequestedPermissionMode } from './apply-permission-mode.js';
import {
  parsePositiveIntegerOption,
  prepareGoalCliWorkspace,
  resolveGoalCliJudgeModel,
  resolveGoalCliMaxToolRounds,
  resolveLocalGoalActorSystemPrompt,
  shouldUseLocalGoalActorPrompt,
} from './goal-cli.js';
import type { DevLoopResult } from '../agent/dev-loop/dev-loop.js';
import type { GoalJudgeProviderInfo } from '../goals/goal-judge-client.js';

function parsePositiveFloatOption(value: string, optionName: string): number {
  const trimmed = value.trim();
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) {
    throw new InvalidArgumentError(
      `${optionName} must be a positive number (received ${JSON.stringify(trimmed)})`,
    );
  }
  return n;
}

/** Pre-parse numeric guard (mirrors goal's, adds --budget). */
export function validateLoopCommandNumericOptions(argv: readonly string[]): void {
  const intOpts = new Set(['--max-turns', '--max-tool-rounds']);
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--') break;
    if (intOpts.has(arg)) {
      const value = argv[i + 1];
      if (value !== undefined) parsePositiveIntegerOption(value, arg);
      i++;
      continue;
    }
    if (arg === '--budget') {
      const value = argv[i + 1];
      if (value !== undefined) parsePositiveFloatOption(value, arg);
      i++;
      continue;
    }
    const eqIndex = arg.indexOf('=');
    if (eqIndex <= 0) continue;
    const name = arg.slice(0, eqIndex);
    if (intOpts.has(name)) parsePositiveIntegerOption(arg.slice(eqIndex + 1), name);
    else if (name === '--budget') parsePositiveFloatOption(arg.slice(eqIndex + 1), name);
  }
}

/** Exit 0 only when the goal is done AND (no-verify, or independent verifier CONFIRMED). */
export function loopRunSucceeded(
  result: Pick<DevLoopResult, 'status' | 'lastVerifierVerdict'>,
  noVerify: boolean,
): boolean {
  if (result.status !== 'done') return false;
  if (noVerify) return true;
  return result.lastVerifierVerdict === 'CONFIRMED';
}

/**
 * Local Ollama advertises 262k context for qwen3.8* but serving that KV cache
 * stalls the first token past the 120s stream guard — `buddy loop` then
 * vanished with exit 0. Cap unless the operator already set CODEBUDDY_MAX_CONTEXT.
 */
export function applyLocalLoopContextCap(provider: GoalJudgeProviderInfo): void {
  if (process.env.CODEBUDDY_MAX_CONTEXT?.trim()) return;
  if (!shouldUseLocalGoalActorPrompt(provider)) return;
  process.env.CODEBUDDY_MAX_CONTEXT = '32768';
}

function writeLoopLine(text: string): void {
  try {
    fs.writeSync(1, `${text.endsWith('\n') ? text : `${text}\n`}`);
  } catch {
    console.log(text);
  }
}

export function createLoopCommand(): Command {
  return new Command('loop')
    .description(
      'Boucle de dev autonome : plan → exécute → vérifie (Verifier) → juge → décide, jusqu\'à fait (prouvé) ou budget',
    )
    .argument('<goal>', 'L\'objectif de développement à atteindre')
    .option(
      '--max-turns <n>',
      'Budget de tours (défaut 20, ou goals.maxTurns)',
      value => parsePositiveIntegerOption(value, '--max-turns'),
    )
    .option('--budget <usd>', 'Budget coût session en USD (pause si dépassé)', value =>
      parsePositiveFloatOption(value, '--budget'),
    )
    .option('--judge-model <model>', 'Modèle du juge (défaut: modèle de session)')
    .option(
      '--verify-cmd <shell>',
      'Gate de vérif DÉTERMINISTE (exit 0 = CONFIRMED) au lieu du Verifier LLM — ex. "npm test"',
    )
    .option('--no-verify', 'Désactiver le gate Verifier indépendant (boucle juge-seule)')
    .option(
      '--no-structural',
      'Désactiver la couche structurelle zéro-LLM (fichiers vides/conflits/omissions/JSON) avant le Verifier',
    )
    .option('--no-plan', 'Désactiver la décomposition en plan')
    .option('-m, --model <model>', 'Override du modèle agent pour ce run')
    // `--permission-mode` existe sur le programme principal, mais Commander n'accepte une
    // option globale qu'AVANT la sous-commande : `buddy loop … --permission-mode acceptEdits`
    // échouait sur « unknown option », sans dire où la placer. Or c'est précisément sur une
    // boucle autonome qu'on veut préciser la posture, et la forme naturelle est de la mettre
    // après l'objectif. On l'accepte donc ici aussi ; la forme globale continue de marcher.
    .option(
      '--permission-mode <mode>',
      'Posture de permission : default, plan, acceptEdits, dontAsk, bypassPermissions',
    )
    .option(
      '--max-tool-rounds <n>',
      'Max tool rounds par tour',
      value => parsePositiveIntegerOption(value, '--max-tool-rounds'),
      50,
    )
    .action(async (goal: string, options, command) => {
      // Fail closed: a vanished turn (stall, killed child, nested parse) must
      // not inherit Commander's default exit 0.
      process.exitCode = 1;
      let runId: string | undefined;
      try {
        const cwd = await prepareGoalCliWorkspace(command);

        await applyRequestedPermissionMode(
          options,
          command,
          (mode, values) => `Posture de permission inconnue : ${mode}. Valeurs : ${values}`,
        );

        const modelOverride: string | undefined = options.model ?? command?.optsWithGlobals?.()?.model;
        const resolved = resolveCommandProvider({ explicitModel: modelOverride });
        if (!resolved) {
          writeLoopLine(
            'Error: aucun provider — définis une clé API, `buddy onboard`, ou CODEBUDDY_PROVIDER=ollama.',
          );
          process.exit(1);
          return;
        }

        applyLocalLoopContextCap(resolved);

        if (options.judgeModel) process.env.CODEBUDDY_GOAL_JUDGE_MODEL = options.judgeModel;
        const judgeModel = resolveGoalCliJudgeModel(options.judgeModel);
        const maxToolRounds = resolveGoalCliMaxToolRounds(options.maxToolRounds, command);
        process.env.CODEBUDDY_DISABLE_MCP = process.env.CODEBUDDY_DISABLE_MCP ?? 'true';
        process.env.CODEBUDDY_HEADLESS = 'true';
        // Le budget de coût de la boucle pilote aussi le plafond global.
        if (options.budget !== undefined) process.env.MAX_COST = String(options.budget);

        const { CodeBuddyAgent } = await import('../agent/codebuddy-agent.js');
        const { ConfirmationService } = await import('../utils/confirmation-service.js');
        ConfirmationService.getInstance().setSessionFlag('allOperations', true);

        const agent = new CodeBuddyAgent(
          resolved.apiKey,
          resolved.baseURL,
          resolved.model,
          maxToolRounds,
          false,
          undefined,
          cwd,
          undefined,
          resolveLocalGoalActorSystemPrompt(resolved, cwd),
        );
        await agent.systemPromptReady;

        const { RunStore } = await import('../observability/run-store.js');
        const runStore = RunStore.getInstance();
        runId = runStore.startRun(goal, {
          channel: 'terminal',
          tags: ['loop', resolved.model || 'unknown'],
        });
        agent.setRunId(runId);

        const { runDevLoop, makeShellVerifier } = await import('../agent/dev-loop/dev-loop.js');
        // --verify-cmd swaps the LLM Verifier for a deterministic shell gate.
        const verify = options.verifyCmd ? makeShellVerifier(options.verifyCmd, { cwd }) : undefined;
        const noVerify = options.verify === false;
        const result = await runDevLoop(agent, goal, {
          ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
          ...(options.budget !== undefined ? { budgetUsd: options.budget } : {}),
          ...(judgeModel ? { judgeModel } : {}),
          ...(verify ? { verify } : {}),
          noVerify,
          noStructural: options.structural === false,
          noPlan: options.plan === false,
          cwd,
          onMessage: text => writeLoopLine(`\n${text}`),
        });

        const ok = loopRunSucceeded(result, noVerify);
        writeLoopLine(
          `\nRésultat : ${result.status} — ${result.turnsUsed} tour(s), ` +
            `$${result.costUsd.toFixed(4)}, vérification ${result.lastVerifierVerdict}.`,
        );
        writeLoopLine(`Journal : buddy run show ${runId}`);
        runStore.endRun(runId, ok ? 'completed' : 'failed');
        await agent.dispose?.();
        process.exitCode = ok ? 0 : 1;
        process.exit(process.exitCode);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeLoopLine(`Loop error: ${message}`);
        if (runId) {
          try {
            const { getActiveRunStore } = await import('../observability/run-store.js');
            getActiveRunStore()?.endRun(runId, 'failed');
          } catch {
            /* journal best-effort */
          }
        }
        process.exitCode = 1;
        process.exit(1);
      }
    });
}
