/**
 * Message Preprocessing Pipeline
 *
 * Processes inbound messages before they reach the agent.
 * Advanced enterprise architecture for message:received → transcribed → preprocessed pipeline.
 *
 * Stages:
 * 1. Media detection — identify images, audio, video, files
 * 2. Audio transcription — convert voice messages to text
 * 3. Link understanding — extract and summarize URLs
 * 4. Content enrichment — add metadata, context, formatting
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import type { InboundMessage, ContentType, MessageAttachment } from './core.js';

// ============================================================================
// Types
// ============================================================================

export interface PreprocessingResult {
  originalMessage: InboundMessage;
  processedContent: string;
  transcriptions: Array<{ attachmentIndex: number; text: string; language?: string }>;
  extractedLinks: Array<{ url: string; title?: string; summary?: string }>;
  detectedMedia: Array<{ type: ContentType; mimeType?: string; size?: number }>;
  enrichments: Record<string, unknown>;
  processingTimeMs: number;
}

export interface PreprocessingConfig {
  enableTranscription: boolean;
  enableLinkUnderstanding: boolean;
  enableMediaDetection: boolean;
  maxLinkSummaryLength: number;
  maxTranscriptionLength: number;
  transcriptionProvider: 'whisper' | 'deepgram' | 'browser';
  audioTranscriber?: AudioTranscriber;
}

export interface AudioTranscriber {
  readonly provider: PreprocessingConfig['transcriptionProvider'] | string;
  transcribe(attachment: MessageAttachment): Promise<{ text: string; language?: string }>;
}

// ============================================================================
// Preprocessing Pipeline
// ============================================================================

export class MessagePreprocessor extends EventEmitter {
  private static instance: MessagePreprocessor | null = null;
  private config: PreprocessingConfig;

  constructor(config?: Partial<PreprocessingConfig>) {
    super();
    this.config = {
      enableTranscription: config?.enableTranscription ?? true,
      enableLinkUnderstanding: config?.enableLinkUnderstanding ?? true,
      enableMediaDetection: config?.enableMediaDetection ?? true,
      maxLinkSummaryLength: config?.maxLinkSummaryLength ?? 500,
      maxTranscriptionLength: config?.maxTranscriptionLength ?? 5000,
      transcriptionProvider: config?.transcriptionProvider ?? 'whisper',
      audioTranscriber: config?.audioTranscriber,
    };
  }

  static getInstance(config?: Partial<PreprocessingConfig>): MessagePreprocessor {
    if (!MessagePreprocessor.instance) {
      MessagePreprocessor.instance = new MessagePreprocessor(config);
    }
    return MessagePreprocessor.instance;
  }

  static resetInstance(): void {
    MessagePreprocessor.instance = null;
  }

  // --------------------------------------------------------------------------
  // Main Pipeline
  // --------------------------------------------------------------------------

  async preprocess(message: InboundMessage): Promise<PreprocessingResult> {
    const start = Date.now();
    const result: PreprocessingResult = {
      originalMessage: message,
      processedContent: message.content,
      transcriptions: [],
      extractedLinks: [],
      detectedMedia: [],
      enrichments: {},
      processingTimeMs: 0,
    };

    this.emit('message:received', message);

    // Stage 1: Media detection
    if (this.config.enableMediaDetection && message.attachments?.length) {
      result.detectedMedia = this.detectMedia(message.attachments);
    }

    // Stage 2: Audio transcription
    if (this.config.enableTranscription && message.attachments?.length) {
      const audioAttachments = message.attachments.filter(
        a => a.type === 'audio' || a.type === 'voice'
      );
      if (audioAttachments.length > 0) {
        result.transcriptions = await this.transcribeAudio(audioAttachments, message.attachments);
        this.emit('message:transcribed', { message, transcriptions: result.transcriptions });

        // Append transcriptions to content
        if (result.transcriptions.length > 0) {
          const transcriptText = result.transcriptions
            .map(t => `[Voice message]: ${t.text}`)
            .join('\n');
          result.processedContent = result.processedContent
            ? `${result.processedContent}\n\n${transcriptText}`
            : transcriptText;
        }
      }
    }

    // Stage 3: Link understanding
    if (this.config.enableLinkUnderstanding) {
      result.extractedLinks = this.extractLinks(message.content);
    }

    // Stage 4: Content enrichment
    result.enrichments = this.enrichContent(message);

    result.processingTimeMs = Date.now() - start;
    this.emit('message:preprocessed', result);

    return result;
  }

  // --------------------------------------------------------------------------
  // Stage Implementations
  // --------------------------------------------------------------------------

  private detectMedia(attachments: MessageAttachment[]): Array<{
    type: ContentType;
    mimeType?: string;
    size?: number;
  }> {
    return attachments.map(att => ({
      type: att.type,
      mimeType: att.mimeType,
      size: att.size,
    }));
  }

  private async transcribeAudio(
    audioAttachments: MessageAttachment[],
    allAttachments: MessageAttachment[]
  ): Promise<Array<{ attachmentIndex: number; text: string; language?: string }>> {
    const results: Array<{ attachmentIndex: number; text: string; language?: string }> = [];

    if (!this.config.audioTranscriber) {
      logger.warn('MessagePreprocessor: audio transcription requested but no transcriber is configured', {
        provider: this.config.transcriptionProvider,
        attachments: audioAttachments.length,
      });
      return results;
    }

    for (const att of audioAttachments) {
      const index = allAttachments.indexOf(att);
      logger.debug('MessagePreprocessor: transcribing audio', {
        index,
        mimeType: att.mimeType,
        size: att.size,
        provider: this.config.audioTranscriber.provider,
      });

      try {
        const transcription = await this.config.audioTranscriber.transcribe(att);
        const text = transcription.text.trim().slice(0, this.config.maxTranscriptionLength);
        if (!text) {
          continue;
        }

        results.push({
          attachmentIndex: index,
          text,
          language: transcription.language,
        });
      } catch (error) {
        logger.warn('MessagePreprocessor: audio transcription failed', {
          index,
          provider: this.config.audioTranscriber.provider,
          error,
        });
      }
    }

    return results;
  }

  private extractLinks(content: string): Array<{ url: string; title?: string; summary?: string }> {
    if (!content) return [];

    const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;
    const matches = content.match(urlRegex) || [];

    return matches.map(url => ({
      url,
      // In production, this would fetch and summarize the URL
      title: undefined,
      summary: undefined,
    }));
  }

  private enrichContent(message: InboundMessage): Record<string, unknown> {
    const enrichments: Record<string, unknown> = {};

    // Add timestamp context
    enrichments.receivedAt = message.timestamp.toISOString();

    // Detect if message is a reply
    if (message.replyTo) {
      enrichments.isReply = true;
      enrichments.replyToMessageId = message.replyTo;
    }

    // Detect if message is in a thread
    if (message.threadId) {
      enrichments.isThread = true;
      enrichments.threadId = message.threadId;
    }

    // Detect commands
    if (message.isCommand) {
      enrichments.command = message.commandName;
      enrichments.commandArgs = message.commandArgs;
    }

    // Detect message length category
    const len = message.content?.length || 0;
    enrichments.lengthCategory = len < 50 ? 'short'
      : len < 500 ? 'medium'
      : len < 2000 ? 'long'
      : 'very-long';

    return enrichments;
  }

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  getConfig(): PreprocessingConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<PreprocessingConfig>): void {
    Object.assign(this.config, updates);
  }
}
