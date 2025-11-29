/**
 * Extended Thinking Engine
 *
 * Enables deep, structured reasoning before generating responses.
 * Implements multiple reasoning strategies including:
 * - Chain-of-thought reasoning
 * - Self-consistency decoding
 * - Verification and contradiction detection
 * - Multi-path exploration
 *
 * Inspired by Claude's Extended Thinking and research on reasoning in LLMs.
 */

import { EventEmitter } from "events";
import { GrokClient, GrokMessage } from "../../grok/client.js";
import {
  ThinkingDepth,
  ThinkingConfig,
  ThinkingSession,
  ThinkingResult,
  Thought,
  ThoughtType,
  ReasoningChain,
  VerificationResult,
  SelfConsistencyResult,
  AlternativeAnswer,
  DEFAULT_THINKING_CONFIG,
  THINKING_DEPTH_CONFIG,
  THINKING_PROMPTS,
} from "./types.js";

/**
 * System prompts for thinking
 */
const THINKING_SYSTEM_PROMPT = `You are engaged in extended thinking mode. Your goal is to reason carefully and thoroughly about the problem before arriving at an answer.

Guidelines for thinking:
1. Start with observations - what are the key facts?
2. Analyze deeply - look for patterns, connections, and implications
3. Form hypotheses - propose potential solutions or explanations
4. Verify your reasoning - check for errors or contradictions
5. Consider alternatives - explore other possibilities
6. Synthesize insights - combine findings into a coherent understanding
7. Reach conclusions - state your answer with appropriate confidence

Be explicit about your reasoning. If uncertain, say so. If you find contradictions, acknowledge them.`;

const THOUGHT_GENERATION_PROMPT = `Given the problem and your previous thoughts, generate the next thought in your reasoning chain.

Problem: {problem}

Previous thoughts:
{previous_thoughts}

What type of thought should come next? Consider:
- If you haven't made observations, start there
- If you have observations but no analysis, analyze them
- If you have analysis but no hypothesis, form one
- If you have a hypothesis, verify it
- If you find issues, note the contradiction
- If you have multiple insights, synthesize them
- If ready, state your conclusion

Respond in this format:
<thought_type>[observation|analysis|hypothesis|verification|contradiction|synthesis|conclusion|uncertainty|question|action_plan]</thought_type>
<content>Your thought here</content>
<confidence>0.0-1.0</confidence>
<reasoning>Why you're thinking this</reasoning>`;

const VERIFICATION_PROMPT = `Verify the following thought/conclusion:

Thought: {thought}
Reasoning: {reasoning}

Problem context: {problem}

Check for:
1. Logical consistency
2. Factual accuracy (based on given information)
3. Completeness - are there missing considerations?
4. Potential counterexamples

Respond:
<verified>true|false</verified>
<confidence>0.0-1.0</confidence>
<issues>Any issues found (if any)</issues>
<corrections>Suggested corrections (if needed)</corrections>`;

const SYNTHESIS_PROMPT = `Synthesize the following thoughts into a final answer:

Problem: {problem}

Thoughts:
{thoughts}

Provide:
<answer>Your final answer</answer>
<reasoning>Key reasoning that led to this answer</reasoning>
<confidence>0.0-1.0</confidence>
<key_insights>
- Insight 1
- Insight 2
...
</key_insights>
<uncertainties>
- Any remaining uncertainties
</uncertainties>`;

/**
 * Extended Thinking Engine
 */
export class ExtendedThinkingEngine extends EventEmitter {
  private client: GrokClient;
  private config: ThinkingConfig;
  private currentSession: ThinkingSession | null = null;

