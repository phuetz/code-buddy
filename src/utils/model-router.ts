import * as path from "path";
import { EventEmitter } from "events";
import { readJsonAtomicSync, writeJsonAtomicSync } from './atomic-write.js';
import { getModelPricing } from '../config/model-pricing.js';
import { ROUTER_MODEL_DATA, ROUTER_DEFAULT_DATA } from '../config/model-price-data.js';

export type TaskType =
  | "search"      // Fast searches
  | "planning"    // Architecture and design
  | "coding"      // Code generation/editing
  | "review"      // Code review
  | "debug"       // Debugging
  | "docs"        // Documentation
  | "chat"        // General conversation
  | "complex";    // Complex reasoning

export interface ModelConfig {
  id: string;
  name: string;
  costPer1kInput: number;    // Cost per 1k input tokens
  costPer1kOutput: number;   // Cost per 1k output tokens
  contextWindow: number;     // Max context window
  speed: "fast" | "medium" | "slow";
  capabilities: TaskType[];  // What this model is good at
}

export interface ModelRouterConfig {
  defaultModel: string;
  taskModels: Record<TaskType, string>;
  costThreshold?: number;     // Switch to cheaper model after $X spent
  autoSwitch: boolean;        // Auto-switch based on task
  preferSpeed: boolean;       // Prefer faster models
  fallbackChain?: string[];   // Fallback models when primary fails
  enableFallback: boolean;    // Enable automatic fallback on errors
}

export interface ModelHealth {
  modelId: string;
  available: boolean;
  lastSuccess: Date | null;
  lastFailure: Date | null;
  consecutiveFailures: number;
  cooldownUntil: Date | null;
}

// The router owns selection logic; model identities and attributes are data.
const GROK_MODELS: Record<string, ModelConfig> = Object.fromEntries(
  Object.entries(ROUTER_MODEL_DATA).map(([id, data]) => {
    return [id, { ...data, id,
      get costPer1kInput() { return getModelPricing(id).inputPerMillion / 1000; },
      get costPer1kOutput() { return getModelPricing(id).outputPerMillion / 1000; },
    }];
  }),
);

const DEFAULT_ROUTER_CONFIG: ModelRouterConfig = ROUTER_DEFAULT_DATA;

/** Cooldown period after consecutive failures (in ms) */
const FAILURE_COOLDOWN_MS = 60000; // 1 minute
/** Max consecutive failures before cooldown */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Model Router - Dynamic model selection based on task type
 */
export class ModelRouter extends EventEmitter {
  private config: ModelRouterConfig;
  private configPath: string;
  private currentModel: string;
  private sessionCost: number = 0;
  private switchHistory: Array<{ from: string; to: string; reason: string; timestamp: Date }> = [];
  private modelHealth: Map<string, ModelHealth> = new Map();

  constructor(projectRoot: string = process.cwd()) {
    super();
    this.configPath = path.join(projectRoot, ".codebuddy", "model-router.json");
    this.config = this.loadConfig();
    this.currentModel = this.config.defaultModel;
    this.initializeModelHealth();
  }

  /**
   * Initialize health tracking for all known models
   */
  private initializeModelHealth(): void {
    for (const modelId of Object.keys(GROK_MODELS)) {
      this.modelHealth.set(modelId, {
        modelId,
        available: true,
        lastSuccess: null,
        lastFailure: null,
        consecutiveFailures: 0,
        cooldownUntil: null,
      });
    }
  }

  private loadConfig(): ModelRouterConfig {
    try {
      const saved = readJsonAtomicSync<Partial<ModelRouterConfig>>(this.configPath, {});
      return { ...DEFAULT_ROUTER_CONFIG, ...saved };
    } catch (_error) {
      // Use defaults
    }
    return { ...DEFAULT_ROUTER_CONFIG };
  }

  private saveConfig(): void {
    try {
      writeJsonAtomicSync(this.configPath, this.config);
    } catch (_error) {
      // Ignore save errors
    }
  }

  /**
   * Get the current model
   */
  getCurrentModel(): string {
    return this.currentModel;
  }

