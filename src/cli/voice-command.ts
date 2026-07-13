/**
 * `buddy voice` — push-to-talk voice COMMANDS for the terminal. Press Enter to stop
 * recording; the utterance drives a real agent turn (it can investigate AND, under a
 * higher posture, act), and the result is spoken back. Routes through the SAME core as
 * the sensory daemon: STT (faster-whisper) → makeAgentReply (full agent turn under a
 * permission posture) → condensed spoken reply (Piper).
 *
 * Voice defaults to the normal guarded posture.  Collaboration/plan state is
 * independent: an explicit `--mode plan` remains read-only, but a previous
 * planning session can no longer silently disable Lisa's everyday actions.
 *
 * @module cli/voice-command
 */

import { logger } from '../utils/logger.js';
import type { PermissionMode } from '../security/permission-modes.js';

export interface VoiceCommandOptions {
  /** Voice ACT posture. Default 'default' (guarded workspace actions). */
  permissionMode?: PermissionMode;
  /** Record one utterance, return the WAV path. Default: voice-input.recordAudio (Enter to stop). */
  record?: () => Promise<string>;
  /** Transcribe a WAV → text. Default: the daemon's faster-whisper path. */
  transcribe?: (wav: string) => Promise<string>;
  /** Handle the transcript (drive the turn + speak). Default: makeVoiceReply({makeAgentReply}). */
  onHeard?: (text: string) => Promise<void>;
  /** Output sink (default console.log). */
  print?: (s: string) => void;
  /** Run a single capture (e.g. the /listen slash) instead of looping. */
  once?: boolean;
  /** Loop guard for tests — stop after N rounds even without an exit signal. */
  maxRounds?: number;
}

/** Run the push-to-talk loop. Resolves when the user exits (Ctrl-C) or `once`/`maxRounds` is hit. */
export async function runVoiceCommand(options: VoiceCommandOptions = {}): Promise<void> {
  const mode: PermissionMode = options.permissionMode ?? 'default';
  const print = options.print ?? ((s: string) => console.log(s));

  const record =
    options.record ??
    (async () => {
      const { recordAudio } = await import('../tools/voice-input.js');
      return recordAudio(0); // 0 = manual stop (Enter)
    });
  const transcribe =
    options.transcribe ??
    (async (wav: string) => {
      const { transcribeWav } = await import('../sensory/speech-reaction.js');
      return transcribeWav(wav);
    });
  const onHeard =
    options.onHeard ??
    (await (async () => {
      const { makeVoiceReply } = await import('../sensory/voice-loop.js');
      const { makeAgentReply } = await import('../sensory/agent-reply.js');
      return makeVoiceReply({ replyFn: makeAgentReply({ permissionMode: mode }) });
    })());

  const postureLabel =
    mode === 'plan'
      ? ' (read-only)'
      : mode === 'default'
        ? ' (guarded workspace sandbox)'
        : mode === 'acceptEdits'
          ? ' (edits allowed, shell guarded)'
          : ' — CAN EDIT/RUN';
  print(
    `🎙️  Voice commands — posture: ${mode}${postureLabel}.` +
      `${options.once ? '' : ' Ctrl-C to quit.'}`
  );

  let round = 0;
  for (;;) {
    round += 1;
    try {
      const wav = await record();
      const text = (await transcribe(wav)).trim();
      if (!text) {
        print('… (rien entendu)');
      } else {
        print(`🗣️  ${text}`);
        await onHeard(text); // drives the turn AND speaks the reply
      }
    } catch (err) {
      // A single failed round must not kill the loop.
      logger.warn(`[voice-cmd] round failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (options.once) break;
    if (options.maxRounds !== undefined && round >= options.maxRounds) break;
  }
}
