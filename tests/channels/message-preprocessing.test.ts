import { vi } from 'vitest';
import {
  MessagePreprocessor,
  type AudioTranscriber,
} from '../../src/channels/message-preprocessing.js';
import type { InboundMessage } from '../../src/channels/core.js';

function createMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: 'msg-1',
    channel: {
      id: 'cli',
      type: 'cli',
      name: 'CLI',
    },
    sender: {
      id: 'user-1',
      username: 'patrice',
    },
    content: 'Voici un audio',
    contentType: 'text',
    timestamp: new Date('2026-05-15T00:00:00.000Z'),
    ...overrides,
  };
}

describe('MessagePreprocessor', () => {
  it('should not fabricate audio transcriptions without a configured transcriber', async () => {
    const preprocessor = new MessagePreprocessor({
      enableTranscription: true,
      enableLinkUnderstanding: false,
    });

    const result = await preprocessor.preprocess(createMessage({
      attachments: [{
        type: 'voice',
        mimeType: 'audio/ogg',
        fileName: 'voice.ogg',
        size: 1024,
      }],
    }));

    expect(result.transcriptions).toEqual([]);
    expect(result.processedContent).toBe('Voici un audio');
    expect(result.processedContent).not.toContain('transcription pending');
  });

  it('should append text only from an explicit audio transcriber', async () => {
    const transcriber: AudioTranscriber = {
      provider: 'whisper',
      transcribe: vi.fn().mockResolvedValue({
        text: 'Transcription reelle',
        language: 'fr',
      }),
    };
    const preprocessor = new MessagePreprocessor({
      enableTranscription: true,
      enableLinkUnderstanding: false,
      audioTranscriber: transcriber,
    });

    const result = await preprocessor.preprocess(createMessage({
      attachments: [{
        type: 'audio',
        mimeType: 'audio/wav',
        fileName: 'sample.wav',
        size: 2048,
      }],
    }));

    expect(transcriber.transcribe).toHaveBeenCalledTimes(1);
    expect(result.transcriptions).toEqual([{
      attachmentIndex: 0,
      text: 'Transcription reelle',
      language: 'fr',
    }]);
    expect(result.processedContent).toContain('[Voice message]: Transcription reelle');
  });
});
