import type { ChatEntry } from '../../agent/codebuddy-agent.js';
import type { CommandHandlerResult } from './branch-handlers.js';
import {
  buildCompanionLiveBrief,
  buildCompanionListenCheck,
  formatCompanionLiveBrief,
  formatCompanionListenCheck,
  formatCompanionStatus,
  getCompanionStatus,
  recordCompanionSelfState,
  setupCompanionMode,
} from '../../companion/companion-mode.js';
import {
  captureCameraSnapshot,
  checkCameraAvailability,
  formatCameraStatus,
  formatCameraSnapshotInspection,
  inspectCameraSnapshot,
} from '../../companion/camera.js';
import {
  formatCompanionPercepts,
  formatCompanionPerceptStats,
  getCompanionPerceptStats,
  readRecentCompanionPercepts,
  type CompanionPerceptModality,
} from '../../companion/percepts.js';
import {
  evaluateCompanionSelf,
  formatCompanionSelfEvaluation,
} from '../../companion/self-evaluation.js';
import {
  buildCompanionCompetitiveRadar,
  formatCompanionCompetitiveRadar,
} from '../../companion/competitive-radar.js';
import {
  formatCompanionImprovementCycle,
  runCompanionImprovementCycle,
} from '../../companion/improvement-cycle.js';
import {
  buildCompanionImpulseBrief,
  formatCompanionImpulseBrief,
} from '../../companion/impulses.js';
import {
  buildCompanionCheckIn,
  formatCompanionCheckIn,
} from '../../companion/check-in.js';
import {
  formatCompanionMissionBoard,
  readCompanionMissionBoard,
  syncCompanionMissionBoard,
  updateCompanionMissionStatus,
  type CompanionMissionStatus,
} from '../../companion/mission-board.js';
import {
  formatCompanionMissionRun,
  runNextCompanionMission,
} from '../../companion/mission-runner.js';
import {
  formatCompanionSafetyEvents,
  formatCompanionSafetyLedgerStats,
  getCompanionSafetyLedgerStats,
  readRecentCompanionSafetyEvents,
  type CompanionSafetyEventKind,
  type CompanionSafetyEventRisk,
} from '../../companion/safety-ledger.js';
import {
  formatCompanionContinuityStatus,
  getCompanionContinuityStatus,
  refreshCompanionContinuity,
} from '../../companion/continuity.js';
import {
  exportCompanionMigration,
  formatCompanionMigrationResult,
  getOrCreateCompanionMigrationPassphrase,
  readCompanionMigrationPassphrase,
  restoreCompanionMigration,
} from '../../companion/migration.js';

function entry(content: string): ChatEntry {
  return {
    type: 'assistant',
    content,
    timestamp: new Date(),
  };
}

function collectFlagValue(
  args: string[],
  startIndex: number,
  firstValue: string | undefined,
  consumeRest: boolean,
): string | undefined {
  const values = firstValue && !firstValue.startsWith('--') ? [firstValue] : [];
  if (consumeRest) {
    for (let i = startIndex; i < args.length; i++) {
      const value = args[i];
      if (!value || value.startsWith('--')) break;
      values.push(value);
    }
  }
  const value = values.join(' ').trim();
  return value || undefined;
}

function flagValue(args: string[], name: string, options: { consumeRest?: boolean } = {}): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg.startsWith(`${name}=`)) {
      return collectFlagValue(args, i + 1, arg.slice(name.length + 1), Boolean(options.consumeRest));
    }
    if (arg === name) {
      return collectFlagValue(args, i + 2, args[i + 1], Boolean(options.consumeRest));
    }
  }
  return undefined;
}

