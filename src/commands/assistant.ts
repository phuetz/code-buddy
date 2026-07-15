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
import { execFileSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import type { Command } from 'commander';
import {
  ASSISTANT_SETTINGS,
  envFilePath,
  listPocketVoices,
  previewVoice,
  readAssistantConfig,
  restartAssistantServices,
  writeAssistantConfig,
  type AssistantSetting,
  type AssistantSettingGroup,
} from '../companion/assistant-config.js';
import { logger } from '../utils/logger.js';
import type { TtsLatencyBenchmarkReport } from '../voice/tts-latency-benchmark.js';

const GROUPS: AssistantSettingGroup[] = ['voice', 'speech', 'behavior', 'companion'];
const GROUP_LABELS: Record<AssistantSettingGroup, string> = {
  voice: 'Voix',
  speech: 'Parole',
  behavior: 'Ecoute / reponse',
  companion: 'Compagnon',
};

function findSetting(key: string): AssistantSetting | undefined {
  return ASSISTANT_SETTINGS.find((setting) => setting.key === key);
}

function validateCliValue(setting: AssistantSetting, value: string): boolean {
  if (setting.type === 'enum') return setting.options?.includes(value) ?? false;
  if (setting.type === 'volume') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
  }
  return true;
}

function parseBoundedNumber(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
  integer = false
): number {
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed < minimum ||
    parsed > maximum ||
    (integer && !Number.isInteger(parsed))
  ) {
    throw new Error(
      `${label} must be ${integer ? 'an integer' : 'a number'} between ${minimum} and ${maximum}`
    );
  }
  return parsed;
}

function printWriteResult(result: { vision: string[]; lisa: string[] }): void {
  const files: string[] = [];
  if (result.vision.length > 0) files.push(`vision (${envFilePath('vision')})`);
  if (result.lisa.length > 0) files.push(`lisa (${envFilePath('lisa')})`);
  if (files.length === 0) {
    console.log('Aucune valeur ecrite (cle inconnue ou valeur invalide).');
    return;
  }
  console.log(`Ecrit dans : ${files.join(', ')}`);
}

function playAudioFile(path: string): boolean {
  const players =
    process.platform === 'darwin'
      ? [{ command: 'afplay', args: [path] }]
      : [
          { command: 'aplay', args: [path] },
          { command: 'paplay', args: [path] },
          { command: 'ffplay', args: ['-nodisp', '-autoexit', path] },
        ];

  for (const player of players) {
    try {
      execFileSync(player.command, player.args, { stdio: 'inherit' });
      return true;
    } catch (error) {
      logger.debug('Audio player unavailable', { player: player.command, error });
    }
  }

  return false;
}

