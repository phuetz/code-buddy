/**
 * Parallel Model Executor
 *
 * Executes prompts across multiple models in parallel and aggregates results.
 * Implements various strategies including ensemble, debate, and routing.
 *
 * Based on research:
 * - Mixture of Experts (Shazeer et al., 2017)
 * - Self-consistency (Wang et al., 2022)
 * - LLM Debates (Du et al., 2023)
 */

import { EventEmitter } from "events";
import { GrokClient, GrokMessage } from "../../grok/client.js";
import { getErrorMessage } from "../../types/index.js";
import {
  ModelConfig,
  ParallelConfig,
  ParallelExecutionResult,
  ModelResponse,
  ExecutionStrategy,
  AggregationMethod,
  ConsensusResult,
  DebateResult,
  DebateRound,
  RoutingTask,
  RoutingDecision,
  RoutingRule,
  CacheEntry,
  DEFAULT_PARALLEL_CONFIG,
  TaskType,
  ModelCapability,
} from "./types.js";

/**
 * Parallel Model Executor
 */
export class ParallelExecutor extends EventEmitter {
  private config: ParallelConfig;
  private clients: Map<string, GrokClient> = new Map();
  private cache: Map<string, CacheEntry> = new Map();
  private routingRules: RoutingRule[] = [];
  private modelStats: Map<string, { successes: number; failures: number; avgLatency: number }> = new Map();

  constructor(config: Partial<ParallelConfig> = {}) {
    super();
    this.config = { ...DEFAULT_PARALLEL_CONFIG, ...config };
    this.initializeClients();
  }

  /**
   * Initialize clients for each model
   */
  private initializeClients(): void {
    for (const model of this.config.models) {
      if (!model.enabled) continue;

      // For now, we primarily support Grok but structure allows expansion
      const client = new GrokClient(
        model.apiKey || process.env.XAI_API_KEY || "",
        model.model,
        model.baseURL
      );
      this.clients.set(model.id, client);
    }
  }

  /**
   * Execute a prompt across models based on strategy
   */
  async execute(
    prompt: string,
    systemPrompt?: string,
    strategy?: ExecutionStrategy
  ): Promise<ParallelExecutionResult> {
    const effectiveStrategy = strategy || this.config.strategy;
    const enabledModels = this.config.models.filter((m) => m.enabled);

    this.emit("parallel:start", {
      task: prompt.slice(0, 100),
      strategy: effectiveStrategy,
      models: enabledModels.map((m) => m.id),
    });

    const startTime = Date.now();

    try {
      let result: ParallelExecutionResult;

      switch (effectiveStrategy) {
        case "fastest":
          result = await this.executeFastest(prompt, systemPrompt, enabledModels);
          break;
        case "cascade":
          result = await this.executeCascade(prompt, systemPrompt, enabledModels);
          break;
        case "route":
          result = await this.executeRouted(prompt, systemPrompt, enabledModels);
          break;
        case "consensus":
          result = await this.executeConsensus(prompt, systemPrompt, enabledModels);
          break;
        case "debate":
          result = await this.executeDebate(prompt, systemPrompt, enabledModels);
          break;
        case "ensemble":
          result = await this.executeEnsemble(prompt, systemPrompt, enabledModels);
          break;
        case "best":
        case "all":
        default:
          result = await this.executeAll(prompt, systemPrompt, enabledModels, effectiveStrategy === "best");
          break;
      }

      result.totalLatency = Date.now() - startTime;
      this.emit("parallel:complete", { result });

      return result;
    } catch (error) {
      return {
        strategy: effectiveStrategy,
        responses: [],
        confidence: 0,
        totalLatency: Date.now() - startTime,
        effectiveLatency: Date.now() - startTime,
        totalTokens: 0,
        metadata: { error: getErrorMessage(error) },
      };
    }
  }

