/** Publishes local status snapshots through the same membership checks as peers. */
import { getGlobalEventBus } from '../../events/event-bus.js';
import {
  createMissionObservationRoomPublisher,
  wireSensoryMissionBridge,
  type SensoryMissionBus,
} from '../sensory-mission-bridge.js';
import { buildRoomAuth, buildRoomMessage, isValidRoomId, signRoomEvent } from './room-event.js';
import type { RoomHub } from './room-hub.js';
import { loadRoomIdentity } from './room-identity.js';

export const ROOM_OBSERVATION_PRINCIPAL = 'local:fleet-room-observations';

export function startRoomObservations(
  hub: RoomHub,
  options: { env?: NodeJS.ProcessEnv; bus?: SensoryMissionBus } = {},
): () => void {
  const env = options.env ?? process.env;
  if (env.CODEBUDDY_FLEET_ROOMS_OBSERVATIONS !== 'true') return () => {};
  const room = env.CODEBUDDY_FLEET_ROOMS_ROOM;
  const missionId = env.CODEBUDDY_FLEET_ROOMS_MISSION;
  if (typeof room !== 'string' || !isValidRoomId(room) || !missionId || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(missionId)) {
    throw new Error('Room observations require a valid CODEBUDDY_FLEET_ROOMS_ROOM and CODEBUDDY_FLEET_ROOMS_MISSION');
  }
  const identity = loadRoomIdentity(env.CODEBUDDY_FLEET_ROOMS_IDENTITY);
  const audience = hub.audiences[0];
  if (!audience) throw new Error('Room observations require a configured hub audience');
  const session = hub.open({
    connectionId: ROOM_OBSERVATION_PRINCIPAL,
    principalId: ROOM_OBSERVATION_PRINCIPAL,
    send: () => false,
    isBackpressured: () => false,
  });
  try {
    const challenge = session.hello();
    const auth = session.authenticate(signRoomEvent(
      buildRoomAuth(challenge.challenge, audience, Math.floor(hub.now() / 1000)),
      identity.secretKey,
    ));
    if (!auth.ok || !hub.access.canWrite(identity.publicKey, room)) {
      throw new Error('Room observation identity is not allowed to publish to the configured room');
    }
    const stop = wireSensoryMissionBridge({
      enabled: true,
      missionId,
      bus: options.bus ?? getGlobalEventBus(),
      now: hub.now,
      ...(env.CODEBUDDY_FLEET_ROOMS_OBSERVATION_INTERVAL_MS !== undefined
        ? { intervalMs: Number(env.CODEBUDDY_FLEET_ROOMS_OBSERVATION_INTERVAL_MS) }
        : {}),
      publish: createMissionObservationRoomPublisher(room, async (target, content, createdAt, signal) => {
        signal.throwIfAborted();
        const result = session.publish(signRoomEvent(
          buildRoomMessage({ room: target, content, createdAt }, identity.publicKey),
          identity.secretKey,
        ));
        if (!result.accepted) throw new Error(result.message);
      }),
    });
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      stop();
      session.dispose();
    };
  } catch (error) {
    session.dispose();
    throw error;
  }
}
