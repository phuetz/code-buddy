import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { AvatarEvent, AvatarEventInput } from './avatar-protocol.js';

export type AvatarEventListener = (event: AvatarEvent) => void;

/** Bounded in-process performance bus shared by the voice loop and Gateway. */
export class AvatarEventBus {
  private readonly emitter = new EventEmitter();
  private readonly events: AvatarEvent[] = [];
  private sequence = 0;

  constructor(private readonly maxEvents = 100) {
    this.emitter.setMaxListeners(50);
  }

  publish(input: AvatarEventInput, now = new Date()): AvatarEvent {
    const event = {
      ...input,
      version: 1,
      id: randomUUID(),
      sequence: this.sequence++,
      timestamp: now.toISOString(),
    } as AvatarEvent;
    // Audio is ephemeral and may contain many binary chunks. It is delivered live but never
    // retained in replay history; late renderers start cleanly on the next speech turn.
    if (!event.type.startsWith('avatar.audio.')) {
      this.events.push(event);
      while (this.events.length > Math.max(10, this.maxEvents)) this.events.shift();
    }
    this.emitter.emit('event', event);
    return event;
  }

  subscribe(listener: AvatarEventListener): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  history(limit = this.maxEvents): AvatarEvent[] {
    return this.events.slice(-Math.max(0, limit)).map((event) => ({ ...event }));
  }

  reset(): void {
    this.events.length = 0;
    this.sequence = 0;
    this.emitter.removeAllListeners();
  }
}

let avatarEventBus: AvatarEventBus | undefined;

export function getAvatarEventBus(): AvatarEventBus {
  avatarEventBus ??= new AvatarEventBus();
  return avatarEventBus;
}

export function resetAvatarEventBus(): void {
  avatarEventBus?.reset();
  avatarEventBus = undefined;
}
