/**
 * Embedding Provider
 *
 * Provides text embeddings for semantic search.
 * Uses a simple TF-IDF based approach for local operation,
 * with optional support for external embedding APIs.
 */

import { EmbeddingProvider } from "./types.js";
import crypto from "crypto";

/**
 * Simple local embedding provider using TF-IDF
 * This is a fallback when no external embedding service is available.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  private vocabulary: Map<string, number> = new Map();
  private idfScores: Map<string, number> = new Map();
  private documentCount: number = 0;
  private dimension: number;
  private isInitialized: boolean = false;

  constructor(dimension: number = 384) {
    this.dimension = dimension;
  }

  /**
   * Initialize with a corpus of documents
   */
  async initialize(documents: string[]): Promise<void> {
    this.documentCount = documents.length;

    // Build vocabulary and calculate IDF
    const docFrequency = new Map<string, number>();

    for (const doc of documents) {
      const tokens = this.tokenize(doc);
      const uniqueTokens = new Set(tokens);

      for (const token of uniqueTokens) {
        docFrequency.set(token, (docFrequency.get(token) || 0) + 1);
      }
    }

    // Calculate IDF scores
    let vocabIndex = 0;
    for (const [token, df] of docFrequency) {
      if (vocabIndex >= this.dimension) break;

      this.vocabulary.set(token, vocabIndex);
      this.idfScores.set(token, Math.log(this.documentCount / (df + 1)) + 1);
      vocabIndex++;
    }

    this.isInitialized = true;
  }

  /**
   * Embed a single text
   */
  async embed(text: string): Promise<number[]> {
    const tokens = this.tokenize(text);
    const embedding = new Array(this.dimension).fill(0);

    // Calculate TF-IDF
    const termFrequency = new Map<string, number>();
    for (const token of tokens) {
      termFrequency.set(token, (termFrequency.get(token) || 0) + 1);
    }

    for (const [token, tf] of termFrequency) {
      const vocabIdx = this.vocabulary.get(token);
      if (vocabIdx !== undefined) {
        const idf = this.idfScores.get(token) || 1;
        embedding[vocabIdx] = tf * idf;
      } else {
        // Hash unknown tokens to a bucket
        const hash = this.hashToken(token);
        const idx = hash % this.dimension;
        embedding[idx] += tf;
      }
    }

    // L2 normalize
    return this.normalize(embedding);
  }

  /**
   * Embed multiple texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  /**
   * Get embedding dimension
   */
  getDimension(): number {
    return this.dimension;
  }

  /**
   * Get model name
   */
  getModelName(): string {
    return "local-tfidf";
  }

  /**
   * Tokenize text
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 1 && t.length < 30);
  }

  /**
   * Hash a token to a number
   */
  private hashToken(token: string): number {
    const hash = crypto.createHash("md5").update(token).digest("hex");
    return parseInt(hash.slice(0, 8), 16);
  }

  /**
   * L2 normalize a vector
   */
  private normalize(vec: number[]): number[] {
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0) return vec;
    return vec.map(v => v / magnitude);
  }
}

/**
 * Semantic hashing based embedding provider
 * Uses random projections for fast, consistent embeddings
 */
export class SemanticHashEmbeddingProvider implements EmbeddingProvider {
  private dimension: number;
  private projectionMatrix: number[][] | null = null;
  private vocabSize: number = 10000;

  constructor(dimension: number = 384) {
    this.dimension = dimension;
    this.initProjectionMatrix();
  }

  /**
   * Initialize random projection matrix (deterministic based on seed)
   */
  private initProjectionMatrix(): void {
    // Use a seeded random for reproducibility
    const seed = 42;
    this.projectionMatrix = [];

    for (let i = 0; i < this.vocabSize; i++) {
      const row: number[] = [];
      for (let j = 0; j < this.dimension; j++) {
        // Deterministic "random" values
        const val = Math.sin(seed * i + j) * Math.cos(j * 0.1 + i * 0.01);
        row.push(val);
      }
      this.projectionMatrix.push(this.normalize(row));
    }
  }

  /**
   * Embed a single text
   */
  async embed(text: string): Promise<number[]> {
    const tokens = this.tokenize(text);
    const embedding = new Array(this.dimension).fill(0);

    // Aggregate token embeddings
    for (const token of tokens) {
      const tokenIdx = this.hashToken(token) % this.vocabSize;
      const tokenEmb = this.projectionMatrix![tokenIdx];

      for (let i = 0; i < this.dimension; i++) {
        embedding[i] += tokenEmb[i];
      }
    }

    return this.normalize(embedding);
  }

  /**
   * Embed multiple texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  /**
   * Get embedding dimension
   */
  getDimension(): number {
    return this.dimension;
  }

  /**
   * Get model name
   */
  getModelName(): string {
    return "semantic-hash";
  }

  /**
   * Tokenize text with n-grams
   */
  private tokenize(text: string): string[] {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 1);

    const tokens: string[] = [...words];

    // Add bigrams for better context
    for (let i = 0; i < words.length - 1; i++) {
      tokens.push(`${words[i]}_${words[i + 1]}`);
    }

