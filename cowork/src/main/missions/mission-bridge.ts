/**
 * Mission Bridge — pure main-process wrapper for the Mission Orchestrator.
 *
 * This owns the MissionManager lifecycle and translates manager signals into
 * renderer-ready server events, but deliberately does not import Electron or
 * register IPC handlers. The Electron boot file can instantiate this wrapper,
 * call `setSendToRenderer`, and expose one-shot IPC methods later.
 *
 * @module cowork/main/missions/mission-bridge
 */

import { MissionManager, type MissionEventSignal } from './mission-manager.js';
import { MissionStore } from './mission-store.js';
import {
  MissionStatus,
  SubTaskStatus,
  isTerminalStatus,
  type Clock,
  type IdFactory,
  type Mission,
  type MissionCreateInput,
  type MissionFilter,
  type SubTask,
} from './mission-types.js';
import { applyBootRecovery, type RecoveryItem } from './mission-recovery.js';
import { MissionHeartbeat } from './mission-heartbeat.js';
import { readySubTasks, type ReadySubTasksOptions } from './mission-scheduler.js';
import {
  VOICE_MISSION_EVENT,
  buildVoiceMissionAgentPrompt,
  buildVoiceMissionTitle,
  isVoiceBackgroundMission,
  voiceMissionSessionId,
  type VoiceBackgroundMissionInput,
} from '../../shared/voice-background-mission.js';

export type MissionBridgeServerEvent =
  | { type: 'mission.created'; payload: Mission }
  | { type: 'mission.updated'; payload: Mission }
  | { type: 'mission.event'; payload: MissionEventSignal }
  | { type: 'mission.heartbeat'; payload: { missionId: string } };

export type MissionBridgeSend = (event: MissionBridgeServerEvent) => void;

export interface MissionBridgeOptions {
  manager?: MissionManager;
  store?: MissionStore;
  now?: Clock;
  idFactory?: IdFactory;
  heartbeatIntervalMs?: number;
  sendToRenderer?: MissionBridgeSend;
  executeVoiceMission?: VoiceMissionExecutor;
  cancelVoiceSession?: (sessionId: string) => void;
  inspectVoiceSession?: (sessionId: string) => VoiceSessionState;
}

export type VoiceSessionState = 'queued' | 'running' | 'completed' | 'failed' | 'missing';

export type VoiceMissionExecutor = (input: {
  missionId: string;
  title: string;
  prompt: string;
  cwd?: string;
  projectId?: string;
}) => Promise<{ sessionId: string }>;

export interface VoiceSessionOutcome {
  sessionId: string;
  status: 'completed' | 'failed';
  resultPreview?: string;
  error?: string;
}

export interface MissionBridgeInitOptions {
  /** Defaults to true so interrupted planning/running missions are parked. */
  recoverInterrupted?: boolean;
}

export class MissionBridge {
  readonly manager: MissionManager;
  readonly heartbeat: MissionHeartbeat;
  private sendToRenderer: MissionBridgeSend | null;
  private readonly executeVoiceMission: VoiceMissionExecutor | null;
  private readonly cancelVoiceSession: ((sessionId: string) => void) | null;
  private readonly inspectVoiceSession: ((sessionId: string) => VoiceSessionState) | null;
  private readonly voiceSessionToMission = new Map<string, string>();

  private readonly onCreated = (mission: Mission) => {
    this.emit({ type: 'mission.created', payload: mission });
  };
  private readonly onUpdated = (mission: Mission) => {
    this.emit({ type: 'mission.updated', payload: mission });
  };
  private readonly onEvent = (payload: MissionEventSignal) => {
    this.emit({ type: 'mission.event', payload });
  };
  private readonly onHeartbeat = (missionId: string) => {
    this.emit({ type: 'mission.heartbeat', payload: { missionId } });
  };