  constructor(
    apiKey: string,
    baseURL?: string,
    config: Partial<ThinkingConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_THINKING_CONFIG, ...config };
    this.client = new GrokClient(
      apiKey,
      config.model || "grok-3-latest",
      baseURL
    );
  }

  /**
   * Think deeply about a problem
   */
  async think(
    problem: string,
    context?: string,
    depth?: ThinkingDepth
  ): Promise<ThinkingResult> {
    // Set up configuration based on depth
    const effectiveDepth = depth || this.config.depth;
    const depthConfig = THINKING_DEPTH_CONFIG[effectiveDepth];
    const sessionConfig = { ...this.config, ...depthConfig, depth: effectiveDepth };

    // Create session
    const session = this.createSession(problem, context, sessionConfig);
    this.currentSession = session;
    this.emit("thinking:start", { session });

    try {
      // Create initial reasoning chain
      const mainChain = this.createChain();
      session.chains.push(mainChain);
      session.activeChainId = mainChain.id;

      this.emit("thinking:chain:start", { chain: mainChain });

      // Main thinking loop
      while (this.shouldContinueThinking(session, sessionConfig)) {
        const activeChain = this.getActiveChain(session);
        if (!activeChain) break;

        // Generate next thought
        const thought = await this.generateThought(session, activeChain, sessionConfig);
        if (!thought) break;

        // Add thought to chain
        activeChain.thoughts.push(thought);
        this.emit("thinking:thought", { thought, chain: activeChain });

        // Stream thinking content if enabled
        if (sessionConfig.streamThinking) {
          this.emit("thinking:stream", { content: this.formatThought(thought) });
        }

        // Verify thought if verification is enabled
        if (sessionConfig.verificationEnabled && this.shouldVerify(thought)) {
          const verification = await this.verifyThought(thought, session, sessionConfig);
          this.emit("thinking:verification", { thought, verified: verification.verified });

          if (!verification.verified) {
            // Add contradiction thought
            const contradictionThought = this.createContradictionThought(
              thought,
              verification
            );
            activeChain.thoughts.push(contradictionThought);
            this.emit("thinking:thought", { thought: contradictionThought, chain: activeChain });
          }
        }

        // Consider branching to explore alternatives
        if (this.shouldBranch(session, sessionConfig)) {
          await this.createBranch(session, activeChain, sessionConfig);
        }

        // Check if chain is complete
        if (thought.type === "conclusion") {
          activeChain.status = "completed";
          activeChain.conclusion = thought.content;
          activeChain.confidence = thought.confidence;
          this.emit("thinking:chain:complete", { chain: activeChain });

          // Move to next chain or finish
          const nextChainId = this.selectNextChain(session);
          session.activeChainId = nextChainId;
        }
      }

      // Synthesize final answer
      const result = await this.synthesize(session, sessionConfig);
      session.finalAnswer = result;
      session.endTime = Date.now();

      this.emit("thinking:complete", { result });
      return result;
    } finally {
      this.currentSession = null;
    }
  }

  /**
   * Quick think - minimal reasoning for simple problems
   */
  async quickThink(problem: string, context?: string): Promise<ThinkingResult> {
    return this.think(problem, context, "minimal");
  }

  /**
   * Deep think - thorough reasoning for complex problems
   */
  async deepThink(problem: string, context?: string): Promise<ThinkingResult> {
    return this.think(problem, context, "deep");
  }

  /**
   * Generate the next thought in a chain
   */
  private async generateThought(
    session: ThinkingSession,
    chain: ReasoningChain,
    config: ThinkingConfig
  ): Promise<Thought | null> {
    const previousThoughts = chain.thoughts
      .map((t, i) => `${i + 1}. [${t.type}] ${t.content}`)
      .join("\n");

    const prompt = THOUGHT_GENERATION_PROMPT
      .replace("{problem}", session.problem)
      .replace("{previous_thoughts}", previousThoughts || "None yet");

    const messages: GrokMessage[] = [
      { role: "system", content: THINKING_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];

    if (session.context) {
      messages.splice(1, 0, {
        role: "user",
        content: `Context: ${session.context}`,
      });
    }

    try {
      const response = await this.client.chat(messages, [], {
        temperature: config.temperature,
      });

      const content = response.choices[0]?.message?.content || "";
      return this.parseThought(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse a thought from LLM response
   */
  private parseThought(content: string): Thought | null {
    const typeMatch = content.match(/<thought_type>(\w+)<\/thought_type>/);
    const contentMatch = content.match(/<content>([\s\S]*?)<\/content>/);
    const confidenceMatch = content.match(/<confidence>([\d.]+)<\/confidence>/);
    const reasoningMatch = content.match(/<reasoning>([\s\S]*?)<\/reasoning>/);

    if (!typeMatch || !contentMatch) {
      // Try to extract from plain text
      return {
        id: this.createId("thought"),
        type: "analysis",
        content: content.slice(0, 500),
        confidence: 0.5,
        timestamp: Date.now(),
      };
    }

    return {
      id: this.createId("thought"),
      type: typeMatch[1] as ThoughtType,
      content: contentMatch[1].trim(),
      confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
      reasoning: reasoningMatch?.[1]?.trim(),
      timestamp: Date.now(),
    };
  }

  /**
   * Verify a thought for logical consistency
   */
  private async verifyThought(
    thought: Thought,
    session: ThinkingSession,
    config: ThinkingConfig
  ): Promise<VerificationResult> {
    const prompt = VERIFICATION_PROMPT
      .replace("{thought}", thought.content)
      .replace("{reasoning}", thought.reasoning || "N/A")
      .replace("{problem}", session.problem);

    const messages: GrokMessage[] = [
      { role: "system", content: "You are a careful reasoning verifier." },
      { role: "user", content: prompt },
    ];

    try {
      const response = await this.client.chat(messages, [], {
        temperature: 0.1, // Low temperature for verification
      });

      const content = response.choices[0]?.message?.content || "";

      const verifiedMatch = content.match(/<verified>(true|false)<\/verified>/i);
      const confidenceMatch = content.match(/<confidence>([\d.]+)<\/confidence>/);
      const issuesMatch = content.match(/<issues>([\s\S]*?)<\/issues>/);
      const correctionsMatch = content.match(/<corrections>([\s\S]*?)<\/corrections>/);

      return {
        thought,
        verified: verifiedMatch?.[1]?.toLowerCase() === "true",
        confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
        issues: issuesMatch?.[1]?.trim() ? [issuesMatch[1].trim()] : undefined,
        corrections: correctionsMatch?.[1]?.trim()
          ? [correctionsMatch[1].trim()]
          : undefined,
      };
    } catch {
      return { thought, verified: true, confidence: 0.5 };
    }
  }

  /**
   * Create a branch to explore an alternative reasoning path
   */
  private async createBranch(
    session: ThinkingSession,
    parentChain: ReasoningChain,
    config: ThinkingConfig
  ): Promise<void> {
    if (session.chains.length >= config.maxChains) return;

    const branchChain = this.createChain();

    // Copy some context from parent
    if (parentChain.thoughts.length > 0) {
      // Keep observations but explore different analysis
      const observations = parentChain.thoughts.filter(
        (t) => t.type === "observation"
      );
      branchChain.thoughts.push(...observations.map((t) => ({ ...t, id: this.createId("thought") })));
    }

    parentChain.branches = parentChain.branches || [];
    parentChain.branches.push(branchChain);
    session.chains.push(branchChain);

    this.emit("thinking:branch", { parent: parentChain, branch: branchChain });
  }

  /**
   * Synthesize final answer from all reasoning chains
   */
  private async synthesize(
    session: ThinkingSession,
    config: ThinkingConfig
  ): Promise<ThinkingResult> {
    // Collect all thoughts across chains
    const allThoughts = session.chains.flatMap((c) => c.thoughts);

    // If self-consistency is enabled, use it
    if (config.selfConsistency && session.chains.length > 1) {
      const consistencyResult = await this.checkSelfConsistency(session, config);
      return this.createResultFromConsistency(session, consistencyResult);
    }

    // Otherwise, synthesize from the main chain
    const thoughtsSummary = allThoughts
      .map((t) => `[${t.type}] ${t.content}`)
      .join("\n");

    const prompt = SYNTHESIS_PROMPT
      .replace("{problem}", session.problem)
      .replace("{thoughts}", thoughtsSummary);

    const messages: GrokMessage[] = [
      { role: "system", content: THINKING_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];

    try {
      const response = await this.client.chat(messages, [], {
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content || "";
      return this.parseSynthesis(session, content, allThoughts);
    } catch {
      // Fallback result
      return this.createFallbackResult(session, allThoughts);
    }
  }

  /**
   * Check self-consistency across multiple reasoning chains
   */
  private async checkSelfConsistency(
    session: ThinkingSession,
    config: ThinkingConfig
  ): Promise<SelfConsistencyResult> {
    const completedChains = session.chains.filter(
      (c) => c.status === "completed" && c.conclusion
    );

    const answers = completedChains.map((c) => ({
      answer: c.conclusion!,
      confidence: c.confidence,
      reasoning: c.thoughts.map((t) => t.content).join(" -> "),
    }));

    // Find consensus (most common answer or highest confidence)
    const answerGroups = new Map<string, typeof answers>();
    for (const a of answers) {
      const key = a.answer.toLowerCase().slice(0, 100);
      const group = answerGroups.get(key) || [];
      group.push(a);
      answerGroups.set(key, group);
    }

    let consensusAnswer = "";
    let consensusConfidence = 0;
    let maxGroupSize = 0;

    for (const [key, group] of answerGroups) {
      if (group.length > maxGroupSize) {
        maxGroupSize = group.length;
        consensusAnswer = group[0].answer;
        consensusConfidence =
          group.reduce((sum, a) => sum + a.confidence, 0) / group.length;
      }
    }

    // Find disagreements
    const disagreements = answers
      .filter((a) => a.answer.toLowerCase().slice(0, 100) !== consensusAnswer.toLowerCase().slice(0, 100))
      .map((a) => a.answer);

    return {
      answers,
      consensusAnswer: consensusAnswer || answers[0]?.answer || "",
      consensusConfidence,
      disagreements,
    };
  }

  /**
   * Parse synthesis response into result
   */
  private parseSynthesis(
    session: ThinkingSession,
    content: string,
    thoughts: Thought[]
  ): ThinkingResult {
    const answerMatch = content.match(/<answer>([\s\S]*?)<\/answer>/);
    const reasoningMatch = content.match(/<reasoning>([\s\S]*?)<\/reasoning>/);
    const confidenceMatch = content.match(/<confidence>([\d.]+)<\/confidence>/);
    const insightsMatch = content.match(/<key_insights>([\s\S]*?)<\/key_insights>/);
    const uncertaintiesMatch = content.match(/<uncertainties>([\s\S]*?)<\/uncertainties>/);

    const keyInsights = insightsMatch
      ? insightsMatch[1].split(/\n-/).filter((s) => s.trim()).map((s) => s.trim())
      : [];

    const uncertainties = uncertaintiesMatch
      ? uncertaintiesMatch[1].split(/\n-/).filter((s) => s.trim()).map((s) => s.trim())
      : [];

    return {
      answer: answerMatch?.[1]?.trim() || content,
      reasoning: reasoningMatch?.[1]?.trim() || "",
      confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
      thinkingTime: (session.endTime || Date.now()) - session.startTime,
      thoughtCount: thoughts.length,
      chainsExplored: session.chains.length,
      keyInsights,
      uncertainties,
    };
  }

  /**
   * Create result from self-consistency check
   */
  private createResultFromConsistency(
    session: ThinkingSession,
    consistency: SelfConsistencyResult
  ): ThinkingResult {
    const allThoughts = session.chains.flatMap((c) => c.thoughts);

    const alternativeAnswers: AlternativeAnswer[] = consistency.answers
      .filter((a) => a.answer !== consistency.consensusAnswer)
      .map((a) => ({
        answer: a.answer,
        confidence: a.confidence,
        reasoning: a.reasoning,
        whyNotChosen: "Not the consensus answer",
      }));

    return {
      answer: consistency.consensusAnswer,
      reasoning: `Consensus from ${session.chains.length} reasoning chains`,
      confidence: consistency.consensusConfidence,
      thinkingTime: (session.endTime || Date.now()) - session.startTime,
      thoughtCount: allThoughts.length,
      chainsExplored: session.chains.length,
      keyInsights: [],
      uncertainties: consistency.disagreements.length > 0
        ? [`${consistency.disagreements.length} chains reached different conclusions`]
        : [],
      alternativeAnswers,
    };
  }

  /**
   * Create fallback result when synthesis fails
   */
  private createFallbackResult(
    session: ThinkingSession,
    thoughts: Thought[]
  ): ThinkingResult {
    const conclusions = thoughts.filter((t) => t.type === "conclusion");
    const bestConclusion = conclusions.sort((a, b) => b.confidence - a.confidence)[0];

    return {
      answer: bestConclusion?.content || "Unable to reach conclusion",
      reasoning: thoughts.map((t) => t.content).join("\n"),
      confidence: bestConclusion?.confidence || 0.3,
      thinkingTime: (session.endTime || Date.now()) - session.startTime,
      thoughtCount: thoughts.length,
      chainsExplored: session.chains.length,
      keyInsights: [],
      uncertainties: ["Synthesis process encountered issues"],
    };
  }

  /**
   * Check if thinking should continue
   */
  private shouldContinueThinking(
    session: ThinkingSession,
    config: ThinkingConfig
  ): boolean {
    // Time limit
    if (Date.now() - session.startTime > config.maxTime) return false;

    // Thought limit
    const totalThoughts = session.chains.reduce(
      (sum, c) => sum + c.thoughts.length,
      0
    );
    if (totalThoughts >= config.maxThoughts) return false;

    // All chains completed
    const allComplete = session.chains.every(
      (c) => c.status === "completed" || c.status === "abandoned"
    );
    if (allComplete) return false;

    return true;
  }

  /**
   * Check if a thought should be verified
   */
  private shouldVerify(thought: Thought): boolean {
    return (
      thought.type === "hypothesis" ||
      thought.type === "conclusion" ||
      thought.confidence > 0.7
    );
  }

  /**
   * Check if should create a branch
   */
  private shouldBranch(session: ThinkingSession, config: ThinkingConfig): boolean {
    if (session.chains.length >= config.maxChains) return false;
    if (Math.random() > config.explorationRate) return false;

    const activeChain = this.getActiveChain(session);
    if (!activeChain) return false;

    // Branch after analysis phase
    return (
      activeChain.thoughts.length >= 3 &&
      activeChain.thoughts.some((t) => t.type === "analysis")
    );
  }

  /**
   * Create a contradiction thought
   */
  private createContradictionThought(
    original: Thought,
    verification: VerificationResult
  ): Thought {
    return {
      id: this.createId("thought"),
      type: "contradiction",
      content: `Issue with previous thought: ${verification.issues?.join(", ") || "Verification failed"}`,
      confidence: verification.confidence,
      reasoning: verification.corrections?.join(", "),
      timestamp: Date.now(),
    };
  }

  /**
   * Helper methods
   */
  private createSession(
    problem: string,
    context: string | undefined,
    config: ThinkingConfig
  ): ThinkingSession {
    return {
      id: this.createId("session"),
      problem,
      context,
      depth: config.depth,
      chains: [],
      activeChainId: null,
      startTime: Date.now(),
      metadata: {},
    };
  }

  private createChain(): ReasoningChain {
    return {
      id: this.createId("chain"),
      thoughts: [],
      status: "in_progress",
      confidence: 0,
    };
  }

  private getActiveChain(session: ThinkingSession): ReasoningChain | null {
    if (!session.activeChainId) return null;
    return session.chains.find((c) => c.id === session.activeChainId) || null;
  }

  private selectNextChain(session: ThinkingSession): string | null {
    const incomplete = session.chains.find((c) => c.status === "in_progress");
    return incomplete?.id || null;
  }

  private createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  private formatThought(thought: Thought): string {
    const icon = this.getThoughtIcon(thought.type);
    return `${icon} [${thought.type}] ${thought.content}`;
  }

  private getThoughtIcon(type: ThoughtType): string {
    const icons: Record<ThoughtType, string> = {
      observation: "👁️",
      analysis: "🔍",
      hypothesis: "💡",
      verification: "✓",
      contradiction: "⚠️",
      synthesis: "🔗",
      conclusion: "✅",
      uncertainty: "❓",
      question: "❔",
      action_plan: "📋",
    };
    return icons[type] || "💭";
  }

  /**
   * Format result for display
   */
  formatResult(result: ThinkingResult): string {
    const lines: string[] = [];

    lines.push("═".repeat(60));
    lines.push("🧠 EXTENDED THINKING RESULT");
    lines.push("═".repeat(60));
    lines.push("");

    lines.push("📝 Answer:");
    lines.push(result.answer);
    lines.push("");

    if (result.reasoning) {
      lines.push("💭 Reasoning:");
      lines.push(result.reasoning);
      lines.push("");
    }

    lines.push(`📊 Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    lines.push(`⏱️  Time: ${(result.thinkingTime / 1000).toFixed(2)}s`);
    lines.push(`💭 Thoughts: ${result.thoughtCount}`);
    lines.push(`🔀 Chains: ${result.chainsExplored}`);

    if (result.keyInsights.length > 0) {
      lines.push("");
      lines.push("💡 Key Insights:");
      for (const insight of result.keyInsights) {
        lines.push(`  • ${insight}`);
      }
    }

    if (result.uncertainties.length > 0) {
      lines.push("");
      lines.push("❓ Uncertainties:");
      for (const uncertainty of result.uncertainties) {
        lines.push(`  • ${uncertainty}`);
      }
    }

    if (result.alternativeAnswers && result.alternativeAnswers.length > 0) {
      lines.push("");
      lines.push("🔄 Alternative Answers Considered:");
      for (const alt of result.alternativeAnswers) {
        lines.push(`  • ${alt.answer.slice(0, 80)}...`);
        lines.push(`    (${(alt.confidence * 100).toFixed(0)}% confidence)`);
      }
    }

    lines.push("");
    lines.push("═".repeat(60));

    return lines.join("\n");
  }

  /**
   * Get/set configuration
   */
  getConfig(): ThinkingConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<ThinkingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  setDepth(depth: ThinkingDepth): void {
    this.config.depth = depth;
  }
}

/**
 * Create an extended thinking engine
 */
export function createExtendedThinkingEngine(
  apiKey: string,
  baseURL?: string,
  config?: Partial<ThinkingConfig>
): ExtendedThinkingEngine {
  return new ExtendedThinkingEngine(apiKey, baseURL, config);
}

// Singleton instance
let thinkingEngineInstance: ExtendedThinkingEngine | null = null;

export function getExtendedThinkingEngine(
  apiKey: string,
  baseURL?: string
): ExtendedThinkingEngine {
  if (!thinkingEngineInstance) {
    thinkingEngineInstance = createExtendedThinkingEngine(apiKey, baseURL);
  }
  return thinkingEngineInstance;
}

export function resetExtendedThinkingEngine(): void {
  thinkingEngineInstance = null;
}
