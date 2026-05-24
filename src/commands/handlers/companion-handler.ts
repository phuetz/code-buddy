import type { ChatEntry } from '../../agent/codebuddy-agent.js';
import type { CommandHandlerResult } from './branch-handlers.js';
import {
  formatCompanionStatus,
  getCompanionStatus,
  recordCompanionSelfState,
  setupCompanionMode,
} from '../../companion/companion-mode.js';
import {
  captureCameraSnapshot,
  checkCameraAvailability,
  formatCameraStatus,
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
  buildCompanionImpulseBrief,
  formatCompanionImpulseBrief,
} from '../../companion/impulses.js';
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

function entry(content: string): ChatEntry {
  return {
    type: 'assistant',
    content,
    timestamp: new Date(),
  };
}

function flagValue(args: string[], name: string): string | undefined {
  const equals = args.find(arg => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function handleCompanion(args: string[]): Promise<CommandHandlerResult> {
  const action = args[0]?.toLowerCase() || 'status';

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
        '       /companion evaluate [--no-record]',
        '       /companion radar [--no-record]',
        '       /companion impulses [--no-record]',
        '       /companion missions sync|list|run-next|start|done|dismiss',
        '       /companion safety recent|stats',
      ].join('\n')),
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

  if (action === 'evaluate' || action === 'eval' || action === 'improve') {
    const evaluation = await evaluateCompanionSelf({
      recordSuggestions: !args.includes('--no-record'),
    });
    return {
      handled: true,
      entry: entry(formatCompanionSelfEvaluation(evaluation)),
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

  if (action === 'impulses' || action === 'brief' || action === 'check-in') {
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

    return {
      handled: true,
      entry: entry([
        'Usage: /companion camera status',
        '       /companion camera snapshot [--output <path>] [--device <device>] [--timeout-ms <ms>]',
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
      '       /companion self',
      '       /companion evaluate [--no-record]',
      '       /companion radar [--no-record]',
      '       /companion impulses [--no-record]',
      '       /companion missions sync|list|run-next|start|done|dismiss',
      '       /companion safety recent|stats',
      '       /companion camera status',
      '       /companion camera snapshot [--output <path>] [--device <device>]',
      '       /companion percepts recent [--limit <n>] [--modality <name>]',
      '       /companion percepts stats',
      '',
      'This configures Buddy as a ChatGPT-backed project companion with voice-first and camera-aware defaults.',
    ].join('\n')),
  };
}
