import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AvatarRendererRegistry } from '../../src/avatar/avatar-renderer-registry.js';
import { AvatarRendererSimulator } from '../../src/avatar/avatar-renderer-simulator.js';
import type { AvatarEvent } from '../../src/avatar/avatar-protocol.js';
import { makeVoiceReply } from '../../src/sensory/voice-loop.js';

describe('voice → Gateway → MetaHuman reference renderer → feedback', () => {
  it('reconstructs exact audio and reports a completed renderer cycle to Code Buddy', async () => {
    const previous = process.env.CODEBUDDY_AVATAR_STREAM_AUDIO;
    process.env.CODEBUDDY_AVATAR_STREAM_AUDIO = 'true';
    const dir = mkdtempSync(join(tmpdir(), 'avatar-e2e-'));
    const wavPath = join(dir, 'lisa.wav');
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(140_000, 3)]);
    writeFileSync(wavPath, wav);
    const events: AvatarEvent[] = [];
    try {
      const handler = makeVoiceReply({
        replyFn: async () => 'Voici la réponse incarnée de Lisa.',
        synth: async () => wavPath,
        play: async () => undefined,
        onAvatarEvent: (event) => events.push(event),
      });
      await handler('Lisa, explique-moi cette idée.');

      const simulator = new AvatarRendererSimulator('darkstar-metahuman');
      const registry = new AvatarRendererRegistry();
      expect(registry.register('ws-darkstar', simulator.hello()).ok).toBe(true);
      for (const event of events) {
        simulator.consumeGatewayMessage({
          type: 'avatar:event',
          payload: event,
          timestamp: event.timestamp,
        });
      }

      const rendered = simulator.drainCompletedAudio();
      expect(rendered).toHaveLength(1);
      expect(rendered[0]?.audio).toEqual(wav);
      expect(simulator.snapshot().phase).toBe('idle');
      expect(registry.report('ws-darkstar', simulator.status())).toMatchObject({
        ok: true,
        renderer: {
          rendererId: 'darkstar-metahuman',
          phase: 'ready',
          connected: true,
          droppedAudioChunks: 0,
        },
      });
    } finally {
      if (previous === undefined) delete process.env.CODEBUDDY_AVATAR_STREAM_AUDIO;
      else process.env.CODEBUDDY_AVATAR_STREAM_AUDIO = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