export async function handleCompanion(args: string[]): Promise<CommandHandlerResult> {
  const action = args[0]?.toLowerCase() || 'status';

  if (action === 'continuity' || action === 'lineage') {
    const continuityAction = args[1]?.toLowerCase() || 'status';
    if (continuityAction === 'init' || continuityAction === 'refresh') {
      refreshCompanionContinuity();
      return {
        handled: true,
        entry: entry(formatCompanionContinuityStatus(getCompanionContinuityStatus())),
      };
    }
    if (continuityAction === 'status' || continuityAction === 'verify') {
      return {
        handled: true,
        entry: entry(formatCompanionContinuityStatus(getCompanionContinuityStatus())),
      };
    }
    return {
      handled: true,
      entry: entry([
        'Usage: /companion continuity init',
        '       /companion continuity status',
        '       /companion continuity refresh',
        '       /companion continuity verify',
      ].join('\n')),
    };
  }

  if (action === 'migration' || action === 'migrate') {
    const migrationAction = args[1]?.toLowerCase() || 'help';
    const keyFile = flagValue(args, '--key-file');
    if (migrationAction === 'export') {
      const key = keyFile || process.env.CODEBUDDY_COMPANION_MIGRATION_KEY
        ? readCompanionMigrationPassphrase({ keyFile })
        : getOrCreateCompanionMigrationPassphrase();
      const result = exportCompanionMigration({
        passphrase: key.passphrase,
        bundlePath: flagValue(args, '--output'),
      });
      return { handled: true, entry: entry(formatCompanionMigrationResult(result, key.keyPath)) };
    }
    if (migrationAction === 'verify' || migrationAction === 'restore') {
      const bundlePath = args[2] && !args[2].startsWith('--') ? args[2] : flagValue(args, '--bundle');
      if (!bundlePath) {
        return { handled: true, entry: entry('A migration bundle path is required.') };
      }
      const key = readCompanionMigrationPassphrase({ keyFile });
      const apply = migrationAction === 'restore' && args.includes('--apply');
      const overwrite = apply && args.includes('--overwrite');
      const result = restoreCompanionMigration({
        passphrase: key.passphrase,
        bundlePath,
        apply,
        overwrite,
      });
      return { handled: true, entry: entry(formatCompanionMigrationResult(result, key.keyPath)) };
    }
    return {
      handled: true,
      entry: entry([
        'Usage: /companion migration export [--output <path>] [--key-file <path>]',
        '       /companion migration verify <bundle> [--key-file <path>]',
        '       /companion migration restore <bundle> [--apply] [--overwrite] [--key-file <path>]',
      ].join('\n')),
    };
  }

  if (action === 'percepts' || action === 'senses') {
    const perceptAction = args[1]?.toLowerCase() || 'recent';
    if (perceptAction === 'recent' || perceptAction === 'list') {
      const limit = flagValue(args, '--limit');
      const modality = flagValue(args, '--modality') as CompanionPerceptModality | undefined;
      return {
        handled: true,
        entry: entry(formatCompanionPercepts(await readRecentCompanionPercepts({
          limit: limit ? parseInt(limit, 10) : undefined,
          modality,
        }))),
      };
    }

    if (perceptAction === 'stats' || perceptAction === 'status') {
      return {
        handled: true,
        entry: entry(formatCompanionPerceptStats(await getCompanionPerceptStats())),
      };
    }

    return {
      handled: true,
      entry: entry([
        'Usage: /companion percepts recent [--limit <n>] [--modality <vision|hearing|screen|self|memory|tool|suggestion>]',
        '       /companion percepts stats',
        '       /companion live [--no-record]',
        '       /companion listen-check [--wav <path>]',
        '       /companion evaluate [--no-record]',
        '       /companion improve [--dry-run] [--no-record] [--no-run-mission]',
        '       /companion radar [--no-record]',
        '       /companion impulses [--no-record]',
        '       /companion check-in [--text <text>] [--preview]',
        '       /companion missions sync|list|run-next|start|done|dismiss',
        '       /companion safety recent|stats',
      ].join('\n')),
    };
  }

  if (action === 'listen-check' || action === 'heard') {
    const wav = flagValue(args, '--wav');
    return {
      handled: true,
      entry: entry(formatCompanionListenCheck(await buildCompanionListenCheck({ wav }))),
    };
  }

  if (action === 'self' || action === 'proprioception') {
    const percept = await recordCompanionSelfState();
    return {
      handled: true,
      entry: entry([
        `Self-state percept recorded: ${percept.id}`,
        percept.summary,
      ].join('\n')),
    };
  }

  if (action === 'live' || action === 'evening' || action === 'boot') {
    const brief = await buildCompanionLiveBrief({
      record: !args.includes('--no-record'),
    });
    return {
      handled: true,
      entry: entry(formatCompanionLiveBrief(brief)),
    };
  }

  if (action === 'evaluate' || action === 'eval') {
    const evaluation = await evaluateCompanionSelf({
      recordSuggestions: !args.includes('--no-record'),
    });
    return {
      handled: true,
      entry: entry(formatCompanionSelfEvaluation(evaluation)),
    };
  }

  if (action === 'improve' || action === 'improvement') {
    const cycle = await runCompanionImprovementCycle({
      dryRun: args.includes('--dry-run'),
      recordSuggestions: !args.includes('--no-record'),
      runMission: !args.includes('--no-run-mission'),
    });
    return {
      handled: true,
      entry: entry(formatCompanionImprovementCycle(cycle)),
    };
  }

  if (action === 'radar' || action === 'compare' || action === 'competitors') {
    const radar = await buildCompanionCompetitiveRadar({
      recordSuggestions: !args.includes('--no-record'),
    });
    return {
      handled: true,
      entry: entry(formatCompanionCompetitiveRadar(radar)),
    };
  }

  if (action === 'check-in' || action === 'say') {
    const preview = args.includes('--preview') || args.includes('--no-record');
    const userText = flagValue(args, '--text', { consumeRest: true });
    const cue = await buildCompanionCheckIn({
      userText,
      recordPercept: !preview,
      createCard: !preview,
      recordSafety: !preview,
    });
    return {
      handled: true,
      entry: entry(formatCompanionCheckIn(cue)),
    };
  }

  if (action === 'impulses' || action === 'brief') {
    const brief = await buildCompanionImpulseBrief({
      recordSuggestions: !args.includes('--no-record'),
    });
    return {
      handled: true,
      entry: entry(formatCompanionImpulseBrief(brief)),
    };
  }

  if (action === 'missions' || action === 'mission-board' || action === 'board') {
    const missionAction = args[1]?.toLowerCase() || 'list';
    if (missionAction === 'sync') {
      const result = await syncCompanionMissionBoard({
        recordSuggestions: !args.includes('--no-record'),
      });
      return {
        handled: true,
        entry: entry([
          `Mission board synced from ${result.radarId}.`,
          `Created: ${result.created}, updated: ${result.updated}, unchanged: ${result.unchanged}`,
          '',
          formatCompanionMissionBoard(result.board),
        ].join('\n')),
      };
    }

    if (missionAction === 'list' || missionAction === 'status') {
      const status = flagValue(args, '--status') as CompanionMissionStatus | undefined;
      const board = await readCompanionMissionBoard();
      return {
        handled: true,
        entry: entry(formatCompanionMissionBoard(status
          ? { ...board, missions: board.missions.filter(mission => mission.status === status) }
          : board)),
      };
    }

    if (missionAction === 'run-next' || missionAction === 'next') {
      const result = await runNextCompanionMission({
        dryRun: args.includes('--dry-run'),
      });
      return {
        handled: true,
        entry: entry(formatCompanionMissionRun(result)),
      };
    }

    const missionId = args[2];
    const statusByAction: Record<string, CompanionMissionStatus> = {
      start: 'in_progress',
      done: 'done',
      complete: 'done',
      dismiss: 'dismissed',
    };
    const nextStatus = statusByAction[missionAction];
    if (nextStatus && missionId) {
      const mission = await updateCompanionMissionStatus(missionId, nextStatus);
      return {
        handled: true,
        entry: entry(`Mission ${mission.id} marked ${mission.status}.`),
      };
    }

    return {
      handled: true,
      entry: entry([
        'Usage: /companion missions sync [--no-record]',
        '       /companion missions list [--status <open|in_progress|done|dismissed>]',
        '       /companion missions run-next [--dry-run]',
        '       /companion missions start <id>',
        '       /companion missions done <id>',
        '       /companion missions dismiss <id>',
      ].join('\n')),
    };
  }

  if (action === 'safety' || action === 'ledger') {
    const safetyAction = args[1]?.toLowerCase() || 'recent';
    if (safetyAction === 'recent' || safetyAction === 'list') {
      const limit = flagValue(args, '--limit');
      const kind = flagValue(args, '--kind') as CompanionSafetyEventKind | undefined;
      const risk = flagValue(args, '--risk') as CompanionSafetyEventRisk | undefined;
      return {
        handled: true,
        entry: entry(formatCompanionSafetyEvents(await readRecentCompanionSafetyEvents({
          limit: limit ? parseInt(limit, 10) : undefined,
          kind,
          risk,
        }))),
      };
    }

    if (safetyAction === 'stats' || safetyAction === 'status') {
      return {
        handled: true,
        entry: entry(formatCompanionSafetyLedgerStats(await getCompanionSafetyLedgerStats())),
      };
    }

    return {
      handled: true,
      entry: entry([
        'Usage: /companion safety recent [--limit <n>] [--kind <sense|tool|mission|permission|data>] [--risk <low|medium|high>]',
        '       /companion safety stats',
      ].join('\n')),
    };
  }

  if (action === 'camera' || action === 'vision' || action === 'see') {
    const cameraAction = args[1]?.toLowerCase() || 'status';
    if (cameraAction === 'status' || cameraAction === 'doctor') {
      return {
        handled: true,
        entry: entry(formatCameraStatus(await checkCameraAvailability())),
      };
    }

    if (cameraAction === 'snapshot' || cameraAction === 'snap') {
      const outputPath = flagValue(args, '--output') ?? flagValue(args, '--output-path');
      const device = flagValue(args, '--device');
      const timeout = flagValue(args, '--timeout-ms');
      const result = await captureCameraSnapshot({
        outputPath,
        device,
        timeoutMs: timeout ? parseInt(timeout, 10) : undefined,
      });

      if (result.success) {
        return {
          handled: true,
          entry: entry([
            `Camera snapshot saved: ${result.path}`,
            result.perceptId ? `Percept recorded: ${result.perceptId}` : '',
            result.command ? `Command: ${result.command}` : '',
            'Buddy can now inspect this image with the vision/OCR tools or include it in the next multimodal turn.',
          ].filter(Boolean).join('\n')),
        };
      }

      return {
        handled: true,
        entry: entry([
          `Camera snapshot failed: ${result.error || 'unknown error'}`,
          result.command ? `Command: ${result.command}` : '',
        ].filter(Boolean).join('\n')),
      };
    }

    if (cameraAction === 'inspect' || cameraAction === 'look') {
      const imagePath = flagValue(args, '--image') ?? flagValue(args, '--path');
      const outputPath = flagValue(args, '--output') ?? flagValue(args, '--output-path');
      const device = flagValue(args, '--device');
      const timeout = flagValue(args, '--timeout-ms');
      const result = await inspectCameraSnapshot({
        imagePath,
        outputPath,
        device,
        timeoutMs: timeout ? parseInt(timeout, 10) : undefined,
        includeOcr: args.includes('--ocr'),
        ocrLanguage: flagValue(args, '--language') || 'eng',
      });
      return {
        handled: true,
        entry: entry(formatCameraSnapshotInspection(result)),
      };
    }

    return {
      handled: true,
      entry: entry([
        'Usage: /companion camera status',
        '       /companion camera snapshot [--output <path>] [--device <device>] [--timeout-ms <ms>]',
        '       /companion camera inspect [--image <path>] [--ocr] [--language <lang>]',
      ].join('\n')),
    };
  }

  if (action === 'setup' || action === 'awaken' || action === 'on') {
    const force = args.includes('--force');
    const noVoice = args.includes('--no-voice');
    const noModel = args.includes('--no-set-model') || args.includes('--no-chatgpt-model');
    const language = flagValue(args, '--language');
    const model = flagValue(args, '--model') ?? flagValue(args, '--chatgpt-model');
    const ttsVoice = flagValue(args, '--tts-voice');

    const result = await setupCompanionMode({
      forceIdentity: force,
      configureVoice: !noVoice,
      configureModel: !noModel,
      language,
      model,
      ttsVoice,
    });

    const lines = [
      'Buddy companion mode is ready.',
      result.wroteSoul ? 'Installed SOUL.md.' : 'Kept existing SOUL.md.',
      result.wroteBoot ? 'Installed BOOT.md.' : 'Kept existing BOOT.md.',
      result.voiceConfigured ? 'Voice input and TTS defaults configured.' : 'Voice configuration skipped.',
      result.modelConfigured && result.model
        ? `Project model set to ${result.model}.`
        : 'Project model not changed; run `/login chatgpt` to connect ChatGPT OAuth first.',
      '',
      formatCompanionStatus(result.status),
    ];

    return { handled: true, entry: entry(lines.join('\n')) };
  }

  if (action === 'status' || action === 'doctor') {
    return {
      handled: true,
      entry: entry(formatCompanionStatus(await getCompanionStatus())),
    };
  }

  return {
    handled: true,
    entry: entry([
      'Usage: /companion status',
      '       /companion setup [--force] [--no-voice] [--no-set-model]',
      '       /companion live [--no-record]',
      '       /companion self',
      '       /companion evaluate [--no-record]',
      '       /companion improve [--dry-run] [--no-record] [--no-run-mission]',
      '       /companion radar [--no-record]',
      '       /companion impulses [--no-record]',
      '       /companion check-in [--text <text>] [--preview]',
      '       /companion missions sync|list|run-next|start|done|dismiss',
      '       /companion safety recent|stats',
      '       /companion continuity init|status|refresh|verify',
      '       /companion migration export|verify|restore',
      '       /companion camera status',
      '       /companion camera snapshot [--output <path>] [--device <device>]',
      '       /companion camera inspect [--image <path>] [--ocr]',
      '       /companion percepts recent [--limit <n>] [--modality <name>]',
      '       /companion percepts stats',
      '',
      'This configures Buddy as a ChatGPT-backed project companion with voice-first, camera-aware, and live-session defaults.',
    ].join('\n')),
  };
}
