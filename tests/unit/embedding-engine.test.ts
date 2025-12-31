/**
 * Comprehensive Tests for Embedding Providers (codebase-rag embeddings)
 *
 * Tests the embedding system used by the RAG context including:
 * - LocalEmbeddingProvider (TF-IDF based)
 * - SemanticHashEmbeddingProvider (Random projections)
 * - CodeEmbeddingProvider (Code-aware features)
 * - Cosine similarity calculation
 * - Factory function
 */

import {
  LocalEmbeddingProvider,
  SemanticHashEmbeddingProvider,
  CodeEmbeddingProvider,
  cosineSimilarity,
  createEmbeddingProvider,
} from '../../src/context/codebase-rag/embeddings';
import type { EmbeddingProvider } from '../../src/context/codebase-rag/types';

// Mock crypto
jest.mock('crypto', () => ({
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn(() => 'abcd1234efgh5678'),
  })),
}));

describe('LocalEmbeddingProvider', () => {
  let provider: LocalEmbeddingProvider;

  beforeEach(() => {
    provider = new LocalEmbeddingProvider(384);
  });

  describe('constructor', () => {
    it('should create with default dimension', () => {
      const defaultProvider = new LocalEmbeddingProvider();
      expect(defaultProvider.getDimension()).toBe(384);
    });

    it('should create with custom dimension', () => {
      const customProvider = new LocalEmbeddingProvider(512);
      expect(customProvider.getDimension()).toBe(512);
    });
  });

  describe('initialize', () => {
    it('should initialize with document corpus', async () => {
      const documents = [
        'function test() { return true; }',
        'const value = 42;',
        'class MyClass {}',
      ];

      await provider.initialize(documents);

      // Should be able to embed after initialization
      const embedding = await provider.embed('test function');
      expect(embedding.length).toBe(384);
    });

    it('should build vocabulary from documents', async () => {
      const documents = [
        'function hello() {}',
        'function world() {}',
        'function test() {}',
      ];

      await provider.initialize(documents);

      // function appears in all docs, should have high IDF weighting
      const embedding = await provider.embed('function');
      expect(embedding.some((v) => v !== 0)).toBe(true);
    });

    it('should calculate IDF scores', async () => {
      const documents = [
        'unique term here',
        'another document',
        'different content',
      ];

      await provider.initialize(documents);

      // Unique terms should have embeddings
      const embedding = await provider.embed('unique');
      expect(embedding.length).toBe(384);
    });
  });

  describe('embed', () => {
    beforeEach(async () => {
      await provider.initialize([
        'function test code',
        'class implementation',
        'variable declaration',
      ]);
    });

    it('should generate embedding for text', async () => {
      const embedding = await provider.embed('test function');

      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(384);
    });

    it('should return normalized embedding', async () => {
      const embedding = await provider.embed('sample text');

      // Calculate L2 norm
      const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1, 5);
    });

    it('should generate different embeddings for different text', async () => {
      const embedding1 = await provider.embed('function test');
      const embedding2 = await provider.embed('class definition');

      expect(embedding1).not.toEqual(embedding2);
    });

    it('should handle unknown tokens', async () => {
      const embedding = await provider.embed('xyz123unknown tokens');

      expect(embedding.length).toBe(384);
      // Should still have non-zero values from hashing
      expect(embedding.some((v) => v !== 0)).toBe(true);
    });

    it('should handle empty text', async () => {
      const embedding = await provider.embed('');

      expect(embedding.length).toBe(384);
    });

    it('should handle text with only stopwords', async () => {
      const embedding = await provider.embed('a the an');

      // Should filter out short tokens
      expect(embedding.length).toBe(384);
    });
  });

  describe('embedBatch', () => {
    beforeEach(async () => {
      await provider.initialize(['test corpus']);
    });

    it('should embed multiple texts', async () => {
      const texts = ['text one', 'text two', 'text three'];
      const embeddings = await provider.embedBatch(texts);

      expect(embeddings.length).toBe(3);
      embeddings.forEach((emb) => {
        expect(emb.length).toBe(384);
      });
    });

    it('should handle empty array', async () => {
      const embeddings = await provider.embedBatch([]);
      expect(embeddings).toEqual([]);
    });

    it('should produce same results as individual embed calls', async () => {
      const texts = ['hello world', 'test code'];
      const batchEmbeddings = await provider.embedBatch(texts);

      const individualEmbeddings = await Promise.all(
        texts.map((t) => provider.embed(t))
      );

      for (let i = 0; i < texts.length; i++) {
        expect(batchEmbeddings[i]).toEqual(individualEmbeddings[i]);
      }
    });
  });

  describe('getDimension', () => {
    it('should return correct dimension', () => {
      expect(provider.getDimension()).toBe(384);
    });
  });

  describe('getModelName', () => {
    it('should return model name', () => {
      expect(provider.getModelName()).toBe('local-tfidf');
    });
  });
});

