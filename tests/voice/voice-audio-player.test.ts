import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const playerHarness = vi.hoisted(() => ({
  spawn: vi.fn(),
  commands: [] as string[],
  args: [] as string[][],
}));
const commandExists = vi.hoisted(() => vi.fn(async (command: string) => command === 'ffplay'));
const cacheLookup = vi.hoisted(() => vi.fn());
const openPocketAudioStream = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({ spawn: playerHarness.spawn }));
vi.mock('../../src/utils/command-exists.js', () => ({ commandExists }));
vi.mock('../../src/sensory/tts-cache.js', () => ({
  getTtsCache: () => ({ lookup: cacheLookup }),
}));
vi.mock('../../src/voice/local-tts.js', () => ({
  resolveTtsEngine: () => 'pocket',
  openPocketAudioStream,
}));

import { __voiceAudioPlayerTest } from '../../src/sensory/voice-loop.js';

function pcm16Wav(): Buffer {
  const sampleCount = 3_000;
  const wav = Buffer.alloc(44 + sampleCount * 2);
  wav.write('RIFF', 0, 4, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8, 4, 'ascii');
  wav.write('fmt ', 12, 4, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24_000, 24);
  wav.writeUInt32LE(48_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 4, 'ascii');
  wav.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const pattern = [0, 1_000, -2_000, 3_000, -3_000];
    wav.writeInt16LE(pattern[index % pattern.length]!, 44 + index * 2);
  }
  return wav;
}

describe('voice loop — one audio player per turn', () => {
  beforeEach(() => {
    playerHarness.commands.length = 0;
    playerHarness.args.length = 0;
    playerHarness.spawn.mockImplementation((command: string, args: string[], options: {
      stdio: unknown;
    }) => {
      playerHarness.commands.push(command);
      playerHarness.args.push(args);
      const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough | null;
        kill: () => boolean;
      };
      child.stdin = Array.isArray(options.stdio) ? new PassThrough() : null;
      child.kill = () => {
        queueMicrotask(() => child.emit('close', null));
        return true;
      };
      if (child.stdin) {
        child.stdin.once('finish', () => queueMicrotask(() => child.emit('close', 0)));
      } else {
        queueMicrotask(() => child.emit('close', 0));
      }
      return child;
    });
    commandExists.mockClear();
    cacheLookup.mockReset();
    cacheLookup.mockImplementation((text: string) =>
      text === 'Alors…' ? '/tmp/codebuddy-cached-backchannel.wav' : null
    );
    openPocketAudioStream.mockReset();
    openPocketAudioStream.mockImplementation(async () => {
      const wav = pcm16Wav();
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(wav);
          controller.close();
        },
      });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses the same WAV-aware binary for cached and streamed segments', async () => {
    const playerPromise = __voiceAudioPlayerTest.resolveVoiceAudioPlayer();
    const streamSpeak = __voiceAudioPlayerTest.makeDefaultStreamSpeak(playerPromise);

    expect(streamSpeak).toBeDefined();
    expect(await streamSpeak!('Alors…')).toBe(true);
    expect(await streamSpeak!('Voici la réponse complète.')).toBe(true);

    expect(playerHarness.commands).toEqual(['ffplay', 'ffplay']);
    expect(playerHarness.commands).not.toContain('pw-play');
    expect(commandExists.mock.calls.map(([command]) => command)).toEqual(['aplay', 'ffplay']);
    expect(playerHarness.args[0]).toContain('/tmp/codebuddy-cached-backchannel.wav');
    expect(playerHarness.args[1]).toContain('pipe:0');
  });
});