  /**
   * Execute all models in parallel
   */
  private async executeAll(
    prompt: string,
    systemPrompt: string | undefined,
    models: ModelConfig[],
    selectBest: boolean
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();

    // Execute all models in parallel
    const responsePromises = models.map((model) =>
      this.executeModel(model, prompt, systemPrompt)
    );

    const responses = await Promise.all(responsePromises);
    const validResponses = responses.filter((r) => !r.error);

    // Aggregate results
    const aggregatedResponse = selectBest
      ? this.selectBestResponse(validResponses)
      : this.aggregateResponses(validResponses, this.config.aggregation);

    return {
      strategy: selectBest ? "best" : "all",
      aggregationMethod: this.config.aggregation,
      responses,
      aggregatedResponse: aggregatedResponse?.content,
      confidence: aggregatedResponse?.confidence || 0,
      totalLatency: Date.now() - startTime,
      effectiveLatency: Math.max(...responses.map((r) => r.latency)),
      totalTokens: responses.reduce((sum, r) => sum + r.tokensUsed, 0),
      selectedModel: selectBest ? aggregatedResponse?.modelId : undefined,
      metadata: {},
    };
  }

  /**
   * Execute and return fastest response
   */
  private async executeFastest(
    prompt: string,
    systemPrompt: string | undefined,
    models: ModelConfig[]
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();

    // Race all models
    const responsePromises = models.map((model) =>
      this.executeModel(model, prompt, systemPrompt)
    );

    const firstResponse = await Promise.race(responsePromises);
    const allResponses = await Promise.all(responsePromises);

    return {
      strategy: "fastest",
      responses: allResponses,
      aggregatedResponse: firstResponse.content,
      confidence: firstResponse.confidence,
      totalLatency: Date.now() - startTime,
      effectiveLatency: firstResponse.latency,
      totalTokens: allResponses.reduce((sum, r) => sum + r.tokensUsed, 0),
      selectedModel: firstResponse.modelId,
      metadata: { winner: firstResponse.modelId },
    };
  }

  /**
   * Execute models in cascade (try each until success)
   */
  private async executeCascade(
    prompt: string,
    systemPrompt: string | undefined,
    models: ModelConfig[]
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();
    const responses: ModelResponse[] = [];

    // Sort models by priority/cost
    const sortedModels = [...models].sort(
      (a, b) => (a.costPerToken || 0) - (b.costPerToken || 0)
    );

    for (const model of sortedModels) {
      const response = await this.executeModel(model, prompt, systemPrompt);
      responses.push(response);

      if (!response.error && response.confidence >= 0.5) {
        return {
          strategy: "cascade",
          responses,
          aggregatedResponse: response.content,
          confidence: response.confidence,
          totalLatency: Date.now() - startTime,
          effectiveLatency: responses.reduce((sum, r) => sum + r.latency, 0),
          totalTokens: responses.reduce((sum, r) => sum + r.tokensUsed, 0),
          selectedModel: response.modelId,
          metadata: { cascadeLevel: responses.length },
        };
      }
    }

    // No successful response
    const bestResponse = this.selectBestResponse(responses);
    return {
      strategy: "cascade",
      responses,
      aggregatedResponse: bestResponse?.content,
      confidence: bestResponse?.confidence || 0,
      totalLatency: Date.now() - startTime,
      effectiveLatency: responses.reduce((sum, r) => sum + r.latency, 0),
      totalTokens: responses.reduce((sum, r) => sum + r.tokensUsed, 0),
      selectedModel: bestResponse?.modelId,
      metadata: { cascadeFailed: true },
    };
  }

  /**
   * Route to best model for the task
   */
  private async executeRouted(
    prompt: string,
    systemPrompt: string | undefined,
    models: ModelConfig[]
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();

    // Analyze task and route
    const task = this.analyzeTask(prompt);
    const decision = this.routeTask(task, models);

    this.emit("parallel:route", { decision });

    // Execute selected model
    const selectedModel = models.find((m) => m.id === decision.selectedModel);
    if (!selectedModel) {
      throw new Error(`Routed model ${decision.selectedModel} not found`);
    }

    const response = await this.executeModel(selectedModel, prompt, systemPrompt);

    return {
      strategy: "route",
      responses: [response],
      aggregatedResponse: response.content,
      confidence: response.confidence,
      totalLatency: Date.now() - startTime,
      effectiveLatency: response.latency,
      totalTokens: response.tokensUsed,
      selectedModel: response.modelId,
      metadata: { routingDecision: decision },
    };
  }