  /**
   * Set the current model manually
   */
  setCurrentModel(modelId: string): boolean {
    if (!GROK_MODELS[modelId]) {
      return false;
    }

    const previousModel = this.currentModel;
    this.currentModel = modelId;

    this.switchHistory.push({
      from: previousModel,
      to: modelId,
      reason: "Manual switch",
      timestamp: new Date(),
    });

    this.emit("model:switched", { from: previousModel, to: modelId, reason: "manual" });
    return true;
  }

  /**
   * Select the best model for a task type
   */
  selectModelForTask(taskType: TaskType): string {
    if (!this.config.autoSwitch) {
      return this.currentModel;
    }

    // Check cost threshold
    if (this.config.costThreshold && this.sessionCost >= this.config.costThreshold) {
      return this.getCheapestModel();
    }

    // Get configured model for task
    const configuredModel = this.config.taskModels[taskType];

    if (configuredModel && GROK_MODELS[configuredModel]) {
      if (configuredModel !== this.currentModel) {
        this.switchModel(configuredModel, `Task type: ${taskType}`);
      }
      return configuredModel;
    }

    // Fallback: find best model for task
    const bestModel = this.findBestModelForTask(taskType);
    if (bestModel !== this.currentModel) {
      this.switchModel(bestModel, `Auto-selected for ${taskType}`);
    }

    return bestModel;
  }

  /**
   * Detect task type from input
   */
  detectTaskType(input: string): TaskType {
    const inputLower = input.toLowerCase();

    // Search indicators
    if (inputLower.match(/\b(find|search|where|locate|grep|look for)\b/)) {
      return "search";
    }

    // Planning indicators
    if (inputLower.match(/\b(plan|design|architect|structure|organize|strategy)\b/)) {
      return "planning";
    }

    // Review indicators
    if (inputLower.match(/\b(review|check|audit|analyze|examine|inspect)\b/)) {
      return "review";
    }

    // Debug indicators
    if (inputLower.match(/\b(debug|fix|error|bug|issue|broken|crash|fail)\b/)) {
      return "debug";
    }

    // Docs indicators
    if (inputLower.match(/\b(document|readme|comment|explain|describe)\b/)) {
      return "docs";
    }

    // Complex reasoning indicators
    if (inputLower.match(/\b(complex|difficult|challenging|think|consider|evaluate)\b/)) {
      return "complex";
    }

    // Coding is default for most requests
    if (inputLower.match(/\b(implement|create|add|build|write|code|function|class|component)\b/)) {
      return "coding";
    }

    return "chat";
  }

  /**
   * Auto-select model based on input
   */
  autoSelectModel(input: string): string {
    const taskType = this.detectTaskType(input);
    return this.selectModelForTask(taskType);
  }

  private findBestModelForTask(taskType: TaskType): string {
    const candidates = Object.entries(GROK_MODELS)
      .filter(([_, config]) => config.capabilities.includes(taskType));

    if (candidates.length === 0) {
      return this.config.defaultModel;
    }

    // Sort by preference
    candidates.sort((a, b) => {
      if (this.config.preferSpeed) {
        const speedOrder = { fast: 0, medium: 1, slow: 2 };
        return speedOrder[a[1].speed] - speedOrder[b[1].speed];
      } else {
        // Prefer by capability (more specific models first)
        return a[1].capabilities.length - b[1].capabilities.length;
      }
    });

    const best = candidates[0];
    if (best === undefined) {
      return this.config.defaultModel;
    }
    return best[0];
  }

  private getCheapestModel(): string {
    const sorted = Object.entries(GROK_MODELS)
      .sort((a, b) => {
        const priceA = getModelPricing(a[0]);
        const priceB = getModelPricing(b[0]);
        const costA = priceA.inputPerMillion + priceA.outputPerMillion;
        const costB = priceB.inputPerMillion + priceB.outputPerMillion;
        return costA - costB;
      });

    const cheapest = sorted[0];
    if (cheapest === undefined) {
      return this.config.defaultModel;
    }
    return cheapest[0];
  }