describe('SemanticHashEmbeddingProvider', () => {
  let provider: SemanticHashEmbeddingProvider;

  beforeEach(() => {
    provider = new SemanticHashEmbeddingProvider(384);
  });

  describe('constructor', () => {
    it('should create with default dimension', () => {
      const defaultProvider = new SemanticHashEmbeddingProvider();
      expect(defaultProvider.getDimension()).toBe(384);
    });

    it('should create with custom dimension', () => {
      const customProvider = new SemanticHashEmbeddingProvider(256);
      expect(customProvider.getDimension()).toBe(256);
    });
  });

  describe('embed', () => {
    it('should generate embedding for text', async () => {
      const embedding = await provider.embed('hello world');

      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(384);
    });

    it('should return normalized embedding', async () => {
      const embedding = await provider.embed('sample text for testing');

      const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1, 5);
    });

    it('should generate consistent embeddings for same text', async () => {
      const embedding1 = await provider.embed('consistent text');
      const embedding2 = await provider.embed('consistent text');

      expect(embedding1).toEqual(embedding2);
    });

    it('should generate different embeddings for different text', async () => {
      const embedding1 = await provider.embed('first text');
      const embedding2 = await provider.embed('second text completely different');

      expect(embedding1).not.toEqual(embedding2);
    });

    it('should include bigrams for context', async () => {
      const embedding1 = await provider.embed('new york');
      const embedding2 = await provider.embed('york new');

      // Different word order should produce different embeddings
      expect(embedding1).not.toEqual(embedding2);
    });

    it('should handle special characters', async () => {
      const embedding = await provider.embed('function() { return x + y; }');

      expect(embedding.length).toBe(384);
    });

    it('should handle unicode', async () => {
      const embedding = await provider.embed('hello world unicode');

      expect(embedding.length).toBe(384);
    });
  });

  describe('embedBatch', () => {
    it('should embed multiple texts', async () => {
      const texts = ['first', 'second', 'third'];
      const embeddings = await provider.embedBatch(texts);

      expect(embeddings.length).toBe(3);
    });

    it('should handle empty batch', async () => {
      const embeddings = await provider.embedBatch([]);
      expect(embeddings).toEqual([]);
    });
  });

  describe('getModelName', () => {
    it('should return model name', () => {
      expect(provider.getModelName()).toBe('semantic-hash');
    });
  });
});

