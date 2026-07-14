import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GROUNDED_VOICE_SYSTEM_PROMPT_APPEND,
  isAlreadySpeakableAgentResult,
  makeAgentReply,
  prepareSelfInspectionVoiceReply,
  runInterruptibleVoiceAgentTurn,
  type AgentRunner,
} from '../../src/sensory/agent-reply.js';
import {
  getPermissionModeManager,
  resetPermissionModeManager,
} from '../../src/security/permission-modes.js';
import {
  getOperatingModeManager,
  resetOperatingModeManager,
} from '../../src/agent/operating-modes.js';
import { resetWorkspaceIsolation } from '../../src/workspace/workspace-isolation.js';
import { guardLisaOperationalSelfInspectionReply } from '../../src/identity/lisa-introspection.js';
import { logger } from '../../src/utils/logger.js';

describe('agent-reply — spoken instruction → full agent turn', () => {
  beforeEach(() => {
    resetPermissionModeManager();
    resetOperatingModeManager();
    resetWorkspaceIsolation();
  });
  afterEach(() => vi.restoreAllMocks());

  it('defines a system-level speech contract for the grounded final response', () => {
    expect(GROUNDED_VOICE_SYSTEM_PROMPT_APPEND).toContain('réponds en français');
    expect(GROUNDED_VOICE_SYSTEM_PROMPT_APPEND).toContain('Adapte la longueur');
    expect(GROUNDED_VOICE_SYSTEM_PROMPT_APPEND).toContain('discussion philosophique');
    expect(GROUNDED_VOICE_SYSTEM_PROMPT_APPEND).toContain('objection honnête');
    expect(GROUNDED_VOICE_SYSTEM_PROMPT_APPEND).toContain("n'annonce pas ce que tu vas faire");
    expect(GROUNDED_VOICE_SYSTEM_PROMPT_APPEND).toContain('ni Markdown');
    expect(GROUNDED_VOICE_SYSTEM_PROMPT_APPEND).toContain('ni liste');
  });

  it('propagates barge-in to the real interruptible agent stream', async () => {
    const controller = new AbortController();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const streamStarted = new Promise<void>((resolve) => { started = resolve; });
    let aborts = 0;
    const fakeAgent = {
      async *processUserMessageStream(): AsyncGenerator<unknown> {
        started();
        await gate;
        yield { type: 'done' };
      },
      getChatHistory: () => [{ type: 'assistant', content: 'Réponse devenue obsolète.' }],
      abortCurrentOperation: () => {
        aborts += 1;
        release();
      },
    };
    const pending = runInterruptibleVoiceAgentTurn(fakeAgent, 'ancienne question', {
      signal: controller.signal,
    });
    await streamStarted;
    controller.abort();
    await expect(pending).resolves.toBe('');
    expect(aborts).toBeGreaterThanOrEqual(1);
  });

  it('extracts the final assistant entry from an uninterrupted streamed agent turn', async () => {
    const streamOptions: Array<
      {
        transientContext?: string;
        relationshipSafety?: boolean;
        surface?: string;
        introspectionText?: string;
      } | undefined
    > = [];
    const fakeAgent = {
      async *processUserMessageStream(
        _message: string,
        options?: {
          transientContext?: string;
          relationshipSafety?: boolean;
          surface?: string;
          introspectionText?: string;
        },
      ): AsyncGenerator<unknown> {
        streamOptions.push(options);
        yield { type: 'content', content: 'partiel' };
        yield { type: 'done' };
      },
      getChatHistory: () => [
        { type: 'user', content: 'question' },
        { type: 'assistant', content: 'Résultat final.' },
      ],
      abortCurrentOperation: vi.fn(),
    };
    await expect(runInterruptibleVoiceAgentTurn(fakeAgent, 'question')).resolves.toBe(
      'Résultat final.'
    );
    expect(fakeAgent.abortCurrentOperation).not.toHaveBeenCalled();
    expect(streamOptions[0]).toMatchObject({
      relationshipSafety: true,
      surface: 'voice',
      introspectionText: 'question',
    });
    expect(streamOptions[0]?.transientContext).toContain('conversation_response_plan');
  });

  it('keeps the explicit utterance separate from a voice prompt containing old introspection', async () => {
    let received:
      | {
          transientContext?: string;
          relationshipSafety?: boolean;
          surface?: string;
          introspectionText?: string;
        }
      | undefined;
    const fakeAgent = {
      async *processUserMessageStream(
        _message: string,
        options?: {
          transientContext?: string;
          relationshipSafety?: boolean;
          surface?: string;
          introspectionText?: string;
        },
      ): AsyncGenerator<unknown> {
        received = options;
        yield { type: 'done' };
      },
      getChatHistory: () => [{ type: 'assistant', content: 'Action vérifiée.' }],
      abortCurrentOperation: vi.fn(),
    };
    const composite =
      'Contexte récent : Patrice: es-tu consciente ?\n\n' +
      'Demande actuelle : crée le fichier demandé';

    await expect(
      runInterruptibleVoiceAgentTurn(fakeAgent, composite, {
        introspectionText: 'crée le fichier demandé',
      }),
    ).resolves.toBe('Action vérifiée.');
    expect(received).toMatchObject({
      surface: 'voice',
      introspectionText: 'crée le fichier demandé',
    });
  });

  it('exposes predictive prepare and teardown without running a user turn', async () => {
    const runner = vi.fn(async () => 'Terminé.') as unknown as AgentRunner;
    runner.prewarm = vi.fn(async () => undefined);
    runner.dispose = vi.fn();
    const reply = makeAgentReply({ agentRunner: runner, summarize: async () => 'unused' });
    await reply.prewarm('cherche les actualités');
    reply.dispose();
    expect(runner.prewarm).toHaveBeenCalledOnce();
    expect(runner.prewarm).toHaveBeenCalledWith('cherche les actualités');
    expect(runner.dispose).toHaveBeenCalledOnce();
    expect(runner).not.toHaveBeenCalled();
  });

  it('falls back for markdown/multiline output and keeps the original transcript', async () => {
    const transcript = 'où en est le projet ?';
    const agentOutput = '## État\n- Le projet compte 27000 tests.\n- La boucle vocale est fermée.';
    const summarize = vi.fn(async (out: string, heard: string) => {
      expect(out).toBe(agentOutput);
      expect(heard).toBe(transcript);
      return 'Tout va bien, la boucle vocale est prête.';
    });
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const reply = makeAgentReply({
      agentRunner: async (heard) => {
        expect(heard).toBe(transcript);
        return agentOutput;
      },
      summarize,
    });
    const spoken = await reply(transcript);
    expect(spoken).toBe('Tout va bien, la boucle vocale est prête.');
    expect(summarize).toHaveBeenCalledWith(
      agentOutput,
      transcript,
      expect.objectContaining({ onProviderResolved: expect.any(Function) }),
    );
    expect(info).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[voice-act\] result timing: agentMs=\d+ms summaryMs=\d+ms summary=fallback$/
      )
    );
  });

  it('skips the second LLM pass when the agent result is already short spoken prose', async () => {
    const summarize = vi.fn(async () => 'inutile');
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const reply = makeAgentReply({
      agentRunner: async () => 'Les tests ciblés passent et le service est prêt.',
      summarize,
    });
    expect(isAlreadySpeakableAgentResult('Les tests ciblés passent.')).toBe(true);
    expect(await reply('vérifie le service')).toBe(
      'Les tests ciblés passent et le service est prêt.'
    );
    expect(summarize).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[voice-act\] result timing: agentMs=\d+ms summaryMs=0ms summary=skipped$/
      )
    );
  });

  it('publishes only the provider that produced the text actually retained', async () => {
    const agentRoute = {
      model: 'grounded-model',
      apiKey: 'grounded-key',
      baseURL: 'https://grounded.example/v1',
    };
    const summaryRoute = {
      model: 'speech-model',
      apiKey: 'speech-key',
      baseURL: 'https://speech.example/v1',
    };
    const published: typeof agentRoute[] = [];
    const agentRunner: AgentRunner = async (_heard, opts) => {
      opts?.onProviderResolved?.(agentRoute);
      return '## Résultat\n- Une réponse longue qui nécessite un résumé parlé.';
    };
    const summarize = vi.fn(async (_output, _heard, opts) => {
      opts?.onProviderResolved?.(summaryRoute);
      return 'Résumé parlé retenu.';
    });
    const reply = makeAgentReply({ agentRunner, summarize });

    expect(await reply('Explique le résultat', {
      onProviderResolved: (route) => published.push(route as typeof agentRoute),
    })).toBe('Résumé parlé retenu.');
    expect(published).toEqual([summaryRoute]);

    const fallbackPublished: typeof agentRoute[] = [];
    const fallback = makeAgentReply({
      agentRunner,
      summarize: async (_output, _heard, opts) => {
        opts?.onProviderResolved?.(summaryRoute);
        throw new Error('summary unavailable');
      },
    });
    expect(await fallback('Explique le résultat', {
      onProviderResolved: (route) => fallbackPublished.push(route as typeof agentRoute),
    })).toContain('Résultat');
    expect(fallbackPublished).toEqual([agentRoute]);

    const unreceiptedPublished: typeof agentRoute[] = [];
    const unreceipted = makeAgentReply({
      agentRunner,
      summarize: async () => 'Résumé distant sans reçu de route.',
    });
    expect(await unreceipted('Explique le résultat', {
      onProviderResolved: (route) => unreceiptedPublished.push(route as typeof agentRoute),
    })).toBe('Résumé distant sans reçu de route.');
    expect(unreceiptedPublished).toEqual([]);
  });

  it('never lets a second model rewrite an operational introspection as consciousness', async () => {
    const summarize = vi.fn(async () => 'Je suis pleinement consciente et je ressens des émotions.');
    const agentOutput =
      '## Inspection technique\n' +
      '- Le fichier src/identity/operational-self-model.ts atteste le modèle opérationnel.\n' +
      `${'Une preuve structurelle vérifiée est disponible. '.repeat(40)}`;
    const reply = makeAgentReply({
      agentRunner: async () => agentOutput,
      summarize,
    });

    const spoken = await reply('Étudie ton propre code et explique comment tu fonctionnes');

    expect(summarize).not.toHaveBeenCalled();
    expect(spoken).toContain('src/identity/operational-self-model.ts');
    expect(spoken).toContain('elle n’établit pas une conscience subjective');
    expect(spoken).not.toContain('pleinement consciente');
    expect(spoken.length).toBeLessThanOrEqual(1100);
  });

  it('removes an unsupported subjective claim from the grounded voice result too', () => {
    const spoken = prepareSelfInspectionVoiceReply(
      'Je suis réellement consciente et je ressens des émotions comme un humain.',
    );
    expect(spoken).toContain('je l’ai écartée');
    expect(spoken).toContain('n’établit pas une conscience subjective');
    expect(spoken).not.toContain('réellement consciente');
  });

  it('does not duplicate the operational boundary after the main last-mile guard', () => {
    const guarded = guardLisaOperationalSelfInspectionReply('Inspection vérifiée.');
    const spoken = prepareSelfInspectionVoiceReply(guarded);
    expect(spoken.match(/Limite importante/g)).toHaveLength(1);
  });

  it('accepts developed spoken prose while rejecting walls of text and markdown', () => {
    const twoHundredTwentyWords = `${Array.from({ length: 219 }, () => 'mot').join(' ')} mot.`;
    const twoHundredTwentyOneWords = `${Array.from({ length: 220 }, () => 'mot').join(' ')} mot.`;

    expect(isAlreadySpeakableAgentResult(twoHundredTwentyWords)).toBe(true);
    expect(isAlreadySpeakableAgentResult(twoHundredTwentyOneWords)).toBe(false);
    expect(isAlreadySpeakableAgentResult('Première phrase. Deuxième phrase !')).toBe(true);
    expect(isAlreadySpeakableAgentResult('Phrase sans ponctuation finale')).toBe(false);
    expect(isAlreadySpeakableAgentResult('Une. Deux. Trois.')).toBe(true);
    expect(isAlreadySpeakableAgentResult('Une. Deux. Trois. Quatre. Cinq. Six. Sept. Huit. Neuf. Dix. Onze.')).toBe(false);
    expect(isAlreadySpeakableAgentResult('Une phrase.\nUne autre.')).toBe(false);
    expect(isAlreadySpeakableAgentResult('## Résultat\nTout va bien.')).toBe(false);
    expect(isAlreadySpeakableAgentResult('Utilise `npm test` maintenant.')).toBe(false);
  });

  it('never throws — a failed turn becomes a spoken apology', async () => {
    const reply = makeAgentReply({
      apology: 'OOPS',
      agentRunner: async () => {
        throw new Error('model down');
      },
      summarize: async () => 'unused',
    });
    await expect(reply('fais un truc')).resolves.toBe('OOPS');
  });

  it('speaks a short confirmation when an ACTING posture produced no text', async () => {
    const reply = makeAgentReply({
      permissionMode: 'dontAsk', // can act → empty output means "did it silently"
      agentRunner: async () => '   ',
      summarize: async () => 'unused',
    });
    await expect(reply('lance les tests')).resolves.toBe("C'est fait.");
  });

  it("is honest in guarded default posture: empty output → couldn't-verify, not a false success", async () => {
    const reply = makeAgentReply({
      agentRunner: async () => '   ',
      summarize: async () => 'unused',
    });
    await expect(reply('lance les tests')).resolves.toBe("Je n'ai pas réussi à vérifier ça, désolée.");
  });

  it('falls back to a readable first paragraph when summarize fails', async () => {
    const reply = makeAgentReply({
      agentRunner: async () => 'Première ligne du résultat.\nDétails markdown ignorés.',
      summarize: async () => {
        throw new Error('summarizer down');
      },
    });
    await expect(reply('résume')).resolves.toBe(
      'Première ligne du résultat. Détails markdown ignorés.'
    );
  });

  it('uses guarded default + balanced only inside the voice turn, so safe bash inspection works', async () => {
    const pm = getPermissionModeManager();
    const operating = getOperatingModeManager();
    // Reproduce an explicit code session already in /plan before Lisa speaks.
    pm.setMode('plan');
    operating.setMode('plan');
    const reply = makeAgentReply({
      cwd: process.cwd(),
      agentRunner: async () => {
        expect(pm.getMode()).toBe('default');
        expect(pm.checkPermission('inspect repository', 'bash').allowed).toBe(true);
        expect(operating.getMode()).toBe('balanced');
        return 'Le dépôt est accessible.';
      },
      summarize: async () => 'unused',
    });

    await expect(reply('lis le dépôt')).resolves.toBe('Le dépôt est accessible.');
    // The explicit code session remains plan after the voice async context ends.
    expect(pm.getMode()).toBe('plan');
    expect(operating.getMode()).toBe('plan');
  });

  it('honors an explicit autonomous posture without persisting it globally', async () => {
    const seen: string[] = [];
    const reply = makeAgentReply({
      permissionMode: 'dontAsk',
      agentRunner: async () => {
        seen.push(getPermissionModeManager().getMode());
        return 'ok';
      },
      summarize: async () => 'ok',
    });
    await reply('édite le fichier');
    expect(seen).toEqual(['dontAsk']);
    expect(getPermissionModeManager().getMode()).toBe('default');
  });

  it('preserves an explicitly requested plan posture for that voice command session only', async () => {
    const seen: string[] = [];
    const reply = makeAgentReply({
      permissionMode: 'plan',
      agentRunner: async () => {
        const pm = getPermissionModeManager();
        seen.push(pm.getMode());
        expect(pm.checkPermission('inspect repository', 'bash').allowed).toBe(false);
        return 'Analyse en lecture seule terminée.';
      },
      summarize: async () => 'unused',
    });
    await reply('prépare seulement un plan');
    expect(seen).toEqual(['plan']);
    expect(getPermissionModeManager().getMode()).toBe('default');
  });

  it('starts the slow turn in parallel with the ack and waits for both', async () => {
    const events: string[] = [];
    let releaseAck: (() => void) | undefined;
    let reportAckStarted: (() => void) | undefined;
    let reportTurnStarted: (() => void) | undefined;
    const ackGate = new Promise<void>((resolve) => {
      releaseAck = resolve;
    });
    const ackStarted = new Promise<void>((resolve) => {
      reportAckStarted = resolve;
    });
    const turnStarted = new Promise<void>((resolve) => {
      reportTurnStarted = resolve;
    });
    const reply = makeAgentReply({
      ack: async () => {
        events.push('ack:start');
        reportAckStarted?.();
        await ackGate;
        events.push('ack:end');
      },
      agentRunner: async () => {
        events.push('turn:start');
        reportTurnStarted?.();
        return 'Terminé.';
      },
      summarize: async () => 'résumé',
    });
    let settled = false;
    const pending = reply('fais X');
    void pending.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    await Promise.all([ackStarted, turnStarted]);
    expect(new Set(events)).toEqual(new Set(['turn:start', 'ack:start']));
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseAck?.();
    await expect(pending).resolves.toBe('Terminé.');
    expect(events).toContain('turn:start');
    expect(events).toContain('ack:start');
    expect(events.at(-1)).toBe('ack:end');
  });

  it('observes an agent rejection while the ack is playing and reports it after the ack', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    let releaseAck: (() => void) | undefined;
    let reportAckStarted: (() => void) | undefined;
    let rejectTurn: ((reason?: unknown) => void) | undefined;
    const ackGate = new Promise<void>((resolve) => {
      releaseAck = resolve;
    });
    const ackStarted = new Promise<void>((resolve) => {
      reportAckStarted = resolve;
    });
    const turnGate = new Promise<string>((_resolve, reject) => {
      rejectTurn = reject;
    });
    const reply = makeAgentReply({
      apology: 'AGENT_FAILED',
      ack: async () => {
        reportAckStarted?.();
        await ackGate;
        throw new Error('ack failed too');
      },
      agentRunner: async () => turnGate,
      summarize: async () => 'unused',
    });
    let settled = false;
    const pending = reply('fais X');
    void pending.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    await ackStarted;
    rejectTurn?.(new Error('agent failed'));
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseAck?.();
    await expect(pending).resolves.toBe('AGENT_FAILED');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('agent failed'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('ack failed too'));
    warn.mockRestore();
  });

  it('returns silence when abort rejects the agent while the ack is playing', async () => {
    const controller = new AbortController();
    let releaseAck: (() => void) | undefined;
    let reportAckStarted: (() => void) | undefined;
    let reportTurnStarted: (() => void) | undefined;
    const ackGate = new Promise<void>((resolve) => {
      releaseAck = resolve;
    });
    const ackStarted = new Promise<void>((resolve) => {
      reportAckStarted = resolve;
    });
    const turnStarted = new Promise<void>((resolve) => {
      reportTurnStarted = resolve;
    });
    const reply = makeAgentReply({
      apology: 'MUST_NOT_SPEAK',
      ack: async () => {
        reportAckStarted?.();
        await ackGate;
      },
      agentRunner: async (_heard, opts) => {
        reportTurnStarted?.();
        return new Promise<string>((_resolve, reject) => {
          const rejectAbort = (): void => reject(new Error('agent aborted'));
          if (opts?.signal?.aborted) rejectAbort();
          else opts?.signal?.addEventListener('abort', rejectAbort, { once: true });
        });
      },
      summarize: async () => 'unused',
    });
    let settled = false;
    const pending = reply('fais X', { signal: controller.signal });
    void pending.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    await Promise.all([ackStarted, turnStarted]);
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseAck?.();
    await expect(pending).resolves.toBe('');
  });
});
