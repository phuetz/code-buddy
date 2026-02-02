/**
 * Auto-Capture Memory System
 *
 * Inspired by OpenClaw's intelligent memory capture.
 * Automatically detects and stores important information from conversations.
 *
 * Features:
 * - Pattern-based detection (remember, preferences, contacts)
 * - Deduplication with similarity threshold
 * - Lifecycle hooks for auto-recall and auto-capture
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { EnhancedMemory, MemoryEntry, MemoryType } from './enhanced-memory.js';

// ============================================================================
// Types
// ============================================================================

export interface CapturePattern {
  id: string;
  name: string;
  /** Regex patterns to match */
  patterns: RegExp[];
  /** Memory type to assign */
  memoryType: MemoryType;
  /** Importance score (0-1) */
  importance: number;
  /** Tags to apply */
  tags: string[];
  /** Whether to extract the matched content or the full message */
  extractMatch: boolean;
}

export interface CaptureResult {
  captured: boolean;
  memoryId?: string;
  pattern?: string;
  content?: string;
  deduplicated?: boolean;
  similarMemoryId?: string;
}

export interface AutoCaptureConfig {
  /** Enable auto-capture */
  enabled: boolean;
  /** Similarity threshold for deduplication (0-1, default 0.95) */
  deduplicationThreshold: number;
  /** Minimum content length to capture */
  minContentLength: number;
  /** Maximum content length to capture */
  maxContentLength: number;
  /** Patterns to exclude (system messages, etc.) */
  excludePatterns: RegExp[];
  /** Custom capture patterns */
  customPatterns: CapturePattern[];
}

