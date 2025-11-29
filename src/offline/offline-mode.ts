/**
 * Offline Mode System
 *
 * Features:
 * - Response caching for offline use
 * - Local LLM fallback (Ollama, llama.cpp)
 * - Embedding cache for semantic search
 * - Queue requests when offline
 * - Automatic sync when back online
 * - Offline-capable tools
 *
 * Allows Grok CLI to function without internet connectivity.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import axios from 'axios';
import { spawn, ChildProcess } from 'child_process';

export interface OfflineConfig {
  enabled: boolean;
  cacheEnabled: boolean;
  cacheMaxSize: number; // MB
  cacheMaxAge: number; // days
  localLLMEnabled: boolean;
  localLLMProvider: 'ollama' | 'llamacpp' | 'none';
  localLLMModel: string;
  localLLMEndpoint?: string;
  embeddingCacheEnabled: boolean;
  queueRequestsWhenOffline: boolean;
  autoSyncOnReconnect: boolean;
  checkInternetInterval: number;
}

export interface CachedResponse {
  id: string;
  query: string;
  queryHash: string;
  response: string;
  model: string;
  tokensUsed: number;
  createdAt: Date;
  accessedAt: Date;
  accessCount: number;
  similarity?: number;
}

export interface CachedEmbedding {
  id: string;
  text: string;
  textHash: string;
  embedding: number[];
  model: string;
  createdAt: Date;
}

export interface QueuedRequest {
  id: string;
  type: 'chat' | 'embedding' | 'tool';
  payload: any;
  createdAt: Date;
  retries: number;
  priority: number;
}

export interface OfflineStats {
  cacheHits: number;
  cacheMisses: number;
  localLLMCalls: number;
  queuedRequests: number;
  cacheSize: number;
  isOnline: boolean;
  lastOnline?: Date;
}

const DEFAULT_CONFIG: OfflineConfig = {
  enabled: true,
  cacheEnabled: true,
  cacheMaxSize: 500, // 500 MB
  cacheMaxAge: 30, // 30 days
  localLLMEnabled: true,
  localLLMProvider: 'ollama',
  localLLMModel: 'llama3.2',
  embeddingCacheEnabled: true,
  queueRequestsWhenOffline: true,
  autoSyncOnReconnect: true,
  checkInternetInterval: 30000, // 30 seconds
};

/**
 * Offline Mode Manager
 */
export class OfflineMode extends EventEmitter {
  private config: OfflineConfig;
  private dataDir: string;
  private cacheDir: string;
  private responseCache: Map<string, CachedResponse> = new Map();
  private embeddingCache: Map<string, CachedEmbedding> = new Map();
  private requestQueue: QueuedRequest[] = [];
  private isOnline: boolean = true;
  private lastOnline: Date = new Date();
  private stats: OfflineStats;
  private checkInternetTimer: NodeJS.Timeout | null = null;
  private localLLMProcess: ChildProcess | null = null;

