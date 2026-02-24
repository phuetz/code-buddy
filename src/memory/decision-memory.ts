/**
 * Decision Memory — Extracts, persists, and retrieves architectural/design
 * decisions from LLM responses.
 *
 * Decisions are encoded in `<decision>` XML blocks within LLM output.
 * They are stored via EnhancedMemory with type 'decision' for long-term
 * recall and injected into prompts as `<decisions_context>` blocks.
 */

import * as crypto from 'crypto';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface Decision {
  id: string;
  choice: string;
  alternatives: string[];
  rationale: string;
  context: string;
  confidence: number;
  tags: string[];
  timestamp: Date;
}

export interface DecisionExtractionResult {
  decisions: Decision[];
  rawText: string;
}

// ============================================================================
// XML Helpers
// ============================================================================

/**
 * Extract text content of the first occurrence of `<tag>…</tag>` from xml.
 * Returns empty string if the tag is not found.
 */
function extractTag(xml: string, tag: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  if (start === -1) return '';
  const contentStart = start + open.length;
  const end = xml.indexOf(close, contentStart);
  if (end === -1) return '';
  return xml.slice(contentStart, end).trim();
}

/**
 * Extract all occurrences of `<tag>…</tag>` as an array of strings.
 */
function extractAllTags(xml: string, tag: string): string[] {
  const results: string[] = [];
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let cursor = 0;
  while (true) {
    const start = xml.indexOf(open, cursor);
    if (start === -1) break;
    const contentStart = start + open.length;
    const end = xml.indexOf(close, contentStart);
    if (end === -1) break;
    results.push(xml.slice(contentStart, end).trim());
    cursor = end + close.length;
  }
  return results;
}

// ============================================================================
// DecisionMemory
// ============================================================================

export class DecisionMemory {
  /**
   * Parse an LLM response and extract all `<decision>` blocks.
   *
   * Expected format inside LLM output:
   * ```
   * <decision>
   *   <choice>Use PostgreSQL</choice>
   *   <alternatives>MySQL, SQLite</alternatives>
   *   <rationale>Better JSON support and indexing</rationale>
   *   <context>Database selection for the API layer</context>
   *   <confidence>0.85</confidence>
   *   <tags>database, architecture</tags>
   * </decision>
   * ```
   */
  extractDecisions(llmResponse: string): DecisionExtractionResult {
    const decisions: Decision[] = [];

    if (!llmResponse) {
      return { decisions, rawText: llmResponse };
    }

    const blocks = extractAllTags(llmResponse, 'decision');

    for (const block of blocks) {
      const choice = extractTag(block, 'choice');
      if (!choice) continue; // choice is required

      const alternativesRaw = extractTag(block, 'alternatives');
      const alternatives = alternativesRaw
        ? alternativesRaw.split(',').map(a => a.trim()).filter(Boolean)
        : [];

      const rationale = extractTag(block, 'rationale');
      const context = extractTag(block, 'context');

      const confidenceRaw = extractTag(block, 'confidence');
      const confidence = confidenceRaw ? Math.min(1, Math.max(0, parseFloat(confidenceRaw) || 0.5)) : 0.5;

      const tagsRaw = extractTag(block, 'tags');
      const tags = tagsRaw
        ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
        : [];

      decisions.push({
        id: crypto.randomBytes(8).toString('hex'),
        choice,
        alternatives,
        rationale,
        context,
        confidence,
        tags,
        timestamp: new Date(),
      });
    }

    return { decisions, rawText: llmResponse };
  }

