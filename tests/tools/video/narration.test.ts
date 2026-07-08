/**
 * narration — Piper voiceover synthesis + clip muxing.
 *
 * Pure: voice resolution, Piper argv, the mux filter argv. I/O: synthesize with
 * an injected spawn (fake Piper + ffprobe), proving the fail-open contract
 * (empty text / no voice / Piper error → null, never throws).
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';

import {
  resolvePiperVoice,
  buildPiperArgs,
  buildMuxNarrationArgs,
  synthesizeNarration,
} from '../../../src/tools/video/narration.js';

function makeSpawn(
  opts: { piperCode?: number; probeDur?: string; seen?: string[][] } = {}
): typeof spawn {
  return ((cmd: string, args: string[]) => {
    opts.seen?.push([cmd, ...args]);
    const child = new EventEmitter() as unknown as ReturnType<typeof spawn> & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { write: () => void; end: () => void };
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: () => undefined, end: () => undefined };
    child.kill = () => undefined;
    const isProbe = cmd.includes('ffprobe');
    setImmediate(() => {
      if (isProbe) {
        child.stdout.emit('data', Buffer.from(`${opts.probeDur ?? '4.20'}\n`));
        child.emit('close', 0);
      } else {
        child.emit('close', opts.piperCode ?? 0);
      }
    });
    return child;
  }) as unknown as typeof spawn;
}

describe('resolvePiperVoice', () => {
  it('reads CODEBUDDY_TTS_VOICE then CODEBUDDY_TTS_PIPER_MODEL, else null', () => {
    expect(resolvePiperVoice({ CODEBUDDY_TTS_VOICE: '/v.onnx' } as NodeJS.ProcessEnv)).toBe(
      '/v.onnx'
    );
    expect(resolvePiperVoice({ CODEBUDDY_TTS_PIPER_MODEL: '/m.onnx' } as NodeJS.ProcessEnv)).toBe(
      '/m.onnx'
    );
    expect(resolvePiperVoice({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('pure argv builders', () => {
  it('buildPiperArgs', () => {
    expect(buildPiperArgs('/voice.onnx', '/out.wav')).toEqual([
      '--model',
      '/voice.onnx',
      '--output_file',
      '/out.wav',
    ]);
  });

  it('buildMuxNarrationArgs delays + trims narration and copies video', () => {
    const args = buildMuxNarrationArgs('/clip.mp4', '/nar.wav', '/out.mp4', 7.4, 0.5);
    const s = args.join(' ');
    expect(s).toContain('adelay=500:all=1');
    expect(s).toContain('atrim=0:7.4');
    expect(s).toContain('-c:v copy');
    expect(args).toEqual(expect.arrayContaining(['-map', '0:v', '-map', '[a]']));
    expect(args[args.length - 1]).toBe('/out.mp4');
  });
});

describe('synthesizeNarration (injected)', () => {
  const env = { CODEBUDDY_TTS_VOICE: '/voice.onnx' } as NodeJS.ProcessEnv;

  it('returns the path + probed duration on success', async () => {
    const seen: string[][] = [];
    const r = await synthesizeNarration('Bonjour le monde', '/tmp/n.wav', {
      spawn: makeSpawn({ probeDur: '4.20', seen }),
      env,
    });
    expect(r).toEqual({ path: '/tmp/n.wav', duration: 4.2 });
    // Piper was invoked with the resolved voice + output file.
    expect(seen.some((a) => a.includes('--model') && a.includes('/voice.onnx'))).toBe(true);
  });

  it('fail-open: empty text → null (no spawn)', async () => {
    expect(await synthesizeNarration('   ', '/tmp/n.wav', { spawn: makeSpawn(), env })).toBeNull();
  });

  it('fail-open: no configured voice → null', async () => {
    expect(
      await synthesizeNarration('hello', '/tmp/n.wav', {
        spawn: makeSpawn(),
        env: {} as NodeJS.ProcessEnv,
      })
    ).toBeNull();
  });

  it('fail-open: Piper error → null', async () => {
    expect(
      await synthesizeNarration('hello', '/tmp/n.wav', { spawn: makeSpawn({ piperCode: 1 }), env })
    ).toBeNull();
  });
});