  constructor(config: Partial<OfflineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dataDir = path.join(os.homedir(), '.grok', 'offline');
    this.cacheDir = path.join(this.dataDir, 'cache');
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      localLLMCalls: 0,
      queuedRequests: 0,
      cacheSize: 0,
      isOnline: true,
    };
    this.initialize();
  }

  /**
   * Initialize offline mode
   */
  private async initialize(): Promise<void> {
    await fs.ensureDir(this.dataDir);
    await fs.ensureDir(this.cacheDir);
    await fs.ensureDir(path.join(this.cacheDir, 'responses'));
    await fs.ensureDir(path.join(this.cacheDir, 'embeddings'));

    await this.loadCaches();
    await this.loadQueue();

    this.isOnline = await this.checkInternet();
    this.startInternetCheck();
  }

  /**
   * Load caches from disk
   */
  private async loadCaches(): Promise<void> {
    // Load response cache index
    const indexPath = path.join(this.cacheDir, 'response-index.json');
    if (await fs.pathExists(indexPath)) {
      try {
        const index = await fs.readJSON(indexPath);
        for (const item of index) {
          this.responseCache.set(item.queryHash, item);
        }
      } catch {
        // Start fresh
      }
    }

    // Load embedding cache index
    const embIndexPath = path.join(this.cacheDir, 'embedding-index.json');
    if (await fs.pathExists(embIndexPath)) {
      try {
        const index = await fs.readJSON(embIndexPath);
        for (const item of index) {
          this.embeddingCache.set(item.textHash, item);
        }
      } catch {
        // Start fresh
      }
    }

    // Calculate cache size
    await this.calculateCacheSize();
  }

  /**
   * Load request queue
   */
  private async loadQueue(): Promise<void> {
    const queuePath = path.join(this.dataDir, 'queue.json');
    if (await fs.pathExists(queuePath)) {
      try {
        this.requestQueue = await fs.readJSON(queuePath);
        this.stats.queuedRequests = this.requestQueue.length;
      } catch {
        this.requestQueue = [];
      }
    }
  }

  /**
   * Save request queue
   */
  private async saveQueue(): Promise<void> {
    const queuePath = path.join(this.dataDir, 'queue.json');
    await fs.writeJSON(queuePath, this.requestQueue, { spaces: 2 });
  }

  /**
   * Save cache indexes
   */
  private async saveCacheIndexes(): Promise<void> {
    await fs.writeJSON(
      path.join(this.cacheDir, 'response-index.json'),
      Array.from(this.responseCache.values()),
      { spaces: 2 }
    );

    await fs.writeJSON(
      path.join(this.cacheDir, 'embedding-index.json'),
      Array.from(this.embeddingCache.values()),
      { spaces: 2 }
    );
  }

  /**
   * Calculate cache size
   */
  private async calculateCacheSize(): Promise<void> {
    let size = 0;

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          const stat = await fs.stat(fullPath);
          size += stat.size;
        }
      }
    };

    await walk(this.cacheDir);
    this.stats.cacheSize = size;
  }

  /**
   * Check internet connectivity
   */
  async checkInternet(): Promise<boolean> {
    try {
      await axios.get('https://api.x.ai/health', {
        timeout: 5000,
      });
      return true;
    } catch {
      try {
        // Fallback check
        await axios.get('https://www.google.com/generate_204', {
          timeout: 5000,
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Start internet connectivity checker
   */
  private startInternetCheck(): void {
    this.checkInternetTimer = setInterval(async () => {
      const wasOnline = this.isOnline;
      this.isOnline = await this.checkInternet();
      this.stats.isOnline = this.isOnline;

      if (!wasOnline && this.isOnline) {
        this.lastOnline = new Date();
        this.stats.lastOnline = this.lastOnline;
        this.emit('online');

        if (this.config.autoSyncOnReconnect) {
          this.processQueue();
        }
      } else if (wasOnline && !this.isOnline) {
        this.emit('offline');
      }
    }, this.config.checkInternetInterval);
  }

  /**
   * Hash a string for cache lookup
   */
  private hash(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  /**
   * Cache a response
   */
  async cacheResponse(query: string, response: string, model: string, tokensUsed: number): Promise<void> {
    if (!this.config.cacheEnabled) return;

    const queryHash = this.hash(query);
    const id = crypto.randomBytes(8).toString('hex');

    const cached: CachedResponse = {
      id,
      query,
      queryHash,
      response,
      model,
      tokensUsed,
      createdAt: new Date(),
      accessedAt: new Date(),
      accessCount: 1,
    };

    // Save response to file
    const responsePath = path.join(this.cacheDir, 'responses', `${id}.json`);
    await fs.writeJSON(responsePath, cached, { spaces: 2 });

    this.responseCache.set(queryHash, cached);
    await this.saveCacheIndexes();

    // Check cache size and cleanup if needed
    await this.cleanupCacheIfNeeded();
  }

  /**
   * Get cached response
   */
  async getCachedResponse(query: string): Promise<CachedResponse | null> {
    if (!this.config.cacheEnabled) return null;

    const queryHash = this.hash(query);
    const cached = this.responseCache.get(queryHash);

    if (cached) {
      // Check if expired
      const age = Date.now() - new Date(cached.createdAt).getTime();
      const maxAge = this.config.cacheMaxAge * 24 * 60 * 60 * 1000;

      if (age > maxAge) {
        await this.removeCachedResponse(queryHash);
        this.stats.cacheMisses++;
        return null;
      }

      // Update access stats
      cached.accessedAt = new Date();
      cached.accessCount++;
      this.stats.cacheHits++;

      return cached;
    }

    this.stats.cacheMisses++;
    return null;
  }

  /**
   * Find similar cached responses using embedding similarity
   */
  async findSimilarResponses(query: string, threshold: number = 0.85): Promise<CachedResponse[]> {
    if (!this.config.embeddingCacheEnabled) return [];

    // Get or compute query embedding
    const queryEmbedding = await this.getEmbedding(query);
    if (!queryEmbedding) return [];

    const similar: CachedResponse[] = [];

    for (const cached of this.responseCache.values()) {
      // Get cached query embedding
      const cachedEmbedding = this.embeddingCache.get(this.hash(cached.query));
      if (cachedEmbedding) {
        const similarity = this.cosineSimilarity(queryEmbedding, cachedEmbedding.embedding);
        if (similarity >= threshold) {
          similar.push({ ...cached, similarity });
        }
      }
    }

    return similar.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
  }

  /**
   * Cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Cache an embedding
   */
  async cacheEmbedding(text: string, embedding: number[], model: string): Promise<void> {
    if (!this.config.embeddingCacheEnabled) return;

    const textHash = this.hash(text);
    const id = crypto.randomBytes(8).toString('hex');

    const cached: CachedEmbedding = {
      id,
      text,
      textHash,
      embedding,
      model,
      createdAt: new Date(),
    };

    // Save embedding to file
    const embPath = path.join(this.cacheDir, 'embeddings', `${id}.json`);
    await fs.writeJSON(embPath, cached);

    this.embeddingCache.set(textHash, cached);
    await this.saveCacheIndexes();
  }

  /**
   * Get cached embedding
   */
  async getEmbedding(text: string): Promise<number[] | null> {
    const textHash = this.hash(text);
    const cached = this.embeddingCache.get(textHash);
    return cached?.embedding || null;
  }

  /**
   * Remove cached response
   */
  private async removeCachedResponse(queryHash: string): Promise<void> {
    const cached = this.responseCache.get(queryHash);
    if (cached) {
      const responsePath = path.join(this.cacheDir, 'responses', `${cached.id}.json`);
      await fs.remove(responsePath);
      this.responseCache.delete(queryHash);
    }
  }

  /**
   * Cleanup cache if needed
   */
  private async cleanupCacheIfNeeded(): Promise<void> {
    await this.calculateCacheSize();

    const maxSizeBytes = this.config.cacheMaxSize * 1024 * 1024;
    if (this.stats.cacheSize <= maxSizeBytes) return;

    // Sort by access time (LRU)
    const sorted = Array.from(this.responseCache.values())
      .sort((a, b) => new Date(a.accessedAt).getTime() - new Date(b.accessedAt).getTime());

    // Remove oldest until under limit
    for (const cached of sorted) {
      await this.removeCachedResponse(cached.queryHash);
      await this.calculateCacheSize();

      if (this.stats.cacheSize <= maxSizeBytes * 0.8) {
        break;
      }
    }

    await this.saveCacheIndexes();
    this.emit('cache:cleaned');
  }

  /**
   * Queue a request for later processing
   */
  queueRequest(type: QueuedRequest['type'], payload: any, priority: number = 0): string {
    if (!this.config.queueRequestsWhenOffline) {
      throw new Error('Request queuing is disabled');
    }

    const request: QueuedRequest = {
      id: crypto.randomBytes(8).toString('hex'),
      type,
      payload,
      createdAt: new Date(),
      retries: 0,
      priority,
    };

    this.requestQueue.push(request);
    this.requestQueue.sort((a, b) => b.priority - a.priority);
    this.stats.queuedRequests = this.requestQueue.length;

    this.saveQueue();
    this.emit('request:queued', { request });

    return request.id;
  }

  /**
   * Process queued requests
   */
  async processQueue(): Promise<void> {
    if (!this.isOnline) return;

    this.emit('queue:processing');

    const toProcess = [...this.requestQueue];
    this.requestQueue = [];

    for (const request of toProcess) {
      try {
        await this.processRequest(request);
        this.emit('request:processed', { request });
      } catch (error) {
        request.retries++;
        if (request.retries < 3) {
          this.requestQueue.push(request);
        } else {
          this.emit('request:failed', { request, error });
        }
      }
    }

    this.stats.queuedRequests = this.requestQueue.length;
    await this.saveQueue();
    this.emit('queue:processed');
  }

  /**
   * Process a single request
   */
  private async processRequest(request: QueuedRequest): Promise<any> {
    // This would integrate with the main Grok client
    // For now, just emit an event
    this.emit('request:execute', { request });
    return null;
  }

  /**
   * Call local LLM
   */
  async callLocalLLM(prompt: string, options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  } = {}): Promise<string | null> {
    if (!this.config.localLLMEnabled) return null;

    const model = options.model || this.config.localLLMModel;

    try {
      switch (this.config.localLLMProvider) {
        case 'ollama':
          return this.callOllama(prompt, model, options);
        case 'llamacpp':
          return this.callLlamaCpp(prompt, model, options);
        default:
          return null;
      }
    } catch (error) {
      this.emit('localLLM:error', { error });
      return null;
    }
  }

  /**
   * Call Ollama API
   */
  private async callOllama(prompt: string, model: string, options: any): Promise<string> {
    const endpoint = this.config.localLLMEndpoint || 'http://localhost:11434';

    const response = await axios.post(`${endpoint}/api/generate`, {
      model,
      prompt,
      stream: false,
      options: {
        num_predict: options.maxTokens || 2048,
        temperature: options.temperature || 0.7,
      },
    }, {
      timeout: 60000,
    });

    this.stats.localLLMCalls++;
    return response.data.response;
  }

  /**
   * Call llama.cpp server
   */
  private async callLlamaCpp(prompt: string, model: string, options: any): Promise<string> {
    const endpoint = this.config.localLLMEndpoint || 'http://localhost:8080';

    const response = await axios.post(`${endpoint}/completion`, {
      prompt,
      n_predict: options.maxTokens || 2048,
      temperature: options.temperature || 0.7,
    }, {
      timeout: 60000,
    });

    this.stats.localLLMCalls++;
    return response.data.content;
  }

  /**
   * Check if local LLM is available
   */
  async isLocalLLMAvailable(): Promise<boolean> {
    if (!this.config.localLLMEnabled) return false;

    try {
      switch (this.config.localLLMProvider) {
        case 'ollama': {
          const endpoint = this.config.localLLMEndpoint || 'http://localhost:11434';
          await axios.get(`${endpoint}/api/tags`, { timeout: 2000 });
          return true;
        }
        case 'llamacpp': {
          const endpoint = this.config.localLLMEndpoint || 'http://localhost:8080';
          await axios.get(`${endpoint}/health`, { timeout: 2000 });
          return true;
        }
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Get available local models
   */
  async getLocalModels(): Promise<string[]> {
    try {
      if (this.config.localLLMProvider === 'ollama') {
        const endpoint = this.config.localLLMEndpoint || 'http://localhost:11434';
        const response = await axios.get(`${endpoint}/api/tags`, { timeout: 5000 });
        return response.data.models?.map((m: any) => m.name) || [];
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Get stats
   */
  getStats(): OfflineStats {
    return { ...this.stats, isOnline: this.isOnline };
  }

  /**
   * Get config
   */
  getConfig(): OfflineConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<OfflineConfig>): void {
    this.config = { ...this.config, ...config };
    this.saveConfig();
  }

  /**
   * Save config
   */
  private async saveConfig(): Promise<void> {
    const configPath = path.join(this.dataDir, 'config.json');
    await fs.writeJSON(configPath, this.config, { spaces: 2 });
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<void> {
    await fs.emptyDir(path.join(this.cacheDir, 'responses'));
    await fs.emptyDir(path.join(this.cacheDir, 'embeddings'));
    this.responseCache.clear();
    this.embeddingCache.clear();
    await this.saveCacheIndexes();
    await this.calculateCacheSize();
    this.emit('cache:cleared');
  }

  /**
   * Clear queue
   */
  async clearQueue(): Promise<void> {
    this.requestQueue = [];
    this.stats.queuedRequests = 0;
    await this.saveQueue();
    this.emit('queue:cleared');
  }

  /**
   * Format status
   */
  formatStatus(): string {
    const stats = this.getStats();
    const cacheHitRate = stats.cacheHits + stats.cacheMisses > 0
      ? ((stats.cacheHits / (stats.cacheHits + stats.cacheMisses)) * 100).toFixed(1)
      : '0.0';

    const lines = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║                     📴 OFFLINE MODE                          ║',
      '╠══════════════════════════════════════════════════════════════╣',
      `║ Status:          ${stats.isOnline ? '🟢 Online' : '🔴 Offline'}                              ║`,
      `║ Cache Enabled:   ${this.config.cacheEnabled ? '✅' : '❌'}                                       ║`,
      `║ Local LLM:       ${this.config.localLLMEnabled ? '✅ ' + this.config.localLLMProvider : '❌ Disabled'}                    ║`,
      '╠══════════════════════════════════════════════════════════════╣',
      '║ CACHE STATS                                                  ║',
      `║ Size:            ${(stats.cacheSize / 1024 / 1024).toFixed(1)} MB / ${this.config.cacheMaxSize} MB                        ║`,
      `║ Responses:       ${this.responseCache.size}                                          ║`,
      `║ Embeddings:      ${this.embeddingCache.size}                                          ║`,
      `║ Hit Rate:        ${cacheHitRate}%                                        ║`,
      '╠══════════════════════════════════════════════════════════════╣',
      `║ Queued Requests: ${stats.queuedRequests}                                           ║`,
      `║ Local LLM Calls: ${stats.localLLMCalls}                                           ║`,
      '╠══════════════════════════════════════════════════════════════╣',
      '║ /offline cache clear | /offline queue process                ║',
      '╚══════════════════════════════════════════════════════════════╝',
    ];

    return lines.join('\n');
  }

  /**
   * Dispose
   */
  dispose(): void {
    if (this.checkInternetTimer) {
      clearInterval(this.checkInternetTimer);
    }
    if (this.localLLMProcess) {
      this.localLLMProcess.kill();
    }
    this.saveCacheIndexes();
    this.saveQueue();
    this.removeAllListeners();
  }
}

// Singleton
let offlineModeInstance: OfflineMode | null = null;

export function getOfflineMode(config?: Partial<OfflineConfig>): OfflineMode {
  if (!offlineModeInstance) {
    offlineModeInstance = new OfflineMode(config);
  }
  return offlineModeInstance;
}

export function resetOfflineMode(): void {
  if (offlineModeInstance) {
    offlineModeInstance.dispose();
  }
  offlineModeInstance = null;
}
