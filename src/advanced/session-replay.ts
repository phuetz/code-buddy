/**
 * Deterministic Session Replay (Item 105)
 */

import fs from 'fs-extra';
import path from 'path';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

export interface ReplayEvent {
  id: string;
  timestamp: number;
  type: 'input' | 'output' | 'tool' | 'api' | 'state';
  data: unknown;
  hash: string;
}

export interface ReplaySession {
  id: string;
  name: string;
  startTime: Date;
  endTime?: Date;
  events: ReplayEvent[];
  metadata: { model: string; systemPrompt: string; toolsEnabled: string[] };
}

export class SessionReplayManager extends EventEmitter {
  private storageDir = '.codebuddy/replays';
  private currentSession: ReplaySession | null = null;
  private recording = false;

  startRecording(name: string, metadata: ReplaySession['metadata']): ReplaySession {
    this.currentSession = {
      id: crypto.randomBytes(8).toString('hex'),
      name,
      startTime: new Date(),
      events: [],
      metadata,
    };
    this.recording = true;
    this.emit('recording-started', this.currentSession.id);
    return this.currentSession;
  }

  stopRecording(): ReplaySession | null {
    if (!this.currentSession) return null;
    this.currentSession.endTime = new Date();
    this.recording = false;
    const session = this.currentSession;
    this.emit('recording-stopped', session.id);
    return session;
  }

  recordEvent(type: ReplayEvent['type'], data: unknown): void {
    if (!this.recording || !this.currentSession) return;
    const event: ReplayEvent = {
      id: crypto.randomBytes(4).toString('hex'),
      timestamp: Date.now(),
      type,
      data,
      hash: crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 8),
    };
    this.currentSession.events.push(event);
    this.emit('event-recorded', event);
  }

  async saveSession(session: ReplaySession): Promise<string> {
    await fs.ensureDir(this.storageDir);
    const safeName = session.name.replace(/[^a-z0-9]/gi, '-');
    const filename = session.id + '-' + safeName + '.json';
    const filePath = path.join(this.storageDir, filename);
    await fs.writeJson(filePath, session, { spaces: 2 });
    return filePath;
  }

  async loadSession(sessionId: string): Promise<ReplaySession | null> {
    if (!await fs.pathExists(this.storageDir)) return null;
    const files = await fs.readdir(this.storageDir);
    const sessionFile = files.find(f => f.startsWith(sessionId));
    if (!sessionFile) return null;
    return fs.readJson(path.join(this.storageDir, sessionFile));
  }

  async listSessions(): Promise<Array<{ id: string; name: string; date: Date }>> {
    if (!await fs.pathExists(this.storageDir)) return [];
    const files = await fs.readdir(this.storageDir);
    const sessions: Array<{ id: string; name: string; date: Date }> = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const session = await fs.readJson(path.join(this.storageDir, file));
          sessions.push({ id: session.id, name: session.name, date: new Date(session.startTime) });
        } catch (e) { logger.debug('Failed to parse session replay file', { error: String(e), file }); }
      }
    }
    return sessions.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  async replay(sessionId: string, options: { speed?: number; onEvent?: (e: ReplayEvent) => void } = {}): Promise<void> {
    const session = await this.loadSession(sessionId);
    if (!session) throw new Error('Session not found');
    const speed = options.speed || 1;
    this.emit('replay-started', sessionId);
    let lastTs = session.events[0]?.timestamp || 0;
    for (const event of session.events) {
      const delay = (event.timestamp - lastTs) / speed;
      if (delay > 0) await new Promise(r => setTimeout(r, Math.min(delay, 1000)));
      if (options.onEvent) options.onEvent(event);
      this.emit('replay-event', event);
      lastTs = event.timestamp;
    }
    this.emit('replay-completed', sessionId);
  }

  verifyIntegrity(session: ReplaySession): boolean {
    for (const event of session.events) {
      const expected = crypto.createHash('sha256').update(JSON.stringify(event.data)).digest('hex').slice(0, 8);
      if (event.hash !== expected) return false;
    }
    return true;
  }

  isRecording(): boolean { return this.recording; }
  getCurrentSession(): ReplaySession | null { return this.currentSession; }
}

let instance: SessionReplayManager | null = null;
export function getSessionReplayManager(): SessionReplayManager {
  if (!instance) instance = new SessionReplayManager();
  return instance;
}
export default SessionReplayManager;