export function registerAssistantCommand(program: Command): void {
  const assistant = program
    .command('assistant')
    .description('Manage the voice assistant (Lisa): improvement loop, voice, config');

  assistant
    .command('show')
    .description('Show the effective voice assistant config')
    .action(() => {
      const config = readAssistantConfig();
      for (const group of GROUPS) {
        console.log(`\n${GROUP_LABELS[group]}`);
        for (const setting of ASSISTANT_SETTINGS.filter((item) => item.group === group)) {
          console.log(`  ${setting.label}: ${config[setting.key] ?? setting.default}`);
        }
      }
    });

  assistant
    .command('set')
    .description('Set one voice assistant environment value')
    .argument('<key>', 'Environment key to update')
    .argument('<value>', 'Value to write')
    .action((key: string, value: string) => {
      const setting = findSetting(key);
      if (!setting) {
        console.error(`Cle inconnue : ${key}`);
        process.exitCode = 1;
        return;
      }
      if (!validateCliValue(setting, value)) {
        console.error(
          `Valeur invalide pour ${key}. Valeurs autorisees : ${(setting.options ?? []).join(', ')}`
        );
        process.exitCode = 1;
        return;
      }
      printWriteResult(writeAssistantConfig({ [key]: value }));
    });

  assistant
    .command('voice')
    .description('Use Pocket TTS with the given voice')
    .argument('<name>', 'Pocket voice name or clone sample path')
    .action((name: string) => {
      printWriteResult(
        writeAssistantConfig({
          CODEBUDDY_TTS_ENGINE: 'pocket',
          CODEBUDDY_POCKET_VOICE: name,
        })
      );
    });

  assistant
    .command('voices')
    .description('List Pocket TTS preset voices')
    .action(() => {
      for (const voice of listPocketVoices()) console.log(voice);
    });

  assistant
    .command('voicebox')
    .description('Probe the Voicebox endpoint and configured Lisa profile (read-only)')
    .option('--json', 'Output the diagnostic as JSON')
    .option('--benchmark [text]', 'Also compare Voicebox and Pocket latency (two runs each)')
    .option('--runs <n>', 'Benchmark attempts per renderer (1–5)', '2')
    .action(async (options: { json?: boolean; benchmark?: string | boolean; runs: string }) => {
      const { probeVoicebox } = await import('../voice/voicebox-tts.js');
      const config = readAssistantConfig();
      // Persisted assistant values supply defaults; explicit launch-time env
      // overrides remain authoritative for one-off diagnostics and CI probes.
      const env = { ...config, ...process.env };
      const report = await probeVoicebox(env);
      let benchmark: TtsLatencyBenchmarkReport | undefined;
      if (options.benchmark) {
        const { DEFAULT_TTS_BENCHMARK_TEXT, runTtsLatencyBenchmark } = await import(
          '../voice/tts-latency-benchmark.js'
        );
        const text = typeof options.benchmark === 'string'
          ? options.benchmark
          : DEFAULT_TTS_BENCHMARK_TEXT;
        benchmark = await runTtsLatencyBenchmark(env, text, {
          runs: Math.max(1, Math.min(5, Number(options.runs) || 2)),
        });
      }
      if (options.json) {
        console.log(JSON.stringify(benchmark ? { probe: report, benchmark } : report, null, 2));
      } else {
        console.log(`Voicebox: ${report.available ? 'prêt' : 'indisponible'}`);
        console.log(`Endpoint: ${report.baseUrl}`);
        console.log(`Moteur: ${report.engine}`);
        console.log(
          `Profil configuré: ${report.configuredProfile ?? '(aucun — choisissez-en un ci-dessous)'}`
        );
        if (report.resolvedProfile) {
          console.log(`Profil résolu: ${report.resolvedProfile.name} (${report.resolvedProfile.id})`);
        }
        if (report.profiles.length > 0) {
          console.log('Profils disponibles:');
          for (const profile of report.profiles) console.log(`  ${profile.name} (${profile.id})`);
        }
        if (report.error) console.error(`Erreur: ${report.error}`);
        if (report.hint) console.error(`Conseil: ${report.hint}`);
        if (benchmark) {
          console.log('\nLatence TTS (le premier essai inclut le chargement à froid):');
          for (const result of benchmark.results) {
            const timing = result.successes > 0
              ? `moyenne ${result.averageMs} ms, meilleur ${result.bestMs} ms`
              : 'aucun rendu réussi';
            console.log(`  ${result.engine}: ${timing} (${result.successes}/${benchmark.runs})`);
            for (const attempt of result.attempts) {
              if (attempt.error) console.log(`    essai ${attempt.run}: ${attempt.error}`);
            }
          }
        }
      }
      if (!report.available) process.exitCode = 1;
    });

  assistant
    .command('latency')
    .description('Measure cached-answer latency to first PCM without playing or publishing audio')
    .option('--json', 'Output the full measurement as JSON')
    .option('--query <text>', 'Prefetched question to exercise (default: today news)')
    .option('--engine <name>', 'active, pocket, voicebox, or both', 'active')
    .option('--runs <n>', 'Sequential attempts per renderer (1–5)', '2')
    .option('--segment-chars <n>', 'Progressive TTS segment size (32–240)')
    .action(async (options: {
      json?: boolean;
      query?: string;
      engine: string;
      runs: string;
      segmentChars?: string;
    }) => {
      const {
        DEFAULT_PERCEIVED_VOICE_QUERY,
        runPerceivedVoiceLatencyBenchmark,
      } = await import('../voice/perceived-latency-benchmark.js');
      const { resolveTtsEngine } = await import('../voice/local-tts.js');
      const config = readAssistantConfig();
      const env = { ...config, ...process.env };
      const requested = options.engine.trim().toLowerCase();
      let engines: Array<'pocket' | 'voicebox'>;
      if (requested === 'both') {
        engines = ['voicebox', 'pocket'];
      } else if (requested === 'pocket' || requested === 'voicebox') {
        engines = [requested];
      } else if (requested === 'active') {
        const active = resolveTtsEngine(env);
        if (active === 'piper') {
          console.error(
            'Le moteur actif Piper ne fournit pas de flux PCM progressif. ' +
              'Utilise --engine pocket, --engine voicebox ou --engine both.'
          );
          process.exitCode = 1;
          return;
        }
        engines = [active];
      } else {
        console.error(`Moteur invalide : ${options.engine}`);
        process.exitCode = 1;
        return;
      }
      const runs = Math.max(1, Math.min(5, Number(options.runs) || 2));
      const report = await runPerceivedVoiceLatencyBenchmark(
        env,
        options.query ?? DEFAULT_PERCEIVED_VOICE_QUERY,
        {
          runs,
          engines,
          ...(options.segmentChars === undefined
            ? {}
            : { sentenceCap: Number(options.segmentChars) }),
        }
      );
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        const freshness = report.cacheFreshness
          ? `${report.cacheFreshness}, ${Math.round((report.cacheAgeMs ?? 0) / 1_000)} s`
          : 'indéterminée';
        console.log(
          `Réponse préchargée: ${report.cacheHit ? `oui (${report.answerChars} caractères, ${freshness})` : 'non'}`
        );
        console.log(`Découpage progressif: ${report.sentenceCap} caractères maximum`);
        console.log('Latence perçue (aucun son réellement joué ni événement publié):');
        for (const result of report.results) {
          const summary = result.successes > 0
            ? `premier son moyen ${result.averageFirstAudioMs} ms ` +
              `(meilleur ${result.bestFirstAudioMs} ms), fin génération ${result.averageTotalMs} ms`
            : 'aucun flux réussi';
          console.log(`  ${result.engine}: ${summary} (${result.successes}/${report.runs})`);
          for (const attempt of result.attempts) {
            console.log(
              `    essai ${attempt.run}: texte=${attempt.firstTextMs ?? '-'} ms, ` +
                `segment=${attempt.firstSegmentMs ?? '-'} ms, octet=${attempt.firstByteMs ?? '-'} ms, ` +
                `audio=${attempt.firstAudioMs ?? '-'} ms, total=${attempt.totalMs} ms, ` +
                `${attempt.streamRequests} requête(s), ${attempt.audioBytes} octets` +
                (attempt.error ? `, erreur=${attempt.error}` : '')
            );
          }
        }
      }
      if (!report.cacheHit || report.results.some((result) => result.successes === 0)) {
        process.exitCode = 1;
      }
    });

  assistant
    .command('preview')
    .description('Synthesize and play a Pocket TTS voice preview')
    .argument('<name>', 'Pocket voice name or clone sample path')
    .action(async (name: string) => {
      const wavPath = await previewVoice(name);
      if (!wavPath) {
        console.error('Pocket TTS indisponible ou impossible de synthetiser cet apercu.');
        process.exitCode = 1;
        return;
      }

      let played = false;
      try {
        played = playAudioFile(wavPath);
        if (!played) {
          console.log(`Audio genere : ${wavPath}`);
          console.error('Aucun lecteur audio trouve. Installe aplay, paplay ou ffplay.');
        }
      } finally {
        if (played) {
          try {
            unlinkSync(wavPath);
          } catch (error) {
            logger.debug('Failed to remove temporary audio file', { wavPath, error });
          }
        }
      }
    });

  assistant
    .command('apply')
    .description('Restart assistant user services so systemd reloads the env files')
    .action(async () => {
      const results = await restartAssistantServices(['buddy-vision-brain', 'lisa-telegram']);
      for (const result of results) {
        if (result.ok) {
          console.log(`ok ${result.service}`);
        } else {
          console.log(`failed ${result.service}: ${result.error ?? 'unknown error'}`);
          process.exitCode = 1;
        }
      }
    });

  assistant
    .command('doctor')
    .description('Check the local robot organs; safe/read-only unless --repair is explicit')
    .option('--json', 'Output the bounded diagnostic as JSON')
    .option('--repair', 'Restart only allowlisted unhealthy systemd user services')
    .action(async (options: { json?: boolean; repair?: boolean }) => {
      const { formatAssistantRuntimeDoctorReport, runAssistantRuntimeDoctor } = await import(
        '../doctor/assistant-runtime.js'
      );
      const report = await runAssistantRuntimeDoctor({ repair: options.repair === true });
      console.log(
        options.json ? JSON.stringify(report, null, 2) : formatAssistantRuntimeDoctorReport(report),
      );
    });

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

  assistant
    .command('repair-voice-incident')
    .description(
      'Quarantine a bounded acoustic-feedback incident; dry-run unless --apply is explicit',
    )
    .requiredOption('--from <iso>', 'Inclusive incident start (ISO timestamp)')
    .option('--to <iso>', 'Inclusive incident end (defaults to now)')
    .option('--runtime-cwd <path>', 'Runtime workspace containing percepts and user-model')
    .option('--apply', 'Back up files, quarantine incident events, and reset contaminated learning')
    .option('--json', 'Output the raw-free repair report as JSON')
    .action(async (opts: {
      from: string;
      to?: string;
      runtimeCwd?: string;
      apply?: boolean;
      json?: boolean;
    }) => {
      const { repairVoiceIncident } = await import(
        '../companion/voice-incident-repair.js'
      );
      const report = repairVoiceIncident({
        from: opts.from,
        ...(opts.to ? { to: opts.to } : {}),
        ...(opts.runtimeCwd ? { runtimeCwd: opts.runtimeCwd } : {}),
        apply: opts.apply === true,
      });
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log(
        `${report.mode}: ${report.conversation.quarantined} conversation turn(s), ` +
          `${report.percepts.quarantined} hearing percept(s), ` +
          `${report.pendingObservationsDiscarded} pending observation(s)`,
      );
      if (report.mode === 'dry-run') {
        console.log('No file changed. Re-run with --apply after reviewing this report.');
      } else {
        console.log(
          `Backups: ${report.backups.length}; quarantine files: ${report.quarantines.length}.`,
        );
      }
    });

  assistant
    .command('quality')
    .description('Evaluate recent user/Lisa exchanges without exposing their raw content')
    .option('--apply', 'Apply one reversible guidance if the same weakness is recurring')
    .option('--limit <n>', 'Maximum recent cross-channel turns to evaluate', '40')
    .action(async (opts: { apply?: boolean; limit: string }) => {
      const {
        formatConversationImprovementResult,
        runConversationImprovementCycle,
      } = await import('../companion/conversation-improvement-loop.js');
      const limit = Math.max(4, Math.min(200, Number(opts.limit) || 40));
      const result = await runConversationImprovementCycle({
        mode: opts.apply ? 'behavioral' : 'dry',
        limit,
      });
      if (!result) {
        console.log(
          'Pas encore assez de conversation complète : il faut au moins deux échanges utilisateur/Lisa.'
        );
        return;
      }
      console.log(formatConversationImprovementResult(result));
      if (!opts.apply) {
        console.log('\n(diagnostic seul — relance avec --apply pour autoriser une adaptation réversible)');
      }
    });

  assistant
    .command('benchmark')
    .description('Run the reproducible Lisa conversation suite (Darkstar/Ollama or current provider)')
    .option('--model <name>', 'Model to evaluate')
    .option('--base-url <url>', 'Ollama host, for example http://darkstar:11434')
    .option('--runs <n>', 'Repeat every scenario N times', '1')
    .option('--concurrency <n>', 'Concurrent generations (1-4)', '1')
    .option('--timeout <ms>', 'Timeout for each generation', '120000')
    .option('--scenarios <csv>', 'Only run scenario IDs containing one of these patterns')
    .option('--verbose', 'Print generated previews (the suite contains synthetic data only)')
    .option('--json', 'Print the complete machine-readable report')
    .option('--no-write', 'Do not persist aggregate metrics in ~/.codebuddy/companion')
    .action(
      async (opts: {
        model?: string;
        baseUrl?: string;
        runs: string;
        concurrency: string;
        timeout: string;
        scenarios?: string;
        verbose?: boolean;
        json?: boolean;
        write?: boolean;
      }) => {
        const {
          createOllamaConversationGenerator,
          defaultConversationBenchmarkPaths,
          formatConversationBenchmarkReport,
          LISA_CORE_BENCHMARK_SCENARIOS,
          runConversationBenchmark,
          writeConversationBenchmarkReport,
        } = await import('../conversation/conversation-benchmark.js');
        const [{ getActivePersonaVoiceAsync }, { SPEAK_SYSTEM_PROMPT }] = await Promise.all([
          import('../personas/persona-manager.js'),
          import('../sensory/voice-loop.js'),
        ]);
        const personaPrompt = (await getActivePersonaVoiceAsync()).spokenPrompt || SPEAK_SYSTEM_PROMPT;
        const scenarioFilters = (opts.scenarios ?? '')
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean);
        const scenarios =
          scenarioFilters.length === 0
            ? LISA_CORE_BENCHMARK_SCENARIOS
            : LISA_CORE_BENCHMARK_SCENARIOS.filter((scenario) =>
                scenarioFilters.some((filter) => scenario.id.toLowerCase().includes(filter))
              );
        if (scenarios.length === 0) {
          console.error(`Aucun scénario ne correspond à : ${opts.scenarios}`);
          process.exitCode = 1;
          return;
        }
        const ollamaHost = opts.baseUrl?.trim() || process.env.OLLAMA_HOST?.trim();
        let model = opts.model?.trim();
        let provider: string;
        let generate: import('../conversation/conversation-benchmark.js').ConversationBenchmarkGenerator;

        if (ollamaHost) {
          model =
            model ||
            process.env.CODEBUDDY_SENSORY_SPEAK_MODEL?.trim() ||
            process.env.GROK_MODEL?.trim() ||
            'qwen3.6:35b-a3b-q4_K_M';
          provider = 'ollama';
          generate = createOllamaConversationGenerator({
            host: ollamaHost,
            model,
            timeoutMs: Math.max(5_000, Number(opts.timeout) || 120_000),
            includeUsage: true,
          });
        } else {
          const { resolveCommandProviderWithOAuth } = await import(
            './llm-provider-resolution.js'
          );
          const resolved = await resolveCommandProviderWithOAuth({
            ...(model ? { explicitModel: model } : {}),
          });
          if (!resolved) {
            console.error(
              'Aucun modèle disponible. Fournis --base-url pour Darkstar, lance `buddy login`, ou configure un fournisseur.'
            );
            process.exitCode = 1;
            return;
          }
          const { CodeBuddyClient } = await import('../codebuddy/client.js');
          const { getModelPricing } = await import('../config/model-pricing.js');
          model = model || resolved.model || 'modèle courant';
          provider = resolved.providerLabel;
          const client = new CodeBuddyClient(resolved.apiKey, resolved.model, resolved.baseURL);
          generate = async (input) => {
            const response = await client.chat(input.messages as never, [], {
              temperature: 0.25,
              maxTokens: input.maxTokens,
              disableProviderFallback: true,
            });
            const content = response.choices[0]?.message.content;
            if (!content?.trim()) throw new Error('Le modèle a renvoyé une réponse vide');
            const usage = response.usage;
            const subscriptionBacked =
              resolved.apiKey === 'ollama' ||
              resolved.apiKey === 'oauth-chatgpt' ||
              /oauth/i.test(resolved.providerLabel) ||
              /^(ollama|lmstudio|lemonade)$/i.test(resolved.providerLabel) ||
              resolved.baseURL?.includes('chatgpt.com/backend-api/codex');
            const pricing = getModelPricing(model ?? resolved.model ?? 'unknown');
            return {
              content: content.trim(),
              usage: {
                ...(usage ? { inputTokens: usage.prompt_tokens } : {}),
                ...(usage ? { outputTokens: usage.completion_tokens } : {}),
                ...(usage
                  ? {
                      costUsd: subscriptionBacked
                        ? 0
                        : (usage.prompt_tokens * pricing.inputPerMillion +
                            usage.completion_tokens * pricing.outputPerMillion) /
                          1_000_000,
                    }
                  : {}),
              },
            };
          };
        }

        const report = await runConversationBenchmark({
          generate,
          personaPrompt,
          runs: Math.max(1, Math.min(10, Number(opts.runs) || 1)),
          concurrency: Math.max(1, Math.min(4, Number(opts.concurrency) || 1)),
          scenarios,
          model,
          provider,
        });
        if (opts.write !== false) writeConversationBenchmarkReport(report);
        console.log(
          opts.json ? JSON.stringify(report, null, 2) : formatConversationBenchmarkReport(report)
        );
        if (opts.verbose && !opts.json) {
          for (const result of report.results) {
            console.log(`\n[${result.scenarioId}] ${result.responsePreview ?? result.error ?? '(vide)'}`);
          }
        }
        if (opts.write !== false && !opts.json) {
          console.log(`Mesures agrégées : ${defaultConversationBenchmarkPaths().latest}`);
        }
        if (!report.summary.regressionGatePasses) process.exitCode = 2;
      }
    );

  assistant
    .command('relational-benchmark')
    .description('Run the deterministic raw-free relational detector self-test')
    .option('--json', 'Print the complete machine-readable report')
    .action(async (opts: { json?: boolean }) => {
      const { runLisaRelationalBenchmark } = await import(
        '../companion/relational-benchmark-scenarios.js'
      );
      const report = runLisaRelationalBenchmark();
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(
          [
            'Auto-test déterministe du détecteur relationnel de Lisa',
            'Aucun appel à un modèle ni à une surface réelle.',
            `Cas reconnus : ${report.matchedCaseCount}/${report.caseCount}`,
            `Taux de détection : ${report.detectionRate.toFixed(1)} %`,
            `Porte de régression : ${report.passes ? 'RÉUSSIE' : 'ÉCHEC'}`,
          ].join('\n')
        );
        for (const result of report.results) {
          const expected = result.expectedPass ? 'sûr' : 'adversarial';
          console.log(
            `  ${result.matchesContract ? '✓' : '✗'} ${result.episodeRef.slice(0, 10)} ` +
              `(${expected}, sécurité ${result.metrics.relationshipSafetyRate.toFixed(0)} %, ` +
              `rappel ${result.metrics.crossSurfaceRecallRate.toFixed(0)} %, ` +
              `chaleur ${result.metrics.warmthAdequacyRate.toFixed(0)} %)`
          );
        }
        console.log('\nLe rapport ne contient ni transcript, ni faits personnels, ni identifiants source.');
      }
      if (!report.passes) process.exitCode = 2;
    });

  assistant
    .command('corpus-init')
    .description('Create Lisa’s private annotated pilot corpus (mode 0600)')
    .option('--path <file>', 'Corpus path')
    .option('--force', 'Replace an existing corpus')
    .action(async (opts: { path?: string; force?: boolean }) => {
      const {
        conversationPilotCorpusFingerprint,
        defaultConversationPilotCorpusPath,
        initializeConversationPilotCorpus,
      } = await import('../conversation/conversation-pilot-corpus.js');
      const path = opts.path?.trim() || defaultConversationPilotCorpusPath();
      try {
        const corpus = initializeConversationPilotCorpus(path, { force: opts.force });
        console.log(
          `Corpus pilote créé : ${path}\n${corpus.scenarios.length} scénarios annotés — empreinte ${conversationPilotCorpusFingerprint(corpus)}.\nTu peux maintenant remplacer ou compléter les exemples synthétiques par tes échanges privés.`
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  assistant
    .command('compare')
    .description('Compare 2-12 Lisa models with anonymized responses and a private review packet')
    .requiredOption('--models <csv>', 'Comma-separated model names')
    .option('--base-url <url>', 'Shared Ollama host, for example http://darkstar:11434')
    .option('--corpus <file>', 'Private annotated corpus path')
    .option('--runs <n>', 'Repeat every scenario N times', '1')
    .option('--concurrency <n>', 'Global concurrent generations (1-8)', '2')
    .option('--timeout <ms>', 'Timeout for each Ollama generation', '120000')
    .option('--json', 'Print the aggregate machine-readable report')
    .option('--no-write', 'Do not write the private review, key and aggregate files')
    .action(
      async (opts: {
        models: string;
        baseUrl?: string;
        corpus?: string;
        runs: string;
        concurrency: string;
        timeout: string;
        json?: boolean;
        write?: boolean;
      }) => {
        const models = opts.models
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        if (models.length < 2 || models.length > 12 || new Set(models).size !== models.length) {
          console.error('--models doit contenir 2 à 12 noms de modèles uniques.');
          process.exitCode = 1;
          return;
        }
        const [
          {
            defaultConversationPilotCorpusPath,
            readConversationPilotCorpus,
          },
          {
            defaultBlindComparisonDirectory,
            formatBlindConversationAggregate,
            runBlindConversationComparison,
            writeBlindComparisonArtifacts,
          },
          { createOllamaConversationGenerator },
          { getActivePersonaVoiceAsync },
          { SPEAK_SYSTEM_PROMPT },
        ] = await Promise.all([
          import('../conversation/conversation-pilot-corpus.js'),
          import('../conversation/conversation-blind-comparison.js'),
          import('../conversation/conversation-benchmark.js'),
          import('../personas/persona-manager.js'),
          import('../sensory/voice-loop.js'),
        ]);
        const corpusPath = opts.corpus?.trim() || defaultConversationPilotCorpusPath();
        let corpus: import('../conversation/conversation-pilot-corpus.js').ConversationPilotCorpus;
        try {
          corpus = readConversationPilotCorpus(corpusPath);
        } catch (error) {
          console.error(
            `Impossible de lire le corpus ${corpusPath}: ${error instanceof Error ? error.message : String(error)}\nLance d’abord \`buddy assistant corpus-init\`.`
          );
          process.exitCode = 1;
          return;
        }
        const personaPrompt = (await getActivePersonaVoiceAsync()).spokenPrompt || SPEAK_SYSTEM_PROMPT;
        const ollamaHost = opts.baseUrl?.trim();
        const candidates: import('../conversation/conversation-blind-comparison.js').BlindConversationCandidate[] = [];
        if (ollamaHost) {
          for (const [index, model] of models.entries()) {
            candidates.push({
              id: `candidate-${index + 1}`,
              model,
              provider: 'ollama',
              generate: createOllamaConversationGenerator({
                host: ollamaHost,
                model,
                timeoutMs: Math.max(5_000, Number(opts.timeout) || 120_000),
                includeUsage: true,
              }),
            });
          }
        } else {
          const [
            { resolveCommandProviderWithOAuth },
            { CodeBuddyClient },
            { getModelPricing },
            { listActiveLlmModelPool },
          ] =
            await Promise.all([
              import('./llm-provider-resolution.js'),
              import('../codebuddy/client.js'),
              import('../config/model-pricing.js'),
              import('../providers/active-llm-model-pool.js'),
            ]);
          const activePool = await listActiveLlmModelPool();
          for (const [index, requestedModel] of models.entries()) {
            const active = activePool.find(
              (candidate) => candidate.model.toLowerCase() === requestedModel.toLowerCase()
            );
            const grokResolution = requestedModel.toLowerCase().startsWith('grok-')
              ? await resolveCommandProviderWithOAuth({ explicitModel: requestedModel })
              : null;
            const resolved =
              grokResolution && /grok|xai/i.test(grokResolution.providerLabel)
                ? grokResolution
                : active?.apiKey
                  ? {
                      apiKey: active.apiKey,
                      baseURL: active.baseURL,
                      model: active.model,
                      providerLabel: active.provider,
                    }
                  : await resolveCommandProviderWithOAuth({ explicitModel: requestedModel });
            if (!resolved) {
              console.error(`Aucun fournisseur disponible pour ${requestedModel}.`);
              process.exitCode = 1;
              return;
            }
            const model = resolved.model || requestedModel;
            const client = new CodeBuddyClient(resolved.apiKey, model, resolved.baseURL);
            const pricing = getModelPricing(model);
            const subscriptionBacked =
              active?.costInputUsdPerMtok === 0 ||
              resolved.apiKey === 'ollama' ||
              resolved.apiKey === 'oauth-chatgpt' ||
              /oauth/i.test(resolved.providerLabel) ||
              /^(ollama|lmstudio|lemonade)$/i.test(resolved.providerLabel) ||
              resolved.baseURL?.includes('chatgpt.com/backend-api/codex');
            candidates.push({
              id: `candidate-${index + 1}`,
              model,
              provider: resolved.providerLabel,
              generate: async (input) => {
                const response = await client.chat(input.messages as never, [], {
                  temperature: 0.25,
                  maxTokens: input.maxTokens,
                  disableProviderFallback: true,
                });
                const content = response.choices[0]?.message.content;
                if (!content?.trim()) throw new Error('Le modèle a renvoyé une réponse vide');
                const usage = response.usage;
                return {
                  content: content.trim(),
                  usage: {
                    ...(usage ? { inputTokens: usage.prompt_tokens } : {}),
                    ...(usage ? { outputTokens: usage.completion_tokens } : {}),
                    ...(usage
                      ? {
                          costUsd: subscriptionBacked
                            ? 0
                            : (usage.prompt_tokens * pricing.inputPerMillion +
                                usage.completion_tokens * pricing.outputPerMillion) /
                              1_000_000,
                        }
                      : {}),
                  },
                };
              },
            });
          }
        }
        const comparison = await runBlindConversationComparison({
          corpus,
          candidates,
          personaPrompt,
          runs: Math.max(1, Math.min(10, Number(opts.runs) || 1)),
          concurrency: Math.max(1, Math.min(8, Number(opts.concurrency) || 2)),
        });
        console.log(
          opts.json
            ? JSON.stringify(comparison.report, null, 2)
            : formatBlindConversationAggregate(comparison.report)
        );
        if (opts.write !== false) {
          const paths = writeBlindComparisonArtifacts(comparison);
          console.log(
            `\nRevue aveugle privée : ${paths.reviewPacket}\nClé scellée : ${paths.key}\nMesures sans contenu brut : ${paths.aggregate}\n\nRemplis les tableaux "ranking" sans ouvrir la clé, puis lance :\nbuddy assistant compare-reveal --packet "${paths.reviewPacket}" --key "${paths.key}"`
          );
        } else if (!opts.json) {
          console.log(`\nAucun fichier écrit (répertoire habituel : ${defaultBlindComparisonDirectory()}).`);
        }
      }
    );

  assistant
    .command('compare-reveal')
    .description('Reveal model identities after a human has ranked the blind review packet')
    .requiredOption('--packet <file>', 'Completed .review.json file')
    .requiredOption('--key <file>', 'Matching sealed .key.json file')
    .option('--output <file>', 'Preference report path')
    .option('--json', 'Print machine-readable preferences')
    .option('--no-write', 'Do not persist the raw-free preference report')
    .action(
      async (opts: {
        packet: string;
        key: string;
        output?: string;
        json?: boolean;
        write?: boolean;
      }) => {
        const {
          formatBlindPreferenceReport,
          readBlindComparisonKey,
          readBlindReviewPacket,
          revealBlindConversationPreferences,
          writeBlindPreferenceReport,
        } = await import('../conversation/conversation-blind-comparison.js');
        try {
          const report = revealBlindConversationPreferences(
            readBlindReviewPacket(opts.packet),
            readBlindComparisonKey(opts.key)
          );
          console.log(
            opts.json ? JSON.stringify(report, null, 2) : formatBlindPreferenceReport(report)
          );
          if (opts.write !== false) {
            const output =
              opts.output?.trim() ||
              (opts.packet.endsWith('.review.json')
                ? opts.packet.replace(/\.review\.json$/, '.preferences.json')
                : `${opts.packet}.preferences.json`);
            writeBlindPreferenceReport(report, output);
            if (!opts.json) {
              const aggregate = opts.packet.endsWith('.review.json')
                ? opts.packet.replace(/\.review\.json$/, '.aggregate.json')
                : '<fichier.aggregate.json>';
              console.log(
                `\nPréférences sans contenu brut : ${output}\n\nAprès vérification, active le gagnant sur les conversations substantielles :\nbuddy assistant route-apply --preferences "${output}" --aggregate "${aggregate}"`
              );
            }
          }
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      }
    );

  assistant
    .command('route-apply')
    .description('Activate a safe, human-reviewed blind-pilot winner across Lisa surfaces')
    .requiredOption('--preferences <file>', 'Revealed .preferences.json report')
    .requiredOption('--aggregate <file>', 'Matching raw-free .aggregate.json report')
    .option('--min-coverage <ratio>', 'Minimum judged-trial ratio (0.1-1)', '0.5')
    .option('--ttl-days <n>', 'Profile lifetime before automatic fallback', '30')
    .option('--force-coverage', 'Allow sparse human review; never bypasses the safety gate')
    .action(
      async (opts: {
        preferences: string;
        aggregate: string;
        minCoverage: string;
        ttlDays: string;
        forceCoverage?: boolean;
      }) => {
        const {
          activateCompanionRoutingFromFiles,
          configuredCompanionRoutingPaths,
          resetCompanionModelRoutingCache,
        } = await import('../conversation/companion-model-routing.js');
        try {
          const minimumCoverage = parseBoundedNumber(
            opts.minCoverage,
            '--min-coverage',
            0.1,
            1
          );
          const ttlDays = parseBoundedNumber(opts.ttlDays, '--ttl-days', 1, 365, true);
          const profile = activateCompanionRoutingFromFiles(
            opts.preferences,
            opts.aggregate,
            {
              minimumCoverage,
              ttlDays,
              forceCoverage: opts.forceCoverage,
            }
          );
          resetCompanionModelRoutingCache();
          const { resetVoiceModelCache } = await import('../sensory/voice-loop.js');
          resetVoiceModelCache();
          console.log(
            `Profil compagnon activé : ${profile.profileId}\nModèle : ${profile.winner.model} (${profile.winner.provider})\nSurfaces : ${profile.policy.surfaces.join(', ')} · voies : ${profile.policy.lanes.join(', ')}\nExpiration/repli automatique : ${profile.expiresAt}\nFichier privé : ${configuredCompanionRoutingPaths().profile}`
          );
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      }
    );

  assistant
    .command('route-status')
    .description('Show the active evidence-backed Lisa route and raw-free outcomes')
    .option('--json', 'Print machine-readable local status')
    .option('--limit <n>', 'Recent routing outcomes', '40')
    .action(async (opts: { json?: boolean; limit: string }) => {
      const {
        configuredCompanionRoutingPaths,
        readCompanionRoutingProfile,
        readRecentCompanionRoutingEvents,
      } = await import('../conversation/companion-model-routing.js');
      try {
        const limit = parseBoundedNumber(opts.limit, '--limit', 1, 500, true);
        const profile = readCompanionRoutingProfile();
        const profileEvents = profile
          ? readRecentCompanionRoutingEvents(
              limit,
              configuredCompanionRoutingPaths().events,
              profile.profileId
            )
          : [];
        const outcomes = profileEvents.reduce<Record<string, number>>((counts, event) => {
          const key = `${event.surface}:${event.outcome}`;
          counts[key] = (counts[key] ?? 0) + 1;
          return counts;
        }, {});
        const expired = profile ? Date.parse(profile.expiresAt) <= Date.now() : false;
        const globallyDisabled = process.env.CODEBUDDY_COMPANION_ROUTING === 'false';
        const effectiveEnabled = Boolean(profile?.enabled && !expired && !globallyDisabled);
        const status = {
          profile,
          expired,
          globallyDisabled,
          effectiveEnabled,
          recentOutcomeCount: profileEvents.length,
          outcomes,
          paths: configuredCompanionRoutingPaths(),
        };
        if (opts.json) {
          console.log(JSON.stringify(status, null, 2));
        } else if (!profile) {
          console.log('Aucun profil de routage compagnon actif.');
        } else {
          const state = !profile.enabled
            ? 'désactivé'
            : expired
              ? 'expiré — repli normal'
              : globallyDisabled
                ? 'arrêt global — repli normal'
                : 'actif';
          console.log(
            `Profil : ${profile.profileId} — ${state}\nModèle pilote : ${profile.winner.model} (${profile.winner.provider})\nPreuves : ${profile.source.judgedTrials}/${profile.source.totalTrials} jugements, qualité ${Math.round(profile.winner.automatedScore * 100)}%, sécurité ${Math.round(profile.winner.safetyPassRate * 100)}%${profile.source.coverageOverride ? ' · couverture forcée' : ''}\nDécisions récentes de ce profil : ${profileEvents.length}${Object.keys(outcomes).length ? ` — ${Object.entries(outcomes).map(([key, count]) => `${key}=${count}`).join(', ')}` : ''}`
          );
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  assistant
    .command('route-rollback')
    .description('Restore the previous Lisa routing profile, or disable the current one')
    .action(async () => {
      const {
        resetCompanionModelRoutingCache,
        rollbackCompanionRoutingProfile,
      } = await import('../conversation/companion-model-routing.js');
      try {
        const profile = rollbackCompanionRoutingProfile();
        resetCompanionModelRoutingCache();
        const { resetVoiceModelCache } = await import('../sensory/voice-loop.js');
        resetVoiceModelCache();
        console.log(
          profile
            ? `Routage restauré : ${profile.profileId} — ${profile.enabled ? profile.winner.model : 'désactivé'}`
            : 'Aucun profil de routage à restaurer.'
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  assistant
    .command('route-disable')
    .description('Immediately disable Lisa pilot routing without restoring another profile')
    .action(async () => {
      const {
        disableCompanionRoutingProfile,
        resetCompanionModelRoutingCache,
      } = await import('../conversation/companion-model-routing.js');
      try {
        const profile = disableCompanionRoutingProfile();
        resetCompanionModelRoutingCache();
        const { resetVoiceModelCache } = await import('../sensory/voice-loop.js');
        resetVoiceModelCache();
        console.log(
          profile
            ? `Routage compagnon désactivé immédiatement : ${profile.profileId}`
            : 'Aucun profil de routage compagnon à désactiver.'
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}

export default registerAssistantCommand;