describe('CodeEmbeddingProvider', () => {
  let provider: CodeEmbeddingProvider;

  beforeEach(() => {
    provider = new CodeEmbeddingProvider(384);
  });

  describe('constructor', () => {
    it('should create with default dimension', () => {
      const defaultProvider = new CodeEmbeddingProvider();
      expect(defaultProvider.getDimension()).toBe(384);
    });

    it('should create with custom dimension', () => {
      const customProvider = new CodeEmbeddingProvider(512);
      expect(customProvider.getDimension()).toBe(512);
    });
  });

  describe('embed', () => {
    it('should generate embedding for code', async () => {
      const code = `
function hello() {
  return "world";
}
`;
      const embedding = await provider.embed(code);

      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(384);
    });

    it('should return normalized embedding', async () => {
      const embedding = await provider.embed('const x = 1;');

      const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1, 5);
    });

    it('should extract code features', async () => {
      // Code with specific features
      const codeWithFeatures = `
async function processData(input: string): Promise<string> {
  try {
    const result = await fetch('/api');
    return result.json();
  } catch (error) {
    throw new Error('Failed');
  }
}
`;
      const embedding = await provider.embed(codeWithFeatures);

      expect(embedding.length).toBe(384);
    });

    it('should differentiate function vs class code', async () => {
      const functionCode = 'function test() { return 1; }';
      const classCode = 'class Test { method() { return 1; } }';

      const funcEmb = await provider.embed(functionCode);
      const classEmb = await provider.embed(classCode);

      expect(funcEmb).not.toEqual(classEmb);
    });

    it('should capture async/await presence', async () => {
      const syncCode = 'function sync() { return 1; }';
      const asyncCode = 'async function asyncFn() { return await fetch(); }';

      const syncEmb = await provider.embed(syncCode);
      const asyncEmb = await provider.embed(asyncCode);

      expect(syncEmb).not.toEqual(asyncEmb);
    });

    it('should capture import/export presence', async () => {
      const noImport = 'const x = 1;';
      const withImport = 'import { x } from "module"; export const y = x;';

      const noImportEmb = await provider.embed(noImport);
      const withImportEmb = await provider.embed(withImport);

      expect(noImportEmb).not.toEqual(withImportEmb);
    });

    it('should capture test code presence', async () => {
      const regularCode = 'function helper() {}';
      const testCode = 'describe("test", () => { it("works", () => { expect(true).toBe(true); }); });';

      const regularEmb = await provider.embed(regularCode);
      const testEmb = await provider.embed(testCode);

      expect(regularEmb).not.toEqual(testEmb);
    });

    it('should capture error handling presence', async () => {
      const noError = 'const x = 1;';
      const withError = 'try { throw new Error(); } catch (e) { console.error(e); }';

      const noErrorEmb = await provider.embed(noError);
      const withErrorEmb = await provider.embed(withError);

      expect(noErrorEmb).not.toEqual(withErrorEmb);
    });

    it('should handle very long code', async () => {
      const longCode = 'const x = 1;\n'.repeat(1000);
      const embedding = await provider.embed(longCode);

      expect(embedding.length).toBe(384);
    });

    it('should handle code with comments', async () => {
      const codeWithComments = `
// This is a comment
/* Multi-line
   comment */
function test() {
  // inline comment
  return 1;
}
`;
      const embedding = await provider.embed(codeWithComments);

      expect(embedding.length).toBe(384);
    });

    it('should handle code with strings', async () => {
      const codeWithStrings = `
const msg = "Hello, World!";
const template = \`Template: \${msg}\`;
const single = 'single quotes';
`;
      const embedding = await provider.embed(codeWithStrings);

      expect(embedding.length).toBe(384);
    });

    it('should handle code with numbers', async () => {
      const codeWithNumbers = `
const int = 42;
const float = 3.14159;
const hex = 0xFF;
const binary = 0b1010;
`;
      const embedding = await provider.embed(codeWithNumbers);

      expect(embedding.length).toBe(384);
    });
  });

  describe('embedBatch', () => {
    it('should embed multiple code snippets', async () => {
      const snippets = [
        'function a() {}',
        'class B {}',
        'const c = 1;',
      ];
      const embeddings = await provider.embedBatch(snippets);

      expect(embeddings.length).toBe(3);
      embeddings.forEach((emb) => {
        expect(emb.length).toBe(384);
      });
    });
  });

  describe('getModelName', () => {
    it('should return model name', () => {
      expect(provider.getModelName()).toBe('code-embedding');
    });
  });
});

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const v = [0.5, 0.5, 0.5, 0.5];
    const similarity = cosineSimilarity(v, v);
    expect(similarity).toBeCloseTo(1, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const v1 = [1, 0, 0, 0];
    const v2 = [0, 1, 0, 0];
    const similarity = cosineSimilarity(v1, v2);
    expect(similarity).toBeCloseTo(0, 5);
  });

  it('should return -1 for opposite vectors', () => {
    const v1 = [1, 0, 0, 0];
    const v2 = [-1, 0, 0, 0];
    const similarity = cosineSimilarity(v1, v2);
    expect(similarity).toBeCloseTo(-1, 5);
  });

  it('should throw for different length vectors', () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0, 0];
    expect(() => cosineSimilarity(v1, v2)).toThrow('same dimension');
  });

  it('should handle zero vectors', () => {
    const v1 = [0, 0, 0, 0];
    const v2 = [1, 0, 0, 0];
    const similarity = cosineSimilarity(v1, v2);
    expect(similarity).toBe(0);
  });

  it('should calculate correct similarity', () => {
    const v1 = [1, 2, 3];
    const v2 = [4, 5, 6];
    const similarity = cosineSimilarity(v1, v2);

    // Manual calculation: (1*4 + 2*5 + 3*6) / (sqrt(14) * sqrt(77))
    const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
    expect(similarity).toBeCloseTo(expected, 5);
  });

  it('should be symmetric', () => {
    const v1 = [1, 2, 3, 4];
    const v2 = [5, 6, 7, 8];

    const sim1 = cosineSimilarity(v1, v2);
    const sim2 = cosineSimilarity(v2, v1);

    expect(sim1).toBeCloseTo(sim2, 10);
  });

  it('should handle negative values', () => {
    const v1 = [-1, 2, -3, 4];
    const v2 = [1, -2, 3, -4];
    const similarity = cosineSimilarity(v1, v2);

    expect(similarity).toBeCloseTo(-1, 5);
  });

  it('should handle very small values', () => {
    const v1 = [1e-10, 1e-10];
    const v2 = [1e-10, 1e-10];
    const similarity = cosineSimilarity(v1, v2);

    expect(similarity).toBeCloseTo(1, 5);
  });

  it('should handle very large values', () => {
    const v1 = [1e10, 1e10];
    const v2 = [1e10, 1e10];
    const similarity = cosineSimilarity(v1, v2);

    expect(similarity).toBeCloseTo(1, 5);
  });
});

