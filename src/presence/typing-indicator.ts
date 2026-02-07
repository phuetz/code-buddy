import { EventEmitter } from 'events';

export type ChannelType = 'telegram' | 'discord' | 'slack' | 'terminal';

export interface TypingSession {
  channel: ChannelType;
  chatId: string;
  interval: ReturnType<typeof setInterval> | null;
  active: boolean;
  startedAt: number;
}

export interface PresenceState {
  status: 'online' | 'busy' | 'idle' | 'offline';
  lastActivity: number;
  currentTask?: string;
}

export class TypingIndicatorManager extends EventEmitter {
  private sessions: Map<string, TypingSession> = new Map();
  private presence: PresenceState = { status: 'online', lastActivity: Date.now() };
  private intervalMs: number;

  constructor(intervalMs: number = 4000) {
    super();
    this.intervalMs = intervalMs;
  }

  startTyping(channel: ChannelType, chatId: string): string {
    const key = `${channel}:${chatId}`;
    if (this.sessions.has(key)) return key;

    const session: TypingSession = {
      channel,
      chatId,
      interval: null,
      active: true,
      startedAt: Date.now(),
    };

    this.emit('typing', { channel, chatId, typing: true });

    session.interval = setInterval(() => {
      if (session.active) {
        this.emit('typing', { channel, chatId, typing: true });
      }
    }, this.intervalMs);

    this.sessions.set(key, session);
    this.updatePresence('busy');
    return key;
  }

  stopTyping(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;

    session.active = false;
    if (session.interval) {
      clearInterval(session.interval);
      session.interval = null;
    }

    this.emit('typing', { channel: session.channel, chatId: session.chatId, typing: false });
    this.sessions.delete(key);

    if (this.sessions.size === 0) {
      this.updatePresence('online');
    }
  }

  stopAll(): void {
    const keys = Array.from(this.sessions.keys());
    for (const key of keys) {
      this.stopTyping(key);
    }
  }

  updatePresence(status: PresenceState['status'], task?: string): void {
    this.presence = {
      status,
      lastActivity: Date.now(),
      currentTask: task,
    };
    this.emit('presence', { ...this.presence });
  }

  getPresence(): PresenceState {
    return { ...this.presence };
  }

  getActiveCount(): number {
    return this.sessions.size;
  }

  dispose(): void {
    this.stopAll();
    this.removeAllListeners();
  }
}
