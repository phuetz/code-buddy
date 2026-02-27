import { EventEmitter } from "events";
import fs from "fs-extra";
import * as path from "path";
import os from "os";
import { spawn, ChildProcess } from "child_process";
import axios from "axios";
import { getErrorMessage } from "../types/index.js";

export interface VoiceConfig {
  provider: "whisper" | "deepgram" | "system";
  apiKey?: string;
  language?: string;
  model?: string;
}

export interface TranscriptionResult {
  text: string;
  confidence?: number;
  duration?: number;
}

export class VoiceInput extends EventEmitter {
  private config: VoiceConfig;
  private isRecording: boolean = false;
  private recordingProcess: ChildProcess | null = null;
  private tempDir: string;

  constructor(config: VoiceConfig = { provider: "system" }) {
    super();
    this.config = config;
    this.tempDir = path.join(
      process.env.HOME || process.env.USERPROFILE || os.homedir(),
      ".codebuddy",
      "voice"
    );
    fs.ensureDirSync(this.tempDir);
  }

  async isAvailable(): Promise<boolean> {
    // Check if recording tools are available using spawn (not exec for security)
    try {
      if (process.platform === "darwin") {
        // macOS - check for sox
        return await this.commandExists("sox");
      } else if (process.platform === "linux") {
        // Linux - check for arecord or sox
        const hasArecord = await this.commandExists("arecord");
        if (hasArecord) return true;
        return await this.commandExists("sox");
      } else if (process.platform === "win32") {
        // Windows - basic support
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a command exists using spawn (secure alternative to exec)
   */
  private commandExists(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("which", [command]);
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  async startRecording(): Promise<string> {
    if (this.isRecording) {
      throw new Error("Already recording");
    }

    // Initialize wake-word detection if Picovoice key is available
    if (process.env.PICOVOICE_ACCESS_KEY) {
      try {
        const { WakeWordDetector } = await import('../voice/wake-word.js');
        const wwd = new WakeWordDetector({ accessKey: process.env.PICOVOICE_ACCESS_KEY });
        this.emit('wake-word:ready');
        wwd.on('detected', () => this.emit('wake-word:detected'));
      } catch { /* wake-word module optional */ }
    }

    // Initialize voice activity detection for auto-stop on silence
    try {
      const { VoiceActivityDetector } = await import('../voice/voice-activity.js');
      const vad = new VoiceActivityDetector();
      vad.on('silence', () => {
        if (this.isRecording) {
          this.emit('vad:silence');
          this.stopRecording();
        }
      });
    } catch { /* VAD module optional */ }

    const outputFile = path.join(this.tempDir, `recording-${Date.now()}.wav`);
    this.isRecording = true;

    return new Promise((resolve, reject) => {
      let cmd: string;
      let args: string[];

      if (process.platform === "darwin") {
        // macOS using sox
        cmd = "sox";
        args = ["-d", "-r", "16000", "-c", "1", "-b", "16", outputFile];
      } else if (process.platform === "linux") {
        // Linux using arecord
        cmd = "arecord";
        args = ["-f", "S16_LE", "-r", "16000", "-c", "1", outputFile];
      } else {
        reject(new Error("Unsupported platform for voice recording"));
        return;
      }

      this.recordingProcess = spawn(cmd, args);

      this.recordingProcess.on("error", (err) => {
        this.isRecording = false;
        reject(err);
      });

      this.emit("recording:start");

      // Recording started successfully
      resolve(outputFile);
    });
  }

  async stopRecording(): Promise<string | null> {
    if (!this.isRecording || !this.recordingProcess) {
      return null;
    }

    return new Promise((resolve) => {
      this.recordingProcess!.on("close", () => {
        this.isRecording = false;
        this.emit("recording:stop");
        resolve(null);
      });

      // Send SIGINT to stop recording gracefully
      this.recordingProcess!.kill("SIGINT");
    });
  }

  async transcribe(audioFile: string): Promise<TranscriptionResult> {
    if (!(await fs.pathExists(audioFile))) {
      throw new Error(`Audio file not found: ${audioFile}`);
    }

    switch (this.config.provider) {
      case "whisper":
        return this.transcribeWithWhisper(audioFile);
      case "deepgram":
        return this.transcribeWithDeepgram(audioFile);
      case "system":
        return this.transcribeWithSystem(audioFile);
      default:
        throw new Error(`Unknown provider: ${this.config.provider}`);
    }
  }

  private async transcribeWithWhisper(audioFile: string): Promise<TranscriptionResult> {
    // Using OpenAI Whisper API
    const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OpenAI API key required for Whisper transcription");
    }

    const audioData = await fs.readFile(audioFile);
    const formData = new FormData();
    formData.append("file", new Blob([audioData]), path.basename(audioFile));
    formData.append("model", this.config.model || "whisper-1");

    if (this.config.language) {
      formData.append("language", this.config.language);
    }

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/audio/transcriptions",
        formData,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "multipart/form-data",
          },
        }
      );

      return {
        text: response.data.text,
        confidence: 1.0,
      };
    } catch (error) {
      throw new Error(`Whisper transcription failed: ${getErrorMessage(error)}`);
    }
  }

  private async transcribeWithDeepgram(audioFile: string): Promise<TranscriptionResult> {
    const apiKey = this.config.apiKey || process.env.DEEPGRAM_API_KEY;

    if (!apiKey) {
      throw new Error("Deepgram API key required");
    }

    const audioData = await fs.readFile(audioFile);

    try {
      const response = await axios.post(
        "https://api.deepgram.com/v1/listen",
        audioData,
        {
          headers: {
            Authorization: `Token ${apiKey}`,
            "Content-Type": "audio/wav",
          },
          params: {
            model: this.config.model || "nova-2",
            language: this.config.language || "en",
          },
        }
      );

      const result = response.data.results?.channels?.[0]?.alternatives?.[0];

      return {
        text: result?.transcript || "",
        confidence: result?.confidence,
      };
    } catch (error) {
      throw new Error(`Deepgram transcription failed: ${getErrorMessage(error)}`);
    }
  }

  private async transcribeWithSystem(audioFile: string): Promise<TranscriptionResult> {
    // Try local whisper.cpp or other system transcription
    return new Promise((resolve, reject) => {
      // Check for whisper.cpp
      const whisperPath = process.env.WHISPER_CPP_PATH || "whisper";

      const proc = spawn(whisperPath, [
        "-f", audioFile,
        "-m", process.env.WHISPER_MODEL_PATH || "models/ggml-base.bin",
        "-otxt",
      ]);

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve({
            text: stdout.trim(),
          });
        } else {
          reject(new Error(`System transcription failed: ${stderr}`));
        }
      });

      proc.on("error", () => {
        // whisper.cpp not available, fall back to error
        reject(
          new Error(
            "No system transcription available. Install whisper.cpp or use API provider."
          )
        );
      });
    });
  }

  async recordAndTranscribe(
    maxDuration: number = 30000
  ): Promise<TranscriptionResult> {
    const audioFile = await this.startRecording();

    // Auto-stop after max duration
    const timeout = setTimeout(() => {
      this.stopRecording();
    }, maxDuration);

    // Wait for user to stop or timeout
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (!this.isRecording) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);
    });

    // Small delay to ensure file is written
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Transcribe
    const result = await this.transcribe(audioFile);

    // Cleanup
    await fs.remove(audioFile);

    return result;
  }

  getRecordingStatus(): { isRecording: boolean } {
    return { isRecording: this.isRecording };
  }

  formatHelp(): string {
    return `
Voice Input Commands:

  /voice start     Start voice recording
  /voice stop      Stop recording and transcribe
  /voice status    Check recording status

Configuration (environment variables):
  OPENAI_API_KEY      For Whisper API transcription
  DEEPGRAM_API_KEY    For Deepgram transcription
  WHISPER_CPP_PATH    Path to local whisper.cpp
  WHISPER_MODEL_PATH  Path to whisper model file

Providers:
  whisper   - OpenAI Whisper API (requires API key)
  deepgram  - Deepgram API (requires API key)
  system    - Local whisper.cpp (requires installation)

Tips:
  - Speak clearly and at a moderate pace
  - Minimize background noise
  - Keep recordings under 30 seconds for best results
`;
  }

  async cleanup(): Promise<void> {
    if (this.isRecording) {
      await this.stopRecording();
    }

    // Clean up old recordings
    try {
      const files = await fs.readdir(this.tempDir);
      for (const file of files) {
        if (file.startsWith("recording-")) {
          await fs.remove(path.join(this.tempDir, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Dispose and cleanup resources
   */
  async dispose(): Promise<void> {
    await this.cleanup();
    this.removeAllListeners();
  }
}

// Singleton instance
let voiceInputInstance: VoiceInput | null = null;

export function getVoiceInput(config?: VoiceConfig): VoiceInput {
  if (!voiceInputInstance || config) {
    voiceInputInstance = new VoiceInput(config);
  }
  return voiceInputInstance;
}

export function resetVoiceInput(): void {
  if (voiceInputInstance) {
    voiceInputInstance.dispose().catch(() => {
      // Ignore cleanup errors during reset
    });
  }
  voiceInputInstance = null;
}
