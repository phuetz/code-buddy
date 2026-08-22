/**
 * Enhanced Memory Persistence System
 *
 * Features:
 * - Long-term memory with semantic search
 * - Project context memory
 * - User preferences learning
 * - Conversation summaries
 * - Memory categories and tags
 * - Memory decay and importance scoring
 *
 * Enables Grok to remember context across sessions.
 */

import { EventEmitter } from 'events';
import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { getMemoryRepository, MemoryRepository } from '../database/repositories/memory-repository.js';
import type { Memory as DBMemory, MemoryType as DBMemoryType } from '../database/schema.js';
import { getEmbeddingProvider } from '../embeddings/embedding-provider.js';
import { logger } from '../utils/logger.js';
import { BayesianQualifier } from '../ml/bayesian-qualifier.js';
import { mmrSelect, type RankedCandidate } from './hybrid-mmr.js';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  summary?: string;
  embedding?: number[];
  importance: number;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
  expiresAt?: Date;
  tags: string[];
  metadata: Record<string, unknown>;
  projectId?: string;
  sessionId?: string;
}

export type MemoryType =
  | 'fact'           // General facts about the project
  | 'preference'     // User preferences
  | 'pattern'        // Code patterns and conventions
  | 'decision'       // Design decisions and rationale
  | 'context'        // Contextual information
  | 'summary'        // Conversation summaries
  | 'instruction'    // User-specific instructions
  | 'error'          // Common errors and solutions
  | 'definition';    // Technical definitions

export interface ProjectMemory {
  projectId: string;
  projectPath: string;
  name: string;
  description?: string;
  languages: string[];
  frameworks: string[];
  conventions: CodeConvention[];
  memories: string[]; // Memory IDs
  createdAt: Date;
  updatedAt: Date;
}

export interface CodeConvention {
  type: 'naming' | 'structure' | 'style' | 'testing' | 'documentation';
  rule: string;
  examples?: string[];
  confidence: number;
}

export interface ConversationSummary {
  id: string;
  sessionId: string;
  summary: string;
  topics: string[];
  decisions: string[];
  todos: string[];
  timestamp: Date;
  messageCount: number;
}

export interface UserProfile {
  id: string;
  preferences: UserPreferences;
  skills: SkillLevel[];
  interests: string[];
  history: UserHistory;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPreferences {
  codeStyle: string;
  verbosity: 'minimal' | 'moderate' | 'detailed';
  language?: string;
  editor?: string;
  themes?: string[];
  customInstructions?: string;
}

export interface SkillLevel {
  skill: string;
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  confidence: number;
}

export interface UserHistory {
  topLanguages: Array<{ language: string; usage: number }>;
  commonTasks: Array<{ task: string; frequency: number }>;
  lastProjects: string[];
}

export interface MemorySearchOptions {
  query?: string;
  types?: MemoryType[];
  tags?: string[];
  projectId?: string;
  minImportance?: number;
  limit?: number;
  includeExpired?: boolean;
  explorationFactor?: number; // Weight for uncertainty in Bayesian retrieval (UCB)
  /** MMR balance for semantic recall: 1 = pure relevance (naive top-k), 0 = pure diversity. Default 0.7. */
  mmrLambda?: number;
}

export interface MemoryConfig {
  enabled: boolean;
  maxMemories: number;
  maxMemoryAge: number; // days
  decayRate: number;
  minImportance: number;
  autoSummarize: boolean;
  summarizeThreshold: number;
  embeddingEnabled: boolean;
  embeddingModel?: string;
  /** Use SQLite database instead of JSON files */
  useSQLite: boolean;
}

const DEFAULT_CONFIG: MemoryConfig = {
  enabled: true,
  maxMemories: 10000,
  maxMemoryAge: 365,
  decayRate: 0.01,
  minImportance: 0.1,
  autoSummarize: true,
  summarizeThreshold: 20,
  embeddingEnabled: true, // Enable local embeddings with @xenova/transformers
  useSQLite: true, // SQLite by default
};

/**
 * Enhanced Memory Manager
 */
/** Minimal embedder surface recall needs — EmbeddingProvider satisfies it (test seam). */
export interface MemoryEmbedder {
  embed(text: string): Promise<{ embedding: Float32Array }>;
}

export class EnhancedMemory extends EventEmitter {
  private config: MemoryConfig;
  private dataDir: string;
  private memories: Map<string, MemoryEntry> = new Map();
  private projects: Map<string, ProjectMemory> = new Map();
  private summaries: ConversationSummary[] = [];
  private userProfile: UserProfile | null = null;
  private currentProjectId: string | null = null;
  private decayIntervalId: ReturnType<typeof setInterval> | null = null;
  private dbRepository: MemoryRepository | null = null;
  private embeddingProvider: MemoryEmbedder | null = null;
  private bayesianQualifier = new BayesianQualifier();
  private disposed = false;
  /** Resolves when initialize() finished (dirs ensured, stores loaded). */
  private readonly ready: Promise<void>;

