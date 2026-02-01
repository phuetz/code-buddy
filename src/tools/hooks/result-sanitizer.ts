/**
 * Tool Result Sanitization System
 *
 * OpenClaw-inspired result sanitization for:
 * - Image payload downscaling/recompression
 * - Size limiting for tool results
 * - Provider-specific policies
 * - Orphaned tool_result cleanup
 * - Content block sanitization
 */

import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Supported LLM providers
 */
export type LLMProvider =
  | 'grok'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'mistral'
  | 'ollama'
  | 'lmstudio';

/**
 * Provider-specific sanitization policy
 */
export interface ProviderPolicy {
  /** Provider name */
  provider: LLMProvider;
  /** Max result size in bytes */
  maxResultSize: number;
  /** Max image dimension (width or height) */
  maxImageDimension: number;
  /** Max image size in bytes */
  maxImageSize: number;
  /** Supported image formats */
  supportedImageFormats: string[];
  /** Tool call ID requirements */
  toolCallIdRequirements?: {
    /** Alphanumeric only */
    alphanumeric?: boolean;
    /** Minimum length */
    minLength?: number;
    /** Maximum length */
    maxLength?: number;
    /** Prefix requirement */
    prefix?: string;
  };
  /** Strip thinking/reasoning from responses */
  stripThinking?: boolean;
  /** Custom sanitizers */
  customSanitizers?: Array<(content: string) => string>;
}

/**
 * Default provider policies
 */
export const PROVIDER_POLICIES: Record<LLMProvider, ProviderPolicy> = {
  grok: {
    provider: 'grok',
    maxResultSize: 100_000,
    maxImageDimension: 2048,
    maxImageSize: 5_000_000,
    supportedImageFormats: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  },
  openai: {
    provider: 'openai',
    maxResultSize: 100_000,
    maxImageDimension: 2048,
    maxImageSize: 20_000_000,
    supportedImageFormats: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  },
  anthropic: {
    provider: 'anthropic',
    maxResultSize: 100_000,
    maxImageDimension: 1568,
    maxImageSize: 5_000_000,
    supportedImageFormats: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  },
  gemini: {
    provider: 'gemini',
    maxResultSize: 100_000,
    maxImageDimension: 3072,
    maxImageSize: 20_000_000,
    supportedImageFormats: ['png', 'jpg', 'jpeg', 'webp'],
    stripThinking: true,
  },
  mistral: {
    provider: 'mistral',
    maxResultSize: 50_000,
    maxImageDimension: 1024,
    maxImageSize: 5_000_000,
    supportedImageFormats: ['png', 'jpg', 'jpeg'],
    toolCallIdRequirements: {
      alphanumeric: true,
      minLength: 9,
      maxLength: 9,
    },
  },
  ollama: {
    provider: 'ollama',
    maxResultSize: 50_000,
    maxImageDimension: 1024,
    maxImageSize: 5_000_000,
    supportedImageFormats: ['png', 'jpg', 'jpeg'],
  },
  lmstudio: {
    provider: 'lmstudio',
    maxResultSize: 50_000,
    maxImageDimension: 1024,
    maxImageSize: 5_000_000,
    supportedImageFormats: ['png', 'jpg', 'jpeg'],
  },
};

/**
 * Tool result to sanitize
 */
export interface ToolResultInput {
  /** Tool call ID */
  toolCallId: string;
  /** Tool name */
  toolName: string;
  /** Success status */
  success: boolean;
  /** Output content */
  output?: string;
  /** Error message */
  error?: string;
  /** Image data (base64) */
  imageData?: string;
  /** Image format */
  imageFormat?: string;
  /** Raw data for special handling */
  rawData?: unknown;
}

/**
 * Sanitized tool result
 */
export interface SanitizedToolResult {
  /** Sanitized tool call ID */
  toolCallId: string;
  /** Tool name */
  toolName: string;
  /** Success status */
  success: boolean;
  /** Sanitized output content */
  output?: string;
  /** Sanitized error message */
  error?: string;
  /** Sanitized image data */
  imageData?: string;
  /** Image format */
  imageFormat?: string;
  /** Sanitization metadata */
  sanitization: {
    /** Was content truncated */
    truncated: boolean;
    /** Original size */
    originalSize: number;
    /** Final size */
    finalSize: number;
    /** Was image resized */
    imageResized: boolean;
    /** Was tool call ID modified */
    toolCallIdModified: boolean;
    /** Applied sanitizers */
    appliedSanitizers: string[];
  };
}

/**
 * Sanitization configuration
 */
export interface SanitizationConfig {
  /** Provider to use */
  provider: LLMProvider;
  /** Override max result size */
  maxResultSize?: number;
  /** Strip ANSI codes */
  stripAnsi?: boolean;
  /** Strip control characters */
  stripControlChars?: boolean;
  /** Truncation suffix */
  truncationSuffix?: string;
  /** Custom sanitizers to apply */
  customSanitizers?: Array<(content: string) => string>;
}

// ============================================================================
// Result Sanitizer
// ============================================================================

