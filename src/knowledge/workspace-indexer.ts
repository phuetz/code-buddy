/**
 * Workspace Indexer (Background Semantic Mapping)
 *
 * Implements a continuous background service that scans the workspace,
 * chunks file contents, computes vector embeddings, and persists them
 * using USearch. This enables instant, massive-scale semantic search
 * over the entire codebase, bypassing the limitations of context windows.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import glob from 'fast-glob';
import { EmbeddingProvider } from '../embeddings/embedding-provider.js';

// Fallback brute-force index if USearch is not available
class BruteForceIndex {
  private vectors: Map<number, number[]> = new Map();

  constructor(private dim: number) {}

  add(id: number, vector: number[] | Float32Array): void {
    this.vectors.set(id, Array.from(vector));
  }

  search(query: number[] | Float32Array, k: number): Array<{ id: number; score: number }> {
    const scores: Array<{ id: number; score: number }> = [];
    const queryArr = Array.from(query);

    for (const [id, vec] of this.vectors) {
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < this.dim; i++) {
        dot += queryArr[i] * vec[i];
        normA += queryArr[i] * queryArr[i];
        normB += vec[i] * vec[i];
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      const similarity = denom > 0 ? dot / denom : 0;
      scores.push({ id, score: similarity });
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, k);
  }
  
  save(filePath: string): void {
      fs.writeFileSync(filePath, JSON.stringify(Array.from(this.vectors.entries())));
  }
  
  load(filePath: string): void {
      if (fs.existsSync(filePath)) {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          this.vectors = new Map(data);
      }
  }
}

export interface WorkspaceIndexerConfig {
  workspaceRoot: string;
  indexPath: string;
  chunkSize: number;
  chunkOverlap: number;
  filePatterns: string[];
  ignorePatterns: string[];
}

const DEFAULT_CONFIG: WorkspaceIndexerConfig = {
  workspaceRoot: process.cwd(),
  indexPath: path.join(process.cwd(), '.codebuddy', 'index', 'workspace.bin'),
  chunkSize: 1000,
  chunkOverlap: 200,
  filePatterns: ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx', '**/*.py', '**/*.go', '**/*.rs', '**/*.md', '**/*.json'],
  ignorePatterns: ['node_modules/**', 'dist/**', '.git/**', 'build/**', '.codebuddy/**'],
};

export interface IndexEntry {
  id: number;
  filePath: string;
  chunkIndex: number;
  text: string;
}

export class WorkspaceIndexer extends EventEmitter {
  private config: WorkspaceIndexerConfig;
  private isIndexing = false;
  private vectorIndex: any = null;
  private entries: Map<number, IndexEntry> = new Map();
  private embeddingProvider: EmbeddingProvider | null = null;
  private nextId = 0;
  
  constructor(config?: Partial<WorkspaceIndexerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    try {
      this.embeddingProvider = new EmbeddingProvider();
      await this.embeddingProvider.initialize();
      
      const dim = 384; // MiniLM-L6-v2 dimension
      
      try {
        const { USearchVectorIndex } = await import('../search/usearch-index.js');
        this.vectorIndex = new USearchVectorIndex({ dimensions: dim });
      } catch {
        logger.debug('USearch not found, falling back to BruteForceIndex for Workspace');
        this.vectorIndex = new BruteForceIndex(dim);
      }
      
      await fs.ensureDir(path.dirname(this.config.indexPath));
      this.loadIndexMetadata();
      
    } catch (err) {
      this.embeddingProvider = null;
      this.vectorIndex = null;
      logger.error('Failed to initialize WorkspaceIndexer', { error: String(err) });
    }
  }
  
