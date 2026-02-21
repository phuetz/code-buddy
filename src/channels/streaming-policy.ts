/**
 * Per-Channel Streaming Policies — OpenClaw-inspired channel adaptation
 *
 * Different messaging channels have different UX constraints:
 * - Telegram: 4096-char message limit, supports MarkdownV2, rate-limited
 * - Discord:  2000-char message limit, embed cards, fast rate limit
 * - Slack:    mrkdwn format, blocks API, real-time socket mode
 * - WhatsApp: plain text only, 65536 char limit, no streaming
 * - Matrix:   rich HTML, threading, no hard length limit
 * - WebChat:  no limits, full streaming, HTML/markdown
 *
 * This module lets each channel adapter declare its streaming preferences
 * independently of the agent, without touching agent-executor.
 */

// ============================================================================
// Types
// ============================================================================

/** How the channel receives content from the agent */
export type StreamingMode =
  | 'char'      // stream character-by-character (WebSocket channels)
  | 'line'      // buffer and emit complete lines
  | 'sentence'  // buffer until sentence boundary (. ! ?)
  | 'paragraph' // buffer until blank line
  | 'full';     // buffer entire response, emit once complete

/** Formatting style the channel natively supports */
export type ChannelFormat =
  | 'markdown'       // GitHub Flavored Markdown
  | 'markdownv2'     // Telegram MarkdownV2 (stricter escaping)
  | 'mrkdwn'         // Slack mrkdwn
  | 'html'           // HTML (Matrix, webchat)
  | 'plain';         // plain text (WhatsApp, SMS)

export interface ChannelStreamingPolicy {
  /** Channel identifier (e.g. 'telegram', 'discord', 'slack') */
  channelId: string;
  /** How content should be chunked before sending */
  mode: StreamingMode;
  /** Maximum characters per message/chunk (0 = unlimited) */
  maxChunkSize: number;
  /** Delay between chunks to avoid rate-limit (ms) */
  chunkDelayMs: number;
  /** Native format the channel understands */
  format: ChannelFormat;
  /** Strip code block fences for channels that don't render them */
  stripCodeBlocks: boolean;
  /** Truncate middle of very long outputs with ellipsis */
  truncateLong: boolean;
  /** Maximum total output length before truncation (0 = unlimited) */
  maxTotalLength: number;
  /** Whether the channel supports editing previously sent messages */
  supportsEdits: boolean;
  /** Whether to show a typing indicator while streaming */
  showTypingIndicator: boolean;
}

// ============================================================================
// Built-in channel defaults
// ============================================================================

const CHANNEL_DEFAULTS: Record<string, Partial<ChannelStreamingPolicy>> = {
  telegram: {
    mode: 'paragraph',
    maxChunkSize: 4000,
    chunkDelayMs: 300,
    format: 'markdownv2',
    stripCodeBlocks: false,
    truncateLong: true,
    maxTotalLength: 16000,
    supportsEdits: true,
    showTypingIndicator: true,
  },
  discord: {
    mode: 'paragraph',
    maxChunkSize: 1900,
    chunkDelayMs: 200,
    format: 'markdown',
    stripCodeBlocks: false,
    truncateLong: true,
    maxTotalLength: 8000,
    supportsEdits: true,
    showTypingIndicator: true,
  },
  slack: {
    mode: 'sentence',
    maxChunkSize: 3000,
    chunkDelayMs: 500,
    format: 'mrkdwn',
    stripCodeBlocks: false,
    truncateLong: true,
    maxTotalLength: 12000,
    supportsEdits: true,
    showTypingIndicator: true,
  },
  whatsapp: {
    mode: 'full',
    maxChunkSize: 60000,
    chunkDelayMs: 0,
    format: 'plain',
    stripCodeBlocks: true,
    truncateLong: false,
    maxTotalLength: 0,
    supportsEdits: false,
    showTypingIndicator: true,
  },
  signal: {
    mode: 'full',
    maxChunkSize: 0,
    chunkDelayMs: 0,
    format: 'plain',
    stripCodeBlocks: true,
    truncateLong: false,
    maxTotalLength: 0,
    supportsEdits: false,
    showTypingIndicator: false,
  },
  matrix: {
    mode: 'paragraph',
    maxChunkSize: 0,
    chunkDelayMs: 100,
    format: 'html',
    stripCodeBlocks: false,
    truncateLong: false,
    maxTotalLength: 0,
    supportsEdits: true,
    showTypingIndicator: true,
  },
  webchat: {
    mode: 'char',
    maxChunkSize: 0,
    chunkDelayMs: 0,
    format: 'markdown',
    stripCodeBlocks: false,
    truncateLong: false,
    maxTotalLength: 0,
    supportsEdits: true,
    showTypingIndicator: false,
  },
  teams: {
    mode: 'full',
    maxChunkSize: 25000,
    chunkDelayMs: 200,
    format: 'markdown',
    stripCodeBlocks: false,
    truncateLong: true,
    maxTotalLength: 25000,
    supportsEdits: false,
    showTypingIndicator: true,
  },
};

const BASE_DEFAULTS: ChannelStreamingPolicy = {
  channelId: 'unknown',
  mode: 'full',
  maxChunkSize: 0,
  chunkDelayMs: 0,
  format: 'plain',
  stripCodeBlocks: false,
  truncateLong: false,
  maxTotalLength: 0,
  supportsEdits: false,
  showTypingIndicator: false,
};