/**
 * Tool result sanitizer
 */
export class ResultSanitizer {
  private policy: ProviderPolicy;
  private config: SanitizationConfig;

  constructor(config: SanitizationConfig) {
    this.config = config;
    this.policy = PROVIDER_POLICIES[config.provider];
  }

  /**
   * Sanitize a tool result
   */
  sanitize(result: ToolResultInput): SanitizedToolResult {
    const appliedSanitizers: string[] = [];
    let truncated = false;
    let imageResized = false;
    let toolCallIdModified = false;

    const originalSize = this.calculateSize(result);

    // Sanitize tool call ID
    let toolCallId = result.toolCallId;
    if (this.policy.toolCallIdRequirements) {
      const sanitizedId = this.sanitizeToolCallId(result.toolCallId);
      if (sanitizedId !== result.toolCallId) {
        toolCallId = sanitizedId;
        toolCallIdModified = true;
        appliedSanitizers.push('toolCallId');
      }
    }

    // Sanitize output
    let output = result.output;
    if (output) {
      // Strip ANSI codes
      if (this.config.stripAnsi !== false) {
        const stripped = this.stripAnsi(output);
        if (stripped !== output) {
          output = stripped;
          appliedSanitizers.push('stripAnsi');
        }
      }

      // Strip control characters
      if (this.config.stripControlChars !== false) {
        const stripped = this.stripControlChars(output);
        if (stripped !== output) {
          output = stripped;
          appliedSanitizers.push('stripControlChars');
        }
      }

      // Apply custom sanitizers
      const allSanitizers = [
        ...(this.policy.customSanitizers || []),
        ...(this.config.customSanitizers || []),
      ];

      for (let i = 0; i < allSanitizers.length; i++) {
        const sanitized = allSanitizers[i](output);
        if (sanitized !== output) {
          output = sanitized;
          appliedSanitizers.push(`custom_${i}`);
        }
      }

      // Size limit
      const maxSize = this.config.maxResultSize || this.policy.maxResultSize;
      if (output.length > maxSize) {
        output = this.truncate(output, maxSize);
        truncated = true;
        appliedSanitizers.push('truncate');
      }
    }

    // Sanitize error
    let error = result.error;
    if (error) {
      // Limit error message size
      const maxErrorSize = 5000;
      if (error.length > maxErrorSize) {
        error = this.truncate(error, maxErrorSize);
        truncated = true;
        appliedSanitizers.push('truncateError');
      }
    }

    // Sanitize image
    let imageData = result.imageData;
    let imageFormat = result.imageFormat;

    if (imageData) {
      const sanitizedImage = this.sanitizeImage(imageData, imageFormat);
      if (sanitizedImage.resized || sanitizedImage.recompressed) {
        imageResized = true;
        appliedSanitizers.push('image');
      }
      imageData = sanitizedImage.data;
      imageFormat = sanitizedImage.format;
    }

    const sanitized: SanitizedToolResult = {
      toolCallId,
      toolName: result.toolName,
      success: result.success,
      output,
      error,
      imageData,
      imageFormat,
      sanitization: {
        truncated,
        originalSize,
        finalSize: this.calculateSize({
          ...result,
          toolCallId,
          output,
          error,
          imageData,
        }),
        imageResized,
        toolCallIdModified,
        appliedSanitizers,
      },
    };

    if (appliedSanitizers.length > 0) {
      logger.debug('Sanitized tool result', {
        toolName: result.toolName,
        appliedSanitizers,
        originalSize,
        finalSize: sanitized.sanitization.finalSize,
      });
    }

    return sanitized;
  }

  /**
   * Sanitize tool call ID according to provider requirements
   */
  private sanitizeToolCallId(id: string): string {
    const reqs = this.policy.toolCallIdRequirements;
    if (!reqs) return id;

    let sanitized = id;

    // Ensure prefix
    if (reqs.prefix && !sanitized.startsWith(reqs.prefix)) {
      sanitized = reqs.prefix + sanitized;
    }

    // Alphanumeric only
    if (reqs.alphanumeric) {
      sanitized = sanitized.replace(/[^a-zA-Z0-9]/g, '');
    }

    // Length constraints
    if (reqs.minLength && sanitized.length < reqs.minLength) {
      // Pad with random alphanumeric
      while (sanitized.length < reqs.minLength) {
        sanitized += Math.random().toString(36).charAt(2);
      }
    }

    if (reqs.maxLength && sanitized.length > reqs.maxLength) {
      sanitized = sanitized.slice(0, reqs.maxLength);
    }

    return sanitized;
  }

