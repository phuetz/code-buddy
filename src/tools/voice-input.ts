/**
 * Voice Input Support (Aider inspired)
 *
 * Allows users to speak their prompts instead of typing.
 * Supports:
 * - OpenAI Whisper API
 * - Local whisper.cpp (if installed)
 * - System speech recognition (macOS)
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

export interface VoiceConfig {
  /** Whisper API key (uses OpenAI key by default) */
  apiKey?: string;
  /** Use local whisper.cpp instead of API */
  useLocal?: boolean;
  /** Recording duration in seconds (0 = manual stop) */
  duration?: number;
  /** Language code (e.g., 'en', 'fr') */
  language?: string;
  /** Model size for local whisper */
  modelSize?: 'tiny' | 'base' | 'small' | 'medium' | 'large';
}

export interface VoiceResult {
  success: boolean;
  text: string;
  duration: number;
  error?: string;
}

/**
 * Check if sox/rec is available for recording
 */
export async function hasRecordingCapability(): Promise<boolean> {
  try {
    await execAsync('which rec || which sox');
    return true;
  } catch {
    // Try ffmpeg as fallback
    try {
      await execAsync('which ffmpeg');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Check if local whisper.cpp is available
 */
export async function hasLocalWhisper(): Promise<boolean> {
  try {
    await execAsync('which whisper || which whisper.cpp || which main');
    return true;
  } catch {
    return false;
  }
}

/**
 * Record audio to a temporary file
 */
export async function recordAudio(
  durationSeconds: number = 0,
  outputPath?: string
): Promise<string> {
  const tempFile = outputPath || path.join(os.tmpdir(), `grok-voice-${Date.now()}.wav`);

  // Try different recording methods
  const recorders = [
    // sox/rec (most common)
    `rec -q ${tempFile} rate 16000 channels 1 ${durationSeconds > 0 ? `trim 0 ${durationSeconds}` : ''}`,
    // ffmpeg with default input
    `ffmpeg -y -f avfoundation -i ":0" -t ${durationSeconds || 30} -ar 16000 -ac 1 ${tempFile}`,
    // arecord (Linux ALSA)
    `arecord -q -f S16_LE -r 16000 -c 1 ${durationSeconds > 0 ? `-d ${durationSeconds}` : ''} ${tempFile}`,
  ];

  for (const cmd of recorders) {
    try {
      if (durationSeconds > 0) {
        // Fixed duration recording
        await execAsync(cmd, { timeout: (durationSeconds + 5) * 1000 });
      } else {
        // Manual stop recording - run in background
        return new Promise((resolve, reject) => {
          logger.info('Recording... Press Enter to stop.');

          const child = spawn('sh', ['-c', cmd.replace(durationSeconds.toString(), '30')], {
            stdio: ['ignore', 'ignore', 'ignore'],
          });

          // Wait for Enter key
          process.stdin.setRawMode?.(false);
          process.stdin.once('data', () => {
            child.kill('SIGINT');
            setTimeout(() => resolve(tempFile), 500);
          });

          child.on('close', () => resolve(tempFile));
          child.on('error', reject);
        });
      }

      if (await UnifiedVfsRouter.Instance.exists(tempFile)) {
        return tempFile;
      }
    } catch {
      // Try next recorder
    }
  }

  throw new Error('No audio recording capability found. Install sox, ffmpeg, or arecord.');
}

/**
 * Transcribe audio using OpenAI Whisper API
 */
export async function transcribeWithWhisperAPI(
  audioPath: string,
  apiKey: string,
  language?: string
): Promise<string> {
  const FormData = (await import('form-data')).default;
  const form = new FormData();

  const buffer = await UnifiedVfsRouter.Instance.readFileBuffer(audioPath);
  form.append('file', buffer, { filename: path.basename(audioPath) });
  form.append('model', 'whisper-1');
  if (language) {
    form.append('language', language);
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    body: form as unknown as BodyInit,
  });

  if (!response.ok) {
    throw new Error(`Whisper API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json() as { text: string };
  return result.text;
}

/**
 * Transcribe audio using local whisper.cpp
 */
export async function transcribeWithLocalWhisper(
  audioPath: string,
  modelSize: string = 'base',
  language?: string
): Promise<string> {
  const langArg = language ? `-l ${language}` : '';

  // Try different whisper commands
  const commands = [
    `whisper ${audioPath} --model ${modelSize} ${langArg} --output_format txt`,
    `whisper.cpp -m models/ggml-${modelSize}.bin -f ${audioPath} ${langArg}`,
    `./main -m models/ggml-${modelSize}.bin -f ${audioPath} ${langArg}`,
  ];

  for (const cmd of commands) {
    try {
      const { stdout } = await execAsync(cmd, { timeout: 60000 });
      return stdout.trim();
    } catch {
      // Try next command
    }
  }

  throw new Error('Local whisper transcription failed');
}

/**
 * Main voice input function
 */
export async function getVoiceInput(config: VoiceConfig = {}): Promise<VoiceResult> {
  const startTime = Date.now();

  try {
    // Check recording capability
    if (!(await hasRecordingCapability())) {
      return {
        success: false,
        text: '',
        duration: 0,
        error: 'No audio recording capability. Install sox or ffmpeg.',
      };
    }

    // Record audio
    logger.info('Press Enter when ready to record...');
    await new Promise(resolve => process.stdin.once('data', resolve));

    logger.info('Recording... Press Enter to stop.');
    const audioPath = await recordAudio(config.duration || 0);

    // Transcribe
    let text: string;

    if (config.useLocal && await hasLocalWhisper()) {
      logger.info('Transcribing with local whisper...');
      text = await transcribeWithLocalWhisper(
        audioPath,
        config.modelSize || 'base',
        config.language
      );
    } else if (config.apiKey) {
      logger.info('Transcribing with Whisper API...');
      text = await transcribeWithWhisperAPI(audioPath, config.apiKey, config.language);
    } else {
      // Try local first, then fail
      if (await hasLocalWhisper()) {
        text = await transcribeWithLocalWhisper(audioPath, config.modelSize || 'base', config.language);
      } else {
        throw new Error('No API key and local whisper not found');
      }
    }

    // Clean up temp file
    await UnifiedVfsRouter.Instance.remove(audioPath);

    return {
      success: true,
      text: text.trim(),
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      text: '',
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check voice input availability
 */
export async function checkVoiceAvailability(): Promise<{
  available: boolean;
  recording: boolean;
  localWhisper: boolean;
  apiAvailable: boolean;
}> {
  const [recording, localWhisper] = await Promise.all([
    hasRecordingCapability(),
    hasLocalWhisper(),
  ]);

  const apiAvailable = !!process.env.OPENAI_API_KEY || !!process.env.GROK_API_KEY;

  return {
    available: recording && (localWhisper || apiAvailable),
    recording,
    localWhisper,
    apiAvailable,
  };
}