  private switchModel(newModel: string, reason: string): void {
    const previousModel = this.currentModel;
    this.currentModel = newModel;

    this.switchHistory.push({
      from: previousModel,
      to: newModel,
      reason,
      timestamp: new Date(),
    });

    this.emit("model:switched", { from: previousModel, to: newModel, reason });
  }

  /**
   * Record token usage and update cost
   */
  recordUsage(inputTokens: number, outputTokens: number): number {
    const modelConfig = GROK_MODELS[this.currentModel];
    if (!modelConfig) return 0;

    const price = getModelPricing(this.currentModel);
    const cost =
      (inputTokens / 1_000_000) * price.inputPerMillion +
      (outputTokens / 1_000_000) * price.outputPerMillion;

    this.sessionCost += cost;
    this.emit("usage:recorded", { inputTokens, outputTokens, cost, totalCost: this.sessionCost });

    return cost;
  }

  /**
   * Record successful API call for a model
   */
  recordSuccess(modelId?: string): void {
    const id = modelId || this.currentModel;
    const health = this.modelHealth.get(id);
    if (health) {
      health.available = true;
      health.lastSuccess = new Date();
      health.consecutiveFailures = 0;
      health.cooldownUntil = null;
      this.modelHealth.set(id, health);
    }
  }

  /**
   * Record failed API call for a model
   */
  recordFailure(modelId?: string, error?: unknown): void {
    const id = modelId || this.currentModel;
    const health = this.modelHealth.get(id);
    if (health) {
      health.lastFailure = new Date();
      health.consecutiveFailures++;

      // Put model in cooldown if too many failures
      if (health.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        health.available = false;
        health.cooldownUntil = new Date(Date.now() + FAILURE_COOLDOWN_MS);
        this.emit("model:cooldown", { modelId: id, until: health.cooldownUntil, error });
      }

      this.modelHealth.set(id, health);
    }
  }

  /**
   * Check if a model is available (not in cooldown)
   */
  isModelAvailable(modelId: string): boolean {
    const health = this.modelHealth.get(modelId);
    if (!health) return false;

    // Check if cooldown has expired
    if (health.cooldownUntil && new Date() >= health.cooldownUntil) {
      health.available = true;
      health.cooldownUntil = null;
      this.modelHealth.set(modelId, health);
    }

    return health.available;
  }

  /**
   * Get next available fallback model
   */
  getNextFallback(): string | null {
    if (!this.config.enableFallback) return null;

    const fallbackChain = this.config.fallbackChain || [];

    // First try the configured fallback chain
    for (const modelId of fallbackChain) {
      if (modelId !== this.currentModel && this.isModelAvailable(modelId)) {
        return modelId;
      }
    }

    // Then try any available model
    for (const modelId of Object.keys(GROK_MODELS)) {
      if (modelId !== this.currentModel && this.isModelAvailable(modelId)) {
        return modelId;
      }
    }

    return null;
  }

  /**
   * Switch to fallback model after failure
   */
  switchToFallback(error?: unknown): string | null {
    if (!this.config.enableFallback) {
      this.emit("fallback:disabled", { currentModel: this.currentModel });
      return null;
    }

    this.recordFailure(this.currentModel, error);

    const fallbackModel = this.getNextFallback();
    if (fallbackModel) {
      const previousModel = this.currentModel;
      this.switchModel(fallbackModel, `Fallback after ${previousModel} failure`);
      this.emit("fallback:activated", { from: previousModel, to: fallbackModel, error });
      return fallbackModel;
    }

    this.emit("fallback:exhausted", { currentModel: this.currentModel, error });
    return null;
  }

  /**
   * Get health status for all models
   */
  getModelHealthStatus(): ModelHealth[] {
    // Refresh cooldown states
    for (const [modelId, health] of this.modelHealth) {
      if (health.cooldownUntil && new Date() >= health.cooldownUntil) {
        health.available = true;
        health.cooldownUntil = null;
        this.modelHealth.set(modelId, health);
      }
    }
    return Array.from(this.modelHealth.values());
  }