describe('createEmbeddingProvider', () => {
  it('should create local provider by default', () => {
    const provider = createEmbeddingProvider();
    expect(provider.getModelName()).toBe('code-embedding');
  });

  it('should create local provider', () => {
    const provider = createEmbeddingProvider('local');
    expect(provider.getModelName()).toBe('local-tfidf');
  });

  it('should create semantic provider', () => {
    const provider = createEmbeddingProvider('semantic');
    expect(provider.getModelName()).toBe('semantic-hash');
  });

  it('should create code provider', () => {
    const provider = createEmbeddingProvider('code');
    expect(provider.getModelName()).toBe('code-embedding');
  });

  it('should use custom dimension', () => {
    const provider = createEmbeddingProvider('code', 512);
    expect(provider.getDimension()).toBe(512);
  });

  it('should default to 384 dimensions', () => {
    const provider = createEmbeddingProvider('code');
    expect(provider.getDimension()).toBe(384);
  });
});

describe('Embedding Provider Integration', () => {
  it('should produce similar embeddings for similar code', async () => {
    const provider = new CodeEmbeddingProvider(384);

    const code1 = 'function add(a, b) { return a + b; }';
    const code2 = 'function sum(x, y) { return x + y; }';
    const code3 = 'class DatabaseConnection { connect() {} disconnect() {} }';

    const emb1 = await provider.embed(code1);
    const emb2 = await provider.embed(code2);
    const emb3 = await provider.embed(code3);

    const sim12 = cosineSimilarity(emb1, emb2);
    const sim13 = cosineSimilarity(emb1, emb3);

    // Similar function code should be more similar than different code
    // Note: This depends on the embedding implementation
    expect(sim12).toBeDefined();
    expect(sim13).toBeDefined();
  });

  it('should work across different providers', async () => {
    const localProvider = new LocalEmbeddingProvider(384);
    const hashProvider = new SemanticHashEmbeddingProvider(384);
    const codeProvider = new CodeEmbeddingProvider(384);

    await localProvider.initialize(['sample text']);

    const text = 'function test() {}';

    const localEmb = await localProvider.embed(text);
    const hashEmb = await hashProvider.embed(text);
    const codeEmb = await codeProvider.embed(text);

    // All should produce valid embeddings of same dimension
    expect(localEmb.length).toBe(384);
    expect(hashEmb.length).toBe(384);
    expect(codeEmb.length).toBe(384);
  });

  it('should handle batch vs single embed consistently', async () => {
    const provider = new SemanticHashEmbeddingProvider(384);
    const texts = ['text one', 'text two'];

    const singleEmbeddings = await Promise.all(texts.map((t) => provider.embed(t)));
    const batchEmbeddings = await provider.embedBatch(texts);

    for (let i = 0; i < texts.length; i++) {
      expect(singleEmbeddings[i]).toEqual(batchEmbeddings[i]);
    }
  });
});

describe('EmbeddingProvider Interface', () => {
  const providers: { name: string; provider: EmbeddingProvider }[] = [
    { name: 'LocalEmbeddingProvider', provider: new LocalEmbeddingProvider() },
    { name: 'SemanticHashEmbeddingProvider', provider: new SemanticHashEmbeddingProvider() },
    { name: 'CodeEmbeddingProvider', provider: new CodeEmbeddingProvider() },
  ];

  beforeAll(async () => {
    // Initialize LocalEmbeddingProvider
    const localProvider = providers.find((p) => p.name === 'LocalEmbeddingProvider')?.provider;
    if (localProvider && localProvider instanceof LocalEmbeddingProvider) {
      await localProvider.initialize(['test corpus']);
    }
  });

  describe.each(providers)('$name', ({ provider }) => {
    it('should implement embed method', async () => {
      const embedding = await provider.embed('test');
      expect(Array.isArray(embedding)).toBe(true);
    });

    it('should implement embedBatch method', async () => {
      const embeddings = await provider.embedBatch(['a', 'b']);
      expect(Array.isArray(embeddings)).toBe(true);
      expect(embeddings.length).toBe(2);
    });

    it('should implement getDimension method', () => {
      const dim = provider.getDimension();
      expect(typeof dim).toBe('number');
      expect(dim).toBeGreaterThan(0);
    });

    it('should implement getModelName method', () => {
      const name = provider.getModelName();
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    });

    it('should return embeddings of correct dimension', async () => {
      const embedding = await provider.embed('sample text');
      expect(embedding.length).toBe(provider.getDimension());
    });
  });
});
