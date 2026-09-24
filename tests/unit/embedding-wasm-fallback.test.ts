/**
 * A cached model that onnxruntime-node cannot parse (a download cut short, or
 * two workers writing the same cache file) makes transformers.js retry on the
 * onnxruntime-web wasm backend. With its threaded build, the second retry in a
 * process parked the main thread in `Atomics.wait` for good: Vitest's own
 * timeout could not fire and the Ubuntu CI job ran until it was cancelled.
 *
 * The load runs in a child process killed after a fixed delay, so a
 * regression fails this test instead of freezing the worker that runs it.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const CHILD_DEADLINE_MS = 60_000;
const disposables: string[] = [];

afterEach(() => {
  for (const dir of disposables.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A cache holding a usable tokenizer and a model file that is not ONNX. */
function unreadableModelCache(): string {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'embedding-wasm-'));
  disposables.push(cache);
  const model = path.join(cache, 'Xenova', 'all-MiniLM-L6-v2');
  fs.mkdirSync(path.join(model, 'onnx'), { recursive: true });
  fs.writeFileSync(path.join(model, 'config.json'), JSON.stringify({ model_type: 'bert' }));
  fs.writeFileSync(path.join(model, 'tokenizer_config.json'), JSON.stringify({
    tokenizer_class: 'BertTokenizer',
    do_lower_case: true,
    model_max_length: 128,
  }));
  fs.writeFileSync(path.join(model, 'tokenizer.json'), JSON.stringify({
    version: '1.0',
    truncation: null,
    padding: null,
    added_tokens: [],
    normalizer: null,
    pre_tokenizer: { type: 'Whitespace' },
    post_processor: null,
    decoder: null,
    model: {
      type: 'WordPiece',
      unk_token: '[UNK]',
      continuing_subword_prefix: '##',
      max_input_chars_per_word: 100,
      vocab: { '[PAD]': 0, '[UNK]': 1, '[CLS]': 2, '[SEP]': 3, bonjour: 4 },
    },
  }));
  fs.writeFileSync(path.join(model, 'onnx', 'model_quantized.onnx'), Buffer.from('not an onnx graph\n'.repeat(64)));
  return cache;
}

function runChild(cache: string): Promise<{ stdout: string; stderr: string; killed: boolean; ms: number }> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  env.NO_COLOR = '1';
  const started = Date.now();
  // `--import` keeps the load in this one process: the tsx CLI would fork a
  // grandchild that survives SIGKILL and holds the pipes open.
  const child = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href,
      path.resolve('tests/fixtures/local-embedding-wasm-fallback-child.ts'),
      cache,
    ],
    { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, CHILD_DEADLINE_MS);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr, killed, ms: Date.now() - started });
    });
  });
}

describe('repli wasm de transformers.js', () => {
  it('rejette deux fois un modele illisible sans figer le processus', async () => {
    const outcome = await runChild(unreadableModelCache());
    const fallbacks = outcome.stderr.split('Using `wasm` as a fallback').length - 1;
    const lines = outcome.stdout.split('\n').filter((line) => /^(ESSAI|FIN)/.test(line));
    const beats = outcome.stdout.split('\n').filter((line) => line.startsWith('BOUCLE')).length;
    console.log(`ASSERT repli-wasm tue=${outcome.killed} ms=${outcome.ms} replis=${fallbacks} battements=${beats} lignes=${JSON.stringify(lines)}`);

    expect(outcome.killed, 'ASSERT repli-wasm enfant fini avant le delai').toBe(false);
    expect(fallbacks, 'ASSERT repli-wasm chemin wasm emprunte deux fois').toBeGreaterThanOrEqual(2);
    expect(outcome.stdout, 'ASSERT repli-wasm premier essai rejete').toMatch(/^ESSAI 1 rejete/m);
    expect(outcome.stdout, 'ASSERT repli-wasm second essai rejete').toMatch(/^ESSAI 2 rejete/m);
    expect(outcome.stdout, 'ASSERT repli-wasm fin atteinte').toMatch(/^FIN /m);
  }, CHILD_DEADLINE_MS + 30_000);
});
