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
    .description("Synthesize speech (AudioReader by default, or Pocket TTS via --engine pocket)")
    .option("--engine <engine>", "TTS engine: audioreader | pocket (Kyutai, on-CPU, voice cloning)")
    .option("--voice <voice>", "Voice ID (audioreader) or preset/clone-sample path (pocket, e.g. estelle)")
    .option("--language <lang>", "Language for the pocket engine (e.g. french, english)")
    .option("--list-voices", "List available voices")
    .option("--speed <speed>", "Speaking speed (0.25-4.0)", "1.0")
    .option("--format <format>", "Output format (wav, mp3)", "wav")
    .option("--url <url>", "AudioReader API URL", "http://localhost:8000")
    .action(async (textParts: string[], opts: { engine?: string; voice?: string; language?: string; listVoices?: boolean; speed: string; format: string; url: string }) => {
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
          console.error("Tip: use `--engine pocket` for the on-CPU Kyutai voice (Lisa/estelle), no server needed.");
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
