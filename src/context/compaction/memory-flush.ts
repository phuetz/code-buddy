/**
 * Memory Flush
 *
 * Flushes important context to EnhancedMemory before compaction
 * to preserve critical information that might otherwise be lost.
 */

import type { ChatMessage } from '../../types/index.js';
import type { FlushableMemory } from './types.js';
import { getEnhancedMemory, type MemoryType } from '../../memory/enhanced-memory.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Memory Extraction
// ============================================================================

/**
 * Keywords that indicate important decisions
 */
const DECISION_INDICATORS = [
  'decided',
  'decision',
  'choose',
  'chose',
  'selected',
  'going with',
  'will use',
  'opted for',
  'approach:',
  'solution:',
];

/**
 * Keywords that indicate important facts
 */
const FACT_INDICATORS = [
  'note:',
  'important:',
  'remember:',
  'key point:',
  'fact:',
  'the reason',
  'because',
  'due to',
  'this is because',
];

/**
 * Keywords that indicate context
 */
const CONTEXT_INDICATORS = [
  'context:',
  'background:',
  'currently',
  'the project',
  'working on',
  'implementing',
  'building',
];

/**
 * Extract flushable memories from messages
 */
export function extractFlushableMemories(messages: ChatMessage[]): FlushableMemory[] {
  const memories: FlushableMemory[] = [];

  for (const message of messages) {
    const content = typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content);

    // Skip very short messages
    if (content.length < 50) continue;

    // Extract decisions
    const decisions = extractDecisions(content);
    for (const decision of decisions) {
      memories.push({
        content: decision,
        type: 'decision',
        importance: 0.8,
        tags: ['auto-extracted', 'compaction'],
      });
    }

    // Extract facts
    const facts = extractFacts(content);
    for (const fact of facts) {
      memories.push({
        content: fact,
        type: 'fact',
        importance: 0.6,
        tags: ['auto-extracted', 'compaction'],
      });
    }

    // Extract context
    const context = extractContext(content, message.role);
    for (const ctx of context) {
      memories.push({
        content: ctx,
        type: 'context',
        importance: 0.5,
        tags: ['auto-extracted', 'compaction'],
      });
    }
  }

  // Deduplicate by content similarity
  return deduplicateMemories(memories);
}

/**
 * Extract decisions from content
 */
function extractDecisions(content: string): string[] {
  const decisions: string[] = [];
  const sentences = splitIntoSentences(content);

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (DECISION_INDICATORS.some(ind => lower.includes(ind))) {
      if (sentence.length >= 30 && sentence.length <= 500) {
        decisions.push(sentence.trim());
      }
    }
  }

  return decisions;
}

/**
 * Extract facts from content
 */
function extractFacts(content: string): string[] {
  const facts: string[] = [];
  const sentences = splitIntoSentences(content);

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (FACT_INDICATORS.some(ind => lower.includes(ind))) {
      if (sentence.length >= 30 && sentence.length <= 500) {
        facts.push(sentence.trim());
      }
    }
  }

  return facts;
}

/**
 * Extract context from content
 */
function extractContext(content: string, role: string): string[] {
  const contexts: string[] = [];

  // Only extract from assistant messages for context
  if (role !== 'assistant') return contexts;

  const sentences = splitIntoSentences(content);

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (CONTEXT_INDICATORS.some(ind => lower.includes(ind))) {
      if (sentence.length >= 50 && sentence.length <= 300) {
        contexts.push(sentence.trim());
      }
    }
  }

  return contexts;
}

/**
 * Split content into sentences
 */
function splitIntoSentences(content: string): string[] {
  // Handle common sentence endings
  return content
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Deduplicate memories by content similarity
 */
function deduplicateMemories(memories: FlushableMemory[]): FlushableMemory[] {
  const unique: FlushableMemory[] = [];

  for (const memory of memories) {
    const isDuplicate = unique.some(existing =>
      calculateSimilarity(existing.content, memory.content) > 0.8
    );

    if (!isDuplicate) {
      unique.push(memory);
    }
  }

  return unique;
}

/**
 * Calculate simple string similarity (Jaccard index on words)
 */
function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));

  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

// ============================================================================
// Memory Flush
// ============================================================================

/**
 * Flush memories to EnhancedMemory
 */
export async function flushToMemory(
  memories: FlushableMemory[],
  options: {
    projectId?: string;
    sessionId?: string;
    maxMemories?: number;
  } = {}
): Promise<number> {
  if (memories.length === 0) {
    return 0;
  }

  const enhancedMemory = getEnhancedMemory();
  const maxMemories = options.maxMemories ?? 20;

  // Sort by importance and take top N
  const toFlush = memories
    .sort((a, b) => b.importance - a.importance)
    .slice(0, maxMemories);

  let flushedCount = 0;

  for (const memory of toFlush) {
    try {
      await enhancedMemory.store({
        type: memory.type as MemoryType,
        content: memory.content,
        importance: memory.importance,
        tags: memory.tags,
        projectId: options.projectId,
        sessionId: options.sessionId,
        metadata: {
          source: 'compaction-flush',
          extractedAt: new Date().toISOString(),
        },
      });
      flushedCount++;
    } catch (error) {
      logger.warn('Failed to flush memory', {
        error: error instanceof Error ? error.message : String(error),
        content: memory.content.slice(0, 100),
      });
    }
  }

  logger.debug('Flushed memories to EnhancedMemory', {
    attempted: toFlush.length,
    flushed: flushedCount,
  });

  return flushedCount;
}

/**
 * Flush messages to memory before compaction
 */
export async function flushMessagesToMemory(
  messages: ChatMessage[],
  options: {
    projectId?: string;
    sessionId?: string;
    maxMemories?: number;
  } = {}
): Promise<number> {
  // Extract flushable memories from messages
  const memories = extractFlushableMemories(messages);

  // Flush to EnhancedMemory
  return flushToMemory(memories, options);
}
