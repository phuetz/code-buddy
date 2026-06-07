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
}

export interface MissionBridgeInitOptions {
  /** Defaults to true so interrupted planning/running missions are parked. */
  recoverInterrupted?: boolean;
}

export class MissionBridge {
  readonly manager: MissionManager;
  readonly heartbeat: MissionHeartbeat;
  private sendToRenderer: MissionBridgeSend | null;

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
    if (options.recoverInterrupted === false) return [];
    return applyBootRecovery(this.manager);
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

  updateStatus(missionId: string, status: MissionStatus): Promise<Mission> {
    return this.manager.updateStatus(missionId, status);
  }

  cancel(missionId: string): Promise<Mission> {
    return this.manager.cancel(missionId);
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
}