  constructor(options: MissionBridgeOptions = {}) {
    this.manager =
      options.manager ??
      new MissionManager({
        store: options.store ?? new MissionStore(),
        now: options.now,
        idFactory: options.idFactory,
      });
    this.heartbeat = new MissionHeartbeat({
      manager: this.manager,
      clock: options.now,
      intervalMs: options.heartbeatIntervalMs,
    });
    this.sendToRenderer = options.sendToRenderer ?? null;
    this.executeVoiceMission = options.executeVoiceMission ?? null;
    this.cancelVoiceSession = options.cancelVoiceSession ?? null;
    this.inspectVoiceSession = options.inspectVoiceSession ?? null;

    this.manager.on('mission:created', this.onCreated);
    this.manager.on('mission:updated', this.onUpdated);
    this.manager.on('mission:event', this.onEvent);
    this.manager.on('mission:heartbeat', this.onHeartbeat);
  }

  setSendToRenderer(sendToRenderer: MissionBridgeSend | null): void {
    this.sendToRenderer = sendToRenderer;
  }

  async init(options: MissionBridgeInitOptions = {}): Promise<RecoveryItem[]> {
    await this.manager.init();
    this.rebuildVoiceSessionIndex();
    if (options.recoverInterrupted === false) return [];
    const recovered = await applyBootRecovery(this.manager);
    this.rebuildVoiceSessionIndex();
    await this.reconcileRecoveredVoiceMissions(recovered);
    this.rebuildVoiceSessionIndex();
    return recovered;
  }

  listMissions(filter?: MissionFilter): Mission[] {
    return this.manager.listMissions(filter);
  }

  getMission(id: string): Mission | null {
    return this.manager.getMission(id);
  }

  createMission(input: MissionCreateInput): Promise<Mission> {
    return this.manager.createMission(input);
  }

  /**
   * Persist a voice mission first, then start its existing background-session
   * executor on the next microtask.  IPC therefore returns an acknowledgement
   * immediately while the durable mission remains the single source of truth.
   */
  async createVoiceMission(input: VoiceBackgroundMissionInput): Promise<Mission> {
    if (!this.executeVoiceMission) {
      throw new Error('Voice background mission executor is unavailable');
    }
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error('prompt is required');
    if (prompt.length > 50_000) throw new Error('prompt exceeds the 50000 character limit');

    const title = input.title?.trim() || buildVoiceMissionTitle(prompt);
    const mission = await this.manager.createMission({
      title,
      description: prompt,
      status: MissionStatus.Planning,
      subTasks: [
        {
          title: 'Exécuter la demande vocale en arrière-plan',
          description: 'Session Cowork persistante avec résultat ouvrable.',
        },
      ],
    });
    await this.manager.recordEvent(mission.id, {
      type: VOICE_MISSION_EVENT.queued,
      message: 'Demande vocale mise en file comme mission persistante.',
      data: {
        source: 'voice',
        externalActionsRequireConfirmation: true,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
      },
    });

    // Starting a background SessionManager session only persists and enqueues
    // work; it does not wait for the agent result. Await that short handshake
    // so there is no crash-only window where the durable mission exists but
    // its sole launch callback lives only in a microtask.
    await this.startVoiceMission(mission.id, {
      ...input,
      prompt,
      title,
    });
    return this.manager.getMission(mission.id) ?? mission;
  }

  updateStatus(missionId: string, status: MissionStatus): Promise<Mission> {
    return this.manager.updateStatus(missionId, status);
  }

  cancel(missionId: string): Promise<Mission> {
    const mission = this.manager.getMission(missionId);
    const sessionId = mission ? voiceMissionSessionId(mission) : undefined;
    if (sessionId) {
      this.cancelVoiceSession?.(sessionId);
      this.voiceSessionToMission.delete(sessionId);
    }
    return this.manager.cancel(missionId);
  }

