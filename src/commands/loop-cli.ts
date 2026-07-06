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

import { Command } from 'commander';
import { resolveCommandProvider } from './llm-provider-resolution.js';
import {
  applyGoalCliWorkingDirectory,
  parsePositiveIntegerOption,
  resolveGoalCliJudgeModel,
  resolveGoalCliMaxToolRounds,
  resolveLocalGoalActorSystemPrompt,
} from './goal-cli.js';
import { InvalidArgumentError } from 'commander';
import * as path from 'path';

function parsePositiveFloatOption(value: string, optionName: string): number {
  const n = Number(value.trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new InvalidArgumentError(`${optionName} must be a positive number`);
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

async function loadLoopEnv(directory: string): Promise<void> {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.join(directory, '.env') });
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
    .option('--no-verify', 'Désactiver le gate Verifier indépendant (boucle juge-seule)')
    .option('--no-plan', 'Désactiver la décomposition en plan')
    .option('-m, --model <model>', 'Override du modèle agent pour ce run')
    .option(
      '--max-tool-rounds <n>',
      'Max tool rounds par tour',
      value => parsePositiveIntegerOption(value, '--max-tool-rounds'),
      50,
    )
    .action(async (goal: string, options, command) => {
      try {
        const launchDir = process.cwd();
        await loadLoopEnv(launchDir);
        const cwd = applyGoalCliWorkingDirectory(command);
        if (cwd !== launchDir) await loadLoopEnv(cwd);

        const modelOverride: string | undefined = options.model ?? command?.optsWithGlobals?.()?.model;
        const resolved = resolveCommandProvider({ explicitModel: modelOverride });
        if (!resolved) {
          console.error(
            'Error: aucun provider — définis une clé API, `buddy onboard`, ou CODEBUDDY_PROVIDER=ollama.',
          );
          process.exit(1);
        }

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
          true,
          undefined,
          cwd,
          undefined,
          resolveLocalGoalActorSystemPrompt(resolved, cwd),
        );
        await agent.systemPromptReady;

        const { runDevLoop } = await import('../agent/dev-loop/dev-loop.js');
        const result = await runDevLoop(agent, goal, {
          ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
          ...(options.budget !== undefined ? { budgetUsd: options.budget } : {}),
          ...(judgeModel ? { judgeModel } : {}),
          noVerify: options.verify === false,
          noPlan: options.plan === false,
          onMessage: text => console.log(`\n${text}`),
        });

        console.log(
          `\nRésultat : ${result.status} — ${result.turnsUsed} tour(s), ` +
            `$${result.costUsd.toFixed(4)}, vérification ${result.lastVerifierVerdict}.`,
        );
        await agent.dispose?.();
        process.exit(result.status === 'done' ? 0 : 1);
      } catch (err) {
        console.error('Loop error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
