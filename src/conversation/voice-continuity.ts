import {
  getCrossChannelConversationBridge,
  type CrossChannelConversationBridge,
} from './cross-channel-bridge.js';
import { prepareSpeech } from '../sensory/speech-sanitizer.js';
import { logger } from '../utils/logger.js';

export type CanonicalVoiceSpeaker = (content: string) => Promise<void | boolean>;

/**
 * Build a speaker for a deterministic spoken shortcut. The first call records
 * the user turn once; every spoken answer is then appended and mirrored in
 * strict bridge order. Rendering and delivery start together to avoid adding
 * journal latency to the local voice.
 */
export function createCanonicalVoiceReplySpeaker(
  heard: string,
  speak: CanonicalVoiceSpeaker,
  bridge: CrossChannelConversationBridge = getCrossChannelConversationBridge(),
): CanonicalVoiceSpeaker {
  let userTurn: Promise<boolean> | undefined;
  return async (content: string): Promise<void> => {
    userTurn ??= bridge.recordVoiceTurn({ role: 'user', content: heard });
    const prepared = prepareSpeech(content);
    if (!prepared) {
      void userTurn.catch((error) => {
        logger.warn(
          `[voice-continuity] user mirror failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return;
    }
    const assistantTurn = bridge.recordVoiceTurn({ role: 'assistant', content: prepared });
    // Appending both turns is synchronous and the bridge owns strict delivery
    // order. Telegram/network latency must not keep the physical mouth locked.
    void Promise.all([userTurn, assistantTurn]).catch((error) => {
      logger.warn(
        `[voice-continuity] conversation mirror failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    await speak(prepared);
  };
}

/** Speak an unsolicited local sentence, then journal it only if the mouth actually accepted it. */
export async function speakCanonicalVoiceInitiative(
  content: string,
  speak: CanonicalVoiceSpeaker,
  bridge: CrossChannelConversationBridge = getCrossChannelConversationBridge(),
): Promise<boolean> {
  const prepared = prepareSpeech(content);
  if (!prepared) return false;
  const spoken = await speak(prepared);
  if (spoken === false) return false;
  const mirrored = bridge.recordVoiceTurn({ role: 'assistant', content: prepared });
  void mirrored.catch((error) => {
    logger.warn(
      `[voice-continuity] initiative mirror failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  return true;
}

/** Append a proactive sentence that has already been delivered on the target channel. */
export async function recordDeliveredChannelInitiative(
  content: string,
  externalId?: string,
  bridge: CrossChannelConversationBridge = getCrossChannelConversationBridge(),
): Promise<boolean> {
  return bridge.recordTargetChannelTurnDurably(
    { role: 'assistant', content },
    externalId,
  );
}
