import { ChatEntry } from "../../agent/grok-agent.js";
import { getVoiceInputManager } from "../../input/voice-input-enhanced.js";
import { getTTSManager } from "../../input/text-to-speech.js";

export interface CommandHandlerResult {
  handled: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
}

/**
 * Voice - Control voice input
 */
export async function handleVoice(args: string[]): Promise<CommandHandlerResult> {
  const voiceManager = getVoiceInputManager();
  const action = args[0]?.toLowerCase();

  let content: string;

  switch (action) {
    case "on":
      voiceManager.enable();
      const availability = await voiceManager.isAvailable();
      if (availability.available) {
        content = `🎤 Voice Input: ENABLED

Provider: ${voiceManager.getConfig().provider}
Language: ${voiceManager.getConfig().language}
Hotkey: ${voiceManager.getConfig().hotkey}

Use /voice toggle to start/stop recording.`;
      } else {
        content = `🎤 Voice Input: ENABLED (but not available)

⚠️ ${availability.reason}

Please install the required dependencies and try again.`;
      }
      break;

    case "off":
      voiceManager.disable();
      content = `🎤 Voice Input: DISABLED

Voice recording has been turned off.`;
      break;

    case "toggle":
      const state = voiceManager.getState();
      if (state.isRecording) {
        voiceManager.stopRecording();
        content = `🎤 Recording stopped.

⏳ Processing audio with Whisper...`;
      } else {
        const avail = await voiceManager.isAvailable();
        if (avail.available) {
          await voiceManager.startRecording();
          const silenceSec = ((voiceManager.getConfig().silenceDuration || 1500) / 1000).toFixed(1);
          content = `🔴 RECORDING IN PROGRESS

┌─────────────────────────────────────┐
│  🎙️  Speak now - I'm listening!    │
│                                     │
│  Language: ${(voiceManager.getConfig().language || 'auto').padEnd(23)}│
│  Auto-stop after ${silenceSec}s silence       │
└─────────────────────────────────────┘

💡 Use /voice toggle to stop manually`;
        } else {
          content = `❌ Cannot start recording: ${avail.reason}`;
        }
      }
      break;

    case "config":
      const config = voiceManager.getConfig();
      content = `🎤 Voice Configuration

Provider: ${config.provider}
Language: ${config.language || 'auto'}
Model: ${config.model || 'base'}
Hotkey: ${config.hotkey}
Auto-send: ${config.autoSend ? 'Yes' : 'No'}
Silence Threshold: ${config.silenceThreshold}
Silence Duration: ${config.silenceDuration}ms

Configuration file: ~/.grok/voice-config.json`;
      break;

    case "status":
    default:
      content = voiceManager.formatStatus();
      break;
  }

  return {
    handled: true,
    entry: {
      type: "assistant",
      content,
      timestamp: new Date(),
    },
  };
}

/**
 * Speak - Text-to-speech
 */
export async function handleSpeak(args: string[]): Promise<CommandHandlerResult> {
  const ttsManager = getTTSManager();
  const text = args.join(" ");

  if (!text || text.toLowerCase() === "stop") {
    ttsManager.stop();
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `🔇 Speech stopped.`,
        timestamp: new Date(),
      },
    };
  }

  const availability = await ttsManager.isAvailable();
  if (!availability.available) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `❌ TTS not available: ${availability.reason}

Install with: pip3 install edge-tts`,
        timestamp: new Date(),
      },
    };
  }

  // Start speaking in background (fire-and-forget with error handling)
  ttsManager.speak(text, 'fr').catch(() => {
    // Errors are emitted via 'error' event, no need to handle here
  });

  return {
    handled: true,
    entry: {
      type: "assistant",
      content: `🔊 Speaking: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
      timestamp: new Date(),
    },
  };
}

/**
 * TTS - Text-to-speech settings
 */
export async function handleTTS(args: string[]): Promise<CommandHandlerResult> {
  const ttsManager = getTTSManager();
  const action = args[0]?.toLowerCase();

  let content: string;

  switch (action) {
    case "on":
      ttsManager.enable();
      content = `🔊 Text-to-Speech: ENABLED

Provider: ${ttsManager.getConfig().provider}
Use /speak <text> to speak text.`;
      break;

    case "off":
      ttsManager.disable();
      content = `🔇 Text-to-Speech: DISABLED`;
      break;

    case "auto":
      const currentAuto = ttsManager.getConfig().autoSpeak;
      ttsManager.setAutoSpeak(!currentAuto);
      content = !currentAuto
        ? `🔊 Auto-speak: ENABLED

AI responses will now be spoken aloud automatically.`
        : `🔇 Auto-speak: DISABLED

AI responses will no longer be spoken automatically.`;
      break;

    case "voices":
      const voices = await ttsManager.listVoices();
      const frVoices = voices.filter(v => v.includes('fr-'));
      content = `🎤 Available French Voices (${frVoices.length})

${frVoices.slice(0, 10).map(v => `  • ${v}`).join('\n')}
${frVoices.length > 10 ? `  ... and ${frVoices.length - 10} more` : ''}

Set voice: /tts voice <name>
Example: /tts voice fr-FR-HenriNeural`;
      break;

    case "voice":
      if (args[1]) {
        ttsManager.updateConfig({ voice: args[1] });
        content = `✅ Voice set to: ${args[1]}`;
      } else {
        content = `Usage: /tts voice <voice-name>

Example: /tts voice fr-FR-HenriNeural
Use /tts voices to list available voices.`;
      }
      break;

    case "status":
    default:
      content = ttsManager.formatStatus();
      break;
  }

  return {
    handled: true,
    entry: {
      type: "assistant",
      content,
      timestamp: new Date(),
    },
  };
}