export interface MemoryRecallResult {
  memories: MemoryEntry[];
  injectedContext: string;
  tokenCount: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: AutoCaptureConfig = {
  enabled: true,
  deduplicationThreshold: 0.95,
  minContentLength: 10,
  maxContentLength: 2000,
  excludePatterns: [
    /^(Using tools|Tool result|Error:|Warning:)/i,
    /^\[.*\]$/, // System tags
    /^```[\s\S]*```$/, // Pure code blocks
  ],
  customPatterns: [],
};

// ============================================================================
// Built-in Capture Patterns
// ============================================================================

const BUILTIN_PATTERNS: CapturePattern[] = [
  // Remember/Souviens-toi patterns
  {
    id: 'remember-explicit',
    name: 'Explicit Remember',
    patterns: [
      /(?:remember|souviens[- ]?toi|n'oublie pas|retiens|note|mémorise)\s*(?:que|:)?\s*(.+)/i,
      /(?:je veux que tu|i want you to)\s*(?:remember|souviens|retiens)\s*(.+)/i,
    ],
    memoryType: 'instruction',
    importance: 0.9,
    tags: ['explicit-remember', 'user-instruction'],
    extractMatch: true,
  },

  // Preferences patterns
  {
    id: 'preference-style',
    name: 'Code Style Preference',
    patterns: [
      /(?:je préfère|i prefer|j'aime|i like|utilise|use)\s*(?:le style|style|the)\s*(.+)/i,
      /(?:mon style|my style)\s*(?:est|is|:)\s*(.+)/i,
      /(?:toujours|always)\s*(?:utilise|use|écris|write)\s*(.+)/i,
    ],
    memoryType: 'preference',
    importance: 0.8,
    tags: ['preference', 'code-style'],
    extractMatch: true,
  },

  // Project information
  {
    id: 'project-info',
    name: 'Project Information',
    patterns: [
      /(?:ce projet|this project)\s*(?:est|is|utilise|uses)\s*(.+)/i,
      /(?:nous utilisons|we use|on utilise)\s*(.+)\s*(?:pour|for|dans|in)/i,
      /(?:la stack|the stack|notre stack)\s*(?:est|is|:)\s*(.+)/i,
    ],
    memoryType: 'fact',
    importance: 0.7,
    tags: ['project', 'stack'],
    extractMatch: true,
  },

  // Contact information
  {
    id: 'contact-info',
    name: 'Contact Information',
    patterns: [
      /(?:mon email|my email|email)\s*(?:est|is|:)\s*([\w.-]+@[\w.-]+)/i,
      /(?:contacte|contact)\s*(\S+@\S+)/i,
    ],
    memoryType: 'fact',
    importance: 0.85,
    tags: ['contact', 'personal'],
    extractMatch: true,
  },

  // Naming conventions
  {
    id: 'naming-convention',
    name: 'Naming Convention',
    patterns: [
      /(?:nomme|name)\s*(?:les|the)\s*(?:fichiers|files|variables|functions|fonctions)\s*(?:en|in|avec|with)\s*(.+)/i,
      /(?:convention de nommage|naming convention)\s*(?:est|is|:)\s*(.+)/i,
    ],
    memoryType: 'pattern',
    importance: 0.75,
    tags: ['convention', 'naming'],
    extractMatch: true,
  },

  // Important decisions
  {
    id: 'decision',
    name: 'Decision',
    patterns: [
      /(?:on a décidé|we decided|décision|decision)\s*(?:de|to|:)\s*(.+)/i,
      /(?:choix final|final choice)\s*(?:est|is|:)\s*(.+)/i,
    ],
    memoryType: 'decision',
    importance: 0.85,
    tags: ['decision', 'architecture'],
    extractMatch: true,
  },

  // Error patterns to remember
  {
    id: 'error-solution',
    name: 'Error Solution',
    patterns: [
      /(?:quand|when)\s*(?:cette erreur|this error)\s*(?:apparaît|appears|se produit|occurs),?\s*(?:il faut|you need to|faire|do)\s*(.+)/i,
      /(?:solution pour|solution for)\s*(.+)\s*(?:est|is|:)\s*(.+)/i,
    ],
    memoryType: 'error',
    importance: 0.8,
    tags: ['error', 'solution', 'troubleshooting'],
    extractMatch: false,
  },
];

// ============================================================================
// Auto-Capture Manager
// ============================================================================

/**
 * Auto-Capture Memory Manager
 *
 * Automatically captures important information from conversations.
 */
export class AutoCaptureManager extends EventEmitter {
  private config: AutoCaptureConfig;
  private memory: EnhancedMemory;
  private patterns: CapturePattern[];
  private recentCaptures: Map<string, number> = new Map(); // content hash -> timestamp
  private captureHistory: CaptureResult[] = [];

  constructor(memory: EnhancedMemory, config: Partial<AutoCaptureConfig> = {}) {
    super();
    this.memory = memory;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.patterns = [...BUILTIN_PATTERNS, ...this.config.customPatterns];
  }

  // ============================================================================
  // Pattern Matching
  // ============================================================================

  /**
   * Check if content matches any capture pattern
   */
  private matchPatterns(content: string): { pattern: CapturePattern; match: RegExpMatchArray } | null {
    for (const pattern of this.patterns) {
      for (const regex of pattern.patterns) {
        const match = content.match(regex);
        if (match) {
          return { pattern, match };
        }
      }
    }
    return null;
  }

  /**
   * Check if content should be excluded
   */
  private shouldExclude(content: string): boolean {
    // Check length
    if (content.length < this.config.minContentLength) return true;
    if (content.length > this.config.maxContentLength) return true;

    // Check exclude patterns
    for (const pattern of this.config.excludePatterns) {
      if (pattern.test(content)) return true;
    }

    return false;
  }

  // ============================================================================
  // Deduplication
  // ============================================================================

  /**
   * Calculate simple hash for content
   */
  private hashContent(content: string): string {
    const normalized = content.toLowerCase().trim().replace(/\s+/g, ' ');
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Calculate Jaccard similarity between two strings
   */
  private calculateSimilarity(a: string, b: string): number {
    const setA = new Set(a.toLowerCase().split(/\s+/));
    const setB = new Set(b.toLowerCase().split(/\s+/));

    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    return intersection.size / union.size;
  }

  /**
   * Check if content is duplicate of existing memory
   */
  async checkDuplicate(content: string): Promise<{ isDuplicate: boolean; similarMemoryId?: string }> {
    // Quick check with recent captures
    const hash = this.hashContent(content);
    const recentTime = this.recentCaptures.get(hash);
    if (recentTime && Date.now() - recentTime < 3600000) { // 1 hour
      return { isDuplicate: true };
    }

    // Search for similar memories
    try {
      const similar = await this.memory.recall({
        query: content,
        limit: 5,
        minImportance: 0,
      });

      for (const mem of similar) {
        const similarity = this.calculateSimilarity(content, mem.content);
        if (similarity >= this.config.deduplicationThreshold) {
          return { isDuplicate: true, similarMemoryId: mem.id };
        }
      }
    } catch {
      // If search fails, allow capture
    }

    return { isDuplicate: false };
  }

  // ============================================================================
  // Capture
  // ============================================================================

  /**
   * Attempt to capture important information from content
   */
  async capture(content: string, context?: { sessionId?: string; projectId?: string }): Promise<CaptureResult> {
    if (!this.config.enabled) {
      return { captured: false };
    }

    // Check exclusions
    if (this.shouldExclude(content)) {
      return { captured: false };
    }

    // Match patterns
    const matchResult = this.matchPatterns(content);
    if (!matchResult) {
      return { captured: false };
    }

    const { pattern, match } = matchResult;

    // Extract content to store
    const captureContent = pattern.extractMatch && match[1]
      ? match[1].trim()
      : content.trim();

    // Check for duplicates
    const dupCheck = await this.checkDuplicate(captureContent);
    if (dupCheck.isDuplicate) {
      logger.debug('Memory capture skipped (duplicate)', {
        pattern: pattern.id,
        similarTo: dupCheck.similarMemoryId,
      });
      return {
        captured: false,
        deduplicated: true,
        similarMemoryId: dupCheck.similarMemoryId,
      };
    }

    // Store memory
    try {
      const storedMemory = await this.memory.store({
        type: pattern.memoryType,
        content: captureContent,
        importance: pattern.importance,
        tags: pattern.tags,
        metadata: {
          capturePattern: pattern.id,
          originalContent: content !== captureContent ? content : undefined,
          ...context,
        },
      });

      // Track recent capture
      this.recentCaptures.set(this.hashContent(captureContent), Date.now());

      const result: CaptureResult = {
        captured: true,
        memoryId: storedMemory.id,
        pattern: pattern.id,
        content: captureContent,
      };

      this.captureHistory.push(result);
      this.emit('captured', result);

      logger.info('Memory auto-captured', {
        pattern: pattern.name,
        type: pattern.memoryType,
        contentLength: captureContent.length,
      });

      return result;
    } catch (error) {
      logger.error('Failed to auto-capture memory', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { captured: false };
    }
  }

  /**
   * Process a conversation message for auto-capture
   */
  async processMessage(
    role: 'user' | 'assistant',
    content: string,
    context?: { sessionId?: string; projectId?: string }
  ): Promise<CaptureResult[]> {
    // Only capture from user messages (assistant messages are generated)
    if (role !== 'user') {
      return [];
    }

    const results: CaptureResult[] = [];

    // Split into sentences for better capture
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);

    for (const sentence of sentences) {
      const result = await this.capture(sentence.trim(), context);
      if (result.captured || result.deduplicated) {
        results.push(result);
      }
    }

    return results;
  }

  // ============================================================================
  // Recall
  // ============================================================================

  /**
   * Recall relevant memories before agent execution
   */
  async recall(
    query: string,
    options?: {
      maxTokens?: number;
      projectId?: string;
      types?: MemoryType[];
    }
  ): Promise<MemoryRecallResult> {
    const maxTokens = options?.maxTokens ?? 1000;

    try {
      const memories = await this.memory.recall({
        query,
        projectId: options?.projectId,
        types: options?.types,
        limit: 20,
        minImportance: 0.3,
      });

      if (memories.length === 0) {
        return { memories: [], injectedContext: '', tokenCount: 0 };
      }

      // Build context string with token budget
      const contextParts: string[] = [];
      let estimatedTokens = 0;
      const tokensPerChar = 0.25; // Rough estimate

      for (const mem of memories) {
        const memStr = `- [${mem.type}] ${mem.content}`;
        const memTokens = Math.ceil(memStr.length * tokensPerChar);

        if (estimatedTokens + memTokens > maxTokens) break;

        contextParts.push(memStr);
        estimatedTokens += memTokens;
      }

      const injectedContext = contextParts.length > 0
        ? `## Relevant Memories\n${contextParts.join('\n')}\n`
        : '';

      this.emit('recalled', { count: memories.length, tokenCount: estimatedTokens });

      return {
        memories: memories.slice(0, contextParts.length),
        injectedContext,
        tokenCount: estimatedTokens,
      };
    } catch (error) {
      logger.error('Failed to recall memories', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { memories: [], injectedContext: '', tokenCount: 0 };
    }
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get capture statistics
   */
  getStats(): {
    totalCaptures: number;
    deduplicated: number;
    byPattern: Record<string, number>;
    recentCaptures: number;
  } {
    const byPattern: Record<string, number> = {};
    let deduplicated = 0;

    for (const result of this.captureHistory) {
      if (result.deduplicated) {
        deduplicated++;
      } else if (result.pattern) {
        byPattern[result.pattern] = (byPattern[result.pattern] || 0) + 1;
      }
    }

    return {
      totalCaptures: this.captureHistory.filter(r => r.captured).length,
      deduplicated,
      byPattern,
      recentCaptures: this.recentCaptures.size,
    };
  }

  /**
   * Add custom capture pattern
   */
  addPattern(pattern: CapturePattern): void {
    this.patterns.push(pattern);
    this.emit('pattern:added', pattern);
  }

  /**
   * Remove capture pattern by ID
   */
  removePattern(patternId: string): boolean {
    const index = this.patterns.findIndex(p => p.id === patternId);
    if (index >= 0) {
      this.patterns.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clear recent captures cache
   */
  clearRecentCache(): void {
    this.recentCaptures.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let autoCaptureInstance: AutoCaptureManager | null = null;

/**
 * Get auto-capture manager instance
 */
export function getAutoCaptureManager(memory?: EnhancedMemory): AutoCaptureManager {
  if (!autoCaptureInstance && memory) {
    autoCaptureInstance = new AutoCaptureManager(memory);
  }
  if (!autoCaptureInstance) {
    throw new Error('AutoCaptureManager not initialized. Provide EnhancedMemory instance.');
  }
  return autoCaptureInstance;
}

/**
 * Reset auto-capture manager
 */
export function resetAutoCaptureManager(): void {
  autoCaptureInstance = null;
}

export default AutoCaptureManager;