  /** Complete/fail a voice mission when its one existing background session settles. */
  async settleVoiceSession(outcome: VoiceSessionOutcome): Promise<Mission | null> {
    const missionId = this.voiceSessionToMission.get(outcome.sessionId)
      ?? this.findVoiceMissionId(outcome.sessionId);
    if (!missionId) return null;
    const mission = this.manager.getMission(missionId);
    if (!mission || isTerminalStatus(mission.status)) return mission;
    const subTask = mission.subTasks[0];

    if (outcome.status === 'completed') {
      if (subTask) {
        await this.manager.updateSubTaskStatus(
          missionId,
          subTask.id,
          SubTaskStatus.Completed,
          {
            result: {
              sessionId: outcome.sessionId,
              ...(outcome.resultPreview ? { preview: outcome.resultPreview } : {}),
            },
          },
        );
      }
      await this.manager.recordEvent(missionId, {
        type: VOICE_MISSION_EVENT.completed,
        message: 'Mission vocale terminée. Le résultat est disponible dans sa session.',
        data: {
          sessionId: outcome.sessionId,
          ...(outcome.resultPreview ? { resultPreview: outcome.resultPreview } : {}),
        },
      });
      this.voiceSessionToMission.delete(outcome.sessionId);
      return this.manager.updateStatus(missionId, MissionStatus.Completed);
    }

    const error = outcome.error?.trim() || 'La session de fond a échoué.';
    if (subTask) {
      await this.manager.updateSubTaskStatus(
        missionId,
        subTask.id,
        SubTaskStatus.Failed,
        { error },
      );
    }
    await this.manager.recordEvent(missionId, {
      type: VOICE_MISSION_EVENT.failed,
      message: error,
      data: { sessionId: outcome.sessionId, error },
    });
    this.voiceSessionToMission.delete(outcome.sessionId);
    return this.manager.updateStatus(missionId, MissionStatus.Failed);
  }

  readySubTasks(missionId: string, options?: ReadySubTasksOptions): SubTask[] {
    const mission = this.manager.getMission(missionId);
    return mission ? readySubTasks(mission, options) : [];
  }

  tickHeartbeat(now?: string): Promise<Mission[]> {
    return this.heartbeat.tick(now);
  }

  dispose(): void {
    this.manager.off('mission:created', this.onCreated);
    this.manager.off('mission:updated', this.onUpdated);
    this.manager.off('mission:event', this.onEvent);
    this.manager.off('mission:heartbeat', this.onHeartbeat);
    this.sendToRenderer = null;
  }

  private emit(event: MissionBridgeServerEvent): void {
    this.sendToRenderer?.(event);
  }

  private async startVoiceMission(
    missionId: string,
    input: VoiceBackgroundMissionInput & { title: string },
  ): Promise<void> {
    const mission = this.manager.getMission(missionId);
    if (!mission || isTerminalStatus(mission.status) || !this.executeVoiceMission) return;
    const subTask = mission.subTasks[0];

    try {
      const execution = await this.executeVoiceMission({
        missionId,
        title: input.title,
        prompt: buildVoiceMissionAgentPrompt(input.prompt),
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
      });
      const latest = this.manager.getMission(missionId);
      if (!latest || isTerminalStatus(latest.status)) {
        this.cancelVoiceSession?.(execution.sessionId);
        return;
      }

      this.voiceSessionToMission.set(execution.sessionId, missionId);
      await this.manager.recordEvent(missionId, {
        type: VOICE_MISSION_EVENT.sessionStarted,
        message: 'Session de fond démarrée.',
        data: { sessionId: execution.sessionId },
      });
      if (!this.isOpenMission(missionId)) {
        this.cancelStartedVoiceSession(execution.sessionId);
        return;
      }
      if (subTask) {
        await this.manager.updateSubTaskStatus(
          missionId,
          subTask.id,
          SubTaskStatus.Running,
          { progress: 10, result: { sessionId: execution.sessionId } },
        );
      }
      if (!this.isOpenMission(missionId)) {
        this.cancelStartedVoiceSession(execution.sessionId);
        return;
      }
      await this.manager.updateStatus(missionId, MissionStatus.Running);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = this.manager.getMission(missionId);
      if (!current || isTerminalStatus(current.status)) return;
      if (subTask) {
        await this.manager.updateSubTaskStatus(
          missionId,
          subTask.id,
          SubTaskStatus.Failed,
          { error: message },
        );
      }
      if (!this.isOpenMission(missionId)) return;
      await this.manager.recordEvent(missionId, {
        type: VOICE_MISSION_EVENT.failed,
        message,
        data: { error: message },
      });
      if (!this.isOpenMission(missionId)) return;
      await this.manager.updateStatus(missionId, MissionStatus.Failed);
    }
  }

