/**
 * Interpreter Service
 *
 * Open Interpreter-inspired service for Code Buddy.
 * Manages profiles, safe mode, auto-run, and budget tracking.
 *
 * Usage:
 * ```typescript
 * import { interpreter } from './services/InterpreterService';
 *
 * // Load a profile
 * interpreter.loadProfile('fast');
 *
 * // Configure
 * interpreter.autoRun = true;
 * interpreter.safeMode = 'ask';
 * interpreter.maxBudget = 1.00;
 *
 * // Execute
 * const result = await interpreter.chat('Open Chrome');
 * await interpreter.continue();
 * interpreter.reset();
 *
 * // Stats
 * console.log(interpreter.tokenUsage);
 * console.log(interpreter.totalCost);
 * ```
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import { logger } from '../utils/logger.js';

import type {
  SafeMode,
  InterpreterProfile,
  InterpreterConfig,
  InterpreterState,
  TokenUsage,
  BudgetStatus,
  UsageStats,
  ChatMessage,
  ChatResult,
  PendingApproval,
} from './types.js';

import {
  DEFAULT_INTERPRETER_CONFIG,
  DEFAULT_MODEL_PRICING,
} from './types.js';

import {
  DEFAULT_PROFILE,
  BUILTIN_PROFILE_MAP,
  getBuiltinProfile,
  validateProfile,
} from './profiles.js';

// ============================================================================
// Interpreter Service Class
// ============================================================================

export class InterpreterService extends EventEmitter {
  private config: InterpreterConfig;
  private state: InterpreterState;
  private conversationHistory: ChatMessage[] = [];
  private customProfiles: Map<string, InterpreterProfile> = new Map();
  private pendingApprovals: Map<string, PendingApproval> = new Map();

  constructor(config: Partial<InterpreterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_INTERPRETER_CONFIG, ...config };
    this.state = this.createInitialState();
    this.loadCustomProfiles();
    this.loadPersistedUsage();
  }

  // ==========================================================================
  // Public Properties
  // ==========================================================================

  /** Get current profile */
  get profile(): InterpreterProfile {
    return this.state.activeProfile;
  }

  /** Get/set auto-run mode */
  get autoRun(): boolean {
    return this.state.autoRun;
  }

  set autoRun(value: boolean) {
    this.state.autoRun = value;
    this.emit('autoRun:changed', value);
  }

  /** Get/set safe mode */
  get safeMode(): SafeMode {
    return this.state.safeMode;
  }

  set safeMode(value: SafeMode) {
    this.state.safeMode = value;
    this.emit('safeMode:changed', value);
  }

  /** Get/set custom instructions */
  get customInstructions(): string | undefined {
    return this.state.customInstructions;
  }

  set customInstructions(value: string | undefined) {
    this.state.customInstructions = value;
  }

  /** Get/set max budget */
  get maxBudget(): number {
    return this.state.usage.budget.maxBudget;
  }

  set maxBudget(value: number) {
    this.state.usage.budget.maxBudget = value;
    this.updateBudgetStatus();
  }

  /** Get token usage */
  get tokenUsage(): TokenUsage {
    return { ...this.state.usage.tokens };
  }

  /** Get total cost */
  get totalCost(): number {
    return this.state.usage.cost.totalCost;
  }

  /** Get budget status */
  get budgetStatus(): BudgetStatus {
    return { ...this.state.usage.budget };
  }

  /** Get full usage stats */
  get usage(): UsageStats {
    return { ...this.state.usage };
  }

  /** Is currently processing */
  get isProcessing(): boolean {
    return this.state.isProcessing;
  }

  /** Is loop mode enabled */
  get loopMode(): boolean {
    return this.state.loopMode;
  }

  set loopMode(value: boolean) {
    this.state.loopMode = value;
  }

  // ==========================================================================
  // Profile Management
  // ==========================================================================

  /**
   * Load a profile by ID
   */
  loadProfile(profileId: string): void {
    // Check built-in profiles first
    let profile = getBuiltinProfile(profileId);

    // Then check custom profiles
    if (!profile) {
      profile = this.customProfiles.get(profileId);
    }

    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    this.state.activeProfile = profile;
    this.state.autoRun = profile.autoRun;
    this.state.safeMode = profile.safeMode;
    this.state.customInstructions = profile.customInstructions;

    if (profile.maxBudget !== undefined) {
      this.state.usage.budget.maxBudget = profile.maxBudget;
      this.updateBudgetStatus();
    }

    this.emit('profile:changed', profile);
  }

  /**
   * Load a profile from YAML file
   */
  loadProfileFromFile(filePath: string): void {
    const resolvedPath = this.resolvePath(filePath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Profile file not found: ${resolvedPath}`);
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const profile = yaml.parse(content) as InterpreterProfile;

    const validation = validateProfile(profile);
    if (!validation.valid) {
      throw new Error(`Invalid profile: ${validation.errors.join(', ')}`);
    }

    this.customProfiles.set(profile.id, profile);
    this.loadProfile(profile.id);
  }

  /**
   * Save current profile to YAML file
   */
  saveProfile(filePath: string): void {
    const resolvedPath = this.resolvePath(filePath);
    const dir = path.dirname(resolvedPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = yaml.stringify(this.state.activeProfile);
    fs.writeFileSync(resolvedPath, content, 'utf-8');
  }

  /**
   * List available profiles
   */
  listProfiles(): Array<{ id: string; name: string; description?: string; builtin: boolean }> {
    const profiles: Array<{ id: string; name: string; description?: string; builtin: boolean }> = [];

    // Add built-in profiles
    for (const [id, profile] of BUILTIN_PROFILE_MAP) {
      profiles.push({
        id,
        name: profile.name,
        description: profile.description,
        builtin: true,
      });
    }

    // Add custom profiles
    for (const [id, profile] of this.customProfiles) {
      profiles.push({
        id,
        name: profile.name,
        description: profile.description,
        builtin: false,
      });
    }

    return profiles;
  }

  /**
   * Create a custom profile
   */
  createProfile(profile: InterpreterProfile): void {
    const validation = validateProfile(profile);
    if (!validation.valid) {
      throw new Error(`Invalid profile: ${validation.errors.join(', ')}`);
    }

    this.customProfiles.set(profile.id, profile);

    // Persist to disk
    const profilePath = path.join(
      this.resolvePath(this.config.profilesDir),
      `${profile.id}.yaml`
    );

    const dir = path.dirname(profilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(profilePath, yaml.stringify(profile), 'utf-8');
  }

  /**
   * Delete a custom profile
   */
  deleteProfile(profileId: string): boolean {
    if (BUILTIN_PROFILE_MAP.has(profileId)) {
      throw new Error('Cannot delete built-in profile');
    }

    const deleted = this.customProfiles.delete(profileId);

    if (deleted) {
      const profilePath = path.join(
        this.resolvePath(this.config.profilesDir),
        `${profileId}.yaml`
      );

      if (fs.existsSync(profilePath)) {
        fs.unlinkSync(profilePath);
      }
    }

    return deleted;
  }

  // ==========================================================================
  // Chat Interface
  // ==========================================================================

  /**
   * Send a message and get a response
   */
  async chat(message: string): Promise<ChatResult> {
    if (this.state.isProcessing) {
      throw new Error('Already processing a request');
    }

    // Check budget
    if (this.state.usage.budget.exceeded) {
      throw new Error('Budget exceeded. Reset usage or increase budget.');
    }

    this.state.isProcessing = true;

    try {
      // Add user message to history
      const userMessage: ChatMessage = {
        role: 'user',
        content: message,
        timestamp: new Date(),
      };
      this.conversationHistory.push(userMessage);

      // Process through the configured LLM client with budget tracking.
      const result = await this.processMessage(message);

      // Update usage
      this.updateUsage(result.tokens, result.cost);

      // Add assistant message to history
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: result.content,
        timestamp: new Date(),
        tokenCount: result.tokens.output,
        cost: result.cost,
        toolCalls: result.toolCalls,
        toolResults: result.toolResults,
      };
      this.conversationHistory.push(assistantMessage);

      return result;
    } finally {
      this.state.isProcessing = false;
    }
  }

  /**
   * Continue the conversation (loop mode)
   */
  async continue(): Promise<ChatResult | null> {
    if (!this.state.loopMode) {
      return null;
    }

    // Get last assistant message
    const lastMessage = this.conversationHistory[this.conversationHistory.length - 1];

    if (lastMessage?.role !== 'assistant') {
      return null;
    }

    // Check if there are pending tool calls
    if (lastMessage.toolCalls && lastMessage.toolCalls.length > 0) {
      // Continue with tool execution
      return this.chat('Continue with the task.');
    }

    return null;
  }

  /**
   * Reset the conversation
   */
  reset(): void {
    this.conversationHistory = [];
    this.pendingApprovals.clear();
    this.state.conversationId = undefined;
    this.state.loopMode = false;
  }

  /**
   * Get conversation history
   */
  getHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }

  // ==========================================================================
  // Approval System
  // ==========================================================================

  /**
   * Check if an action needs approval
   */
  needsApproval(action: string, risk: 'low' | 'medium' | 'high' | 'critical'): boolean {
    switch (this.state.safeMode) {
      case 'off':
        return false;
      case 'ask':
        return true;
      case 'auto':
        return risk === 'high' || risk === 'critical';
      default:
        return true;
    }
  }

  /**
   * Request approval for an action
   */
  requestApproval(approval: Omit<PendingApproval, 'id'>): string {
    const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const pending: PendingApproval = { ...approval, id };

    this.pendingApprovals.set(id, pending);
    this.emit('approval:needed', pending);

    return id;
  }

  /**
   * Approve a pending action
   */
  async approve(approvalId: string): Promise<unknown> {
    const pending = this.pendingApprovals.get(approvalId);

    if (!pending) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    this.pendingApprovals.delete(approvalId);
    const result = await pending.action();

    this.emit('tool:executed', pending.description, result);

    return result;
  }

  /**
   * Reject a pending action
   */
  reject(approvalId: string): void {
    this.pendingApprovals.delete(approvalId);
  }

  /**
   * Get all pending approvals
   */
  getPendingApprovals(): PendingApproval[] {
    return Array.from(this.pendingApprovals.values());
  }

  // ==========================================================================
  // Usage & Budget
  // ==========================================================================

  /**
   * Update usage statistics
   */
  private updateUsage(tokens: TokenUsage, cost: number): void {
    this.state.usage.tokens.input += tokens.input;
    this.state.usage.tokens.output += tokens.output;
    this.state.usage.tokens.total += tokens.total;
    if (tokens.cached) {
      this.state.usage.tokens.cached = (this.state.usage.tokens.cached || 0) + tokens.cached;
    }

    this.state.usage.cost.totalCost += cost;
    this.state.usage.requestCount++;
    this.state.usage.lastRequest = new Date();

    this.updateBudgetStatus();
    this.emit('usage:updated', this.state.usage);

    // Persist usage
    if (this.config.persistUsage) {
      this.persistUsage();
    }
  }

  /**
   * Update budget status
   */
  private updateBudgetStatus(): void {
    const budget = this.state.usage.budget;
    budget.currentSpend = this.state.usage.cost.totalCost;
    budget.remaining = Math.max(0, budget.maxBudget - budget.currentSpend);
    budget.percentUsed = budget.maxBudget > 0
      ? (budget.currentSpend / budget.maxBudget) * 100
      : 0;
    budget.exceeded = budget.currentSpend >= budget.maxBudget && budget.maxBudget > 0;

    // Emit warnings
    if (budget.percentUsed >= 80 && budget.percentUsed < 100) {
      this.emit('budget:warning', budget);
    } else if (budget.exceeded) {
      this.emit('budget:exceeded', budget);
    }
  }

  /**
   * Reset usage statistics
   */
  resetUsage(): void {
    this.state.usage = this.createInitialUsage();

    if (this.config.persistUsage && this.config.usagePath) {
      const usagePath = this.resolvePath(this.config.usagePath);
      if (fs.existsSync(usagePath)) {
        fs.unlinkSync(usagePath);
      }
    }
  }

  /**
   * Calculate cost for tokens
   */
  calculateCost(model: string, tokens: TokenUsage): number {
    const pricing = this.config.pricing[model] || DEFAULT_MODEL_PRICING['grok-3-mini'];
    const inputCost = (tokens.input / 1_000_000) * pricing.input;
    const outputCost = (tokens.output / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }

  /**
   * Format usage for display
   */
  formatUsage(): string {
    const { tokens, cost, budget } = this.state.usage;

    const lines = [
      '📊 Usage Statistics',
      '',
      `Tokens: ${tokens.total.toLocaleString()} (${tokens.input.toLocaleString()} in / ${tokens.output.toLocaleString()} out)`,
      `Cost: $${cost.totalCost.toFixed(4)}`,
      `Budget: $${budget.currentSpend.toFixed(4)} / $${budget.maxBudget.toFixed(2)} (${budget.percentUsed.toFixed(1)}%)`,
      `Requests: ${this.state.usage.requestCount}`,
    ];

    if (budget.exceeded) {
      lines.push('', '⚠️ Budget exceeded!');
    } else if (budget.percentUsed >= 80) {
      lines.push('', '⚠️ Budget warning: 80% used');
    }

    return lines.join('\n');
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private createInitialState(): InterpreterState {
    return {
      activeProfile: DEFAULT_PROFILE,
      autoRun: DEFAULT_PROFILE.autoRun,
      safeMode: DEFAULT_PROFILE.safeMode,
      customInstructions: DEFAULT_PROFILE.customInstructions,
      usage: this.createInitialUsage(),
      isProcessing: false,
      loopMode: false,
    };
  }

  private createInitialUsage(): UsageStats {
    return {
      tokens: { input: 0, output: 0, total: 0 },
      cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
      budget: {
        maxBudget: this.config.globalMaxBudget || 10.00,
        currentSpend: 0,
        remaining: this.config.globalMaxBudget || 10.00,
        percentUsed: 0,
        exceeded: false,
      },
      requestCount: 0,
      sessionStart: new Date(),
    };
  }

  private resolvePath(p: string): string {
    if (p.startsWith('~')) {
      return path.join(os.homedir(), p.slice(1));
    }
    return path.resolve(p);
  }

  private loadCustomProfiles(): void {
    const profilesDir = this.resolvePath(this.config.profilesDir);

    if (!fs.existsSync(profilesDir)) {
      return;
    }

    const files = fs.readdirSync(profilesDir);

    for (const file of files) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        try {
          const content = fs.readFileSync(path.join(profilesDir, file), 'utf-8');
          const profile = yaml.parse(content) as InterpreterProfile;

          const validation = validateProfile(profile);
          if (validation.valid) {
            this.customProfiles.set(profile.id, profile);
          }
        } catch {
          // Skip invalid profiles
        }
      }
    }
  }

  private loadPersistedUsage(): void {
    if (!this.config.persistUsage || !this.config.usagePath) {
      return;
    }

    const usagePath = this.resolvePath(this.config.usagePath);

    if (!fs.existsSync(usagePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(usagePath, 'utf-8');
      const data = JSON.parse(content);

      // Merge persisted usage
      this.state.usage.tokens = data.tokens || this.state.usage.tokens;
      this.state.usage.cost = data.cost || this.state.usage.cost;
      this.state.usage.requestCount = data.requestCount || 0;
      this.state.usage.sessionStart = new Date(data.sessionStart || Date.now());

      this.updateBudgetStatus();
    } catch {
      // Ignore errors, start fresh
    }
  }

  private persistUsage(): void {
    if (!this.config.usagePath) {
      return;
    }

    const usagePath = this.resolvePath(this.config.usagePath);
    const dir = path.dirname(usagePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data = {
      tokens: this.state.usage.tokens,
      cost: this.state.usage.cost,
      requestCount: this.state.usage.requestCount,
      sessionStart: this.state.usage.sessionStart.toISOString(),
      lastRequest: this.state.usage.lastRequest?.toISOString(),
    };

    fs.writeFileSync(usagePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private llmClient: import('../codebuddy/client.js').CodeBuddyClient | null = null;

  private async getLLMClient(): Promise<import('../codebuddy/client.js').CodeBuddyClient> {
    if (this.llmClient) return this.llmClient;

    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) {
      throw new Error('GROK_API_KEY environment variable is required for LLM calls. Set it with: export GROK_API_KEY=your-key');
    }

    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    this.llmClient = new CodeBuddyClient(apiKey);
    return this.llmClient;
  }

  private async processMessage(message: string): Promise<ChatResult> {
    try {
      const client = await this.getLLMClient();

      // Build messages array from conversation history
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

      // Add system prompt from active profile
      const systemPrompt = this.state.activeProfile.customInstructions ||
        'You are a helpful coding assistant. Execute tasks as requested.';
      messages.push({ role: 'system', content: systemPrompt });

      // Add custom instructions if set (and different from profile instructions)
      if (this.state.customInstructions && this.state.customInstructions !== this.state.activeProfile.customInstructions) {
        messages.push({ role: 'system', content: this.state.customInstructions });
      }

      // Add conversation history (last 20 messages to stay within context)
      const historySlice = this.conversationHistory.slice(-20);
      for (const msg of historySlice) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: msg.content });
        }
      }

      // Add current message
      messages.push({ role: 'user', content: message });

      // Call the LLM
      const model = this.state.activeProfile.model;
      const response = await client.chat(messages, [], {
        model,
        temperature: this.state.activeProfile.temperature,
      });

      const choice = response.choices[0];
      const content = choice?.message?.content || '';

      // Extract usage from response
      const usage = response.usage;
      const tokens = {
        input: usage?.prompt_tokens || 0,
        output: usage?.completion_tokens || 0,
        total: usage?.total_tokens || 0,
      };

      // Calculate cost using existing method
      const cost = this.calculateCost(model || 'grok-3-mini', tokens);

      // Extract tool calls if present
      const toolCalls = choice?.message?.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments) as Record<string, unknown>
          : tc.function.arguments as Record<string, unknown>,
      }));

      return {
        content,
        tokens,
        cost,
        autoApproved: this.state.autoRun,
        toolCalls,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('InterpreterService: LLM call failed', { error: errMsg });

      return {
        content: `Error: ${errMsg}`,
        tokens: { input: 0, output: 0, total: 0 },
        cost: 0,
        autoApproved: false,
      };
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let interpreterInstance: InterpreterService | null = null;

export function getInterpreter(config?: Partial<InterpreterConfig>): InterpreterService {
  if (!interpreterInstance) {
    interpreterInstance = new InterpreterService(config);
  }
  return interpreterInstance;
}

export function resetInterpreter(): void {
  interpreterInstance = null;
}

// Default export for convenience
export const interpreter = getInterpreter();

export default InterpreterService;
