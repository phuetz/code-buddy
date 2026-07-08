/**
 * `buddy assistant` — manage the voice assistant (Lisa).
 *
 * For now the headline subcommand is `improve`: run one MySoulmate-inspired
 * improvement cycle (reflect on recent conversation → learned reply-guidance +
 * bounded trait drift + proposed user preferences). Dry-run by default; `--apply`
 * is the explicit human review that also accepts the proposed preferences.
 *
 * @module commands/assistant
 */
import type { Command } from 'commander';

export function registerAssistantCommand(program: Command): void {
  const assistant = program
    .command('assistant')
    .description('Manage the voice assistant (Lisa): improvement loop, voice, config');

  assistant
    .command('improve')
    .description(
      'Run one improvement cycle: reflect on recent conversation and adapt (MySoulmate-style)'
    )
    .option(
      '--apply',
      'Persist ALL learnings, incl. accepting proposed user preferences (human review)'
    )
    .option('--limit <n>', 'How many recent heard utterances to reflect on', '20')
    .action(async (opts: { apply?: boolean; limit: string }) => {
      const { runVoiceImprovementCycle } = await import('../companion/voice-improvement-loop.js');
      const limit = Math.max(2, Number(opts.limit) || 20);
      const mode = opts.apply ? 'all' : 'dry';
      const res = await runVoiceImprovementCycle({ mode, limit });
      if (!res) {
        console.log(
          'Rien à améliorer : pas assez de conversation récente, ou aucun modèle LLM configuré ' +
            '(lance `buddy login` pour le mode ChatGPT $0).'
        );
        return;
      }
      const { reflection } = res;
      console.log(
        `\n🎙️  Cycle d'amélioration (${res.heardCount} phrases entendues, mode ${mode})\n`
      );
      console.log(`  Ton détecté : ${reflection.signal}`);
      console.log(`  Consigne apprise : ${reflection.guidance || '(aucune)'}`);
      console.log(
        `  Préférences repérées : ${reflection.facts.length ? '\n    - ' + reflection.facts.join('\n    - ') : '(aucune)'}`
      );
      if (mode === 'dry') {
        console.log(
          '\n  (dry-run — rien enregistré. Relance avec --apply pour appliquer et accepter les préférences.)'
        );
      } else {
        console.log('\n  Appliqué :');
        console.log(`    - consigne vocale : ${res.guidanceApplied ? 'ajoutée' : 'non'}`);
        console.log(`    - dérive de personnalité : ${res.driftApplied ? 'oui' : 'non'}`);
        console.log(
          `    - préférences acceptées : ${res.acceptedFacts.length ? res.acceptedFacts.join(' ; ') : '(aucune)'}`
        );
        console.log(
          '\n  Astuce : active `CODEBUDDY_COMPANION_RELATIONAL=true` pour que ces apprentissages soient injectés dans les réponses.'
        );
      }
    });
}

export default registerAssistantCommand;
