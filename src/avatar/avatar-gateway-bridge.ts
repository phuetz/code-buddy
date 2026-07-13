import { getAvatarEventBus, type AvatarEventBus } from './avatar-event-bus.js';
import type { AvatarEvent } from './avatar-protocol.js';
import type { AvatarRendererSnapshot } from './avatar-renderer-registry.js';

export interface AvatarGatewayMessage {
  type: 'avatar:event';
  payload: unknown;
  timestamp: string;
}

export type AvatarGatewayBroadcast = (
  message: AvatarGatewayMessage,
  scope: 'avatar:read'
) => void;

export interface AvatarSyncMessage {
  type: 'avatar:sync';
  payload: {
    events: AvatarEvent[];
    latestSequence: number;
    audioReplay: false;
    recovery: 'replay_complete_turns_then_wait_next';
    ignoredTurnIds: string[];
    renderers: AvatarRendererSnapshot[];
  };
  timestamp: string;
}

export function canReadAvatarEvents(scopes: string[]): boolean {
  return scopes.includes('avatar:read') || scopes.includes('admin');
}

export function canReportAvatarStatus(scopes: string[]): boolean {
  return scopes.includes('avatar:write') || scopes.includes('admin');
}

function unfinishedTurnIds(events: AvatarEvent[]): Set<string> {
  const active = new Set<string>();
  for (const event of events) {
    if (
      event.type === 'avatar.speech.completed' ||
      event.type === 'avatar.speech.interrupted' ||
      event.type === 'avatar.speech.failed' ||
      event.type === 'avatar.turn.silent'
    ) {
      active.delete(event.turnId);
    } else {
      active.add(event.turnId);
    }
  }
  return active;
}

export function buildAvatarSyncMessage(
  events: AvatarEvent[],
  now = new Date(),
  renderers: AvatarRendererSnapshot[] = []
): AvatarSyncMessage {
  const ignored = unfinishedTurnIds(events);
  return {
    type: 'avatar:sync',
    payload: {
      // Replaying an unfinished turn without its ephemeral WAV would create a
      // talking face with no sound. Completed turns are safe to reconstruct;
      // the active turn is explicitly ignored until its terminal event.
      events: events.filter((event) => !ignored.has(event.turnId)).map((event) => ({ ...event })),
      latestSequence: events.at(-1)?.sequence ?? -1,
      audioReplay: false,
      recovery: 'replay_complete_turns_then_wait_next',
      ignoredTurnIds: [...ignored],
      renderers: renderers.map((renderer) => ({
        ...renderer,
        capabilities: { ...renderer.capabilities },
      })),
    },
    timestamp: now.toISOString(),
  };
}

/** Expose performance events to authenticated avatar renderers only. */
export function wireAvatarGatewayBridge(
  broadcast: AvatarGatewayBroadcast,
  bus: AvatarEventBus = getAvatarEventBus()
): () => void {
  return bus.subscribe((event) => {
    broadcast(
      {
        type: 'avatar:event',
        payload: event,
        timestamp: event.timestamp,
      },
      'avatar:read'
    );
  });
}
