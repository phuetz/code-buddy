/**
 * Gamme Claude 5.5 sur l'endpoint OpenAI-compatible d'Anthropic
 * (validation du 2026-10-08, D2 + réponses vides + erreurs relayées).
 *
 * Les réponses viennent de `tests/fixtures/anthropic-5-5/` : enregistrements
 * réels (clé jamais écrite). Le vrai SDK `openai` les analyse ; seule la
 * couche réseau est rejouée.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatProvider } from '../../../src/codebuddy/providers/provider-openai-compat.js';
import { getExtendedThinking } from '../../../src/agent/extended-thinking.js';
import { resetAnthropicLearnedRefusals } from '../../../src/providers/anthropic-compat.js';
import { replayClient, replaySequence, type ReplayStep } from '../../helpers/anthropic-replay.js';

const ANTHROPIC = 'https://api.anthropic.com/v1';

function makeProvider(model: string, fixture: string, status = 200, baseURL = ANTHROPIC) {
  const provider = new OpenAICompatProvider({
    apiKey: 'sk-ant-test',
    baseURL,
    model,
    defaultMaxTokens: 64_000,
    getCircuitBreakerConfig: () => undefined,
  });
  const replay = replayClient(fixture, status, baseURL);
  (provider as unknown as { client: unknown }).client = replay.client;
  return { provider, replay };
}

const USER = [{ role: 'user' as const, content: 'Réponds exactement : pong' }];

async function drain(provider: OpenAICompatProvider, opts: Record<string, unknown> = {}): Promise<void> {
  for await (const _chunk of provider.chatStream(USER, [], opts)) {
    // vider le générateur pour que la requête parte
  }
}

function providerWithSteps(model: string, steps: ReplayStep[]) {
  const provider = new OpenAICompatProvider({
    apiKey: 'sk-ant-test',
    baseURL: ANTHROPIC,
    model,
    defaultMaxTokens: 64_000,
    getCircuitBreakerConfig: () => undefined,
  });
  const replay = replaySequence(steps);
  (provider as unknown as { client: unknown }).client = replay.client;
  return { provider, replay };
}

afterEach(() => {
  getExtendedThinking().applyThinkingLevel('off');
  resetAnthropicLearnedRefusals();
  vi.unstubAllEnvs();
});

describe.each(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])(
  'échantillonnage sur Anthropic — %s',
  model => {
    it('chat : aucun temperature/top_p/top_k par défaut', async () => {
      const { provider, replay } = makeProvider(model, '200-text-pong-sonnet.json');
      await provider.chat(USER, [], {});
      const body = replay.calls[0]!.body;
      expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('top_p');
      expect(body).not.toHaveProperty('top_k');
    });

    it('chat : un appelant interne qui fixe temperature: 0 ne provoque pas le 400', async () => {
      const { provider, replay } = makeProvider(model, '200-text-pong-sonnet.json');
      await provider.chat(USER, [], { temperature: 0 });
      expect(replay.calls[0]!.body).not.toHaveProperty('temperature');
    });

    it('flux : aucun temperature par défaut, ni quand un appelant interne en fixe un', async () => {
      const first = makeProvider(model, 'stream-text-pong.sse');
      await drain(first.provider);
      expect(first.replay.calls[0]!.body).not.toHaveProperty('temperature');

      const second = makeProvider(model, 'stream-text-pong.sse');
      await drain(second.provider, { temperature: 0.2 });
      expect(second.replay.calls[0]!.body).not.toHaveProperty('temperature');
    });
  },
);

describe('échantillonnage — autres cas', () => {
  it('Claude 4.x sur Anthropic : pas de défaut 0,7, mais une valeur explicite est transmise', async () => {
    const none = makeProvider('claude-haiku-4-5-20251001', '200-text-pong-sonnet.json');
    await none.provider.chat(USER, [], {});
    expect(none.replay.calls[0]!.body).not.toHaveProperty('temperature');

    const explicit = makeProvider('claude-haiku-4-5-20251001', '200-text-pong-sonnet.json');
    await explicit.provider.chat(USER, [], { temperature: 0.2 });
    expect(explicit.replay.calls[0]!.body.temperature).toBe(0.2);
  });

  it('les autres fournisseurs gardent le défaut historique 0,7', async () => {
    const { provider, replay } = makeProvider('gpt-4o', '200-text-pong-sonnet.json', 200, 'https://api.openai.com/v1');
    await provider.chat(USER, [], {});
    expect(replay.calls[0]!.body.temperature).toBe(0.7);
  });
});

describe('réflexion sur Anthropic 5.5 (endpoint compat)', () => {
  it('garde type "enabled" (l’endpoint compat refuse "adaptive") et reste sous max_tokens', async () => {
    getExtendedThinking().applyThinkingLevel('medium');
    const { provider, replay } = makeProvider('claude-sonnet-5-5', '200-text-pong-sonnet.json');
    await provider.chat(USER, [], { maxTokens: 4_000 });
    const thinking = replay.calls[0]!.body.thinking as { type: string; budget_tokens: number };
    expect(thinking.type).toBe('enabled');
    expect(thinking.budget_tokens).toBeLessThan(4_000);
    expect(thinking.budget_tokens).toBeGreaterThanOrEqual(1_024);
  });

  it('un budget de réflexion qui ne tient pas dans max_tokens est retiré plutôt qu’envoyé', async () => {
    getExtendedThinking().applyThinkingLevel('medium');
    const { provider, replay } = makeProvider('claude-sonnet-5-5', '200-text-pong-sonnet.json');
    await provider.chat(USER, [], { maxTokens: 800 });
    const thinking = replay.calls[0]!.body.thinking as { type: string } | undefined;
    // sous 1 024 + marge, "enabled" serait refusé : la réflexion est coupée explicitement
    expect(thinking?.type).toBe('disabled');
  });

  it('une réponse bornée sans réflexion demandée envoie thinking "disabled" (sinon la réflexion adaptative mange le budget)', async () => {
    const { provider, replay } = makeProvider('claude-haiku-5-5', '200-text-pong-sonnet.json');
    await provider.chat(USER, [], { maxTokens: 50 });
    expect(replay.calls[0]!.body.thinking).toEqual({ type: 'disabled' });
  });

  it('le budget par défaut de l’agent ne touche pas à la réflexion', async () => {
    const { provider, replay } = makeProvider('claude-sonnet-5-5', '200-text-pong-sonnet.json');
    await provider.chat(USER, [], {});
    expect(replay.calls[0]!.body).not.toHaveProperty('thinking');
  });

  it('CODEBUDDY_ANTHROPIC_THINKING=disabled coupe la réflexion même avec un grand budget', async () => {
    vi.stubEnv('CODEBUDDY_ANTHROPIC_THINKING', 'disabled');
    const { provider, replay } = makeProvider('claude-sonnet-5-5', '200-text-pong-sonnet.json');
    await provider.chat(USER, [], {});
    expect(replay.calls[0]!.body.thinking).toEqual({ type: 'disabled' });
  });

  it('ne touche à la réflexion que sur Anthropic', async () => {
    const { provider, replay } = makeProvider('gpt-4o', '200-text-pong-sonnet.json', 200, 'https://api.openai.com/v1');
    await provider.chat(USER, [], { maxTokens: 50 });
    expect(replay.calls[0]!.body).not.toHaveProperty('thinking');
  });
});

describe('réponse vide = erreur explicite', () => {
  it('chat : content "" + finish_reason length (réflexion qui a mangé max_tokens) lève une erreur', async () => {
    const { provider } = makeProvider('claude-haiku-5-5', '200-empty-content-finish-length.json');
    await expect(provider.chat(USER, [], { maxTokens: 50 })).rejects.toThrow(/max_tokens|length/i);
    await expect(provider.chat(USER, [], { maxTokens: 50 })).rejects.toThrow(/50/);
    await expect(provider.chat(USER, [], { maxTokens: 50 })).rejects.toThrow(/thinking|réflexion/i);
  });

  it('flux : un seul delta de rôle puis finish_reason length lève la même erreur', async () => {
    const { provider } = makeProvider('claude-haiku-5-5', 'stream-empty-finish-length.sse');
    await expect(drain(provider, { maxTokens: 300 })).rejects.toThrow(/max_tokens|length/i);
    const again = makeProvider('claude-haiku-5-5', 'stream-empty-finish-length.sse');
    await expect(drain(again.provider, { maxTokens: 300 })).rejects.toThrow(/300/);
  });

  it('une réponse non vide reste un succès (chat et flux)', async () => {
    const chat = makeProvider('claude-sonnet-5-5', '200-text-pong-sonnet.json');
    const response = await chat.provider.chat(USER, [], {});
    expect(response.choices[0]?.message.content).toBe('pong');

    const stream = makeProvider('claude-haiku-5-5', 'stream-text-pong.sse');
    await expect(drain(stream.provider)).resolves.toBeUndefined();
  });

  it('un appel d’outil sans texte n’est pas une réponse vide', async () => {
    const { provider } = makeProvider('claude-haiku-5-5', 'stream-tool-call.sse');
    const tools = [{
      type: 'function' as const,
      function: { name: 'get_weather', description: 'météo', parameters: { type: 'object', properties: {} } },
    }];
    const seen: unknown[] = [];
    for await (const chunk of provider.chatStream(USER, tools, {})) seen.push(chunk);
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe('erreurs de l’API relayées avec leur corps', () => {
  it('404 : le modèle inconnu est nommé', async () => {
    const { provider } = makeProvider('claude-sonnet-4-20250514', '404-model-retired.json', 404);
    await expect(provider.chat(USER, [], {})).rejects.toThrow(/404/);
    await expect(provider.chat(USER, [], {})).rejects.toThrow(/claude-sonnet-4-20250514/);
  });

  it('401 : clé refusée, pas présentée comme une panne passagère', async () => {
    const { provider } = makeProvider('claude-haiku-5-5', '401-invalid-key.json', 401);
    const error = await provider.chat(USER, [], {}).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/401/);
    expect((error as Error).message).toMatch(/key|clé/i);
    expect((error as Error).message).not.toMatch(/réessay|retry later|temporar|indisponible/i);
  });

  it('400 : le corps « deprecated » de l’API est transmis tel quel', async () => {
    const { provider } = makeProvider('claude-haiku-5-5', '400-temperature-deprecated.json', 400);
    await expect(provider.chat(USER, [], {})).rejects.toThrow(/`temperature` is deprecated for this model/);
  });

  it('400 adaptive refusé par l’endpoint compat : message transmis', async () => {
    const { provider } = makeProvider('claude-haiku-5-5', '400-adaptive-not-available-compat.json', 400);
    await expect(provider.chat(USER, [], {})).rejects.toThrow(/Adaptive thinking is not available/);
  });
});

describe('refus appris de l’API (un seul nouvel essai, retenu par modèle)', () => {
  it('Sonnet 5.5 demande between_tools à la place de disabled : substitué, rejoué une fois, puis envoyé d’emblée', async () => {
    const { provider, replay } = providerWithSteps('claude-sonnet-5-5', [
      { fixture: '400-thinking-disabled-use-between-tools.json', status: 400 },
      { fixture: '200-text-pong-sonnet.json' },
    ]);
    const first = await provider.chat(USER, [], { maxTokens: 30 });
    expect(first.choices[0]?.message.content).toBe('pong');
    expect(replay.calls).toHaveLength(2);
    expect(replay.calls[0]!.body.thinking).toEqual({ type: 'disabled' });
    expect(replay.calls[1]!.body.thinking).toEqual({ type: 'between_tools' });

    await provider.chat(USER, [], { maxTokens: 30 });
    expect(replay.calls).toHaveLength(3);
    expect(replay.calls[2]!.body.thinking).toEqual({ type: 'between_tools' });
  });

  it('Sonnet 5.5 vide avec la réflexion par défaut : erreur explicite qui nomme le budget', async () => {
    const { provider } = providerWithSteps('claude-sonnet-5-5', [{ fixture: '200-empty-content-sonnet-5-5.json' }]);
    await expect(provider.chat(USER, [], { maxTokens: 30, temperature: 0.5 })).rejects.toThrow(/finish_reason: length.*\(30\)/);
  });

  it('Opus 5.5 refuse thinking "disabled" : retiré, rejoué une fois, puis plus jamais envoyé', async () => {
    const { provider, replay } = providerWithSteps('claude-opus-5-5', [
      { fixture: '400-thinking-disabled-unsupported.json', status: 400 },
      { fixture: '200-text-pong-sonnet.json' },
    ]);
    const first = await provider.chat(USER, [], { maxTokens: 50 });
    expect(first.choices[0]?.message.content).toBe('pong');
    expect(replay.calls).toHaveLength(2);
    expect(replay.calls[0]!.body.thinking).toEqual({ type: 'disabled' });
    expect(replay.calls[1]!.body).not.toHaveProperty('thinking');

    await provider.chat(USER, [], { maxTokens: 50 });
    expect(replay.calls).toHaveLength(3);
    expect(replay.calls[2]!.body).not.toHaveProperty('thinking');
  });

  it('Opus 5.5 borné qui répond vide reste une erreur explicite (la réflexion ne peut pas être coupée)', async () => {
    const { provider } = providerWithSteps('claude-opus-5-5', [
      { fixture: '400-thinking-disabled-unsupported.json', status: 400 },
      { fixture: '200-empty-content-opus-5-5.json' },
    ]);
    await expect(provider.chat(USER, [], { maxTokens: 20 })).rejects.toThrow(/finish_reason: length.*\(20\)/);
  });

  it('un modèle inconnu qui refuse temperature : paramètre retiré, rejoué une fois', async () => {
    const { provider, replay } = providerWithSteps('claude-futur-test', [
      { fixture: '400-temperature-deprecated.json', status: 400 },
      { fixture: '200-text-pong-sonnet.json' },
    ]);
    await provider.chat(USER, [], { temperature: 0.3 });
    expect(replay.calls[0]!.body.temperature).toBe(0.3);
    expect(replay.calls[1]!.body).not.toHaveProperty('temperature');
  });

  it('un 400 qui ne vise rien de ce qu’on a envoyé n’est pas rejoué', async () => {
    const { provider, replay } = providerWithSteps('claude-haiku-5-5', [
      { fixture: '400-adaptive-not-available-compat.json', status: 400 },
    ]);
    await expect(provider.chat(USER, [], {})).rejects.toThrow(/Adaptive thinking is not available/);
    expect(replay.calls).toHaveLength(1);
  });
});
