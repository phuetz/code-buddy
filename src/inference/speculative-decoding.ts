/**
 * Speculative Decoding Support
 *
 * Implements speculative decoding for faster inference:
 * - Uses a small "draft" model to propose tokens quickly
 * - Uses the main "target" model to verify/correct proposals
 * - Can achieve 2-3x speedup for autoregressive generation
 *
 * Based on: "Fast Inference from Transformers via Speculative Decoding"
 * (Leviathan et al., 2023)
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface SpeculativeConfig {
  /** Draft model identifier */
  draftModel: string;
  /** Target model identifier */
  targetModel: string;
  /** Number of tokens to speculate ahead */
  speculationLength: number;
  /** Minimum acceptance rate to keep using speculation */
  minAcceptanceRate: number;
  /** Whether to enable adaptive speculation length */
  adaptiveLength: boolean;
  /** Temperature for draft model */
  draftTemperature: number;
  /** Temperature for target model */
  targetTemperature: number;
}

export interface SpeculativeStats {
  /** Total tokens generated */
  totalTokens: number;
  /** Tokens accepted from draft */
  acceptedTokens: number;
  /** Tokens rejected (replaced by target) */
  rejectedTokens: number;
  /** Current acceptance rate */
  acceptanceRate: number;
  /** Average tokens per speculation round */
  avgTokensPerRound: number;
  /** Speedup factor compared to target-only */
  estimatedSpeedup: number;
  /** Total speculation rounds */
  speculationRounds: number;
}

export interface DraftProposal {
  /** Proposed token IDs */
  tokens: number[];
  /** Log probabilities from draft model */
  logprobs: number[];
  /** Time taken for draft (ms) */
  draftTimeMs: number;
}

export interface VerificationResult {
  /** Number of accepted tokens (0 to speculationLength) */
  accepted: number;
  /** Final tokens after verification */
  finalTokens: number[];
  /** Time taken for verification (ms) */
  verifyTimeMs: number;
  /** Whether all tokens were accepted */
  fullAccept: boolean;
}

export type DraftModelCallback = (
  prompt: string,
  numTokens: number
) => Promise<DraftProposal>;

export type TargetModelCallback = (
  prompt: string,
  draftTokens: number[]
) => Promise<VerificationResult>;

export const DEFAULT_SPECULATIVE_CONFIG: SpeculativeConfig = {
  draftModel: 'qwen2.5-0.5b',
  targetModel: 'qwen2.5-7b',
  speculationLength: 4,
  minAcceptanceRate: 0.5,
  adaptiveLength: true,
  draftTemperature: 0.0,
  targetTemperature: 0.7,
};

// ============================================================================
// Recommended Model Pairs
// ============================================================================

export interface ModelPair {
  draft: string;
  target: string;
  description: string;
  expectedSpeedup: number;
}

export const RECOMMENDED_PAIRS: ModelPair[] = [
  {
    draft: 'qwen2.5-0.5b',
    target: 'qwen2.5-7b',
    description: 'Qwen 2.5 family (same tokenizer)',
    expectedSpeedup: 2.0,
  },
  {
    draft: 'qwen2.5-1.5b',
    target: 'qwen2.5-32b',
    description: 'Qwen 2.5 for large target',
    expectedSpeedup: 2.5,
  },
  {
    draft: 'llama-3.2-1b',
    target: 'llama-3.1-8b',
    description: 'Llama 3.x family',
    expectedSpeedup: 1.8,
  },
  {
    draft: 'llama-3.2-3b',
    target: 'llama-3.1-70b',
    description: 'Llama 3.x for large target',
    expectedSpeedup: 2.2,
  },
  {
    draft: 'starcoder2-3b',
    target: 'starcoder2-15b',
    description: 'StarCoder2 for code generation',
    expectedSpeedup: 1.7,
  },
];

// ============================================================================
// Speculative Decoder
// ============================================================================

export class SpeculativeDecoder extends EventEmitter {
  private config: SpeculativeConfig;
  private stats: SpeculativeStats;
  private isRunning = false;
  private currentSpecLength: number;

  constructor(config: Partial<SpeculativeConfig> = {}) {
    super();
    this.config = { ...DEFAULT_SPECULATIVE_CONFIG, ...config };
    this.currentSpecLength = this.config.speculationLength;
    this.stats = this.initStats();
  }

  private initStats(): SpeculativeStats {
    return {
      totalTokens: 0,
      acceptedTokens: 0,
      rejectedTokens: 0,
      acceptanceRate: 1.0,
      avgTokensPerRound: 0,
      estimatedSpeedup: 1.0,
      speculationRounds: 0,
    };
  }

