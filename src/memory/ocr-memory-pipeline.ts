/**
 * OCR -> Memory Pipeline
 *
 * Extracts text from screenshots/images via Tesseract.js, generates
 * multimodal embeddings, and stores entries for semantic search.
 * Index is persisted to `.codebuddy/memory/ocr-index.json`.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

// ============================================================================
// Types
// ============================================================================

export interface OCRMemoryEntry {
  id: string;
  sourcePath: string;
  extractedText: string;
  embedding?: number[];
  timestamp: number;
  metadata: {
    width?: number;
    height?: number;
    ocrConfidence?: number;
    sourceType: 'screenshot' | 'image' | 'pdf';
  };
}

interface OCRIndex {
  version: number;
  entries: OCRMemoryEntry[];
}

// ============================================================================
// Constants
// ============================================================================

const INDEX_VERSION = 1;
const DEFAULT_INDEX_PATH = path.join(
  process.cwd(),
  '.codebuddy',
  'memory',
  'ocr-index.json'
);
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp',
]);
const MAX_TEXT_LENGTH = 50000;

// ============================================================================
// Pipeline
// ============================================================================

export class OCRMemoryPipeline {
  private entries: Map<string, OCRMemoryEntry> = new Map();
  private indexPath: string;
  private loaded = false;

  constructor(indexPath?: string) {
    this.indexPath = indexPath || DEFAULT_INDEX_PATH;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Process an image file: OCR -> embed -> store.
   */
  async processImage(imagePath: string): Promise<OCRMemoryEntry> {
    this.ensureLoaded();

    const absPath = path.resolve(imagePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Image file not found: ${absPath}`);
    }

    const ext = path.extname(absPath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) {
      throw new Error(`Unsupported image format: ${ext}`);
    }

    // Check if already indexed (by path)
    const existing = this.findByPath(absPath);
    if (existing) {
      const stat = fs.statSync(absPath);
      // If file hasn't changed, return cached entry
      if (stat.mtimeMs <= existing.timestamp) {
        logger.debug('OCR entry already indexed', { path: absPath });
        return existing;
      }
    }

    logger.info('Processing image for OCR memory', { path: absPath });

    // 1. Run OCR (lazy import to avoid loading Tesseract upfront)
    let extractedText = '';
    let ocrConfidence: number | undefined;
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      const { data } = await worker.recognize(absPath);
      extractedText = data.text.trim().slice(0, MAX_TEXT_LENGTH);
      ocrConfidence = data.confidence;
      await worker.terminate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('OCR extraction failed, storing entry with empty text', {
        error: msg,
        path: absPath,
      });
    }

    // 2. Generate embedding (multimodal if available, else text-only)
    let embedding: number[] | undefined;
    try {
      embedding = await this.generateEmbedding(absPath, extractedText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug('Embedding generation skipped', { error: msg });
    }

    // 3. Detect source type
    const sourceType = this.inferSourceType(absPath);

    // 4. Build entry
    const entry: OCRMemoryEntry = {
      id: crypto.randomUUID(),
      sourcePath: absPath,
      extractedText,
      embedding,
      timestamp: Date.now(),
      metadata: {
        ocrConfidence,
        sourceType,
      },
    };

    // 5. Store & persist
    this.entries.set(entry.id, entry);
    this.save();

    logger.info('OCR memory entry created', {
      id: entry.id,
      textLength: extractedText.length,
      hasEmbedding: !!embedding,
    });

    return entry;
  }

  /**
   * Process all screenshots in `.codebuddy/screenshots/`.
   */
  async processScreenshots(): Promise<OCRMemoryEntry[]> {
    const screenshotsDir = path.join(process.cwd(), '.codebuddy', 'screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      logger.debug('No screenshots directory found');
      return [];
    }

    const files = fs.readdirSync(screenshotsDir).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext);
    });

    logger.info(`Processing ${files.length} screenshots for OCR memory`);

    const results: OCRMemoryEntry[] = [];
    for (const file of files) {
      try {
        const entry = await this.processImage(path.join(screenshotsDir, file));
        results.push(entry);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('Failed to process screenshot', { file, error: msg });
      }
    }

    return results;
  }

  /**
   * Search stored OCR entries by text similarity.
   * Uses embedding cosine similarity when available, falls back to substring match.
   */
  async search(query: string, limit: number = 10): Promise<OCRMemoryEntry[]> {
    this.ensureLoaded();

    const allEntries = Array.from(this.entries.values());
    if (allEntries.length === 0) return [];

    // Try embedding-based search first
    let queryEmbedding: number[] | undefined;
    try {
      const { getMultimodalEmbeddingProvider } = await import(
        '../embeddings/multimodal-embedding-provider.js'
      );
      const provider = getMultimodalEmbeddingProvider();
      if (provider) {
        queryEmbedding = await provider.embedText(query);
      }
    } catch {
      // Fall through to text search
    }

    if (queryEmbedding) {
      // Cosine similarity search
      const scored = allEntries
        .filter((e) => e.embedding && e.embedding.length > 0)
        .map((entry) => ({
          entry,
          score: cosineSimilarity(queryEmbedding!, entry.embedding!),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      if (scored.length > 0) {
        return scored.map((s) => s.entry);
      }
    }

    // Fallback: case-insensitive substring matching with simple scoring
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2);

    const scored = allEntries
      .map((entry) => {
        const text = entry.extractedText.toLowerCase();
        let score = 0;
        for (const term of queryTerms) {
          if (text.includes(term)) {
            score += 1;
          }
        }
        // Bonus for exact phrase match
        if (text.includes(queryLower)) {
          score += queryTerms.length;
        }
        return { entry, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((s) => s.entry);
  }

  /**
   * Get a single entry by ID.
   */
  getEntry(id: string): OCRMemoryEntry | undefined {
    this.ensureLoaded();
    return this.entries.get(id);
  }

  /**
   * Get all stored entries.
   */
  getAllEntries(): OCRMemoryEntry[] {
    this.ensureLoaded();
    return Array.from(this.entries.values());
  }

  /**
   * Remove an entry by ID.
   */
  removeEntry(id: string): boolean {
    this.ensureLoaded();
    const deleted = this.entries.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries.clear();
    this.save();
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.load();
    this.loaded = true;
  }

  private load(): void {
    try {
      const data = readJsonAtomicSync<OCRIndex>(this.indexPath, {
        version: INDEX_VERSION,
        entries: [],
      }, {
        mode: 0o600,
        isValid: (value): value is OCRIndex => Boolean(
          value && typeof value === 'object'
            && (value as { version?: unknown }).version === INDEX_VERSION
            && Array.isArray((value as { entries?: unknown }).entries),
        ),
      });
      for (const entry of data.entries) {
        this.entries.set(entry.id, entry);
      }
      if (this.entries.size > 0) {
        logger.debug(`Loaded ${this.entries.size} OCR memory entries`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug('Failed to load OCR index', { error: msg });
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.indexPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: OCRIndex = {
        version: INDEX_VERSION,
        entries: Array.from(this.entries.values()),
      };
      writeJsonAtomicSync(this.indexPath, data, { mode: 0o600 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to save OCR index', { error: msg });
    }
  }

  private findByPath(absPath: string): OCRMemoryEntry | undefined {
    const entries = Array.from(this.entries.values());
    for (const entry of entries) {
      if (entry.sourcePath === absPath) return entry;
    }
    return undefined;
  }

  private async generateEmbedding(
    imagePath: string,
    extractedText: string
  ): Promise<number[] | undefined> {
    // Try multimodal (image) embedding first
    try {
      const { getMultimodalEmbeddingProvider } = await import(
        '../embeddings/multimodal-embedding-provider.js'
      );
      const provider = getMultimodalEmbeddingProvider();
      if (provider) {
        const imageBuffer = fs.readFileSync(imagePath);
        const base64 = imageBuffer.toString('base64');
        const ext = path.extname(imagePath).toLowerCase();
        const mimeType =
          ext === '.png'
            ? 'image/png'
            : ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : ext === '.gif'
                ? 'image/gif'
                : ext === '.webp'
                  ? 'image/webp'
                  : 'image/png';
        return await provider.embedImage(base64, mimeType);
      }
    } catch {
      // Fall through to text embedding
    }

    // Fall back to text-only embedding if we have extracted text
    if (extractedText.length > 0) {
      try {
        const { getEmbeddingProvider } = await import(
          '../embeddings/embedding-provider.js'
        );
        const provider = getEmbeddingProvider();
        await provider.initialize();
        const result = await provider.embed(extractedText);
        return Array.from(result.embedding);
      } catch {
        // No embedding available
      }
    }

    return undefined;
  }

  private inferSourceType(
    filePath: string
  ): 'screenshot' | 'image' | 'pdf' {
    const lower = filePath.toLowerCase();
    if (lower.includes('screenshot') || lower.includes('screencap')) {
      return 'screenshot';
    }
    if (lower.endsWith('.pdf')) {
      return 'pdf';
    }
    return 'image';
  }
}

// ============================================================================
// Utility: Cosine Similarity
// ============================================================================

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined || bi === undefined) continue;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: OCRMemoryPipeline | null = null;

export function getOCRMemoryPipeline(): OCRMemoryPipeline {
  if (!_instance) {
    _instance = new OCRMemoryPipeline();
  }
  return _instance;
}

export function resetOCRMemoryPipeline(): void {
  _instance = null;
}
