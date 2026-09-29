import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { synthesizeTextToSpeech } from '../../src/tools/text-to-speech-tool.js';
import { commandExists } from '../../src/utils/command-exists.js';

let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-piper-'));
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

interface Captured {
  command?: string;
  args?: string[];
  stdio?: unknown;
  stdin?: string;
}

/** Fake spawn for Piper: captures the invocation, captures stdin, writes a non-empty
 *  WAV at --output_file, then closes 0. Defers events with setImmediate (the tool wires
 *  its .on('close') listener after spawn returns). */
function fakePiperSpawn(captured: Captured) {
  return (command: string, args: string[], opts: { stdio?: unknown }) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: { on: () => void; end: (d?: string) => void };
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    const chunks: string[] = [];
    child.stdin = { on: () => {}, end: (d?: string) => { if (d !== undefined) chunks.push(String(d)); } };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    captured.command = command;
    captured.args = args;
    captured.stdio = opts?.stdio;

    const outIdx = args.indexOf('--output_file');
    const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined;
    setImmediate(async () => {
      captured.stdin = chunks.join('');
      if (outPath) {
        // Minimal valid-enough RIFF/WAVE header so the size check passes.
        await fs.writeFile(outPath, Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfake-audio')]));
      }
      child.emit('close', 0);
    });
    return child;
  };
}

describe('text_to_speech — piper provider (deterministic, injected spawn)', () => {
  it('builds `piper --model <onnx> --output_file <wav>` and pipes the text on stdin', async () => {
    const captured: Captured = {};
    const outputPath = path.join(workspace, '.codebuddy', 'tts', 'out.wav');

    const result = await synthesizeTextToSpeech(
      {
        text: 'Bonjour Patrice on progresse vers le robot',
        provider: 'piper',
        voice: '/voices/fr_FR-siwis-medium.onnx',
        outputPath,
        format: 'wav',
      },
      { rootDir: workspace, runtime: { spawn: fakePiperSpawn(captured) as never } },
    );

    expect(result).toMatchObject({ kind: 'text_to_speech_result', ok: true, provider: 'piper', format: 'wav' });
    // Windows may expand the runner's 8.3 temp-directory alias during the
    // security guard's realpath resolution. Both spellings must name the
    // exact output file requested by the caller.
    expect(await fs.realpath(result.outputPath)).toBe(await fs.realpath(outputPath));
    expect(captured.command).toBe('piper');
    expect(captured.args).toEqual([
      '--model', '/voices/fr_FR-siwis-medium.onnx', '--output_file',
      expect.stringMatching(/\.tts-[0-9a-f-]+\.wav$/),
    ]);
    expect(await fs.realpath(path.dirname(captured.args![3]!)))
      .toBe(await fs.realpath(path.dirname(outputPath)));
    expect(path.basename(captured.args![3]!)).not.toBe(path.basename(outputPath));
    expect(captured.stdin).toBe('Bonjour Patrice on progresse vers le robot');
    // stdin must be piped (not 'ignore') so Piper can read the utterance.
    expect(Array.isArray(captured.stdio) ? (captured.stdio as unknown[])[0] : undefined).toBe('pipe');
  });

  it('throws a clear error when no voice model is configured', async () => {
    const prevModel = process.env.CODEBUDDY_TTS_PIPER_MODEL;
    const prevVoice = process.env.CODEBUDDY_TTS_VOICE;
    delete process.env.CODEBUDDY_TTS_PIPER_MODEL;
    delete process.env.CODEBUDDY_TTS_VOICE;
    try {
      await expect(
        synthesizeTextToSpeech(
          { text: 'hello', provider: 'piper', format: 'wav' },
          { rootDir: workspace, runtime: { spawn: fakePiperSpawn({}) as never } },
        ),
      ).rejects.toThrow(/Piper requires a voice model/);
    } finally {
      if (prevModel !== undefined) process.env.CODEBUDDY_TTS_PIPER_MODEL = prevModel;
      if (prevVoice !== undefined) process.env.CODEBUDDY_TTS_VOICE = prevVoice;
    }
  });

  // Real proof (no-mocks) — runs only when piper + a real voice model are available
  // (set CODEBUDDY_TTS_PIPER_MODEL). Skips cleanly in CI.
  it('synthesizes a real WAV with the installed Piper when configured', async () => {
    const model = process.env.CODEBUDDY_TTS_PIPER_MODEL;
    if (!model || !(await commandExists('piper'))) {
      console.warn('piper or CODEBUDDY_TTS_PIPER_MODEL not available — skipping real synthesis proof');
      return;
    }
    const outputPath = path.join(workspace, '.codebuddy', 'tts', 'real.wav');
    const result = await synthesizeTextToSpeech(
      { text: 'Bonjour Patrice, on progresse vers le robot.', provider: 'piper', voice: model, outputPath, format: 'wav' },
      { rootDir: workspace },
    );
    expect(result.ok).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(44);
    const audio = await fs.readFile(outputPath);
    expect(audio.toString('ascii', 0, 4)).toBe('RIFF');
    expect(audio.toString('ascii', 8, 12)).toBe('WAVE');
  });
});