// ============================================================================
// Policy registry
// ============================================================================

const _registry = new Map<string, ChannelStreamingPolicy>();

/** Set a custom streaming policy for a channel (overrides built-in defaults). */
export function setChannelPolicy(channelId: string, policy: Partial<ChannelStreamingPolicy>): void {
  const existing = getChannelPolicy(channelId);
  _registry.set(channelId, { ...existing, ...policy, channelId });
}

/**
 * Get the effective streaming policy for a channel.
 * Priority: custom registry > built-in defaults > base defaults.
 */
export function getChannelPolicy(channelId: string): ChannelStreamingPolicy {
  if (_registry.has(channelId)) {
    return _registry.get(channelId)!;
  }
  const builtin = CHANNEL_DEFAULTS[channelId.toLowerCase()];
  if (builtin) {
    return { ...BASE_DEFAULTS, ...builtin, channelId };
  }
  return { ...BASE_DEFAULTS, channelId };
}

/** Remove a custom policy override (falls back to built-in defaults). */
export function clearChannelPolicy(channelId: string): void {
  _registry.delete(channelId);
}

/** List all registered channel IDs (custom + built-in). */
export function listChannels(): string[] {
  const custom = Array.from(_registry.keys());
  const builtin = Object.keys(CHANNEL_DEFAULTS);
  return [...new Set([...custom, ...builtin])];
}

// ============================================================================
// StreamingChunker — splits agent output per channel policy
// ============================================================================

export class StreamingChunker {
  private buffer = '';
  private totalEmitted = 0;
  private policy: ChannelStreamingPolicy;
  private onChunk: (chunk: string) => Promise<void>;

  constructor(
    channelId: string,
    onChunk: (chunk: string) => Promise<void>,
    overrides?: Partial<ChannelStreamingPolicy>
  ) {
    this.policy = overrides
      ? { ...getChannelPolicy(channelId), ...overrides }
      : getChannelPolicy(channelId);
    this.onChunk = onChunk;
  }

  /** Feed a streaming token/char from the agent into the chunker. */
  async write(token: string): Promise<void> {
    if (this.policy.mode === 'char') {
      await this._emit(token);
      return;
    }

    this.buffer += token;

    if (this.policy.mode === 'line') {
      const lines = this.buffer.split('\n');
      // Keep last (possibly incomplete) line in buffer
      this.buffer = lines.pop() ?? '';
      for (const line of lines) {
        await this._emit(line + '\n');
      }
      return;
    }

    if (this.policy.mode === 'sentence') {
      const sentenceEnd = /[.!?]\s/g;
      let lastIdx = 0;
      let m: RegExpExecArray | null;
      while ((m = sentenceEnd.exec(this.buffer)) !== null) {
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx > 0) {
        const chunk = this.buffer.slice(0, lastIdx);
        this.buffer = this.buffer.slice(lastIdx);
        await this._emit(chunk);
      }
      return;
    }

    if (this.policy.mode === 'paragraph') {
      const paraBreak = /\n\n+/g;
      let lastIdx = 0;
      let m: RegExpExecArray | null;
      while ((m = paraBreak.exec(this.buffer)) !== null) {
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx > 0) {
        const chunk = this.buffer.slice(0, lastIdx);
        this.buffer = this.buffer.slice(lastIdx);
        await this._emit(chunk);
      }
      return;
    }

    // 'full' mode: buffer everything, emit on flush()
  }

  /** Call when the agent stream ends to flush remaining buffer. */
  async flush(): Promise<void> {
    if (this.buffer.length > 0) {
      await this._emit(this.buffer);
      this.buffer = '';
    }
  }

  private async _emit(text: string): Promise<void> {
    if (!text) return;

    let content = text;

    // Strip code block fences if channel doesn't support them
    if (this.policy.stripCodeBlocks) {
      content = content.replace(/```[\w]*\n?/g, '').replace(/```/g, '');
    }

    // Apply maxTotalLength truncation
    if (this.policy.maxTotalLength > 0) {
      const remaining = this.policy.maxTotalLength - this.totalEmitted;
      if (remaining <= 0) return;
      if (content.length > remaining) {
        content = content.slice(0, remaining) + '\n…[truncated]';
      }
    }

    // Split into maxChunkSize chunks if needed
    if (this.policy.maxChunkSize > 0 && content.length > this.policy.maxChunkSize) {
      let offset = 0;
      while (offset < content.length) {
        const slice = content.slice(offset, offset + this.policy.maxChunkSize);
        await this._sendOne(slice);
        offset += this.policy.maxChunkSize;
      }
    } else {
      await this._sendOne(content);
    }
  }

  private async _sendOne(chunk: string): Promise<void> {
    if (!chunk) return;
    this.totalEmitted += chunk.length;
    if (this.policy.chunkDelayMs > 0) {
      await new Promise(r => setTimeout(r, this.policy.chunkDelayMs));
    }
    await this.onChunk(chunk);
  }

  getPolicy(): ChannelStreamingPolicy {
    return { ...this.policy };
  }

  getBytesEmitted(): number {
    return this.totalEmitted;
  }
}
