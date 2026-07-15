import { describe, expect, it, vi } from 'vitest';

import type { ArgumentObligation } from '../../src/conversation/argument-obligations.js';
import { assessConversationResponse } from '../../src/conversation/conversation-quality.js';
import { planConversationResponse } from '../../src/conversation/discourse-planner.js';
import {
  SEMANTIC_RESPONSE_CRITIQUE_JSON_SCHEMA,
  runSemanticResponseGate,
  semanticResponseCritiqueSchema,
  shouldRunSemanticResponseGate,
  type SemanticResponseCritique,
  type SemanticResponseGateDependencies,
  type SemanticResponseGateInput,
  type SemanticResponseGateTelemetry,
} from '../../src/conversation/semantic-response-gate.js';
import type {
  ConversationDepth,
  ConversationPlan,
  DialogueAct,
  DiscourseMove,
} from '../../src/conversation/types.js';

const USER_REQUEST = 'Pourquoi la liberté compte-t-elle pour la responsabilité ?';
const ORIGINAL_DRAFT = 'La liberté compte parce qu’elle rend la responsabilité intelligible.';
const ANSWER_OBLIGATION: ArgumentObligation = {
  kind: 'answer_question',
  mode: 'required',
};

function makePlan(options: {
  depth?: ConversationDepth;
  act?: DialogueAct;
  moves?: DiscourseMove[];
  continued?: boolean;
} = {}): ConversationPlan {
  const base = planConversationResponse(USER_REQUEST);
  const depth = options.depth ?? 'developed';
  const act = options.act ?? 'question';
  const continued = options.continued ?? false;
  return {
    ...base,
    depth,
    act,
    moves: options.moves ?? ['direct_answer', 'reason'],
    analysis: {
      ...base.analysis,
      depth,
      act,
      continuesDeliberation: continued,
    },
    deliberation: {
      ...base.deliberation,
      active: continued,
      turnCount: continued ? 3 : 1,
      continuedFromHistory: continued,
    },
  };
}

function makeInput(
  overrides: Partial<SemanticResponseGateInput> = {}
): SemanticResponseGateInput {
  return {
    request: USER_REQUEST,
    draft: ORIGINAL_DRAFT,
    plan: makePlan(),
    obligations: [ANSWER_OBLIGATION],
    ...overrides,
  };
}

function critique(
  overrides: Partial<Omit<SemanticResponseCritique, 'dimensions'>> & {
    dimensions?: Partial<SemanticResponseCritique['dimensions']>;
  } = {}
): string {
  return JSON.stringify({
    schemaVersion: 1,
    confidence: 0.95,
    dimensions: {
      answerCoverage: 0.95,
      logicalCoherence: 0.95,
      supportQuality: 0.95,
      objectionHandling: 0.95,
      threadProgression: 0.95,
      evidenceGrounding: null,
      ...overrides.dimensions,
    },
    failedObligationIds: [],
    issueCodes: [],
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'dimensions')
    ),
  });
}

function dependencies(
  overrides: Partial<SemanticResponseGateDependencies> = {}
): SemanticResponseGateDependencies {
  return {
    critic: vi.fn(async () => critique()),
    revise: vi.fn(async () => 'Réponse révisée.'),
    ...overrides,
  };
}