  /**
   * Execute with consensus requirement
   */
  private async executeConsensus(
    prompt: string,
    systemPrompt: string | undefined,
    models: ModelConfig[]
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();

    // Execute all models
    const responsePromises = models.map((model) =>
      this.executeModel(model, prompt, systemPrompt)
    );

    const responses = await Promise.all(responsePromises);
    const validResponses = responses.filter((r) => !r.error);

    // Check consensus
    const consensus = this.checkConsensus(validResponses);

    this.emit("parallel:consensus", { result: consensus });

    return {
      strategy: "consensus",
      responses,
      aggregatedResponse: consensus.consensusAnswer,
      confidence: consensus.agreementLevel,
      totalLatency: Date.now() - startTime,
      effectiveLatency: Math.max(...responses.map((r) => r.latency)),
      totalTokens: responses.reduce((sum, r) => sum + r.tokensUsed, 0),
      consensus,
      metadata: { consensusReached: consensus.reached },
    };
  }

  /**
   * Execute debate between models
   */
  private async executeDebate(
    prompt: string,
    systemPrompt: string | undefined,
    models: ModelConfig[]
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();
    const rounds: DebateRound[] = [];
    let totalTokens = 0;

    // Initial positions
    const initialResponses = await Promise.all(
      models.map((m) => this.executeModel(m, prompt, systemPrompt))
    );
    totalTokens += initialResponses.reduce((sum, r) => sum + r.tokensUsed, 0);

    let currentPositions = initialResponses.map((r) => ({
      modelId: r.modelId,
      argument: r.content,
      confidence: r.confidence,
    }));

    // Debate rounds
    for (let round = 1; round <= this.config.debateRounds; round++) {
      const roundPositions = await this.runDebateRound(
        round,
        currentPositions,
        prompt,
        models
      );

      const roundResult: DebateRound = {
        roundNumber: round,
        positions: roundPositions,
        summary: `Round ${round}: ${roundPositions.length} positions refined`,
      };

      rounds.push(roundResult);
      this.emit("parallel:debate:round", { round: roundResult });

      currentPositions = roundPositions;
      totalTokens += roundPositions.length * 500; // Estimate
    }

    // Determine winner
    const winner = currentPositions.reduce((best, pos) =>
      pos.confidence > best.confidence ? pos : best
    );

    const debate: DebateResult = {
      rounds,
      winner: winner.modelId,
      winningArgument: winner.argument,
      finalPosition: winner.argument,
      confidence: winner.confidence,
    };

    return {
      strategy: "debate",
      responses: initialResponses,
      aggregatedResponse: winner.argument,
      confidence: winner.confidence,
      totalLatency: Date.now() - startTime,
      effectiveLatency: Date.now() - startTime, // Sequential
      totalTokens,
      selectedModel: winner.modelId,
      debate,
      metadata: {},
    };
  }

  /**
   * Execute ensemble aggregation
   */
  private async executeEnsemble(
    prompt: string,
    systemPrompt: string | undefined,
    models: ModelConfig[]
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();

    // Execute all models
    const responses = await Promise.all(
      models.map((m) => this.executeModel(m, prompt, systemPrompt))
    );
    const validResponses = responses.filter((r) => !r.error);

    // Synthesize responses using an LLM
    const synthesized = await this.synthesizeResponses(validResponses, prompt);

    return {
      strategy: "ensemble",
      aggregationMethod: "synthesize",
      responses,
      aggregatedResponse: synthesized.content,
      confidence: synthesized.confidence,
      totalLatency: Date.now() - startTime,
      effectiveLatency: Math.max(...responses.map((r) => r.latency)),
      totalTokens: responses.reduce((sum, r) => sum + r.tokensUsed, 0),
      metadata: { synthesized: true },
    };
  }