  /**
   * Reset health for a specific model (force it out of cooldown)
   */
  resetModelHealth(modelId: string): void {
    const health = this.modelHealth.get(modelId);
    if (health) {
      health.available = true;
      health.consecutiveFailures = 0;
      health.cooldownUntil = null;
      this.modelHealth.set(modelId, health);
      this.emit("model:health-reset", { modelId });
    }
  }

  /**
   * Reset all model health states
   */
  resetAllModelHealth(): void {
    this.initializeModelHealth();
    this.emit("model:health-reset-all");
  }

  /**
   * Get session cost
   */
  getSessionCost(): number {
    return this.sessionCost;
  }

  /**
   * Reset session cost
   */
  resetSessionCost(): void {
    this.sessionCost = 0;
  }

  /**
   * Update router configuration
   */
  updateConfig(updates: Partial<ModelRouterConfig>): void {
    this.config = { ...this.config, ...updates };
    this.saveConfig();
  }

  /**
   * Get model info
   */
  getModelInfo(modelId?: string): ModelConfig | null {
    const id = modelId || this.currentModel;
    const config = GROK_MODELS[id];
    if (!config) return null;
    const price = getModelPricing(id);
    return { ...config, costPer1kInput: price.inputPerMillion / 1000,
      costPer1kOutput: price.outputPerMillion / 1000 };
  }

  /**
   * Get all available models
   */
  getAvailableModels(): string[] {
    return Object.keys(GROK_MODELS);
  }

  /**
   * Format router status
   */
  formatStatus(): string {
    const currentConfig = this.getModelInfo();

    let output = `\n🤖 Model Router Status\n${"═".repeat(50)}\n\n`;
    output += `Current Model: ${this.currentModel}\n`;
    if (currentConfig) {
      output += `  Name: ${currentConfig.name}\n`;
      output += `  Speed: ${currentConfig.speed}\n`;
      output += `  Context: ${currentConfig.contextWindow.toLocaleString()} tokens\n`;
      output += `  Cost: $${currentConfig.costPer1kInput}/1k in, $${currentConfig.costPer1kOutput}/1k out\n`;
    }

    output += `\nSession Cost: $${this.sessionCost.toFixed(4)}\n`;
    if (this.config.costThreshold) {
      output += `Cost Threshold: $${this.config.costThreshold}\n`;
    }

    output += `\nAuto-Switch: ${this.config.autoSwitch ? "ON" : "OFF"}\n`;
    output += `Prefer Speed: ${this.config.preferSpeed ? "ON" : "OFF"}\n`;

    output += `\n📋 Task Model Mapping:\n`;
    for (const [task, model] of Object.entries(this.config.taskModels)) {
      output += `  ${task}: ${model}\n`;
    }

    if (this.switchHistory.length > 0) {
      output += `\n🔄 Recent Switches:\n`;
      for (const switch_ of this.switchHistory.slice(-5)) {
        output += `  ${switch_.from} → ${switch_.to} (${switch_.reason})\n`;
      }
    }

    output += `\n${"═".repeat(50)}\n`;
    return output;
  }

  /**
   * Format available models
   */
  formatAvailableModels(): string {
    let output = `\n📋 Available Models\n${"═".repeat(50)}\n\n`;

    for (const [id, config] of Object.entries(GROK_MODELS)) {
      const current = id === this.currentModel ? " 🟢" : "";
      const price = getModelPricing(id);
      output += `  ${id}${current}\n`;
      output += `    ${config.name} | ${config.speed} | ${config.contextWindow.toLocaleString()} ctx\n`;
      output += `    Cost: $${price.inputPerMillion / 1000}/1k in, $${price.outputPerMillion / 1000}/1k out\n`;
      output += `    Good for: ${config.capabilities.join(", ")}\n`;
      output += `\n`;
    }

    output += `${"═".repeat(50)}\n`;
    return output;
  }
}

// Singleton instance
let modelRouterInstance: ModelRouter | null = null;

export function getModelRouter(projectRoot?: string): ModelRouter {
  if (!modelRouterInstance) {
    modelRouterInstance = new ModelRouter(projectRoot);
  }
  return modelRouterInstance;
}