  /**
   * Run speculative decoding for a generation task
   */
  async generate(
    prompt: string,
    maxTokens: number,
    draftCallback: DraftModelCallback,
    targetCallback: TargetModelCallback,
    onToken?: (token: number) => void
  ): Promise<{ tokens: number[]; stats: SpeculativeStats }> {
    if (this.isRunning) {
      throw new Error('Speculative decoder is already running');
    }

    this.isRunning = true;
    this.stats = this.initStats();

    const generatedTokens: number[] = [];
    let currentPrompt = prompt;

    try {
      while (generatedTokens.length < maxTokens) {
        // Phase 1: Draft model proposes tokens
        const draft = await draftCallback(currentPrompt, this.currentSpecLength);

        this.emit('draft', {
          tokens: draft.tokens,
          timeMs: draft.draftTimeMs,
        });

        // Phase 2: Target model verifies proposals
        const verification = await targetCallback(currentPrompt, draft.tokens);

        this.emit('verify', {
          accepted: verification.accepted,
          total: draft.tokens.length,
          timeMs: verification.verifyTimeMs,
        });

        // Update stats
        this.updateStats(draft.tokens.length, verification.accepted);

        // Add accepted tokens
        for (let i = 0; i < verification.finalTokens.length; i++) {
          generatedTokens.push(verification.finalTokens[i]);
          if (onToken) {
            onToken(verification.finalTokens[i]);
          }
        }

        // Update prompt with new tokens
        currentPrompt = this.updatePrompt(currentPrompt, verification.finalTokens);

        // Adaptive speculation length
        if (this.config.adaptiveLength) {
          this.adaptSpeculationLength(verification.accepted, draft.tokens.length);
        }

        // Check if we hit EOS or reached max tokens
        if (verification.finalTokens.length === 0 || generatedTokens.length >= maxTokens) {
          break;
        }
      }

      this.emit('complete', {
        totalTokens: generatedTokens.length,
        stats: this.stats,
      });

      return { tokens: generatedTokens, stats: { ...this.stats } };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Update statistics after a speculation round
   */
  private updateStats(proposed: number, accepted: number): void {
    this.stats.speculationRounds++;
    this.stats.totalTokens += accepted + 1; // +1 for correction token if rejected
    this.stats.acceptedTokens += accepted;
    this.stats.rejectedTokens += proposed - accepted;

    // Calculate rolling acceptance rate
    this.stats.acceptanceRate =
      this.stats.acceptedTokens / (this.stats.acceptedTokens + this.stats.rejectedTokens);

    // Average tokens per round
    this.stats.avgTokensPerRound =
      this.stats.totalTokens / this.stats.speculationRounds;

    // Estimate speedup (simplified model)
    // Speedup ≈ avgTokensPerRound / (1 + draftCost/targetCost)
    // Assuming draft is ~10x faster than target
    const draftCostRatio = 0.1;
    this.stats.estimatedSpeedup =
      this.stats.avgTokensPerRound / (1 + this.currentSpecLength * draftCostRatio);
  }

  /**
   * Adapt speculation length based on acceptance rate
   */
  private adaptSpeculationLength(accepted: number, proposed: number): void {
    const acceptRate = proposed > 0 ? accepted / proposed : 0;

    if (acceptRate > 0.8 && this.currentSpecLength < 8) {
      // High acceptance - increase speculation
      this.currentSpecLength++;
      logger.debug('Increasing speculation length', { newLength: this.currentSpecLength });
    } else if (acceptRate < 0.3 && this.currentSpecLength > 1) {
      // Low acceptance - decrease speculation
      this.currentSpecLength--;
      logger.debug('Decreasing speculation length', { newLength: this.currentSpecLength });
    }
  }

  /**
   * Update prompt with new tokens (placeholder - actual implementation depends on tokenizer)
   */
  private updatePrompt(prompt: string, newTokenIds: number[]): string {
    // In a real implementation, this would decode token IDs and append
    // For now, we just track the conceptual state
    return prompt + `[+${newTokenIds.length} tokens]`;
  }

  /**
   * Check if speculative decoding is beneficial for current context
   */
  shouldUseSpeculation(): boolean {
    // Don't use if acceptance rate is too low
    if (this.stats.speculationRounds > 10 && this.stats.acceptanceRate < this.config.minAcceptanceRate) {
      return false;
    }

    // Don't use if estimated speedup is negligible
    if (this.stats.estimatedSpeedup < 1.2) {
      return false;
    }

    return true;
  }

  /**
   * Get recommended model pair for a target model
   */
  static getRecommendedDraft(targetModel: string): ModelPair | null {
    const lowerTarget = targetModel.toLowerCase();

    for (const pair of RECOMMENDED_PAIRS) {
      if (lowerTarget.includes(pair.target.split('-')[0])) {
        return pair;
      }
    }

    return null;
  }

  /**
   * Generate llama.cpp speculative decoding arguments
   */
  generateLlamaCppArgs(): string[] {
    const args: string[] = [];

    // Draft model path (requires separate model file)
    args.push('--model-draft', this.config.draftModel);

    // Number of draft tokens
    args.push('--draft', String(this.currentSpecLength));

    // Probability threshold for accepting draft tokens
    args.push('--draft-p-min', '0.5');

    return args;
  }

  /**
   * Get current configuration
   */
  getConfig(): SpeculativeConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SpeculativeConfig>): void {
    Object.assign(this.config, config);
    if (config.speculationLength !== undefined) {
      this.currentSpecLength = config.speculationLength;
    }
    this.emit('configUpdated', this.config);
  }

  /**
   * Get current statistics
   */
  getStats(): SpeculativeStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = this.initStats();
    this.currentSpecLength = this.config.speculationLength;
  }