  /**
   * Execute a single model
   */
  private async executeModel(
    model: ModelConfig,
    prompt: string,
    systemPrompt?: string
  ): Promise<ModelResponse> {
    this.emit("parallel:model:start", { modelId: model.id });
    const startTime = Date.now();

    // Check cache
    const cacheKey = `${model.id}:${prompt}`;
    if (this.config.cacheResponses && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      cached.hits++;
      return cached.response;
    }

    const client = this.clients.get(model.id);
    if (!client) {
      const errorResponse: ModelResponse = {
        modelId: model.id,
        modelName: model.name,
        content: "",
        confidence: 0,
        latency: 0,
        tokensUsed: 0,
        metadata: {},
        error: "Model client not initialized",
      };
      this.emit("parallel:model:error", { modelId: model.id, error: errorResponse.error! });
      return errorResponse;
    }

    try {
      const messages: GrokMessage[] = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: prompt });

      const response = await Promise.race([
        client.chat(messages, [], { temperature: model.temperature }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), this.config.timeout)
        ),
      ]);

      const content = response.choices[0]?.message?.content || "";
      const tokensUsed = response.usage?.total_tokens || 0;
      const latency = Date.now() - startTime;

      // Estimate confidence based on response characteristics
      const confidence = this.estimateConfidence(content);

      const modelResponse: ModelResponse = {
        modelId: model.id,
        modelName: model.name,
        content,
        confidence,
        latency,
        tokensUsed,
        cost: tokensUsed * (model.costPerToken || 0),
        metadata: { model: model.model },
      };

      // Update stats
      this.updateModelStats(model.id, true, latency);

      // Cache response
      if (this.config.cacheResponses) {
        this.cache.set(cacheKey, {
          prompt,
          modelId: model.id,
          response: modelResponse,
          timestamp: Date.now(),
          hits: 0,
        });
      }

      this.emit("parallel:model:complete", { response: modelResponse });
      return modelResponse;
    } catch (error) {
      this.updateModelStats(model.id, false, Date.now() - startTime);

      const errorMessage = getErrorMessage(error);
      const errorResponse: ModelResponse = {
        modelId: model.id,
        modelName: model.name,
        content: "",
        confidence: 0,
        latency: Date.now() - startTime,
        tokensUsed: 0,
        metadata: {},
        error: errorMessage,
      };

      this.emit("parallel:model:error", { modelId: model.id, error: errorMessage });
      return errorResponse;
    }
  }

  /**
   * Run a debate round
   */
  private async runDebateRound(
    round: number,
    currentPositions: Array<{ modelId: string; argument: string; confidence: number }>,
    originalPrompt: string,
    models: ModelConfig[]
  ): Promise<Array<{ modelId: string; argument: string; critique?: string; confidence: number }>> {
    const newPositions: Array<{ modelId: string; argument: string; critique?: string; confidence: number }> = [];

    for (const position of currentPositions) {
      const model = models.find((m) => m.id === position.modelId);
      if (!model) continue;

      const otherPositions = currentPositions
        .filter((p) => p.modelId !== position.modelId)
        .map((p) => `${p.modelId}: ${p.argument}`)
        .join("\n\n");

      const debatePrompt = `Round ${round} of debate.

Original question: ${originalPrompt}

Your current position: ${position.argument}

Other positions:
${otherPositions}

Critique the other positions and refine your own argument. You may change your position if convinced.

Respond with:
<critique>Your critique of other positions</critique>
<refined_argument>Your refined argument</refined_argument>
<confidence>0.0-1.0</confidence>`;

      const response = await this.executeModel(model, debatePrompt);

      // Parse response
      const critiqueMatch = response.content.match(/<critique>([\s\S]*?)<\/critique>/);
      const argumentMatch = response.content.match(/<refined_argument>([\s\S]*?)<\/refined_argument>/);
      const confMatch = response.content.match(/<confidence>([\d.]+)<\/confidence>/);

      newPositions.push({
        modelId: position.modelId,
        argument: argumentMatch?.[1]?.trim() || response.content,
        critique: critiqueMatch?.[1]?.trim(),
        confidence: confMatch ? parseFloat(confMatch[1]) : position.confidence,
      });
    }

    return newPositions;
  }

  /**
   * Synthesize multiple responses into one
   */
  private async synthesizeResponses(
    responses: ModelResponse[],
    originalPrompt: string
  ): Promise<{ content: string; confidence: number }> {
    if (responses.length === 0) {
      return { content: "", confidence: 0 };
    }

    if (responses.length === 1) {
      return { content: responses[0].content, confidence: responses[0].confidence };
    }

    // Use first available client to synthesize
    const synthesizer = this.clients.values().next().value;
    if (!synthesizer) {
      return this.selectBestResponse(responses) || { content: "", confidence: 0 };
    }

    const responseSummary = responses
      .map((r, i) => `Response ${i + 1} (${r.modelName}, confidence: ${r.confidence}):\n${r.content}`)
      .join("\n\n---\n\n");

    const synthesisPrompt = `Given the following responses to the question: "${originalPrompt}"

${responseSummary}

Synthesize these responses into a single, comprehensive answer that:
1. Combines the best insights from each response
2. Resolves any contradictions
3. Provides a coherent, well-structured answer

<synthesized_answer>Your synthesized answer</synthesized_answer>
<confidence>0.0-1.0</confidence>`;

    const messages: GrokMessage[] = [
      { role: "system", content: "You are an expert at synthesizing multiple perspectives into a coherent answer." },
      { role: "user", content: synthesisPrompt },
    ];

    try {
      const response = await synthesizer.chat(messages, []);
      const content = response.choices[0]?.message?.content || "";

      const answerMatch = content.match(/<synthesized_answer>([\s\S]*?)<\/synthesized_answer>/);
      const confMatch = content.match(/<confidence>([\d.]+)<\/confidence>/);

      return {
        content: answerMatch?.[1]?.trim() || content,
        confidence: confMatch ? parseFloat(confMatch[1]) : 0.7,
      };
    } catch {
      return this.selectBestResponse(responses) || { content: "", confidence: 0 };
    }
  }

  /**
   * Check consensus among responses
   */
  private checkConsensus(responses: ModelResponse[]): ConsensusResult {
    if (responses.length === 0) {
      return {
        reached: false,
        agreementLevel: 0,
        agreeingModels: [],
        disagreements: [],
      };
    }

    // Simple similarity-based consensus
    // In production, use semantic similarity
    const similarities: Array<{ pair: [string, string]; similarity: number }> = [];

    for (let i = 0; i < responses.length; i++) {
      for (let j = i + 1; j < responses.length; j++) {
        const sim = this.calculateSimilarity(responses[i].content, responses[j].content);
        similarities.push({
          pair: [responses[i].modelId, responses[j].modelId],
          similarity: sim,
        });
      }
    }

    const avgSimilarity = similarities.reduce((sum, s) => sum + s.similarity, 0) / similarities.length || 0;

    const agreeingModels = avgSimilarity >= this.config.consensusThreshold
      ? responses.map((r) => r.modelId)
      : [];

    const disagreements = avgSimilarity < this.config.consensusThreshold
      ? responses.map((r) => ({ modelId: r.modelId, position: r.content.slice(0, 100) }))
      : [];

    // Use highest confidence as consensus answer
    const bestResponse = responses.reduce((best, r) =>
      r.confidence > best.confidence ? r : best
    );

    return {
      reached: avgSimilarity >= this.config.consensusThreshold,
      agreementLevel: avgSimilarity,
      agreeingModels,
      disagreements,
      consensusAnswer: agreeingModels.length > 0 ? bestResponse.content : undefined,
    };
  }

  /**
   * Select best response based on confidence and quality
   */
  private selectBestResponse(responses: ModelResponse[]): ModelResponse | null {
    if (responses.length === 0) return null;

    return responses.reduce((best, r) => {
      // Score based on confidence and model weight
      const model = this.config.models.find((m) => m.id === r.modelId);
      const weight = model?.weight || 1;
      const score = r.confidence * weight;

      const bestModel = this.config.models.find((m) => m.id === best.modelId);
      const bestWeight = bestModel?.weight || 1;
      const bestScore = best.confidence * bestWeight;

      return score > bestScore ? r : best;
    });
  }

  /**
   * Aggregate responses using specified method
   */
  private aggregateResponses(
    responses: ModelResponse[],
    method: AggregationMethod
  ): ModelResponse | null {
    if (responses.length === 0) return null;

    switch (method) {
      case "best_confidence":
        return this.selectBestResponse(responses);

      case "weighted_vote":
        // Weight by model quality and return highest weighted
        return this.selectBestResponse(responses);

      case "concatenate":
        return {
          modelId: "aggregated",
          modelName: "Aggregated",
          content: responses.map((r) => `[${r.modelName}]: ${r.content}`).join("\n\n"),
          confidence: responses.reduce((sum, r) => sum + r.confidence, 0) / responses.length,
          latency: Math.max(...responses.map((r) => r.latency)),
          tokensUsed: responses.reduce((sum, r) => sum + r.tokensUsed, 0),
          metadata: { aggregated: true },
        };

      default:
        return this.selectBestResponse(responses);
    }
  }

  /**
   * Analyze task for routing
   */
  private analyzeTask(prompt: string): RoutingTask {
    const lowerPrompt = prompt.toLowerCase();

    let type: TaskType = "general";
    let complexity: "simple" | "moderate" | "complex" = "moderate";
    const requiredCapabilities: ModelCapability[] = [];

    // Detect task type
    if (lowerPrompt.includes("write") && (lowerPrompt.includes("code") || lowerPrompt.includes("function"))) {
      type = "code_generation";
      requiredCapabilities.push("code_generation");
    } else if (lowerPrompt.includes("review") || lowerPrompt.includes("check")) {
      type = "code_review";
      requiredCapabilities.push("code_review");
    } else if (lowerPrompt.includes("debug") || lowerPrompt.includes("fix") || lowerPrompt.includes("error")) {
      type = "debugging";
      requiredCapabilities.push("code_generation", "reasoning");
    } else if (lowerPrompt.includes("explain")) {
      type = "explanation";
      requiredCapabilities.push("reasoning");
    } else if (lowerPrompt.match(/\d+\s*[+\-*/]\s*\d+/) || lowerPrompt.includes("calculate")) {
      type = "math";
      requiredCapabilities.push("math");
    }

    // Estimate complexity
    if (prompt.length < 100) complexity = "simple";
    else if (prompt.length > 500) complexity = "complex";

    return {
      prompt,
      type,
      complexity,
      requiredCapabilities,
    };
  }

  /**
   * Route task to best model
   */
  private routeTask(task: RoutingTask, models: ModelConfig[]): RoutingDecision {
    const scores: Array<{ model: ModelConfig; score: number; reason: string }> = [];

    for (const model of models) {
      let score = model.weight || 0.5;
      let reason = "Default weight";

      // Check capability match
      if (task.requiredCapabilities && model.capabilities) {
        const matchCount = task.requiredCapabilities.filter((c) =>
          model.capabilities!.includes(c)
        ).length;
        const matchRatio = matchCount / task.requiredCapabilities.length;
        score *= 1 + matchRatio;
        if (matchRatio > 0.5) reason = "Good capability match";
      }

      // Consider latency preference
      if (this.config.preferLowLatency && model.latencyMs) {
        score *= 1 / Math.log(model.latencyMs + 10);
      }

      // Consider cost
      if (task.maxCost && model.costPerToken) {
        if (model.costPerToken <= task.maxCost / 1000) {
          score *= 1.2;
        }
      }

      // Use historical performance
      const stats = this.modelStats.get(model.id);
      if (stats && stats.successes + stats.failures > 10) {
        const successRate = stats.successes / (stats.successes + stats.failures);
        score *= successRate;
      }

      scores.push({ model, score, reason });
    }

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    const selected = scores[0];
    return {
      selectedModel: selected.model.id,
      reason: selected.reason,
      confidence: selected.score / (scores[1]?.score || selected.score),
      alternatives: scores.slice(1, 4).map((s) => ({
        modelId: s.model.id,
        score: s.score,
        reason: s.reason,
      })),
    };
  }

  /**
   * Calculate simple text similarity
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Estimate confidence from response
   */
  private estimateConfidence(content: string): number {
    let confidence = 0.5;

    // Longer responses generally indicate more thorough answers
    if (content.length > 500) confidence += 0.1;
    if (content.length > 1000) confidence += 0.1;

    // Check for uncertainty markers
    const uncertaintyWords = ["maybe", "perhaps", "possibly", "might", "could be", "not sure"];
    for (const word of uncertaintyWords) {
      if (content.toLowerCase().includes(word)) {
        confidence -= 0.05;
      }
    }

    // Check for confidence markers
    const confidenceWords = ["certainly", "definitely", "clearly", "obviously", "sure"];
    for (const word of confidenceWords) {
      if (content.toLowerCase().includes(word)) {
        confidence += 0.05;
      }
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Update model statistics
   */
  private updateModelStats(modelId: string, success: boolean, latency: number): void {
    const stats = this.modelStats.get(modelId) || { successes: 0, failures: 0, avgLatency: 0 };

    if (success) {
      stats.successes++;
    } else {
      stats.failures++;
    }

    const totalCalls = stats.successes + stats.failures;
    stats.avgLatency = ((totalCalls - 1) * stats.avgLatency + latency) / totalCalls;

    this.modelStats.set(modelId, stats);
  }

  /**
   * Add a model
   */
  addModel(model: ModelConfig): void {
    const existing = this.config.models.findIndex((m) => m.id === model.id);
    if (existing >= 0) {
      this.config.models[existing] = model;
    } else {
      this.config.models.push(model);
    }

    if (model.enabled) {
      const client = new GrokClient(
        model.apiKey || process.env.XAI_API_KEY || "",
        model.model,
        model.baseURL
      );
      this.clients.set(model.id, client);
    }
  }

  /**
   * Remove a model
   */
  removeModel(modelId: string): void {
    this.config.models = this.config.models.filter((m) => m.id !== modelId);
    this.clients.delete(modelId);
  }

  /**
   * Add a routing rule
   */
  addRoutingRule(rule: RoutingRule): void {
    this.routingRules.push(rule);
    this.routingRules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get statistics
   */
  getStatistics(): Map<string, { successes: number; failures: number; avgLatency: number }> {
    return new Map(this.modelStats);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get/set config
   */
  getConfig(): ParallelConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<ParallelConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.models) {
      this.initializeClients();
    }
  }

  /**
   * Format result for display
   */
  formatResult(result: ParallelExecutionResult): string {
    const lines: string[] = [];

    lines.push("═".repeat(60));
    lines.push("⚡ PARALLEL EXECUTION RESULT");
    lines.push("═".repeat(60));
    lines.push("");

    lines.push(`Strategy: ${result.strategy}`);
    if (result.aggregationMethod) {
      lines.push(`Aggregation: ${result.aggregationMethod}`);
    }
    lines.push(`Models executed: ${result.responses.length}`);
    lines.push(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    lines.push(`Effective latency: ${result.effectiveLatency}ms`);
    lines.push(`Total tokens: ${result.totalTokens}`);

    if (result.selectedModel) {
      lines.push(`Selected model: ${result.selectedModel}`);
    }

    if (result.consensus) {
      lines.push("");
      lines.push("─".repeat(40));
      lines.push("Consensus:");
      lines.push(`  Reached: ${result.consensus.reached}`);
      lines.push(`  Agreement: ${(result.consensus.agreementLevel * 100).toFixed(0)}%`);
    }

    if (result.debate) {
      lines.push("");
      lines.push("─".repeat(40));
      lines.push("Debate:");
      lines.push(`  Rounds: ${result.debate.rounds.length}`);
      lines.push(`  Winner: ${result.debate.winner}`);
    }

    lines.push("");
    lines.push("─".repeat(40));
    lines.push("Response:");
    lines.push(result.aggregatedResponse || "(No response)");

    lines.push("");
    lines.push("═".repeat(60));

    return lines.join("\n");
  }
}

/**
 * Create a parallel executor
 */
export function createParallelExecutor(config?: Partial<ParallelConfig>): ParallelExecutor {
  return new ParallelExecutor(config);
}

// Singleton instance
let parallelExecutorInstance: ParallelExecutor | null = null;

export function getParallelExecutor(): ParallelExecutor {
  if (!parallelExecutorInstance) {
    parallelExecutorInstance = createParallelExecutor();
  }
  return parallelExecutorInstance;
}

export function resetParallelExecutor(): void {
  parallelExecutorInstance = null;
}