    return tokens;
  }

  /**
   * Hash a token to a number
   */
  private hashToken(token: string): number {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      const char = token.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * L2 normalize a vector
   */
  private normalize(vec: number[]): number[] {
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0) return vec;
    return vec.map(v => v / magnitude);
  }
}

/**
 * Code-aware embedding provider
 * Combines semantic hashing with code-specific features
 */
export class CodeEmbeddingProvider implements EmbeddingProvider {
  private baseProvider: SemanticHashEmbeddingProvider;
  private dimension: number;

  constructor(dimension: number = 384) {
    this.dimension = dimension;
    // Reserve some dimensions for code features
    this.baseProvider = new SemanticHashEmbeddingProvider(Math.floor(dimension * 0.8));
  }

  /**
   * Embed code with code-aware features
   */
  async embed(text: string): Promise<number[]> {
    // Get base embedding
    const baseEmb = await this.baseProvider.embed(text);

    // Extract code features
    const codeFeatures = this.extractCodeFeatures(text);

    // Combine embeddings
    const combined = [
      ...baseEmb,
      ...codeFeatures,
    ];

    // Pad or truncate to target dimension
    return this.normalize(this.padOrTruncate(combined, this.dimension));
  }

  /**
   * Embed multiple texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  /**
   * Get embedding dimension
   */
  getDimension(): number {
    return this.dimension;
  }

  /**
   * Get model name
   */
  getModelName(): string {
    return "code-embedding";
  }

  /**
   * Extract code-specific features
   */
  private extractCodeFeatures(text: string): number[] {
    const featureDim = Math.ceil(this.dimension * 0.2);
    const features = new Array(featureDim).fill(0);

    let idx = 0;

    // Feature: Number of lines
    features[idx++] = Math.min(text.split("\n").length / 100, 1);

    // Feature: Average line length
    const lines = text.split("\n");
    const avgLineLen = lines.reduce((sum, l) => sum + l.length, 0) / (lines.length || 1);
    features[idx++] = Math.min(avgLineLen / 80, 1);

    // Feature: Indentation depth (complexity indicator)
    const maxIndent = Math.max(...lines.map(l => {
      const match = l.match(/^(\s*)/);
      return match ? match[1].length : 0;
    }));
    features[idx++] = Math.min(maxIndent / 16, 1);

    // Feature: Contains function/class keywords
    features[idx++] = /\b(function|def|func)\b/.test(text) ? 1 : 0;
    features[idx++] = /\b(class|struct|interface)\b/.test(text) ? 1 : 0;
    features[idx++] = /\b(async|await)\b/.test(text) ? 1 : 0;
    features[idx++] = /\b(export|import|from)\b/.test(text) ? 1 : 0;

    // Feature: Bracket density
    const bracketCount = (text.match(/[{}[\]()]/g) || []).length;
    features[idx++] = Math.min(bracketCount / (text.length + 1), 0.3) / 0.3;

    // Feature: Comment ratio
    const commentMatch = text.match(/\/\/.*|\/\*[\s\S]*?\*\/|#.*/g);
    const commentChars = commentMatch ? commentMatch.join("").length : 0;
    features[idx++] = Math.min(commentChars / (text.length + 1), 0.5) / 0.5;

    // Feature: String literal density
    const stringMatch = text.match(/"[^"]*"|'[^']*'|`[^`]*`/g);
    const stringChars = stringMatch ? stringMatch.join("").length : 0;
    features[idx++] = Math.min(stringChars / (text.length + 1), 0.5) / 0.5;

    // Feature: Numeric literal density
    const numMatch = text.match(/\b\d+(\.\d+)?\b/g);
    features[idx++] = Math.min((numMatch?.length || 0) / 50, 1);

    // Feature: Operator density
    const opMatch = text.match(/[+\-*/%=<>!&|^~?:]+/g);
    features[idx++] = Math.min((opMatch?.length || 0) / 50, 1);

    // Feature: Contains test-related keywords
    features[idx++] = /\b(test|spec|describe|it|expect|assert)\b/i.test(text) ? 1 : 0;

    // Feature: Contains error handling
    features[idx++] = /\b(try|catch|throw|error|exception)\b/i.test(text) ? 1 : 0;

    return features.slice(0, featureDim);
  }

  /**
   * Pad or truncate vector to target dimension
   */
  private padOrTruncate(vec: number[], targetDim: number): number[] {
    if (vec.length === targetDim) return vec;
    if (vec.length > targetDim) return vec.slice(0, targetDim);
    return [...vec, ...new Array(targetDim - vec.length).fill(0)];
  }

  /**
   * L2 normalize a vector
   */
  private normalize(vec: number[]): number[] {
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0) return vec;
    return vec.map(v => v / magnitude);
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have same dimension");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Create the default embedding provider
 */
export function createEmbeddingProvider(
  type: "local" | "semantic" | "code" = "code",
  dimension: number = 384
): EmbeddingProvider {
  switch (type) {
    case "local":
      return new LocalEmbeddingProvider(dimension);
    case "semantic":
      return new SemanticHashEmbeddingProvider(dimension);
    case "code":
    default:
      return new CodeEmbeddingProvider(dimension);
  }
}
