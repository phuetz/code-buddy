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
    .description("Synthesize speech using AudioReader TTS")
    .option("--voice <voice>", "Voice ID to use (e.g., af_bella, ff_siwis)")
    .option("--list-voices", "List available voices")
    .option("--speed <speed>", "Speaking speed (0.25-4.0)", "1.0")
    .option("--format <format>", "Output format (wav, mp3)", "wav")
    .option("--url <url>", "AudioReader API URL", "http://localhost:8000")
    .action(async (textParts: string[], opts: { voice?: string; listVoices?: boolean; speed: string; format: string; url: string }) => {
      const { AudioReaderTTSProvider } = await import("../../talk-mode/providers/audioreader-tts.js");
      const provider = new AudioReaderTTSProvider();
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

      const available = await provider.isAvailable();
      if (!available) {
        console.error("AudioReader is not running at " + opts.url);
        console.error("Start it with: cd ~/claude/AudioReader && python main.py");
        process.exit(1);
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
