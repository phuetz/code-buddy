/**
 * Child process for tests/unit/embedding-wasm-fallback.test.ts.
 * Loads the real EmbeddingProvider twice against a transformers.js cache whose
 * model file is not a valid ONNX graph. A heartbeat proves the event loop is alive.
 */
import path from 'node:path';
import { env } from '@xenova/transformers';
import { EmbeddingProvider } from '../../src/embeddings/embedding-provider.js';

const cache = process.argv[2];
if (!cache) throw new Error('usage: local-embedding-wasm-fallback-child.ts <cacheDir>');
env.cacheDir = cache;
env.allowRemoteModels = false;
env.localModelPath = `${path.join(cache, 'absent')}/`;

const t0 = Date.now();
setInterval(() => console.log(`BOUCLE t=${Date.now() - t0}ms`), 500).unref();

for (const essai of [1, 2]) {
  try {
    await new EmbeddingProvider({ provider: 'local', cacheDir: path.join(cache, 'models') }).initialize();
    console.log(`ESSAI ${essai} charge t=${Date.now() - t0}ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`ESSAI ${essai} rejete t=${Date.now() - t0}ms: ${message.slice(0, 120)}`);
  }
}
console.log(`FIN t=${Date.now() - t0}ms`);
process.exit(0);