  private loadIndexMetadata() {
      const metaPath = this.config.indexPath + '.meta.json';
      if (fs.existsSync(metaPath)) {
          try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
              this.entries = new Map(meta.entries);
              this.nextId = meta.nextId;
              
              if (this.vectorIndex.load) {
                  this.vectorIndex.load(this.config.indexPath);
              }
              logger.info(`Loaded workspace index with ${this.entries.size} chunks.`);
          } catch (e) {
              logger.warn('Failed to load index metadata, starting fresh.');
          }
      }
  }
  
  private saveIndexMetadata() {
      const metaPath = this.config.indexPath + '.meta.json';
      const meta = {
          entries: Array.from(this.entries.entries()),
          nextId: this.nextId
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      if (this.vectorIndex.save) {
          this.vectorIndex.save(this.config.indexPath);
      }
  }

  async startIndexing(): Promise<void> {
    if (this.isIndexing || !this.embeddingProvider || !this.vectorIndex) return;
    this.isIndexing = true;
    this.emit('indexing:start');
    logger.info('Starting background workspace semantic indexing...');

    try {
      const files = await glob(this.config.filePatterns, {
        cwd: this.config.workspaceRoot,
        ignore: this.config.ignorePatterns,
        absolute: false,
      });

      let processedFiles = 0;
      let totalChunks = 0;

      // TODO: In a real implementation, we should diff mtimes to only index changed files.
      // For this PoC, we rebuild the index.
      this.entries.clear();
      this.nextId = 0;
      if (this.vectorIndex.clear) this.vectorIndex.clear();
      else if (this.vectorIndex instanceof BruteForceIndex) this.vectorIndex = new BruteForceIndex(384);

      for (const file of files) {
        const fullPath = path.join(this.config.workspaceRoot, file);
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const chunks = this.chunkText(content);
          
          if (chunks.length === 0) continue;
          
          const embeddings = await this.embeddingProvider.embedBatch(chunks);
          
          if (embeddings && embeddings.embeddings) {
              for (let i = 0; i < chunks.length; i++) {
                  const id = this.nextId++;
                  this.entries.set(id, {
                      id,
                      filePath: file,
                      chunkIndex: i,
                      text: chunks[i]
                  });
                  this.vectorIndex.add(id, embeddings.embeddings[i]);
                  totalChunks++;
              }
          }
          
          processedFiles++;
          
          // Yield to event loop to avoid blocking main agent thread
          if (processedFiles % 10 === 0) {
              await new Promise(r => setTimeout(r, 10));
          }
          
        } catch (fileErr) {
            // Skip unreadable files
        }
      }

      this.saveIndexMetadata();
      logger.info(`Workspace indexing complete: ${processedFiles} files, ${totalChunks} chunks.`);
      this.emit('indexing:complete', { files: processedFiles, chunks: totalChunks });
    } catch (err) {
      logger.error('Workspace indexing failed:', { error: String(err) });
      this.emit('indexing:error', err);
    } finally {
      this.isIndexing = false;
    }
  }

  private chunkText(text: string): string[] {
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + this.config.chunkSize));
      i += this.config.chunkSize - this.config.chunkOverlap;
    }
    return chunks;
  }

  async search(query: string, k: number = 5): Promise<Array<{ filePath: string; text: string; score: number }>> {
    if (!this.embeddingProvider || !this.vectorIndex || this.entries.size === 0) {
        return [];
    }

    try {
      const queryEmbedding = await this.embeddingProvider.embed(query);
      if (!queryEmbedding) return [];

      const results = this.vectorIndex.search(queryEmbedding, k);

      return results.map((r: { id: number; score: number }) => {
          const entry = this.entries.get(r.id);
          return {
            filePath: entry?.filePath || 'unknown',
            text: entry?.text || '',
            score: r.score,
          };
      });
    } catch (err) {
      logger.error('Semantic search failed:', { error: String(err) });
      return [];
    }
  }
}

// Singleton for easy access
let instance: WorkspaceIndexer | null = null;
export function getWorkspaceIndexer(): WorkspaceIndexer {
    if (!instance) {
        instance = new WorkspaceIndexer();
    }
    return instance;
}
