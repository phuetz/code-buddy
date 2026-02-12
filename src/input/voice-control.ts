/**
 * Native Voice Control System
 *
 * Advanced voice control features:
 * - Voice commands (explain, fix, refactor, search, etc.)
 * - Wake word detection ("Hey Grok", "OK Grok")
 * - Continuous listening mode
 * - Real-time voice activity detection (VAD)
 * - Multi-language support
 * - Command shortcuts and macros
 *
 * Inspired by voice assistants and Cursor 2.0's voice features.
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { WakeWordDetector } from '../voice/wake-word.js';
import { logger } from '../utils/logger.js';

export interface VoiceControlConfig {
  enabled: boolean;
  wakeWord: string;
  wakeWordEnabled: boolean;
  continuousListening: boolean;
  language: string;
  vadThreshold: number;
  vadSilenceDuration: number;
  provider: 'whisper-local' | 'whisper-api' | 'vosk' | 'system';
  apiKey?: string;
  model?: string;
  commandTimeout: number;
  feedbackSound: boolean;
  confirmActions: boolean;
}

export interface VoiceCommand {
  name: string;
  aliases: string[];
  description: string;
  pattern: RegExp;
  handler: (args: string[], context: VoiceCommandContext) => Promise<VoiceCommandResult>;
}

export interface VoiceCommandContext {
  transcription: string;
  confidence: number;
  language: string;
  currentFile?: string;
  selectedText?: string;
  workspaceRoot?: string;
}

export interface VoiceCommandResult {
  success: boolean;
  action?: string;
  response?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface VoiceControlState {
  isListening: boolean;
  isProcessing: boolean;
  isWakeWordActive: boolean;
  lastCommand?: string;
  lastResult?: VoiceCommandResult;
  sessionCommands: number;
  errorCount: number;
}

export interface TranscriptionResult {
  success: boolean;
  text?: string;
  confidence?: number;
  language?: string;
  duration?: number;
  error?: string;
}

const DEFAULT_CONFIG: VoiceControlConfig = {
  enabled: false,
  wakeWord: 'hey grok',
  wakeWordEnabled: true,
  continuousListening: false,
  language: 'en',
  vadThreshold: 0.02,
  vadSilenceDuration: 1500,
  provider: 'whisper-local',
  model: 'base',
  commandTimeout: 10000,
  feedbackSound: true,
  confirmActions: true,
};

// Built-in voice commands
const BUILTIN_COMMANDS: Array<{
  name: string;
  aliases: string[];
  description: string;
  pattern: RegExp;
  action: string;
}> = [
  {
    name: 'explain',
    aliases: ['what is', 'what does', 'describe'],
    description: 'Explain the current code or selection',
    pattern: /^(explain|what is|what does|describe)\s*(this|that|the|code|selection)?(.*)$/i,
    action: 'explain',
  },
  {
    name: 'fix',
    aliases: ['repair', 'debug', 'solve'],
    description: 'Fix bugs or issues in the code',
    pattern: /^(fix|repair|debug|solve)\s*(this|that|the|bug|issue|error|problem)?(.*)$/i,
    action: 'fix',
  },
  {
    name: 'refactor',
    aliases: ['improve', 'optimize', 'clean up'],
    description: 'Refactor or improve the code',
    pattern: /^(refactor|improve|optimize|clean up)\s*(this|that|the|code)?(.*)$/i,
    action: 'refactor',
  },
  {
    name: 'test',
    aliases: ['write test', 'generate test', 'create test'],
    description: 'Generate tests for the code',
    pattern: /^(test|write test|generate test|create test)(s)?\s*(for)?(.*)$/i,
    action: 'generateTests',
  },
  {
    name: 'document',
    aliases: ['add docs', 'add documentation', 'comment'],
    description: 'Add documentation to the code',
    pattern: /^(document|add docs|add documentation|comment)\s*(this|that|the|code)?(.*)$/i,
    action: 'document',
  },
  {
    name: 'search',
    aliases: ['find', 'look for', 'locate'],
    description: 'Search for something in the codebase',
    pattern: /^(search|find|look for|locate)\s*(for)?\s*(.+)$/i,
    action: 'search',
  },
  {
    name: 'open',
    aliases: ['go to', 'navigate to', 'show'],
    description: 'Open a file or navigate to a location',
    pattern: /^(open|go to|navigate to|show)\s*(file)?\s*(.+)$/i,
    action: 'open',
  },
  {
    name: 'run',
    aliases: ['execute', 'start'],
    description: 'Run a command or script',
    pattern: /^(run|execute|start)\s*(the)?\s*(.+)$/i,
    action: 'run',
  },
  {
    name: 'commit',
    aliases: ['save changes', 'git commit'],
    description: 'Commit changes to git',
    pattern: /^(commit|save changes|git commit)\s*(with message|message)?(.*)$/i,
    action: 'commit',
  },
  {
    name: 'undo',
    aliases: ['revert', 'rollback'],
    description: 'Undo the last action',
    pattern: /^(undo|revert|rollback)\s*(last|that|the)?(.*)$/i,
    action: 'undo',
  },
  {
    name: 'help',
    aliases: ['how do i', 'show commands'],
    description: 'Show voice command help',
    pattern: /^(help|how do i|show commands)(.*)$/i,
    action: 'help',
  },
  {
    name: 'stop',
    aliases: ['cancel', 'abort', 'nevermind'],
    description: 'Stop the current operation',
    pattern: /^(stop|cancel|abort|nevermind|never mind)$/i,
    action: 'stop',
  },
];

/**
 * Native Voice Control System
 */