  private isOpenMission(missionId: string): boolean {
    const mission = this.manager.getMission(missionId);
    return Boolean(mission && !isTerminalStatus(mission.status));
  }

  private cancelStartedVoiceSession(sessionId: string): void {
    this.voiceSessionToMission.delete(sessionId);
    this.cancelVoiceSession?.(sessionId);
  }

  private async reconcileRecoveredVoiceMissions(recovered: RecoveryItem[]): Promise<void> {
    for (const item of recovered) {
      const mission = this.manager.getMission(item.missionId);
      if (!mission || !isVoiceBackgroundMission(mission)) continue;
      const sessionId = voiceMissionSessionId(mission);

      // A crash before SessionManager returned is safe to retry: no session id
      // was ever persisted, so there cannot be a duplicate live worker.
      if (!sessionId) {
        const context = voiceMissionLaunchContext(mission);
        await this.startVoiceMission(mission.id, {
          prompt: mission.description,
          title: mission.title,
          ...context,
        });
        continue;
      }

      if (!this.inspectVoiceSession) continue;
      const state = this.inspectVoiceSession(sessionId);
      if (state === 'completed') {
        await this.settleVoiceSession({ sessionId, status: 'completed' });
        continue;
      }
      if (state === 'failed' || state === 'missing') {
        await this.settleVoiceSession({
          sessionId,
          status: 'failed',
          error: state === 'missing'
            ? 'La session de fond persistée est introuvable après le redémarrage.'
            : 'La session de fond avait échoué avant le redémarrage.',
        });
        continue;
      }

      const current = this.manager.getMission(mission.id);
      const subTask = current?.subTasks[0];
      if (subTask && subTask.status !== SubTaskStatus.Running) {
        await this.manager.updateSubTaskStatus(
          mission.id,
          subTask.id,
          SubTaskStatus.Running,
          { progress: Math.max(10, subTask.progress), result: { sessionId } },
        );
      }
      if (this.isOpenMission(mission.id)) {
        await this.manager.updateStatus(mission.id, MissionStatus.Running);
      }
    }
  }

  private rebuildVoiceSessionIndex(): void {
    this.voiceSessionToMission.clear();
    for (const mission of this.manager.listMissions()) {
      const sessionId = voiceMissionSessionId(mission);
      if (sessionId) this.voiceSessionToMission.set(sessionId, mission.id);
    }
  }

  private findVoiceMissionId(sessionId: string): string | null {
    for (const mission of this.manager.listMissions()) {
      if (voiceMissionSessionId(mission) === sessionId) return mission.id;
    }
    return null;
  }
}

function voiceMissionLaunchContext(mission: Mission): Pick<VoiceBackgroundMissionInput, 'cwd' | 'projectId'> {
  const queued = [...mission.events]
    .reverse()
    .find((event) => event.type === VOICE_MISSION_EVENT.queued);
  const data = queued?.data && typeof queued.data === 'object'
    ? queued.data as Record<string, unknown>
    : {};
  return {
    ...(typeof data.cwd === 'string' && data.cwd.trim() ? { cwd: data.cwd } : {}),
    ...(typeof data.projectId === 'string' && data.projectId.trim()
      ? { projectId: data.projectId }
      : {}),
  };
}