describe('semantic response gate', () => {
  it('runs only for developed, deliberative, or explicitly factual-analytical turns', () => {
    const standard = makePlan({ depth: 'standard', act: 'question' });
    const developed = makePlan({ depth: 'developed' });
    const deliberative = makePlan({ depth: 'deliberative' });
    const freshAnalytical = makePlan({
      depth: 'standard',
      act: 'fresh_information',
      moves: ['direct_answer', 'evidence', 'significance'],
    });

    expect(shouldRunSemanticResponseGate({ plan: standard })).toBe(false);
    expect(shouldRunSemanticResponseGate({ plan: developed })).toBe(true);
    expect(shouldRunSemanticResponseGate({ plan: deliberative })).toBe(true);
    expect(shouldRunSemanticResponseGate({ plan: freshAnalytical })).toBe(true);
    expect(
      shouldRunSemanticResponseGate({ plan: standard, profile: 'factual_analytical' })
    ).toBe(true);
  });

  it('skips an ineligible turn without invoking either model dependency', async () => {
    const deps = dependencies();
    const result = await runSemanticResponseGate(
      makeInput({ plan: makePlan({ depth: 'standard' }) }),
      deps
    );

    expect(result).toMatchObject({
      response: ORIGINAL_DRAFT,
      outcome: 'skipped',
      reason: 'ineligible',
      revisionAttempts: 0,
    });
    expect(deps.critic).not.toHaveBeenCalled();
    expect(deps.revise).not.toHaveBeenCalled();
  });

  it('places the exact strict JSON contract in the critic prompt', async () => {
    const critic = vi.fn(async () => critique());
    const result = await runSemanticResponseGate(makeInput(), dependencies({ critic }));

    expect(result.outcome).toBe('accepted');
    expect(critic).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: expect.stringContaining('"schemaVersion":{"const":1}'),
      jsonSchema: expect.objectContaining({ additionalProperties: false }),
    }));
  });

  it('accepts only from the numeric contract and applicable obligations', async () => {
    const deps = dependencies({
      critic: vi.fn(async () =>
        critique({
          // These dimensions do not apply to a new thread without objections or facts.
          dimensions: {
            objectionHandling: 0,
            threadProgression: 0,
            evidenceGrounding: null,
          },
        })
      ),
    });
    const result = await runSemanticResponseGate(makeInput(), deps);

    expect(result).toMatchObject({
      response: ORIGINAL_DRAFT,
      outcome: 'accepted',
      reason: 'audit_passed',
      revisionAttempts: 0,
      audit: { accepted: true, lowDimensions: [] },
    });
    expect(deps.revise).not.toHaveBeenCalled();
  });

  it('performs exactly one revision when an applicable semantic dimension fails', async () => {
    const critic = vi
      .fn()
      .mockResolvedValueOnce(
        critique({
          dimensions: { logicalCoherence: 0.2 },
          issueCodes: ['non_sequitur'],
        }),
      )
      .mockResolvedValueOnce(critique());
    const revise = vi.fn(async () => 'La responsabilité suppose une marge de choix réelle.');
    const result = await runSemanticResponseGate(makeInput(), { critic, revise });

    expect(result).toMatchObject({
      response: 'La responsabilité suppose une marge de choix réelle.',
      outcome: 'revised',
      reason: 'revision_completed',
      revisionAttempts: 1,
      audit: {
        accepted: false,
        issueCodes: ['non_sequitur'],
        lowDimensions: ['logicalCoherence'],
      },
      verificationAudit: { accepted: true },
    });
    expect(critic).toHaveBeenCalledTimes(2);
    expect(revise).toHaveBeenCalledTimes(1);
  });

  it('stops after one audit for an exclusively ungrounded fresh answer when a grounded fallback exists', async () => {
    const critic = vi.fn(async () =>
      critique({
        dimensions: { supportQuality: 0.3, evidenceGrounding: 0.1 },
        failedObligationIds: ['source_fresh_facts'],
        issueCodes: ['ungrounded_fresh_claim', 'unsupported_claim'],
      }),
    );
    const revise = vi.fn();
    const result = await runSemanticResponseGate(
      makeInput({
        request: 'Quelles sont les actualités importantes aujourd’hui ?',
        plan: makePlan({
          depth: 'developed',
          act: 'fresh_information',
          moves: ['direct_answer', 'evidence', 'significance'],
        }),
        obligations: [
          { kind: 'source_fresh_facts', mode: 'required' },
          {
            kind: 'express_uncertainty',
            mode: 'conditional',
            when: 'fresh_context_unavailable',
          },
        ],
        evidence: '{"title":"Titre vérifié","url":"https://example.test/source"}',
        history: [
          { role: 'user', content: 'HISTORIQUE_INUTILE' },
          { role: 'assistant', content: 'ANCIENNE_REPONSE_INUTILE' },
        ],
      }),
      { critic, revise },
      { stopAfterFreshGroundingFailure: true },
    );

    expect(result).toMatchObject({
      response: ORIGINAL_DRAFT,
      outcome: 'fail_open',
      reason: 'fresh_grounding_rejected',
      revisionAttempts: 0,
    });
    expect(critic).toHaveBeenCalledTimes(1);
    expect(revise).not.toHaveBeenCalled();
    const criticPrompt = String(critic.mock.calls[0]?.[0]?.userPrompt ?? '');
    expect(criticPrompt).toContain('https://example.test/source');
    expect(criticPrompt).not.toContain('HISTORIQUE_INUTILE');
    expect(criticPrompt).not.toContain('ANCIENNE_REPONSE_INUTILE');
  });

  it('keeps revision and independent verification for non-grounding defects on fresh answers', async () => {
    const critic = vi
      .fn()
      .mockResolvedValueOnce(
        critique({
          dimensions: { logicalCoherence: 0.1 },
          issueCodes: ['non_sequitur'],
        }),
      )
      .mockResolvedValueOnce(critique({ dimensions: { evidenceGrounding: 0.95 } }));
    const revise = vi.fn(async () => 'Analyse fraîche corrigée et sourcée.');
    const result = await runSemanticResponseGate(
      makeInput({
        plan: makePlan({ depth: 'developed', act: 'fresh_information' }),
        evidence: '{"url":"https://example.test/source"}',
      }),
      { critic, revise },
      { stopAfterFreshGroundingFailure: true },
    );

    expect(result).toMatchObject({
      outcome: 'revised',
      reason: 'revision_completed',
      revisionAttempts: 1,
    });
    expect(critic).toHaveBeenCalledTimes(2);
    expect(revise).toHaveBeenCalledTimes(1);
  });

  it('keeps the original draft when the one revision is still semantic nonsense', async () => {
    const critic = vi
      .fn()
      .mockResolvedValueOnce(
        critique({
          dimensions: { logicalCoherence: 0.1 },
          issueCodes: ['non_sequitur'],
        }),
      )
      .mockResolvedValueOnce(
        critique({
          dimensions: { answerCoverage: 0.05, logicalCoherence: 0.02 },
          failedObligationIds: ['answer_question'],
          issueCodes: ['does_not_answer', 'non_sequitur'],
        }),
      );
    const revise = vi.fn(async () => 'Les bananes prouvent que le triangle est bleu.');

    const result = await runSemanticResponseGate(makeInput(), { critic, revise });

    expect(result).toMatchObject({
      response: ORIGINAL_DRAFT,
      outcome: 'fail_open',
      reason: 'revision_rejected',
      revisionAttempts: 1,
      verificationAudit: {
        accepted: false,
        issueCodes: ['does_not_answer', 'non_sequitur'],
      },
    });
    expect(critic).toHaveBeenCalledTimes(2);
    expect(revise).toHaveBeenCalledTimes(1);
  });

  it('keeps the original draft when the revision cannot be independently verified', async () => {
    const critic = vi
      .fn()
      .mockResolvedValueOnce(
        critique({
          dimensions: { answerCoverage: 0.1 },
          failedObligationIds: ['answer_question'],
          issueCodes: ['does_not_answer'],
        }),
      )
      .mockResolvedValueOnce('not-json');

    const result = await runSemanticResponseGate(
      makeInput(),
      { critic, revise: vi.fn(async () => 'Révision plausible mais non certifiée.') },
    );

    expect(result).toMatchObject({
      response: ORIGINAL_DRAFT,
      outcome: 'fail_open',
      reason: 'revision_unverified',
      revisionAttempts: 1,
    });
  });

  it('never delivers a revision tail that fell outside the critic input bound', async () => {
    const critic = vi.fn().mockResolvedValue(
      critique({
        dimensions: { answerCoverage: 0.1 },
        failedObligationIds: ['answer_question'],
        issueCodes: ['does_not_answer'],
      }),
    );
    const oversizedRevision = `${'Préfixe cohérent. '.repeat(1_500)}QUEUE_NON_AUDITEE`;

    const result = await runSemanticResponseGate(
      makeInput(),
      { critic, revise: vi.fn(async () => oversizedRevision) },
    );

    expect(result).toMatchObject({
      response: ORIGINAL_DRAFT,
      outcome: 'fail_open',
      reason: 'revision_unverified',
      revisionAttempts: 1,
    });
    expect(result.response).not.toContain('QUEUE_NON_AUDITEE');
    expect(critic).toHaveBeenCalledTimes(1);
  });

  it('never labels an initial draft accepted when its tail was outside the critic bound', async () => {
    const oversizedDraft = `${'Préfixe raisonnable. '.repeat(1_400)}QUEUE_INITIALE_NON_AUDITEE`;
    const critic = vi.fn().mockResolvedValue(critique());

    const result = await runSemanticResponseGate(
      makeInput({ draft: oversizedDraft }),
      { critic, revise: vi.fn() },
    );

    expect(result).toMatchObject({
      response: oversizedDraft,
      outcome: 'fail_open',
      reason: 'draft_unverified',
      revisionAttempts: 0,
    });
    expect(critic).not.toHaveBeenCalled();
  });

  it('lets semantic criticism override a lexical false positive', async () => {
    const request = 'Argumente sur la valeur du libre arbitre et de la responsabilité.';
    const nonsensical =
      'La lune est morale parce que les bananes sont libres. Cependant, un triangle contredit la démocratie. ' +
      'Même si le silence est carré, je reconnais que le hasard ressent du bleu. ' +
      'En synthèse, la conscience est donc une chaise.';
    expect(assessConversationResponse(request, nonsensical).passes).toBe(true);

    const result = await runSemanticResponseGate(
      makeInput({
        request,
        draft: nonsensical,
        plan: makePlan({ depth: 'deliberative', act: 'opinion' }),
        obligations: [{ kind: 'support_position', mode: 'required' }],
      }),
      dependencies({
        critic: vi
          .fn()
          .mockResolvedValueOnce(
            critique({
              dimensions: { logicalCoherence: 0.05, supportQuality: 0.05 },
              failedObligationIds: ['support_position'],
              issueCodes: ['non_sequitur', 'unsupported_claim'],
            }),
          )
          .mockResolvedValueOnce(critique()),
      })
    );

    expect(result.outcome).toBe('revised');
    expect(result.revisionAttempts).toBe(1);
  });

  it('does not revise a coherent concise answer merely because the lexical scorer rejects it', async () => {
    const request = 'Argumente sur la valeur du libre arbitre et de la responsabilité.';
    const concise =
      'Une responsabilité juste doit rester proportionnée à la liberté réelle dont une personne disposait.';
    expect(assessConversationResponse(request, concise).passes).toBe(false);
    const deps = dependencies();

    const result = await runSemanticResponseGate(
      makeInput({
        request,
        draft: concise,
        plan: makePlan({ depth: 'deliberative', act: 'opinion' }),
        obligations: [{ kind: 'support_position', mode: 'required' }],
      }),
      deps
    );

    expect(result.outcome).toBe('accepted');
    expect(result.response).toBe(concise);
    expect(deps.revise).not.toHaveBeenCalled();
  });

  it.each([
    ['markdown fenced JSON', () => `\`\`\`json\n${critique()}\n\`\`\``],
    [
      'an extra prose field',
      () =>
        JSON.stringify({
          ...JSON.parse(critique()),
          explanation: 'verbatim must not be accepted',
        }),
    ],
    [
      'an obligation that was not offered',
      () => critique({ failedObligationIds: ['support_position'] }),
    ],
  ])('fails open on strict critic violation: %s', async (_label, raw) => {
    const deps = dependencies({ critic: vi.fn(async () => raw()) });
    const result = await runSemanticResponseGate(makeInput(), deps);

    expect(result).toMatchObject({
      response: ORIGINAL_DRAFT,
      outcome: 'fail_open',
      reason: 'critic_invalid',
      revisionAttempts: 0,
    });
    expect(deps.revise).not.toHaveBeenCalled();
  });

  it('publishes matching strict Zod and JSON schemas', () => {
    const valid = JSON.parse(critique());
    expect(semanticResponseCritiqueSchema.safeParse(valid).success).toBe(true);
    expect(SEMANTIC_RESPONSE_CRITIQUE_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(
      SEMANTIC_RESPONSE_CRITIQUE_JSON_SCHEMA.properties.dimensions.additionalProperties
    ).toBe(false);
    expect(semanticResponseCritiqueSchema.safeParse({ ...valid, verdict: 'pass' }).success).toBe(
      false
    );
  });

  it('requires evidence grounding when fresh facts are an obligation', async () => {
    const deps = dependencies({
      critic: vi
        .fn()
        .mockResolvedValueOnce(
          critique({
            dimensions: { evidenceGrounding: null },
            failedObligationIds: ['source_fresh_facts'],
            issueCodes: ['ungrounded_fresh_claim'],
          }),
        )
        .mockResolvedValueOnce(
          critique({ dimensions: { evidenceGrounding: 0.95 } }),
        ),
    });
    const result = await runSemanticResponseGate(
      makeInput({
        evidence: 'Bulletin déjà sanitizé.',
        obligations: [
          ANSWER_OBLIGATION,
          { kind: 'source_fresh_facts', mode: 'required' },
        ],
      }),
      deps
    );

    expect(result.outcome).toBe('revised');
    expect(result.audit?.lowDimensions).toContain('evidenceGrounding');
  });

  it('does not force a rewrite when no safe tool-evidence bundle was supplied', async () => {
    const result = await runSemanticResponseGate(
      makeInput({
        draft: 'Selon Reuters, le résultat publié aujourd’hui est de 42.',
        obligations: [
          ANSWER_OBLIGATION,
          { kind: 'source_fresh_facts', mode: 'required' },
        ],
      }),
      dependencies({
        critic: vi.fn(async () => critique({ dimensions: { evidenceGrounding: null } })),
      })
    );

    expect(result.outcome).toBe('accepted');
    expect(result.audit?.lowDimensions).not.toContain('evidenceGrounding');
  });

  it('fails open instead of rewriting from an uncertain negative critique', async () => {
    const deps = dependencies({
      critic: vi.fn(async () =>
        critique({
          confidence: 0.2,
          dimensions: { answerCoverage: 0.1 },
          failedObligationIds: ['answer_question'],
          issueCodes: ['does_not_answer'],
        })
      ),
    });
    const result = await runSemanticResponseGate(makeInput(), deps);

    expect(result).toMatchObject({
      response: ORIGINAL_DRAFT,
      outcome: 'fail_open',
      reason: 'critic_uncertain',
      revisionAttempts: 0,
    });
    expect(deps.revise).not.toHaveBeenCalled();
  });

  it('does not claim acceptance from an uncertain positive critique', async () => {
    const result = await runSemanticResponseGate(
      makeInput(),
      dependencies({ critic: vi.fn(async () => critique({ confidence: 0.2 })) })
    );

    expect(result).toMatchObject({
      response: ORIGINAL_DRAFT,
      outcome: 'fail_open',
      reason: 'critic_uncertain',
      revisionAttempts: 0,
      audit: { accepted: false },
    });
  });

  it('fails open with distinct critic and revision failures', async () => {
    const criticFailure = await runSemanticResponseGate(
      makeInput(),
      dependencies({ critic: vi.fn(async () => Promise.reject(new Error('provider down'))) })
    );
    const revisionFailure = await runSemanticResponseGate(
      makeInput(),
      dependencies({
        critic: vi.fn(async () =>
          critique({
            dimensions: { answerCoverage: 0.1 },
            failedObligationIds: ['answer_question'],
            issueCodes: ['does_not_answer'],
          })
        ),
        revise: vi.fn(async () => Promise.reject(new Error('revision down'))),
      })
    );

    expect(criticFailure).toMatchObject({
      outcome: 'fail_open',
      reason: 'critic_failed',
      revisionAttempts: 0,
    });
    expect(revisionFailure).toMatchObject({
      outcome: 'fail_open',
      reason: 'revision_failed',
      revisionAttempts: 1,
    });
  });

  it('enforces its deadline even when an injected critic ignores the abort signal', async () => {
    let criticSignal: AbortSignal | undefined;
    const deps = dependencies({
      critic: vi.fn(({ signal }) => {
        criticSignal = signal;
        return new Promise<string>(() => undefined);
      }),
    });

    const result = await runSemanticResponseGate(makeInput(), deps, { timeoutMs: 10 });

    expect(result).toMatchObject({
      response: ORIGINAL_DRAFT,
      outcome: 'fail_open',
      reason: 'timeout',
      revisionAttempts: 0,
    });
    expect(criticSignal?.aborted).toBe(true);
  });

  it('reports one attempted revision when the shared deadline expires during revision', async () => {
    let revisionSignal: AbortSignal | undefined;
    const result = await runSemanticResponseGate(
      makeInput(),
      dependencies({
        critic: vi.fn(async () =>
          critique({
            dimensions: { answerCoverage: 0.1 },
            failedObligationIds: ['answer_question'],
            issueCodes: ['does_not_answer'],
          })
        ),
        revise: vi.fn(({ signal }) => {
          revisionSignal = signal;
          return new Promise<string>(() => undefined);
        }),
      }),
      { timeoutMs: 10 }
    );

    expect(result).toMatchObject({
      response: ORIGINAL_DRAFT,
      outcome: 'fail_open',
      reason: 'timeout',
      revisionAttempts: 1,
    });
    expect(revisionSignal?.aborted).toBe(true);
  });

  it('honors a caller abort without starting the critic', async () => {
    const controller = new AbortController();
    controller.abort(new Error('caller stopped'));
    const deps = dependencies();

    const result = await runSemanticResponseGate(makeInput(), deps, {
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      response: ORIGINAL_DRAFT,
      outcome: 'fail_open',
      reason: 'caller_aborted',
      revisionAttempts: 0,
    });
    expect(deps.critic).not.toHaveBeenCalled();
    expect(deps.revise).not.toHaveBeenCalled();
  });

  it('does not start the critic when abort wins the pre-call microtask race', async () => {
    const controller = new AbortController();
    const deps = dependencies();

    const pending = runSemanticResponseGate(makeInput(), deps, {
      signal: controller.signal,
    });
    controller.abort(new Error('caller stopped before provider dispatch'));
    const result = await pending;

    expect(result).toMatchObject({
      response: ORIGINAL_DRAFT,
      outcome: 'fail_open',
      reason: 'caller_aborted',
      revisionAttempts: 0,
    });
    expect(deps.critic).not.toHaveBeenCalled();
    expect(deps.revise).not.toHaveBeenCalled();
  });

  it('passes bounded evidence and thread data to models but never to telemetry', async () => {
    const marker = 'VERBATIM_SECRET_SENTINEL';
    const tailMarker = 'TRUNCATED_TAIL_SENTINEL';
    const events: SemanticResponseGateTelemetry[] = [];
    let criticPrompt = '';
    let revisionPrompt = '';
    let criticCall = 0;
    const result = await runSemanticResponseGate(
      makeInput({
        request: `${USER_REQUEST} ${marker}`,
        draft: `${ORIGINAL_DRAFT} ${marker}`,
        history: [{ role: 'user', content: `contexte partagé ${marker}` }],
        evidence: `preuve fraîche ${marker}${'x'.repeat(20_000)}${tailMarker}`,
      }),
      {
        critic: vi.fn(async request => {
          criticCall += 1;
          criticPrompt = request.userPrompt;
          return criticCall === 1
            ? critique({
                dimensions: { answerCoverage: 0.1 },
                failedObligationIds: ['answer_question'],
                issueCodes: ['does_not_answer'],
              })
            : critique({ dimensions: { evidenceGrounding: 0.95 } });
        }),
        revise: vi.fn(async request => {
          revisionPrompt = request.userPrompt;
          return `révision finale ${marker}`;
        }),
        telemetry: event => events.push(event),
      }
    );

    expect(criticPrompt).toContain(marker);
    expect(revisionPrompt).toContain(marker);
    expect(criticPrompt).not.toContain(tailMarker);
    expect(revisionPrompt).not.toContain(tailMarker);
    expect(result.response).toContain(marker);
    expect(JSON.stringify(events)).not.toContain(marker);
    expect(JSON.stringify(events)).not.toContain('preuve fraîche');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'semantic_response_gate',
      outcome: 'revised',
      criticCalls: 2,
      revisionAttempts: 1,
      failedObligationCount: 1,
    });
  });

  it('does not let a telemetry failure alter an accepted response', async () => {
    const result = await runSemanticResponseGate(
      makeInput(),
      dependencies({
        telemetry: () => {
          throw new Error('telemetry unavailable');
        },
      })
    );
    expect(result.outcome).toBe('accepted');
    expect(result.response).toBe(ORIGINAL_DRAFT);
  });

  it('isolates returned audit data from mutations made by a telemetry sink', async () => {
    const result = await runSemanticResponseGate(
      makeInput(),
      dependencies({
        telemetry: event => {
          if (event.dimensions) event.dimensions.answerCoverage = 0;
          event.issueCodes.push('does_not_answer');
        },
      })
    );

    expect(result.audit?.dimensions.answerCoverage).toBe(0.95);
    expect(result.audit?.issueCodes).toEqual([]);
  });
});
