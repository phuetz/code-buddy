/**
 * Speak CLI command
 *
 * Extracted from index.ts for modularity.
 */

import type { Command } from 'commander';
import { logger } from '../../utils/logger.js';

/**
 * Register speak command on the given program
 */
export function registerSpeakCommand(program: Command): void {
  program
    .command("speak [text...]")
    .description("Synthesize speech (AudioReader, Pocket, or expressive Voicebox)")
    .option("--engine <engine>", "TTS engine: audioreader | pocket | voicebox")
    .option("--voice <voice>", "Voice ID, Pocket preset/sample, or Voicebox profile")
    .option("--language <lang>", "Language for Pocket or Voicebox")
    .option("--list-voices", "List available voices")
    .option("--speed <speed>", "Speaking speed (0.25-4.0)", "1.0")
    .option("--format <format>", "Output format (wav, mp3)", "wav")
    .option("--url <url>", "AudioReader API URL", "http://localhost:8000")
    .option("--voicebox-url <url>", "Voicebox API URL (defaults to CODEBUDDY_VOICEBOX_URL)")
    .action(async (textParts: string[], opts: { engine?: string; voice?: string; language?: string; listVoices?: boolean; speed: string; format: string; url: string; voiceboxUrl?: string }) => {
      // Engine selection: explicit --engine wins, else CODEBUDDY_TTS_ENGINE, else audioreader.
      const engine = (opts.engine ?? process.env.CODEBUDDY_TTS_ENGINE ?? 'audioreader').trim().toLowerCase();

      let provider: import("../../talk-mode/tts-manager.js").ITTSProvider;
      if (engine === 'pocket') {
        const { PocketTTSProvider } = await import("../../talk-mode/providers/pocket-tts.js");
        provider = new PocketTTSProvider();
        await provider.initialize({
          provider: 'pocket',
          enabled: true,
          priority: 1,
          settings: {
            voice: opts.voice ?? process.env.CODEBUDDY_POCKET_VOICE ?? 'estelle',
            language: opts.language ?? process.env.CODEBUDDY_POCKET_LANG ?? 'french',
          },
        });
        if (!(await provider.isAvailable())) {
          console.error("pocket-tts not found. Install with: pip install pocket-tts (or install uv for `uvx pocket-tts`).");
          process.exit(1);
        }
      } else if (engine === 'voicebox') {
        const { VoiceboxTTSProvider } = await import("../../talk-mode/providers/voicebox-tts.js");
        provider = new VoiceboxTTSProvider();
        await provider.initialize({
          provider: 'voicebox',
          enabled: true,
          priority: 1,
          settings: {
            baseURL: opts.voiceboxUrl ?? process.env.CODEBUDDY_VOICEBOX_URL,
            profile: opts.voice ?? process.env.CODEBUDDY_VOICEBOX_PROFILE,
            language: opts.language ?? process.env.CODEBUDDY_VOICEBOX_LANGUAGE ?? 'fr',
            engine: process.env.CODEBUDDY_VOICEBOX_ENGINE ?? 'qwen',
            modelSize: process.env.CODEBUDDY_VOICEBOX_MODEL_SIZE ?? '1.7B',
            instruct: process.env.CODEBUDDY_VOICEBOX_INSTRUCT,
          },
        });
        if (!(await provider.isAvailable())) {
          console.error("Voicebox or its configured profile is unavailable.");
          console.error("Run `buddy assistant voicebox` to inspect the endpoint and profiles.");
          process.exit(1);
        }
      } else {
        const { AudioReaderTTSProvider } = await import("../../talk-mode/providers/audioreader-tts.js");
        provider = new AudioReaderTTSProvider();
        await provider.initialize({
          provider: 'audioreader',
          enabled: true,
          priority: 1,
          settings: {
            baseURL: opts.url,
            defaultVoice: opts.voice,
            speed: parseFloat(opts.speed),
            format: opts.format,
          },
        });
        if (!(await provider.isAvailable())) {
          console.error("AudioReader is not running at " + opts.url);
          console.error("Start it with: cd ~/claude/AudioReader && python main.py");
          console.error("Tip: use `--engine pocket` for the on-CPU realtime voice, or `--engine voicebox` for the expressive GPU voice.");
          process.exit(1);
        }
      }

      if (opts.listVoices) {
        const voices = await provider.listVoices();
        console.log("Available voices:\n");
        for (const v of voices) {
          const marker = v.isDefault ? " (default)" : "";
          console.log(`  ${v.providerId.padEnd(14)} ${v.name.padEnd(10)} ${v.language}  ${v.gender}${marker}`);
        }
        return;
      }

      const text = textParts.join(" ");
      if (!text) {
        console.error("No text provided. Usage: buddy speak \"Hello world\"");
        process.exit(1);
      }

      const result = await provider.synthesize(text, {
        voice: opts.voice,
        rate: parseFloat(opts.speed),
        format: opts.format as 'wav' | 'mp3',
      });

      const { execSync } = await import("child_process");
      const { writeFileSync, unlinkSync } = await import("fs");
      const { tmpdir } = await import("os");
      const { join } = await import("path");

      const tmpFile = join(tmpdir(), `codebuddy-speak-${Date.now()}.${result.format}`);
      writeFileSync(tmpFile, result.audio);

      try {
        const players = process.platform === 'darwin'
          ? ['afplay']
          : ['aplay', 'paplay', 'play', 'mpv', 'ffplay'];

        let played = false;
        for (const player of players) {
          try {
            const args = player === 'ffplay' ? '-nodisp -autoexit' : '';
            execSync(`${player} ${args} "${tmpFile}"`, { stdio: 'inherit' });
            played = true;
            break;
          } catch (error) {
            logger.debug('Audio player unavailable', { player, error });
            continue;
          }
        }

        if (!played) {
          console.log(`Audio saved to: ${tmpFile}`);
          console.error("No audio player found. Install aplay, mpv, or ffplay.");
          return;
        }
      } finally {
        try {
          unlinkSync(tmpFile);
        } catch (error) {
          logger.debug('Failed to remove temporary audio file', { tmpFile, error });
        }
      }
    });
}
