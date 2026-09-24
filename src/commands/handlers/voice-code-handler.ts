/**
 * Voice-Code Handler
 *
 * /voice-code on|off|status — Control the voice-to-code pipeline.
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import { failureFlag } from '../slash-failure.js';

/** Singleton pipeline instance (lazy-loaded) */
let pipeline: { isActive: () => boolean; start: () => Promise<void>; stop: () => Promise<void> } | null = null;

export async function handleVoiceCode(args: string[]): Promise<CommandHandlerResult> {
  const action = args[0]?.toLowerCase() || 'status';

  if (action === 'on' || action === 'start') {
    try {
      const { createVoiceToCodePipeline } = await import('../../voice/voice-to-code.js');
      if (!pipeline) {
        pipeline = createVoiceToCodePipeline();
      }
      await pipeline.start();
      return {
        handled: true,
...failureFlag('Voice-to-code pipeline started. Speak commands or dictate code.'),
        entry: { type: 'assistant', content: 'Voice-to-code pipeline started. Speak commands or dictate code.', timestamp: new Date() },
      };
    } catch (err) {
      return {
        handled: true,
...failureFlag(`Failed to start voice-to-code: ${err instanceof Error ? err.message : String(err)}`),
        entry: { type: 'assistant', content: `Failed to start voice-to-code: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date() },
      };
    }
  }

  if (action === 'off' || action === 'stop') {
    if (pipeline) {
      await pipeline.stop();
    }
    return {
      handled: true,
...failureFlag('Voice-to-code pipeline stopped.'),
      entry: { type: 'assistant', content: 'Voice-to-code pipeline stopped.', timestamp: new Date() },
    };
  }

  // status
  const active = pipeline?.isActive() ?? false;
  return {
    handled: true,
...failureFlag(`Voice-to-code pipeline: ${active ? 'active' : 'inactive'}`),
    entry: { type: 'assistant', content: `Voice-to-code pipeline: ${active ? 'active' : 'inactive'}`, timestamp: new Date() },
  };
}