  /**
   * Format statistics for display
   */
  formatStats(): string {
    const lines: string[] = [];

    lines.push('Speculative Decoding Statistics');
    lines.push('─────────────────────────────────────');
    lines.push(`Draft Model:        ${this.config.draftModel}`);
    lines.push(`Target Model:       ${this.config.targetModel}`);
    lines.push(`Speculation Length: ${this.currentSpecLength}`);
    lines.push('');
    lines.push('Performance');
    lines.push('─────────────────────────────────────');
    lines.push(`Total Tokens:       ${this.stats.totalTokens}`);
    lines.push(`Accepted:           ${this.stats.acceptedTokens}`);
    lines.push(`Rejected:           ${this.stats.rejectedTokens}`);
    lines.push(`Acceptance Rate:    ${(this.stats.acceptanceRate * 100).toFixed(1)}%`);
    lines.push(`Avg Tokens/Round:   ${this.stats.avgTokensPerRound.toFixed(2)}`);
    lines.push(`Est. Speedup:       ${this.stats.estimatedSpeedup.toFixed(2)}x`);
    lines.push(`Speculation Rounds: ${this.stats.speculationRounds}`);

    return lines.join('\n');
  }
}

// ============================================================================
// Mock Implementations for Testing
// ============================================================================

/**
 * Create a mock draft callback for testing
 */
export function createMockDraftCallback(_acceptanceRate = 0.7): DraftModelCallback {
  return async (_prompt: string, numTokens: number): Promise<DraftProposal> => {
    // Simulate draft model latency (~10ms per token)
    await new Promise((resolve) => setTimeout(resolve, numTokens * 10));

    const tokens: number[] = [];
    const logprobs: number[] = [];

    for (let i = 0; i < numTokens; i++) {
      tokens.push(Math.floor(Math.random() * 32000));
      logprobs.push(-Math.random() * 2);
    }

    return {
      tokens,
      logprobs,
      draftTimeMs: numTokens * 10,
    };
  };
}

/**
 * Create a mock target callback for testing
 */
export function createMockTargetCallback(acceptanceRate = 0.7): TargetModelCallback {
  return async (_prompt: string, draftTokens: number[]): Promise<VerificationResult> => {
    // Simulate target model latency (~100ms for verification)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Randomly accept tokens based on acceptance rate
    let accepted = 0;
    for (let i = 0; i < draftTokens.length; i++) {
      if (Math.random() < acceptanceRate) {
        accepted++;
      } else {
        break; // First rejection breaks the chain
      }
    }

    const finalTokens = draftTokens.slice(0, accepted);
    if (accepted < draftTokens.length) {
      // Add correction token
      finalTokens.push(Math.floor(Math.random() * 32000));
    }

    return {
      accepted,
      finalTokens,
      verifyTimeMs: 100,
      fullAccept: accepted === draftTokens.length,
    };
  };
}

// ============================================================================
// Singleton
// ============================================================================

let speculativeDecoderInstance: SpeculativeDecoder | null = null;

export function getSpeculativeDecoder(
  config?: Partial<SpeculativeConfig>
): SpeculativeDecoder {
  if (!speculativeDecoderInstance) {
    speculativeDecoderInstance = new SpeculativeDecoder(config);
  }
  return speculativeDecoderInstance;
}

export function resetSpeculativeDecoder(): void {
  speculativeDecoderInstance = null;
}