  /**
   * Strip ANSI escape codes
   */
  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
  }

  /**
   * Strip control characters (except newlines and tabs)
   */
  private stripControlChars(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  /**
   * Truncate text with suffix
   */
  private truncate(text: string, maxSize: number): string {
    const suffix = this.config.truncationSuffix || '\n\n[Output truncated...]';
    const availableSize = maxSize - suffix.length;

    if (availableSize <= 0) {
      return suffix;
    }

    // Try to truncate at a line boundary
    let truncated = text.slice(0, availableSize);
    const lastNewline = truncated.lastIndexOf('\n');

    if (lastNewline > availableSize * 0.8) {
      truncated = truncated.slice(0, lastNewline);
    }

    return truncated + suffix;
  }

  /**
   * Sanitize image data
   */
  private sanitizeImage(
    base64Data: string,
    format?: string
  ): { data: string; format: string; resized: boolean; recompressed: boolean } {
    // For now, just validate format and return as-is
    // Full image processing would require sharp or similar library

    const detectedFormat = format || this.detectImageFormat(base64Data);

    // Check if format is supported
    if (!this.policy.supportedImageFormats.includes(detectedFormat)) {
      logger.warn(`Image format ${detectedFormat} not supported by ${this.policy.provider}`);
    }

    // Check size
    const sizeBytes = (base64Data.length * 3) / 4;
    const needsResize = sizeBytes > this.policy.maxImageSize;

    if (needsResize) {
      logger.warn('Image exceeds size limit, would need resizing', {
        size: sizeBytes,
        maxSize: this.policy.maxImageSize,
      });
    }

    return {
      data: base64Data,
      format: detectedFormat,
      resized: false, // Would be true if we actually resized
      recompressed: false,
    };
  }

  /**
   * Detect image format from base64 data
   */
  private detectImageFormat(base64Data: string): string {
    const prefix = base64Data.slice(0, 50);

    if (prefix.includes('/9j/')) return 'jpeg';
    if (prefix.includes('iVBORw0KGgo')) return 'png';
    if (prefix.includes('R0lGOD')) return 'gif';
    if (prefix.includes('UklGR')) return 'webp';

    return 'unknown';
  }

  /**
   * Calculate approximate size of result
   */
  private calculateSize(result: Partial<ToolResultInput>): number {
    let size = 0;

    if (result.toolCallId) size += result.toolCallId.length;
    if (result.toolName) size += result.toolName.length;
    if (result.output) size += result.output.length;
    if (result.error) size += result.error.length;
    if (result.imageData) size += (result.imageData.length * 3) / 4;

    return size;
  }
}

// ============================================================================
// Tool Use Result Pairing Validator
// ============================================================================

/**
 * Tool use from assistant message
 */
export interface ToolUse {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool result from tool response
 */
export interface ToolResultPair {
  toolCallId: string;
  content: string;
}

/**
 * Validation result
 */
export interface PairingValidationResult {
  /** Is valid */
  valid: boolean;
  /** Orphaned tool results (no matching tool use) */
  orphanedResults: string[];
  /** Missing results (tool use without result) */
  missingResults: string[];
  /** Synthesized results for missing tool uses */
  synthesizedResults: ToolResultPair[];
  /** Cleaned results (orphans removed) */
  cleanedResults: ToolResultPair[];
}

/**
 * Validate and sanitize tool use/result pairing
 * Removes orphaned results and creates synthetic results for missing tool uses
 */
export function sanitizeToolUseResultPairing(
  toolUses: ToolUse[],
  toolResults: ToolResultPair[]
): PairingValidationResult {
  const toolUseIds = new Set(toolUses.map(t => t.id));
  const resultIds = new Set(toolResults.map(r => r.toolCallId));

  // Find orphaned results (no matching tool use)
  const orphanedResults = toolResults
    .filter(r => !toolUseIds.has(r.toolCallId))
    .map(r => r.toolCallId);

  // Find missing results (tool use without result)
  const missingResults = toolUses
    .filter(t => !resultIds.has(t.id))
    .map(t => t.id);

  // Create synthetic results for missing tool uses
  const synthesizedResults: ToolResultPair[] = missingResults.map(id => {
    const toolUse = toolUses.find(t => t.id === id)!;
    return {
      toolCallId: id,
      content: `[Tool ${toolUse.name} result not available]`,
    };
  });

  // Remove orphaned results
  const cleanedResults = toolResults.filter(r => toolUseIds.has(r.toolCallId));

  // Add synthesized results
  const finalResults = [...cleanedResults, ...synthesizedResults];

  const valid = orphanedResults.length === 0 && missingResults.length === 0;

  if (!valid) {
    logger.warn('Tool use/result pairing issues', {
      orphanedResults: orphanedResults.length,
      missingResults: missingResults.length,
    });
  }

  return {
    valid,
    orphanedResults,
    missingResults,
    synthesizedResults,
    cleanedResults: finalResults,
  };
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a sanitizer for a specific provider
 */
export function createSanitizer(provider: LLMProvider, config?: Partial<SanitizationConfig>): ResultSanitizer {
  return new ResultSanitizer({
    provider,
    ...config,
  });
}

/**
 * Quick sanitize for a provider
 */
export function sanitizeResult(
  provider: LLMProvider,
  result: ToolResultInput
): SanitizedToolResult {
  const sanitizer = createSanitizer(provider);
  return sanitizer.sanitize(result);
}

export default ResultSanitizer;