  constructor(config: Partial<MemoryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dataDir = path.join(os.homedir(), '.codebuddy', 'memory');

    // Initialize SQLite repository if enabled
    if (this.config.useSQLite) {
      try {
        this.dbRepository = getMemoryRepository();
      } catch {
        // Fallback to JSON if SQLite fails
        this.config.useSQLite = false;
      }
    }

    // Initialize embedding provider if embeddings are enabled
    if (this.config.embeddingEnabled) {
      try {
        this.embeddingProvider = getEmbeddingProvider({
          provider: 'local', // Use @xenova/transformers by default
          modelName: this.config.embeddingModel || 'Xenova/all-MiniLM-L6-v2',
        });
      } catch {
        // Disable embeddings if provider fails
        logger.warn('Failed to initialize embedding provider, disabling embeddings');
        this.config.embeddingEnabled = false;
      }
    }

    // Captured, never fire-and-forget: an immediate store() used to race
    // ensureDir (ENOENT) and loadMemories() could overwrite entries stored
    // before the load completed. Every async public method awaits `ready`.
    this.ready = this.initialize().catch((err) => {
      logger.warn('EnhancedMemory initialization failed — continuing best-effort', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /** Await full initialization (dirs + persisted state loaded). */
  whenReady(): Promise<void> {
    return this.ready;
  }

  /** Inject an embedder (tests / alternative engines) and enable semantic recall. */
  setEmbeddingProvider(provider: MemoryEmbedder | null): void {
    this.embeddingProvider = provider;
    if (provider) this.config.embeddingEnabled = true;
  }

  /**
   * Initialize memory system
   */
  private async initialize(): Promise<void> {
    await fs.ensureDir(this.dataDir);
    await fs.ensureDir(path.join(this.dataDir, 'projects'));
    await fs.ensureDir(path.join(this.dataDir, 'memories'));

    await this.loadMemories();
    await this.loadProjects();
    await this.loadUserProfile();
    await this.loadSummaries();

    // Load GPR state if exists
    const qualifierPath = path.join(this.dataDir, 'bayesian-state.json');
    if (await fs.pathExists(qualifierPath)) {
      try {
        const state = await fs.readFile(qualifierPath, 'utf8');
        this.bayesianQualifier.loadState(state);
      } catch (err: any) {
        logger.error(`Failed to load bayesian-state: ${err.message}`);
      }
    }

    if (this.disposed) return;

    // Start decay timer
    this.decayIntervalId = setInterval(() => this.applyDecay(), 3600000); // Every hour
    this.decayIntervalId.unref?.();
  }

  /**
   * Load memories from disk or SQLite
   */
  private async loadMemories(): Promise<void> {
    // Load from SQLite if enabled
    if (this.dbRepository) {
      try {
        const dbMemories = this.dbRepository.find({ limit: this.config.maxMemories });
        for (const dbMem of dbMemories) {
          const entry: MemoryEntry = {
            id: dbMem.id,
            type: dbMem.type as MemoryType,
            content: dbMem.content,
            summary: dbMem.metadata?.summary as string | undefined,
            embedding: dbMem.embedding ? Array.from(dbMem.embedding) : undefined,
            importance: dbMem.importance,
            accessCount: dbMem.access_count,
            createdAt: new Date(dbMem.created_at),
            updatedAt: new Date(dbMem.created_at),
            lastAccessedAt: new Date(dbMem.last_accessed),
            expiresAt: dbMem.expires_at ? new Date(dbMem.expires_at) : undefined,
            tags: (dbMem.metadata?.tags as string[]) || [],
            metadata: dbMem.metadata || {},
            projectId: dbMem.project_id,
          };
          this.memories.set(entry.id, entry);
        }
        return;
      } catch {
        // Fallback to JSON
      }
    }

    // Fallback: Load from JSON
    const indexPath = path.join(this.dataDir, 'memory-index.json');

    if (await fs.pathExists(indexPath)) {
      try {
        const entries = await fs.readJSON(indexPath);
        for (const entry of entries) {
          this.memories.set(entry.id, entry);
        }
      } catch {
        // Start fresh
      }
    }
  }

  /**
   * Load projects from disk
   */
  private async loadProjects(): Promise<void> {
    const projectsDir = path.join(this.dataDir, 'projects');

    // Check if directory exists before reading
    if (!await fs.pathExists(projectsDir)) {
      return;
    }

    const files = await fs.readdir(projectsDir);

    // Load project files in parallel for better performance
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    const loadResults = await Promise.allSettled(
      jsonFiles.map(async file => {
        const project = await fs.readJSON(path.join(projectsDir, file));
        return project;
      })
    );

    for (const result of loadResults) {
      if (result.status === 'fulfilled') {
        this.projects.set(result.value.projectId, result.value);
      }
      // Skip rejected promises (invalid files)
    }
  }

  /**
   * Load user profile
   */
  private async loadUserProfile(): Promise<void> {
    const profilePath = path.join(this.dataDir, 'user-profile.json');

    if (await fs.pathExists(profilePath)) {
      try {
        this.userProfile = await fs.readJSON(profilePath);
      } catch {
        this.userProfile = null;
      }
    }
  }

  /**
   * Load conversation summaries
   */
  private async loadSummaries(): Promise<void> {
    const summariesPath = path.join(this.dataDir, 'summaries.json');

    if (await fs.pathExists(summariesPath)) {
      try {
        this.summaries = await fs.readJSON(summariesPath);
      } catch {
        this.summaries = [];
      }
    }
  }

  /**
   * Save all data
   */
  private async saveAll(): Promise<void> {
    // Save all data files in parallel for better performance
    const saveOperations: Promise<void>[] = [
      // Save memory index
      fs.writeJSON(
        path.join(this.dataDir, 'memory-index.json'),
        Array.from(this.memories.values()),
        { spaces: 2 }
      ),
      // Save summaries
      fs.writeJSON(
        path.join(this.dataDir, 'summaries.json'),
        this.summaries,
        { spaces: 2 }
      ),
    ];

    // Save user profile if exists
    if (this.userProfile) {
      saveOperations.push(
        fs.writeJSON(
          path.join(this.dataDir, 'user-profile.json'),
          this.userProfile,
          { spaces: 2 }
        )
      );
    }

    if (this.bayesianQualifier) {
      saveOperations.push(
        fs.writeFile(
          path.join(this.dataDir, 'bayesian-state.json'),
          this.bayesianQualifier.saveState(),
          'utf8'
        )
      );
    }

    await Promise.all(saveOperations);
  }

  /**
   * Store a memory
   */
  async store(options: {
    type: MemoryType;
    content: string;
    summary?: string;
    importance?: number;
    tags?: string[];
    metadata?: Record<string, unknown>;
    projectId?: string;
    sessionId?: string;
    expiresIn?: number; // days
  }): Promise<MemoryEntry> {
    await this.ready;
    const id = crypto.randomBytes(8).toString('hex');
    const now = new Date();

    const memory: MemoryEntry = {
      id,
      type: options.type,
      content: options.content,
      summary: options.summary,
      importance: options.importance || this.calculateImportance(options),
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      expiresAt: options.expiresIn
        ? new Date(now.getTime() + options.expiresIn * 24 * 60 * 60 * 1000)
        : undefined,
      tags: options.tags || [],
      metadata: options.metadata || {},
      projectId: options.projectId || this.currentProjectId || undefined,
      sessionId: options.sessionId,
    };

    // Generate embedding if enabled
    if (this.config.embeddingEnabled) {
      memory.embedding = await this.generateEmbedding(options.content);
    }

    // Store in SQLite if enabled
    if (this.dbRepository) {
      const dbMemory: Omit<DBMemory, 'access_count' | 'created_at' | 'last_accessed'> = {
        id,
        type: options.type as DBMemoryType,
        scope: options.projectId ? 'project' : 'user',
        project_id: options.projectId || this.currentProjectId || undefined,
        content: options.content,
        embedding: memory.embedding ? new Float32Array(memory.embedding) : undefined,
        importance: memory.importance,
        expires_at: memory.expiresAt?.toISOString(),
        metadata: { ...options.metadata, tags: options.tags, summary: options.summary },
      };
      this.dbRepository.create(dbMemory);
    }

    this.memories.set(id, memory);

    // Add to project if applicable
    if (memory.projectId) {
      const project = this.projects.get(memory.projectId);
      if (project) {
        project.memories.push(id);
        await this.saveProject(project);
      }
    }

    if (!this.dbRepository) {
      await this.saveAll();
    }
    await this.enforceMemoryLimits();

    this.emit('memory:stored', { memory });

    return memory;
  }

  /**
   * Calculate importance score
   */
  private calculateImportance(options: {
    type: MemoryType;
    content: string;
    tags?: string[];
  }): number {
    let score = 0.5;

    // Type-based importance
    const typeScores: Record<MemoryType, number> = {
      decision: 0.9,
      instruction: 0.85,
      preference: 0.8,
      pattern: 0.75,
      error: 0.7,
      fact: 0.6,
      definition: 0.55,
      context: 0.5,
      summary: 0.45,
    };

    score = typeScores[options.type] || 0.5;

    // Adjust based on content length (medium length is often more useful)
    const contentLength = options.content.length;
    if (contentLength > 50 && contentLength < 500) {
      score += 0.1;
    }

    // Adjust based on tags
    if (options.tags && options.tags.length > 0) {
      score += Math.min(options.tags.length * 0.05, 0.15);
    }

    return Math.min(1, Math.max(0, score));
  }

  /**
   * Generate embedding using @xenova/transformers (local) or fallback to hash
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // Use real embedding provider if available
    if (this.embeddingProvider) {
      try {
        const result = await this.embeddingProvider.embed(text);
        // Convert Float32Array to number[]
        return Array.from(result.embedding);
      } catch (error) {
        logger.warn(`Embedding generation failed, using fallback: ${error instanceof Error ? error.message : String(error)}`);
        // Fall through to hash-based fallback
      }
    }

    // Fallback: hash-based pseudo-embedding (for when @xenova/transformers is not available)
    const hash = crypto.createHash('sha256').update(text).digest();
    const embedding: number[] = [];

    for (let i = 0; i < 384; i++) { // 384 dimensions to match all-MiniLM-L6-v2
      const byte = hash[i % hash.length] ?? 0; // modulo keeps index in bounds; ?? 0 satisfies the type checker
      embedding.push((byte / 255) * 2 - 1);
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / norm);
  }

  /**
   * Recall memories
   */
  async recall(options: MemorySearchOptions = {}): Promise<MemoryEntry[]> {
    await this.ready;
    let results = Array.from(this.memories.values());

    // Filter expired
    if (!options.includeExpired) {
      const now = new Date();
      results = results.filter(m => !m.expiresAt || new Date(m.expiresAt) > now);
    }

    // Filter by type
    if (options.types && options.types.length > 0) {
      results = results.filter(m => options.types!.includes(m.type));
    }

    // Filter by tags
    if (options.tags && options.tags.length > 0) {
      results = results.filter(m =>
        options.tags!.some(tag => m.tags.includes(tag))
      );
    }

    // Filter by project
    if (options.projectId) {
      results = results.filter(m => m.projectId === options.projectId);
    }

    // Filter by importance
    if (options.minImportance !== undefined) {
      results = results.filter(m => m.importance >= options.minImportance!);
    }

    // Text search
    let queryRanked = false;
    if (options.query) {
      const query = options.query.toLowerCase();

      if (this.bayesianQualifier && (this.bayesianQualifier as any).isTrained) {
        const queryEmbedding = this.config.embeddingEnabled
          ? await this.generateEmbedding(options.query)
          : undefined;

        results = results
          .map(m => {
            const features = this.extractMemoryFeatures(m, queryEmbedding);
            const { mean, std } = this.bayesianQualifier.predict(features);
            // Bayesian Active Learning: Upper Confidence Bound (UCB)
            const explorationFactor = options.explorationFactor ?? 0.05;
            const score = mean + (explorationFactor * std);
            return { memory: m, score };
          })
          .filter(r => r.score > 0.3)
          .sort((a, b) => b.score - a.score)
          .map(r => r.memory);
        queryRanked = true;
      } else if (this.config.embeddingEnabled) {
        // Semantic search + MMR rerank: cosine gives the relevance, MMR keeps
        // the selection DIVERSE so near-duplicate memories don't crowd the
        // limit (λ=1 reproduces the old naive top-k; see memory/hybrid-mmr.ts).
        const queryEmbedding = await this.generateEmbedding(options.query);
        const scored = results
          .map(m => ({
            memory: m,
            similarity: m.embedding
              ? this.cosineSimilarity(queryEmbedding, m.embedding)
              : 0,
          }))
          .filter(r => r.similarity > 0.5)
          .sort((a, b) => b.similarity - a.similarity);
        const fused: RankedCandidate[] = scored.map((r, i) => ({
          id: r.memory.id,
          relevance: r.similarity,
          lexicalRank: null,
          semanticRank: i + 1,
        }));
        const vectors = new Map<string, Float32Array | null>(
          scored.map(r => [r.memory.id, r.memory.embedding ? Float32Array.from(r.memory.embedding) : null]),
        );
        const picked = mmrSelect(fused, vectors, {
          k: options.limit ?? fused.length,
          lambda: options.mmrLambda ?? 0.7,
        });
        const byId = new Map(scored.map(r => [r.memory.id, r.memory]));
        results = picked.map(p => byId.get(p.id)!);
        queryRanked = true;
      } else {
        // Keyword search
        results = results.filter(m =>
          m.content.toLowerCase().includes(query) ||
          m.summary?.toLowerCase().includes(query) ||
          m.tags.some(t => t.toLowerCase().includes(query))
        );
      }
    }

    // Sort by importance and recency — ONLY when no query ranking happened:
    // the Bayesian and semantic branches above already ordered by relevance,
    // and this unconditional re-sort used to DESTROY that ordering (a real
    // bug: semantic recall returned importance order, not similarity order).
    if (!queryRanked) results.sort((a, b) => {
      const importanceWeight = 0.6;
      const recencyWeight = 0.4;

      const aScore =
        a.importance * importanceWeight +
        (new Date(a.lastAccessedAt).getTime() / Date.now()) * recencyWeight;
      const bScore =
        b.importance * importanceWeight +
        (new Date(b.lastAccessedAt).getTime() / Date.now()) * recencyWeight;

      return bScore - aScore;
    });

    // Limit results
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    // Update access stats
    for (const memory of results) {
      memory.accessCount++;
      memory.lastAccessedAt = new Date();
    }

    await this.saveAll();

    return results;
  }

  /**
   * Cosine similarity
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const ai = a[i];
      const bi = b[i];
      if (ai === undefined || bi === undefined) continue; // lengths are equal and i < a.length, so this never triggers for dense arrays
      dotProduct += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Forget a memory
   */
  async forget(id: string): Promise<boolean> {
    await this.ready;
    const memory = this.memories.get(id);
    if (!memory) return false;

    // Remove from SQLite if enabled
    if (this.dbRepository) {
      this.dbRepository.delete(id);
    }

    // Remove from project
    if (memory.projectId) {
      const project = this.projects.get(memory.projectId);
      if (project) {
        project.memories = project.memories.filter(m => m !== id);
        await this.saveProject(project);
      }
    }

    this.memories.delete(id);
    if (!this.dbRepository) {
      await this.saveAll();
    }

    this.emit('memory:forgotten', { id });

    return true;
  }

  /**
   * Apply memory decay
   */
  private async applyDecay(): Promise<void> {
    const now = new Date();

    for (const [id, memory] of this.memories) {
      // Calculate days since last access
      const daysSinceAccess =
        (now.getTime() - new Date(memory.lastAccessedAt).getTime()) /
        (1000 * 60 * 60 * 24);

      // Apply decay
      const decay = this.config.decayRate * daysSinceAccess;
      memory.importance = Math.max(
        this.config.minImportance,
        memory.importance - decay
      );

      // Remove if below threshold
      if (memory.importance <= this.config.minImportance && memory.accessCount < 3) {
        await this.forget(id);
      }
    }

    await this.saveAll();
  }

  /**
   * Enforce memory limits
   */
  private async enforceMemoryLimits(): Promise<void> {
    if (this.memories.size <= this.config.maxMemories) return;

    // Sort by importance (lowest first)
    const sorted = Array.from(this.memories.values())
      .sort((a, b) => a.importance - b.importance);

    // Remove excess memories
    const toRemove = sorted.slice(0, this.memories.size - this.config.maxMemories);
    for (const memory of toRemove) {
      await this.forget(memory.id);
    }
  }

  /**
   * Store project context
   */
  async setProjectContext(projectPath: string): Promise<ProjectMemory> {
    await this.ready;
    const projectId = crypto
      .createHash('sha256')
      .update(projectPath)
      .digest('hex')
      .slice(0, 16);

    let project = this.projects.get(projectId);

    if (!project) {
      project = {
        projectId,
        projectPath,
        name: path.basename(projectPath),
        languages: [],
        frameworks: [],
        conventions: [],
        memories: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.projects.set(projectId, project);
    }

    this.currentProjectId = projectId;
    await this.saveProject(project);

    this.emit('project:set', { project });

    return project;
  }

  /**
   * Save project
   */
  private async saveProject(project: ProjectMemory): Promise<void> {
    const projectPath = path.join(
      this.dataDir,
      'projects',
      `${project.projectId}.json`
    );
    await fs.writeJSON(projectPath, project, { spaces: 2 });
  }

  /**
   * Learn a code convention
   */
  async learnConvention(options: {
    type: CodeConvention['type'];
    rule: string;
    examples?: string[];
    confidence?: number;
  }): Promise<void> {
    await this.ready;
    if (!this.currentProjectId) return;

    const project = this.projects.get(this.currentProjectId);
    if (!project) return;

    // Check if convention already exists
    const existing = project.conventions.find(
      c => c.type === options.type && c.rule === options.rule
    );

    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      if (options.examples) {
        existing.examples = [...new Set([...(existing.examples || []), ...options.examples])];
      }
    } else {
      project.conventions.push({
        type: options.type,
        rule: options.rule,
        examples: options.examples,
        confidence: options.confidence || 0.5,
      });
    }

    project.updatedAt = new Date();
    await this.saveProject(project);

    this.emit('convention:learned', { convention: options });
  }

  /**
   * Store conversation summary
   */
  async storeSummary(options: {
    sessionId: string;
    summary: string;
    topics: string[];
    decisions?: string[];
    todos?: string[];
    messageCount: number;
  }): Promise<ConversationSummary> {
    await this.ready;
    const summary: ConversationSummary = {
      id: crypto.randomBytes(8).toString('hex'),
      sessionId: options.sessionId,
      summary: options.summary,
      topics: options.topics,
      decisions: options.decisions || [],
      todos: options.todos || [],
      timestamp: new Date(),
      messageCount: options.messageCount,
    };

    this.summaries.push(summary);

    // Keep only last 100 summaries
    if (this.summaries.length > 100) {
      this.summaries = this.summaries.slice(-100);
    }

    await this.saveAll();

    // Also store as memory
    await this.store({
      type: 'summary',
      content: options.summary,
      tags: options.topics,
      metadata: {
        decisions: options.decisions,
        todos: options.todos,
      },
      sessionId: options.sessionId,
    });

    this.emit('summary:stored', { summary });

    return summary;
  }

  /**
   * Update user profile
   */
  async updateUserProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    await this.ready;
    if (!this.userProfile) {
      this.userProfile = {
        id: crypto.randomBytes(8).toString('hex'),
        preferences: {
          codeStyle: 'standard',
          verbosity: 'moderate',
        },
        skills: [],
        interests: [],
        history: {
          topLanguages: [],
          commonTasks: [],
          lastProjects: [],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    this.userProfile = {
      ...this.userProfile,
      ...updates,
      updatedAt: new Date(),
    };

    await this.saveAll();

    this.emit('profile:updated', { profile: this.userProfile });

    return this.userProfile;
  }

  /**
   * Get user profile
   */
  getUserProfile(): UserProfile | null {
    return this.userProfile;
  }

  /**
   * Get project memory
   */
  getProjectMemory(projectId?: string): ProjectMemory | null {
    const id = projectId || this.currentProjectId;
    return id ? this.projects.get(id) || null : null;
  }

  /**
   * Build context from memories
   */
  async buildContext(options: {
    maxTokens?: number;
    includeProject?: boolean;
    includePreferences?: boolean;
    includeRecentSummaries?: boolean;
    query?: string;
  } = {}): Promise<string> {
    await this.ready;
    const parts: string[] = [];

    // Add user preferences
    if (options.includePreferences && this.userProfile) {
      parts.push(`User preferences:\n${JSON.stringify(this.userProfile.preferences, null, 2)}`);
    }

    // Add project context
    if (options.includeProject && this.currentProjectId) {
      const project = this.projects.get(this.currentProjectId);
      if (project) {
        parts.push(`\nProject: ${project.name}`);
        if (project.languages.length > 0) {
          parts.push(`Languages: ${project.languages.join(', ')}`);
        }
        if (project.conventions.length > 0) {
          parts.push('Conventions:');
          for (const conv of project.conventions.slice(0, 5)) {
            parts.push(`- ${conv.rule}`);
          }
        }
      }
    }

    // Add recent summaries
    if (options.includeRecentSummaries) {
      const recentSummaries = this.summaries.slice(-3);
      if (recentSummaries.length > 0) {
        parts.push('\nRecent conversation context:');
        for (const summary of recentSummaries) {
          parts.push(`- ${summary.summary}`);
        }
      }
    }

    // Add relevant memories
    const memories = await this.recall({
      query: options.query,
      limit: 10,
      minImportance: 0.5,
    });

    if (memories.length > 0) {
      parts.push('\nRelevant memories:');
      for (const memory of memories) {
        parts.push(`- [${memory.type}] ${memory.summary || memory.content.slice(0, 100)}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Get stats
   */
  getStats(): {
    totalMemories: number;
    byType: Record<MemoryType, number>;
    projects: number;
    summaries: number;
  } {
    const byType: Record<string, number> = {};

    for (const memory of this.memories.values()) {
      byType[memory.type] = (byType[memory.type] || 0) + 1;
    }

    return {
      totalMemories: this.memories.size,
      byType: byType as Record<MemoryType, number>,
      projects: this.projects.size,
      summaries: this.summaries.length,
    };
  }

  /**
   * Format status
   */
  formatStatus(): string {
    const stats = this.getStats();

    const lines = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║                    🧠 MEMORY SYSTEM                          ║',
      '╠══════════════════════════════════════════════════════════════╣',
      `║ Total Memories: ${stats.totalMemories.toString().padEnd(43)}║`,
      `║ Projects:       ${stats.projects.toString().padEnd(43)}║`,
      `║ Summaries:      ${stats.summaries.toString().padEnd(43)}║`,
      '╠══════════════════════════════════════════════════════════════╣',
      '║ MEMORIES BY TYPE                                             ║',
    ];

    for (const [type, count] of Object.entries(stats.byType)) {
      lines.push(`║   ${type.padEnd(15)} ${count.toString().padEnd(40)}║`);
    }

    const project = this.getProjectMemory();
    if (project) {
      lines.push('╠══════════════════════════════════════════════════════════════╣');
      lines.push(`║ Current Project: ${project.name.slice(0, 40).padEnd(40)}║`);
      lines.push(`║ Conventions:     ${project.conventions.length.toString().padEnd(40)}║`);
    }

    lines.push('╠══════════════════════════════════════════════════════════════╣');
    lines.push('║ /memory store | /memory recall | /memory forget              ║');
    lines.push('╚══════════════════════════════════════════════════════════════╝');

    return lines.join('\n');
  }

  /**
   * Clear all memories
   */
  async clear(): Promise<void> {
    await this.ready;
    this.memories.clear();
    this.summaries = [];
    await this.saveAll();
    this.emit('memory:cleared');
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.disposed = true;
    // Clear decay interval timer
    if (this.decayIntervalId) {
      clearInterval(this.decayIntervalId);
      this.decayIntervalId = null;
    }
    // Fire-and-forget by contract (dispose() is sync), but never let a late write
    // surface as an unhandled rejection — e.g. a test that removes the data dir
    // right after dispose() (ENOENT on bayesian-state.json) turned the whole
    // vitest run red on CI.
    void this.saveAll().catch((err) => {
      logger.debug('enhanced-memory: saveAll on dispose failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    this.memories.clear();
    this.projects.clear();
    this.summaries = [];
    this.removeAllListeners();
  }

  private extractMemoryFeatures(entry: MemoryEntry, queryEmbedding?: number[]): number[] {
    const sim = (queryEmbedding && entry.embedding)
      ? this.cosineSimilarity(queryEmbedding, entry.embedding)
      : 0.0;

    const importance = entry.importance || 0.0;
    const accessCount = entry.accessCount || 0;
    const ageInDays = (Date.now() - new Date(entry.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    const recency = Math.exp(-ageInDays * 0.01);
    const length = entry.content.length / 10000;

    return [sim, importance, accessCount, recency, length];
  }

  /**
   * Qualify a memory as approved or rejected (Active Learning labeling)
   */
  async qualifyMemory(entry: MemoryEntry, approved: boolean, query?: string): Promise<void> {
    await this.ready;
    const queryEmbedding = query ? await this.generateEmbedding(query) : undefined;
    const features = this.extractMemoryFeatures(entry, queryEmbedding);
    this.bayesianQualifier.addSample(features, approved ? 1 : 0);
    this.bayesianQualifier.train();
    await this.saveAll();
  }

  /**
   * Predict the relevance score of a memory
   */
  predictRelevance(entry: MemoryEntry, queryEmbedding?: number[]): { score: number; uncertainty: number } {
    const features = this.extractMemoryFeatures(entry, queryEmbedding);
    const { mean, std } = this.bayesianQualifier.predict(features);
    return { score: mean, uncertainty: std };
  }

  /**
   * Active Learning: Retrieve memories with the highest uncertainty (BALD score)
   * so the system can solicit user feedback and improve its relevance model.
   */
  async getActiveLearningTargets(limit: number = 5, query?: string): Promise<{
    memory: MemoryEntry; baldScore: number }[]> {
    await this.ready;
    if (!this.bayesianQualifier || !(this.bayesianQualifier as any).isTrained) {
      return [];
    }

    const queryEmbedding = query && this.config.embeddingEnabled
      ? await this.generateEmbedding(query)
      : undefined;

    const allMemories = Array.from(this.memories.values());
    
    return allMemories
      .map(m => {
        const features = this.extractMemoryFeatures(m, queryEmbedding);
        const baldScore = this.bayesianQualifier.getAcquisitionScore(features);
        return { memory: m, baldScore };
      })
      // Only keep entries with non-trivial uncertainty
      .filter(r => r.baldScore > 0.01)
      .sort((a, b) => b.baldScore - a.baldScore)
      .slice(0, limit);
  }
}

// Singleton
let memoryInstance: EnhancedMemory | null = null;

export function getEnhancedMemory(config?: Partial<MemoryConfig>): EnhancedMemory {
  if (!memoryInstance) {
    memoryInstance = new EnhancedMemory(config);
  }
  return memoryInstance;
}

export function resetEnhancedMemory(): void {
  if (memoryInstance) {
    memoryInstance.dispose();
  }
  memoryInstance = null;
}
