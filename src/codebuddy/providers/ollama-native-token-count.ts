import { getModelToolConfig } from '../../config/model-tools.js';
import { HEADLESS_LOCAL_COMPACT_MAX_TOKENS, isHeadlessPromptCompact } from '../../config/headless-local-prompt.js';
import { renderQwen35Request } from './qwen35-request-renderer.js';
import type { OllamaNativeRequest } from './ollama-native-transport.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Counter = (body: OllamaNativeRequest) => number;
const counters = new Map<string, Promise<Counter>>();

/** Build the tokenizer from the served GGUF vocabulary, without downloading a
 * model or using another provider. qwen35 denotes a tokenizer/renderer protocol,
 * not a particular model size. Other protocols keep their existing checks.
 */
export async function createQwen35Counter(info: Record<string, unknown>): Promise<Counter> {
  const tokens = info['tokenizer.ggml.tokens'];
  const merges = info['tokenizer.ggml.merges'];
  const types = info['tokenizer.ggml.token_type'];
  if (info['tokenizer.ggml.pre'] !== 'qwen35' || info['tokenizer.ggml.model'] !== 'gpt2'
    || !Array.isArray(tokens) || !tokens.length || !tokens.every(t => typeof t === 'string')
    || !Array.isArray(merges) || !merges.every(m => typeof m === 'string')
    || !Array.isArray(types) || types.length !== tokens.length
    || info['tokenizer.ggml.add_eos_token'] === true || info['tokenizer.ggml.add_bos_token'] === true) {
    throw new Error('Native compact admission requires the complete supported qwen35 tokenizer metadata');
  }
  const { PreTrainedTokenizer } = await import('@huggingface/transformers');
  const tokenizer = new PreTrainedTokenizer({
    version: '1.0', truncation: null, padding: null, normalizer: null,
    added_tokens: tokens.flatMap((content, id) => types[id] === 3 || types[id] === 4
      ? [{ id, content, single_word: false, lstrip: false, rstrip: false, normalized: false, special: types[id] === 3 }] : []),
    pre_tokenizer: { type: 'Sequence', pretokenizers: [
      { type: 'Split', pattern: { Regex: "(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\\r\\n\\p{L}\\p{N}]?[\\p{L}\\p{M}]+|\\p{N}| ?[^\\s\\p{L}\\p{M}\\p{N}]+[\\r\\n]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+" }, behavior: 'Isolated', invert: false },
      { type: 'ByteLevel', add_prefix_space: false, trim_offsets: false, use_regex: false },
    ] },
    post_processor: null, decoder: null,
    model: { type: 'BPE', dropout: null, unk_token: null, continuing_subword_prefix: '', end_of_word_suffix: '',
      fuse_unk: false, byte_fallback: false, ignore_merges: false,
      vocab: Object.fromEntries(tokens.map((token, id) => [token, id])), merges },
  }, {});
  return body => tokenizer.encode(renderQwen35Request(body), { add_special_tokens: false }).length;
}

async function loadCounter(origin: string, body: OllamaNativeRequest, fetcher: Fetch, signal?: AbortSignal): Promise<Counter> {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  const version = await fetcher(`${origin}/api/version`, { signal: requestSignal });
  if (!version.ok || (await version.json() as { version?: string }).version !== '0.30.7') {
    throw new Error('Native compact admission: the Qwen 3.5 renderer has only been verified with Ollama 0.30.7');
  }
  const response = await fetcher(`${origin}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: body.model, verbose: true }), signal: requestSignal });
  if (!response.ok) throw new Error(`Native compact tokenizer metadata unavailable: HTTP ${response.status}`);
  const data = await response.json() as { model_info?: Record<string, unknown>; details?: { family?: string } };
  if (!data.model_info || !['qwen35', 'qwen35moe'].includes(data.details?.family ?? '')) {
    throw new Error('Native compact admission: served model does not match the declared Qwen 3.5 protocol');
  }
  return createQwen35Counter(data.model_info);
}

/** Must run before POST /api/chat, after the final tool/message assembly. */
export async function admitOllamaCompactRequest(
  origin: string, body: OllamaNativeRequest, fetcher: Fetch = fetch, signal?: AbortSignal,
): Promise<number | undefined> {
  if (!isHeadlessPromptCompact() || getModelToolConfig(body.model).nativePromptCounter !== 'qwen35') return undefined;
  const key = `${origin}\n${body.model}`;
  let pending = counters.get(key);
  if (!pending) {
    pending = loadCounter(origin, body, fetcher, signal);
    counters.set(key, pending);
    void pending.catch(() => { if (counters.get(key) === pending) counters.delete(key); });
  }
  const count = (await pending)(body);
  if (count > HEADLESS_LOCAL_COMPACT_MAX_TOKENS) {
    throw new Error(`Ollama compact request not sent: ${count} native prompt tokens exceed ${HEADLESS_LOCAL_COMPACT_MAX_TOKENS} before generation (system, tools, messages and reply prefix included).`);
  }
  return count;
}

/** Unit-test isolation; production caches only read-only tokenizer metadata. */
export function resetNativeTokenCounters(): void { counters.clear(); }
