/**
 * Shared low-level ElevenLabs HTTP client.
 *
 * Keep authentication and synthesis request construction in one place so the
 * talk-mode provider and Lisa's resident voice path cannot drift apart.
 */

export const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';
export const DEFAULT_ELEVENLABS_MODEL = 'eleven_flash_v2_5';

export interface ElevenLabsSpeechRequest {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId: string;
  outputFormat?: string;
  voiceSettings?: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    useSpeakerBoost?: boolean;
  };
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface ElevenLabsSpeechResponse {
  audio: Buffer;
  characterCost?: number;
}

function acceptFor(outputFormat: string): string {
  if (outputFormat.startsWith('pcm_')) return 'audio/pcm';
  if (outputFormat.startsWith('wav_')) return 'audio/wav';
  return 'audio/mpeg';
}

/**
 * Request synthesized audio. Errors deliberately contain status/context only:
 * neither the API key nor a response body can leak into logs upstream.
 */
export async function requestElevenLabsSpeech(
  request: ElevenLabsSpeechRequest
): Promise<ElevenLabsSpeechResponse> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const outputFormat = request.outputFormat ?? 'mp3_44100_128';
  const url = new URL(
    `${ELEVENLABS_API_URL}/text-to-speech/${encodeURIComponent(request.voiceId)}`
  );
  url.searchParams.set('output_format', outputFormat);

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'xi-api-key': request.apiKey,
      'Content-Type': 'application/json',
      Accept: acceptFor(outputFormat),
    },
    body: JSON.stringify({
      text: request.text,
      model_id: request.modelId,
      ...(request.voiceSettings
        ? {
            voice_settings: {
              stability: request.voiceSettings.stability ?? 0.5,
              similarity_boost: request.voiceSettings.similarityBoost ?? 0.75,
              style: request.voiceSettings.style ?? 0,
              use_speaker_boost: request.voiceSettings.useSpeakerBoost ?? true,
            },
          }
        : {}),
    }),
    ...(request.signal ? { signal: request.signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS request failed with HTTP ${response.status}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) {
    throw new Error('ElevenLabs TTS returned empty audio');
  }
  const rawCost = response.headers.get('character-cost');
  const parsedCost = rawCost === null ? Number.NaN : Number(rawCost);
  return {
    audio,
    ...(Number.isFinite(parsedCost) && parsedCost >= 0
      ? { characterCost: Math.floor(parsedCost) }
      : {}),
  };
}

export interface ElevenLabsSpeechStreamResponse {
  /** The chunked audio body, ready to pipe while ElevenLabs is still synthesizing. */
  body: ReadableStream<Uint8Array>;
  characterCost?: number;
}

/**
 * Request synthesized audio as a CHUNKED STREAM (`POST /v1/text-to-speech/{id}/stream`).
 *
 * Unlike {@link requestElevenLabsSpeech} this resolves as soon as the response
 * headers arrive: the caller reads the body progressively and can start playback
 * on the first chunk instead of waiting for the whole clip. Same error contract —
 * status/context only, never the API key or a response body.
 */
export async function requestElevenLabsSpeechStream(
  request: ElevenLabsSpeechRequest
): Promise<ElevenLabsSpeechStreamResponse> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const outputFormat = request.outputFormat ?? 'mp3_44100_128';
  const url = new URL(
    `${ELEVENLABS_API_URL}/text-to-speech/${encodeURIComponent(request.voiceId)}/stream`
  );
  url.searchParams.set('output_format', outputFormat);

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'xi-api-key': request.apiKey,
      'Content-Type': 'application/json',
      Accept: acceptFor(outputFormat),
    },
    body: JSON.stringify({
      text: request.text,
      model_id: request.modelId,
      ...(request.voiceSettings
        ? {
            voice_settings: {
              stability: request.voiceSettings.stability ?? 0.5,
              similarity_boost: request.voiceSettings.similarityBoost ?? 0.75,
              style: request.voiceSettings.style ?? 0,
              use_speaker_boost: request.voiceSettings.useSpeakerBoost ?? true,
            },
          }
        : {}),
    }),
    ...(request.signal ? { signal: request.signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS stream request failed with HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error('ElevenLabs TTS stream response carried no body');
  }
  const rawCost = response.headers.get('character-cost');
  const parsedCost = rawCost === null ? Number.NaN : Number(rawCost);
  return {
    body: response.body,
    ...(Number.isFinite(parsedCost) && parsedCost >= 0
      ? { characterCost: Math.floor(parsedCost) }
      : {}),
  };
}
