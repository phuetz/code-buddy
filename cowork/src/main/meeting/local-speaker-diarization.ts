import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { lstat, unlink } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

const DEFAULT_SEGMENTATION_MODEL = join(
  homedir(),
  '.codebuddy',
  'diarization',
  'sherpa-onnx-pyannote-segmentation-3-0',
  'model.int8.onnx',
);
const DEFAULT_EMBEDDING_MODEL = join(
  homedir(),
  '.codebuddy',
  'diarization',
  '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
);
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;

const SHERPA_DIARIZATION_SCRIPT = String.raw`
import json, sys, wave
import numpy as np
import sherpa_onnx

wav_path, segmentation_model, embedding_model = sys.argv[1:4]
with wave.open(wav_path, 'rb') as f:
    if f.getnchannels() != 1 or f.getsampwidth() != 2 or f.getframerate() != 16000:
        raise RuntimeError('expected mono 16-bit PCM at 16 kHz')
    samples = np.frombuffer(f.readframes(f.getnframes()), dtype='<i2').astype(np.float32) / 32768.0

segmentation = sherpa_onnx.OfflineSpeakerSegmentationModelConfig()
segmentation.pyannote.model = segmentation_model
segmentation.num_threads = 4
embedding = sherpa_onnx.SpeakerEmbeddingExtractorConfig()
embedding.model = embedding_model
embedding.num_threads = 4
clustering = sherpa_onnx.FastClusteringConfig()
clustering.num_clusters = -1
clustering.threshold = 0.5
config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
    segmentation=segmentation,
    embedding=embedding,
    clustering=clustering,
    min_duration_on=0.3,
    min_duration_off=0.5,
)
diarizer = sherpa_onnx.OfflineSpeakerDiarization(config)
result = diarizer.process(samples)
segments = result.sort_by_start_time()
payload = [{
    'startSeconds': float(segment.start),
    'endSeconds': float(segment.end),
    'speaker': int(segment.speaker),
} for segment in segments]
print(json.dumps({
    'segments': payload,
    'speakerCount': len(set(segment['speaker'] for segment in payload)),
}, separators=(',', ':')))
`;

export interface LocalDiarizationSegment {
  startSeconds: number;
  endSeconds: number;
  speaker: number;
}

export interface LocalDiarizationResult {
  segments: LocalDiarizationSegment[];
  speakerCount: number;
}

export interface LocalDiarizationCapability {
  available: boolean;
  provider: 'sherpa-onnx';
  reason: string;
}

export interface LocalSpeakerDiarizerOptions {
  python?: string;
  ffmpeg?: string;
  segmentationModel?: string;
  embeddingModel?: string;
  timeoutMs?: number;
}

export class LocalSpeakerDiarizer {
  private readonly python: string;
  private readonly ffmpeg: string;
  private readonly segmentationModel: string;
  private readonly embeddingModel: string;
  private readonly timeoutMs: number;
  private probePromise: Promise<LocalDiarizationCapability> | null = null;

  constructor(options: LocalSpeakerDiarizerOptions = {}) {
    this.python = options.python
      ?? process.env.CODEBUDDY_DIARIZATION_PYTHON
      ?? resolveDiarizationPython();
    this.ffmpeg = options.ffmpeg ?? process.env.CODEBUDDY_FFMPEG_PATH ?? 'ffmpeg';
    this.segmentationModel = resolve(
      options.segmentationModel
        ?? process.env.CODEBUDDY_DIARIZATION_SEGMENTATION_MODEL
        ?? DEFAULT_SEGMENTATION_MODEL,
    );
    this.embeddingModel = resolve(
      options.embeddingModel
        ?? process.env.CODEBUDDY_DIARIZATION_EMBEDDING_MODEL
        ?? DEFAULT_EMBEDDING_MODEL,
    );
    this.timeoutMs = options.timeoutMs ?? 30 * 60 * 1_000;
  }