export class VoiceControl extends EventEmitter {
  private config: VoiceControlConfig;
  private state: VoiceControlState;
  private commands: Map<string, VoiceCommand> = new Map();
  private recordingProcess: ChildProcess | null = null;
  private vadProcess: ChildProcess | null = null;
  private wakeWordDetector: WakeWordDetector | null = null;
  private tempDir: string;
  private audioBuffer: Buffer[] = [];

  constructor(config: Partial<VoiceControlConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      isListening: false,
      isProcessing: false,
      isWakeWordActive: false,
      sessionCommands: 0,
      errorCount: 0,
    };
    this.tempDir = path.join(os.tmpdir(), 'grok-voice-control');
    this.initialize();
  }

  /**
   * Initialize voice control system
   */
  private async initialize(): Promise<void> {
    await fs.ensureDir(this.tempDir);
    this.loadConfig();
    this.registerBuiltinCommands();
  }

  /**
   * Load configuration from file
   */
  private loadConfig(): void {
    const configPath = path.join(os.homedir(), '.codebuddy', 'voice-control.json');

    if (fs.existsSync(configPath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        this.config = { ...this.config, ...saved };
      } catch {
        // Use defaults
      }
    }
  }

  /**
   * Save configuration
   */
  saveConfig(): void {
    const configDir = path.join(os.homedir(), '.codebuddy');
    const configPath = path.join(configDir, 'voice-control.json');

    fs.ensureDirSync(configDir);
    fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
  }

  /**
   * Register built-in voice commands
   */
  private registerBuiltinCommands(): void {
    for (const cmd of BUILTIN_COMMANDS) {
      this.commands.set(cmd.name, {
        name: cmd.name,
        aliases: cmd.aliases,
        description: cmd.description,
        pattern: cmd.pattern,
        handler: async (args, context) => {
          return {
            success: true,
            action: cmd.action,
            data: {
              args,
              transcription: context.transcription,
              file: context.currentFile,
              selection: context.selectedText,
            },
          };
        },
      });
    }
  }

  /**
   * Register a custom voice command
   */
  registerCommand(command: VoiceCommand): void {
    this.commands.set(command.name, command);
    this.emit('command:registered', { name: command.name });
  }

  /**
   * Check system availability
   */
  async isAvailable(): Promise<{ available: boolean; reason?: string; capabilities: string[] }> {
    const capabilities: string[] = [];
    const issues: string[] = [];

    // Check for audio recording
    const hasRecording = await this.checkCommand('sox') || await this.checkCommand('arecord');
    if (hasRecording) {
      capabilities.push('audio-recording');
    } else {
      issues.push('No audio recording tool (sox or arecord)');
    }

    // Check for Whisper
    if (this.config.provider === 'whisper-local') {
      const hasWhisper = await this.checkCommand('whisper');
      if (hasWhisper) {
        capabilities.push('whisper-local');
      } else {
        issues.push('Whisper not installed (pip install openai-whisper)');
      }
    }

    // Check for Vosk
    if (this.config.provider === 'vosk') {
      // Vosk is a Python library, check via python
      const hasVosk = await this.checkPythonModule('vosk');
      if (hasVosk) {
        capabilities.push('vosk');
      } else {
        issues.push('Vosk not installed (pip install vosk)');
      }
    }

    // Check for API key if using whisper-api
    if (this.config.provider === 'whisper-api') {
      if (this.config.apiKey || process.env.OPENAI_API_KEY) {
        capabilities.push('whisper-api');
      } else {
        issues.push('OpenAI API key not configured');
      }
    }

    // Check for FFmpeg (useful for audio processing)
    if (await this.checkCommand('ffmpeg')) {
      capabilities.push('ffmpeg');
    }

    return {
      available: capabilities.length > 0 && issues.length === 0,
      reason: issues.length > 0 ? issues.join('; ') : undefined,
      capabilities,
    };
  }

  /**
   * Check if a command exists
   */
  private async checkCommand(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const check = spawn('which', [command]);
      const timeout = setTimeout(() => { check.kill(); resolve(false); }, 5000);
      check.on('close', (code) => { clearTimeout(timeout); resolve(code === 0); });
      check.on('error', () => { clearTimeout(timeout); resolve(false); });
    });
  }

  /**
   * Check if a Python module is available
   */
  private async checkPythonModule(module: string): Promise<boolean> {
    return new Promise((resolve) => {
      const check = spawn('python3', ['-c', `import ${module}`]);
      const timeout = setTimeout(() => { check.kill(); resolve(false); }, 10000);
      check.on('close', (code) => { clearTimeout(timeout); resolve(code === 0); });
      check.on('error', () => { clearTimeout(timeout); resolve(false); });
    });
  }

  /**
   * Start listening for voice input
   */
  async startListening(): Promise<void> {
    if (this.state.isListening) {
      return;
    }

    const availability = await this.isAvailable();
    if (!availability.available) {
      this.emit('error', new Error(availability.reason || 'Voice control not available'));
      return;
    }

    this.state.isListening = true;
    this.emit('listening:start');

    if (this.config.feedbackSound) {
      this.playFeedbackSound('start');
    }

    if (this.config.continuousListening) {
      await this.startContinuousListening();
    } else {
      await this.startSingleRecording();
    }
  }

  /**
   * Start continuous listening mode with VAD
   */
  private async startContinuousListening(): Promise<void> {
    this.emit('mode:continuous');

    // Initialize wake word detector if wake word is enabled
    if (this.config.wakeWordEnabled && !this.wakeWordDetector) {
      this.wakeWordDetector = new WakeWordDetector({
        wakeWords: [this.config.wakeWord, 'hey grok', 'ok grok'],
      });
      this.wakeWordDetector.on('detected', (detection) => {
        this.state.isWakeWordActive = true;
        this.emit('wakeword:detected', detection);
        if (this.config.feedbackSound) {
          this.playFeedbackSound('wakeword');
        }
      });
      await this.wakeWordDetector.start();
    }

    // Use sox with silence detection for VAD
    const vadProcess = spawn('sox', [
      '-d',                          // Default audio device
      '-r', '16000',                 // 16kHz sample rate
      '-c', '1',                     // Mono
      '-t', 'raw',                   // Raw output
      '-b', '16',                    // 16-bit
      '-e', 'signed-integer',        // Signed integer encoding
      '-',                           // Output to stdout
      'silence', '1', '0.1', `${this.config.vadThreshold}%`,  // Voice activity detection
      '1', String(this.config.vadSilenceDuration / 1000), `${this.config.vadThreshold}%`,
    ]);

    this.vadProcess = vadProcess;

    vadProcess.stdout.on('data', (data: Buffer) => {
      // Feed raw audio to Porcupine wake word detector if active
      if (this.wakeWordDetector && this.wakeWordDetector.getEngine() === 'porcupine' && !this.state.isWakeWordActive) {
        this.wakeWordDetector.processFrame(data);
      }

      if (this.state.isWakeWordActive || !this.config.wakeWordEnabled) {
        this.audioBuffer.push(data);
        // Cap buffer at ~30s of 16kHz 16-bit mono audio (~960KB)
        if (this.audioBuffer.length > 3000) {
          this.audioBuffer.splice(0, this.audioBuffer.length - 3000);
        }
      }
    });

    vadProcess.on('close', async () => {
      try {
        if (this.audioBuffer.length > 0) {
          await this.processAudioBuffer();
        }

        // Restart if still in continuous mode
        if (this.state.isListening && this.config.continuousListening) {
          setTimeout(() => this.startContinuousListening(), 100);
        }
      } catch (error) {
        logger.error('Error processing audio buffer on VAD close:', { error: String(error) });
      }
    });

    vadProcess.on('error', (error) => {
      this.state.errorCount++;
      this.emit('error', error);
    });
  }

  /**
   * Start single recording session
   */
  private async startSingleRecording(): Promise<void> {
    const audioFile = path.join(this.tempDir, `recording_${Date.now()}.wav`);

    this.recordingProcess = spawn('sox', [
      '-d',
      '-r', '16000',
      '-c', '1',
      '-b', '16',
      audioFile,
      'silence', '1', '0.1', `${this.config.vadThreshold}%`,
      '1', String(this.config.vadSilenceDuration / 1000), `${this.config.vadThreshold}%`,
    ]);

    this.recordingProcess.on('close', async () => {
      if (fs.existsSync(audioFile)) {
        await this.processAudioFile(audioFile);
      }
      this.state.isListening = false;
      this.emit('listening:stop');
    });

    this.recordingProcess.on('error', (error) => {
      this.state.isListening = false;
      this.state.errorCount++;
      this.emit('error', error);
    });
  }

  /**
   * Process audio buffer from continuous listening
   */
  private async processAudioBuffer(): Promise<void> {
    if (this.audioBuffer.length === 0) return;

    const audioFile = path.join(this.tempDir, `buffer_${Date.now()}.wav`);
    const buffer = Buffer.concat(this.audioBuffer);
    this.audioBuffer = [];

    // Write raw audio to WAV file
    await this.writeWavFile(audioFile, buffer);
    await this.processAudioFile(audioFile);
  }

  /**
   * Write raw audio data to WAV file
   */
  private async writeWavFile(filepath: string, data: Buffer): Promise<void> {
    const sampleRate = 16000;
    const channels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);

    await fs.writeFile(filepath, Buffer.concat([header, data]));
  }

  /**
   * Process audio file for transcription
   */
  private async processAudioFile(audioFile: string): Promise<void> {
    this.state.isProcessing = true;
    this.emit('processing:start');

    try {
      const result = await this.transcribe(audioFile);

      if (result.success && result.text) {
        // Check for wake word if enabled
        if (this.config.wakeWordEnabled && !this.state.isWakeWordActive) {
          if (this.detectWakeWord(result.text)) {
            this.state.isWakeWordActive = true;
            this.emit('wakeword:detected');
            if (this.config.feedbackSound) {
              this.playFeedbackSound('wakeword');
            }
            return;
          }
        }

        // Process as command
        const commandResult = await this.processCommand(result.text, result.confidence || 0.5);

        if (commandResult) {
          this.state.lastCommand = result.text;
          this.state.lastResult = commandResult;
          this.state.sessionCommands++;
          this.emit('command:executed', { command: result.text, result: commandResult });
        } else {
          // Not a command, treat as natural language input
          this.emit('transcription', result);
        }

        // Reset wake word state after processing
        this.state.isWakeWordActive = false;
      }
    } catch (error) {
      this.state.errorCount++;
      this.emit('error', error);
    } finally {
      this.state.isProcessing = false;
      this.emit('processing:stop');

      // Clean up audio file
      await fs.remove(audioFile).catch((err) => {
        // Log cleanup error but don't fail the operation
        this.emit('warning', { type: 'cleanup', message: `Failed to remove audio file: ${err.message}` });
      });
    }
  }

  /**
   * Transcribe audio file
   */
  private async transcribe(audioFile: string): Promise<TranscriptionResult> {
    switch (this.config.provider) {
      case 'whisper-local':
        return this.transcribeWithWhisperLocal(audioFile);
      case 'whisper-api':
        return this.transcribeWithWhisperAPI(audioFile);
      case 'vosk':
        return this.transcribeWithVosk(audioFile);
      default:
        return this.transcribeWithSystem(audioFile);
    }
  }

  /**
   * Transcribe with local Whisper
   */
  private async transcribeWithWhisperLocal(audioFile: string): Promise<TranscriptionResult> {
    return new Promise((resolve) => {
      const whisper = spawn('whisper', [
        audioFile,
        '--model', this.config.model || 'base',
        '--language', this.config.language,
        '--output_format', 'json',
        '--output_dir', this.tempDir,
      ]);

      // Kill whisper if it takes too long (120s)
      const timeout = setTimeout(() => {
        whisper.kill();
        resolve({ success: false, error: 'Whisper transcription timed out' });
      }, 120_000);

      let stderr = '';
      whisper.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      whisper.on('close', async (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          const jsonFile = audioFile.replace('.wav', '.json');
          if (await fs.pathExists(jsonFile)) {
            try {
              const data = await fs.readJSON(jsonFile);
              await fs.remove(jsonFile);
              resolve({
                success: true,
                text: data.text?.trim(),
                language: data.language,
              });
            } catch {
              resolve({ success: false, error: 'Failed to parse transcription' });
            }
          } else {
            resolve({ success: false, error: 'Transcription file not found' });
          }
        } else {
          resolve({ success: false, error: stderr || 'Whisper failed' });
        }
      });
    });
  }

  /**
   * Transcribe with Whisper API
   */
  private async transcribeWithWhisperAPI(audioFile: string): Promise<TranscriptionResult> {
    const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'API key not configured' };
    }

    try {
      const FormData = (await import('form-data')).default;
      const axios = (await import('axios')).default;

      const form = new FormData();
      form.append('file', fs.createReadStream(audioFile));
      form.append('model', 'whisper-1');
      form.append('language', this.config.language);

      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        form,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            ...form.getHeaders(),
          },
          timeout: this.config.commandTimeout,
        }
      );

      return {
        success: true,
        text: response.data.text,
        language: response.data.language,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * Transcribe with Vosk (offline)
   */
  private async transcribeWithVosk(audioFile: string): Promise<TranscriptionResult> {
    return new Promise((resolve) => {
      const script = `
import sys
import json
import wave
from vosk import Model, KaldiRecognizer

model_path = "${process.env.VOSK_MODEL_PATH || '/usr/share/vosk/model'}"
model = Model(model_path)

wf = wave.open("${audioFile}", "rb")
rec = KaldiRecognizer(model, wf.getframerate())
rec.SetWords(True)

results = []
while True:
    data = wf.readframes(4000)
    if len(data) == 0:
        break
    if rec.AcceptWaveform(data):
        results.append(json.loads(rec.Result()))

results.append(json.loads(rec.FinalResult()))
text = " ".join([r.get("text", "") for r in results])
print(json.dumps({"text": text.strip()}))
`;

      const python = spawn('python3', ['-c', script]);
      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', (code) => {
        if (code === 0) {
          try {
            const data = JSON.parse(stdout);
            resolve({ success: true, text: data.text });
          } catch {
            resolve({ success: false, error: 'Failed to parse Vosk output' });
          }
        } else {
          resolve({ success: false, error: stderr || 'Vosk failed' });
        }
      });
    });
  }

  /**
   * Fallback system transcription
   */
  private async transcribeWithSystem(_audioFile: string): Promise<TranscriptionResult> {
    return {
      success: false,
      error: 'System transcription not available. Use whisper-local, whisper-api, or vosk provider.',
    };
  }

  /**
   * Detect wake word in transcription
   */
  private detectWakeWord(text: string): boolean {
    // Use WakeWordDetector's text-match if available and in text-match mode
    if (this.wakeWordDetector && this.wakeWordDetector.getEngine() === 'text-match') {
      const detection = this.wakeWordDetector.detectWakeWordText(text);
      return detection !== null;
    }

    // If Porcupine is active, wake word is detected via audio frames, not text
    if (this.wakeWordDetector && this.wakeWordDetector.getEngine() === 'porcupine') {
      return false;
    }

    // Fallback: inline text matching (no detector available)
    const normalized = text.toLowerCase().trim();
    const wakeWords = [
      this.config.wakeWord.toLowerCase(),
      'hey grok',
      'ok grok',
      'okay grok',
      'hi grok',
    ];

    return wakeWords.some(word => normalized.includes(word));
  }

  /**
   * Process transcribed text as command
   */
  private async processCommand(
    text: string,
    confidence: number
  ): Promise<VoiceCommandResult | null> {
    const normalized = text.toLowerCase().trim();

    // Remove wake word if present
    let commandText = normalized;
    for (const wake of ['hey grok', 'ok grok', 'okay grok', 'hi grok', this.config.wakeWord.toLowerCase()]) {
      commandText = commandText.replace(wake, '').trim();
    }

    // Try to match against registered commands
    for (const [_, command] of this.commands) {
      const match = commandText.match(command.pattern);
      if (match) {
        const args = match.slice(1).filter(Boolean).map(s => s.trim());

        const context: VoiceCommandContext = {
          transcription: text,
          confidence,
          language: this.config.language,
        };

        try {
          return await command.handler(args, context);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            success: false,
            error: message,
          };
        }
      }
    }

    return null; // Not recognized as a command
  }

  /**
   * Play feedback sound
   */
  private playFeedbackSound(type: 'start' | 'stop' | 'wakeword' | 'success' | 'error'): void {
    // Use afplay on macOS, paplay on Linux
    const frequencies: Record<string, number[]> = {
      start: [440, 100],
      stop: [330, 100],
      wakeword: [523, 150, 659, 150],
      success: [523, 100, 659, 100, 784, 150],
      error: [220, 200],
    };

    const freq = frequencies[type] || [440, 100];

    if (process.platform === 'darwin') {
      // Generate beep with afplay
      spawn('afplay', ['/System/Library/Sounds/Pop.aiff']);
    } else if (process.platform === 'linux') {
      // Use beep or speaker-test
      for (let i = 0; i < freq.length; i += 2) {
        spawn('beep', ['-f', String(freq[i]), '-l', String(freq[i + 1])]);
      }
    }
  }

  /**
   * Stop listening
   */
  stopListening(): void {
    if (this.recordingProcess) {
      this.recordingProcess.kill('SIGINT');
      this.recordingProcess = null;
    }

    if (this.vadProcess) {
      this.vadProcess.kill('SIGINT');
      this.vadProcess = null;
    }

    if (this.wakeWordDetector) {
      this.wakeWordDetector.stop();
      this.wakeWordDetector = null;
    }

    this.state.isListening = false;
    this.state.isWakeWordActive = false;
    this.audioBuffer = [];

    if (this.config.feedbackSound) {
      this.playFeedbackSound('stop');
    }

    this.emit('listening:stop');
  }

  /**
   * Toggle listening
   */
  toggleListening(): void {
    if (this.state.isListening) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  /**
   * Get current state
   */
  getState(): VoiceControlState {
    return { ...this.state };
  }

  /**
   * Get configuration
   */
  getConfig(): VoiceControlConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<VoiceControlConfig>): void {
    this.config = { ...this.config, ...config };
    this.saveConfig();
  }

  /**
   * Get available commands
   */
  getCommands(): VoiceCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Format status for display
   */
  formatStatus(): string {
    const lines = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║              🎤 VOICE CONTROL STATUS                         ║',
      '╠══════════════════════════════════════════════════════════════╣',
      `║ Enabled:          ${this.config.enabled ? '✅ Yes' : '❌ No'}                                 ║`,
      `║ Status:           ${this.state.isListening ? '🔴 Listening' : '⚪ Idle'}                           ║`,
      `║ Provider:         ${this.config.provider.padEnd(20)}                    ║`,
      `║ Language:         ${this.config.language.padEnd(20)}                    ║`,
      '╠══════════════════════════════════════════════════════════════╣',
      `║ Wake Word:        "${this.config.wakeWord}"                               ║`,
      `║ Wake Word Active: ${this.state.isWakeWordActive ? '✅ Yes' : '❌ No'}                                 ║`,
      `║ Continuous:       ${this.config.continuousListening ? '✅ Yes' : '❌ No'}                                 ║`,
      '╠══════════════════════════════════════════════════════════════╣',
      `║ Session Commands: ${String(this.state.sessionCommands).padEnd(10)}                            ║`,
      `║ Errors:           ${String(this.state.errorCount).padEnd(10)}                            ║`,
    ];

    if (this.state.lastCommand) {
      lines.push('╠══════════════════════════════════════════════════════════════╣');
      lines.push(`║ Last Command: "${this.state.lastCommand.slice(0, 40)}"...                  ║`);
    }

    lines.push('╠══════════════════════════════════════════════════════════════╣');
    lines.push('║ Commands: explain, fix, refactor, test, search, open, run   ║');
    lines.push('║ Toggle: /voice toggle | Config: /voice config               ║');
    lines.push('╚══════════════════════════════════════════════════════════════╝');

    return lines.join('\n');
  }

  /**
   * Format commands help
   */
  formatCommandsHelp(): string {
    const lines = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║              🎤 VOICE COMMANDS                               ║',
      '╠══════════════════════════════════════════════════════════════╣',
    ];

    for (const cmd of this.commands.values()) {
      lines.push(`║ ${cmd.name.padEnd(15)} │ ${cmd.description.slice(0, 40).padEnd(40)}║`);
      if (cmd.aliases.length > 0) {
        lines.push(`║ ${''.padEnd(15)} │ Also: ${cmd.aliases.join(', ').slice(0, 35).padEnd(35)}║`);
      }
    }

    lines.push('╠══════════════════════════════════════════════════════════════╣');
    lines.push('║ Say "Hey Grok" followed by your command                      ║');
    lines.push('║ Examples: "Hey Grok, explain this code"                      ║');
    lines.push('║           "Hey Grok, fix the bug"                            ║');
    lines.push('║           "Hey Grok, search for auth functions"              ║');
    lines.push('╚══════════════════════════════════════════════════════════════╝');

    return lines.join('\n');
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stopListening();

    // Clean up temp directory
    fs.removeSync(this.tempDir);

    this.removeAllListeners();
  }
}

// Singleton
let voiceControlInstance: VoiceControl | null = null;

export function getVoiceControl(config?: Partial<VoiceControlConfig>): VoiceControl {
  if (!voiceControlInstance) {
    voiceControlInstance = new VoiceControl(config);
  }
  return voiceControlInstance;
}

export function resetVoiceControl(): void {
  if (voiceControlInstance) {
    voiceControlInstance.dispose();
  }
  voiceControlInstance = null;
}