  /**
   * Persist extracted decisions to EnhancedMemory.
   */
  async persistDecisions(decisions: Decision[]): Promise<void> {
    if (decisions.length === 0) return;

    let enhancedMemory;
    try {
      const mod = await import('../memory/enhanced-memory.js');
      enhancedMemory = mod.getEnhancedMemory();
    } catch (err) {
      logger.debug('DecisionMemory: could not load EnhancedMemory', { err });
      return;
    }

    for (const decision of decisions) {
      const content = [
        `Decision: ${decision.choice}`,
        decision.alternatives.length > 0
          ? `Alternatives considered: ${decision.alternatives.join(', ')}`
          : null,
        decision.rationale ? `Rationale: ${decision.rationale}` : null,
        decision.context ? `Context: ${decision.context}` : null,
      ].filter(Boolean).join('\n');

      try {
        await enhancedMemory.store({
          type: 'decision',
          content,
          tags: ['decision', ...decision.tags],
          importance: 0.8 + decision.confidence * 0.15,
          metadata: {
            source: 'decision-memory',
            decisionId: decision.id,
            choice: decision.choice,
            alternatives: decision.alternatives,
            confidence: decision.confidence,
          },
        });
      } catch (err) {
        logger.debug('DecisionMemory: failed to persist decision', { err, id: decision.id });
      }
    }
  }

  /**
   * Search stored decisions relevant to a query.
   */
  async findRelevantDecisions(query: string, limit: number = 5): Promise<Decision[]> {
    let enhancedMemory;
    try {
      const mod = await import('../memory/enhanced-memory.js');
      enhancedMemory = mod.getEnhancedMemory();
    } catch {
      return [];
    }

    try {
      const entries = await enhancedMemory.recall({
        query,
        types: ['decision'],
        tags: ['decision'],
        limit,
      });

      return entries.map(entry => ({
        id: (entry.metadata?.decisionId as string) || entry.id,
        choice: (entry.metadata?.choice as string) || entry.content.split('\n')[0]?.replace('Decision: ', '') || '',
        alternatives: (entry.metadata?.alternatives as string[]) || [],
        rationale: this.extractLineValue(entry.content, 'Rationale'),
        context: this.extractLineValue(entry.content, 'Context'),
        confidence: (entry.metadata?.confidence as number) || 0.5,
        tags: entry.tags.filter(t => t !== 'decision'),
        timestamp: entry.createdAt,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Build a `<decisions_context>` block for prompt injection.
   * Returns null if no relevant decisions are found.
   */
  async buildDecisionContext(query: string, limit: number = 5): Promise<string | null> {
    const decisions = await this.findRelevantDecisions(query, limit);
    if (decisions.length === 0) return null;

    const lines = decisions.map(d => {
      const parts = [`- **${d.choice}**`];
      if (d.rationale) parts.push(`  Rationale: ${d.rationale}`);
      if (d.alternatives.length > 0) parts.push(`  Alternatives: ${d.alternatives.join(', ')}`);
      if (d.context) parts.push(`  Context: ${d.context}`);
      return parts.join('\n');
    });

    return `<decisions_context>\nPrevious decisions relevant to this task:\n${lines.join('\n')}\n</decisions_context>`;
  }

  /**
   * Return prompt instructions that teach the LLM how to emit `<decision>` blocks
   * during a pre-compaction flush.
   */
  getDecisionPromptEnhancement(): string {
    return `
If any architectural, design, or technology decisions were made during the conversation,
also output them in <decision> XML blocks. Each block should contain:
  <choice>The chosen option</choice>
  <alternatives>Comma-separated rejected alternatives</alternatives>
  <rationale>Why this choice was made</rationale>
  <context>What problem or area this decision relates to</context>
  <confidence>0.0-1.0 confidence score</confidence>
  <tags>Comma-separated relevant tags</tags>

Example:
<decision>
  <choice>Use PostgreSQL for the API database</choice>
  <alternatives>MySQL, SQLite, MongoDB</alternatives>
  <rationale>Better JSON support, mature indexing, strong ecosystem</rationale>
  <context>Database selection for the REST API backend</context>
  <confidence>0.9</confidence>
  <tags>database, architecture, backend</tags>
</decision>`.trim();
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private extractLineValue(content: string, label: string): string {
    const prefix = `${label}: `;
    const line = content.split('\n').find(l => l.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : '';
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: DecisionMemory | null = null;

export function getDecisionMemory(): DecisionMemory {
  if (!_instance) _instance = new DecisionMemory();
  return _instance;
}

export function resetDecisionMemory(): void {
  _instance = null;
}