  probe(force = false): Promise<LocalDiarizationCapability> {
    if (force || !this.probePromise) this.probePromise = this.runProbe();
    return this.probePromise;
  }

  async diarize(audioPath: string): Promise<LocalDiarizationResult> {
    const capability = await this.probe();
    if (!capability.available) throw new Error(capability.reason);
    const wavPath = join(dirname(audioPath), `.${randomUUID()}.diarization.wav`);
    try {
      await runProcess(
        this.ffmpeg,
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          audioPath,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-c:a',
          'pcm_s16le',
          wavPath,
        ],
        this.timeoutMs,
      );
      const { stdout } = await runProcess(
        this.python,
        [
          '-c',
          SHERPA_DIARIZATION_SCRIPT,
          wavPath,
          this.segmentationModel,
          this.embeddingModel,
        ],
        this.timeoutMs,
      );
      return parseDiarizationResult(stdout);
    } finally {
      await unlink(wavPath).catch(() => undefined);
    }
  }

  private async runProbe(): Promise<LocalDiarizationCapability> {
    try {
      await Promise.all([
        assertPrivateModel(this.segmentationModel, 'segmentation'),
        assertPrivateModel(this.embeddingModel, 'embedding'),
      ]);
      await Promise.all([
        runProcess(this.ffmpeg, ['-version'], 5_000),
        runProcess(
          this.python,
          ['-c', 'import numpy, sherpa_onnx; print(sherpa_onnx.__version__)'],
          10_000,
        ),
      ]);
      return {
        available: true,
        provider: 'sherpa-onnx',
        reason: 'Sherpa-ONNX et ses modèles locaux sont prêts.',
      };
    } catch (error) {
      return {
        available: false,
        provider: 'sherpa-onnx',
        reason: cleanProcessError(error),
      };
    }
  }
}

function resolveDiarizationPython(): string {
  // Cowork prepends its bundled voice Python to PATH after boot. That runtime
  // intentionally does not include Sherpa-ONNX, so prefer known user-managed
  // Python installations before falling back to the mutable PATH.
  const candidates = [
    join(homedir(), 'miniforge3', 'bin', 'python3'),
    join(homedir(), 'miniconda3', 'bin', 'python3'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? 'python3';
}

async function assertPrivateModel(path: string, label: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) {
    throw new Error(`Le modèle local de ${label} est invalide.`);
  }
}

function parseDiarizationResult(stdout: string): LocalDiarizationResult {
  const line = stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
  if (!line) throw new Error('Sherpa-ONNX n’a renvoyé aucun résultat de diarisation.');
  const parsed = JSON.parse(line) as Partial<LocalDiarizationResult>;
  if (!Array.isArray(parsed.segments) || !Number.isSafeInteger(parsed.speakerCount)) {
    throw new Error('Le résultat Sherpa-ONNX est invalide.');
  }
  const speakerCount = parsed.speakerCount as number;
  const segments = parsed.segments.map((segment) => {
    if (
      !Number.isFinite(segment.startSeconds)
      || !Number.isFinite(segment.endSeconds)
      || segment.startSeconds < 0
      || segment.endSeconds <= segment.startSeconds
      || !Number.isSafeInteger(segment.speaker)
      || segment.speaker < 0
    ) {
      throw new Error('Un tour de parole Sherpa-ONNX est invalide.');
    }
    return {
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      speaker: segment.speaker,
    };
  });
  return { segments, speakerCount };
}

function runProcess(
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise({ stdout, stderr });
    };
    const collect = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(new Error('Le moteur de diarisation a dépassé la limite de sortie locale.'));
        return;
      }
      if (target === 'stdout') stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
    child.once('error', (error) => finish(error));
    child.once('close', (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(
        `Le moteur local a échoué (${code ?? signal ?? 'inconnu'}) : ${stderr.trim().slice(-500)}`,
      ));
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`Le moteur local a dépassé ${Math.round(timeoutMs / 1_000)} s.`));
    }, timeoutMs);
  });
}

function cleanProcessError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .slice(0, 600);
}
