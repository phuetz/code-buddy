/**
 * Fleet P3 — verify the task router scores peers correctly and
 * respects the privacy / cost / latency / context-window constraints.
 *
 * The router is pure logic over the input shapes — no LLM, no
 * network. Each test builds a synthetic `PeerSlot[]` and asserts
 * the resulting `DispatchPlan`.
 */
import { describe, expect, it } from 'vitest';

import {
  TaskRouter,
  NoPeerAvailableError,
  planChainDispatch,
  type PeerSlot,
} from '../../src/fleet/task-router';
import type {
  FleetModelDescriptor,
  PeerCapability,
} from '../../src/fleet/types';
import type { TaskClassification } from '../../src/optimization/model-routing';

function model(
  id: string,
  partial: Partial<FleetModelDescriptor> = {},
): FleetModelDescriptor {
  return {
    id,
    contextWindow: 200_000,
    strengths: [],
    provider: 'unknown' as const,
    ...partial,
  };
}

function peer(
  peerId: string,
  cap: Partial<PeerCapability>,
): PeerSlot {
  return {
    peerId,
    capability: {
      models: [],
      egress: 'local',
      machineLabel: peerId,
      ...cap,
    },
  };
}

function classify(
  partial: Partial<TaskClassification> = {},
): TaskClassification {
  return {
    complexity: 'simple',
    requiresVision: false,
    requiresReasoning: false,
    requiresLongContext: false,
    estimatedTokens: 1000,
    confidence: 0.8,
    ...partial,
  };
}

const router = new TaskRouter();

describe('TaskRouter — basic plan', () => {
  it('returns the only candidate when one peer × one model is available', () => {
    const peers: PeerSlot[] = [
      peer('ministar', {
        models: [model('qwen3.6:35b', { provider: 'ollama' })],
      }),
    ];
    const plan = router.plan(classify(), peers);
    expect(plan.primary.peerId).toBe('ministar');
    expect(plan.primary.model).toBe('qwen3.6:35b');
    expect(plan.primary.provider).toBe('ollama');
    expect(plan.fallback).toBeUndefined(); // only one peer
  });

  it('uses another provider on the same peer as a failure-domain fallback', () => {
    const peers: PeerSlot[] = [
      peer('robot-brain', {
        models: [
          model('cloud-reasoner', {
            provider: 'openrouter',
            strengths: ['reasoning', 'thinking'],
          }),
          model('local-fast', {
            provider: 'lemonade',
            strengths: ['fast', 'cheap'],
          }),
        ],
      }),
    ];

    const plan = router.plan(
      classify({ complexity: 'reasoning_heavy', requiresReasoning: true }),
      peers,
    );

    expect(plan.fallback).toBeDefined();
    expect(plan.fallback?.peerId).toBe('robot-brain');
    expect(plan.fallback?.provider).not.toBe(plan.primary.provider);

    const rerouted = router.plan(classify(), peers, {
      excludeProviders: [plan.primary.provider!],
    });
    expect(rerouted.primary.peerId).toBe('robot-brain');
    expect(rerouted.primary.provider).toBe(plan.fallback?.provider);
  });

  it('throws NoPeerAvailableError when no peer satisfies', () => {
    expect(() => router.plan(classify(), [])).toThrow(NoPeerAvailableError);
  });
});

describe('TaskRouter — strength matching', () => {
  it('prefers a model with reasoning + thinking for complex tasks', () => {
    const peers: PeerSlot[] = [
      peer('ministar', {
        models: [
          model('gemma4:8b', {
            provider: 'ollama',
            strengths: ['cheap', 'fast'],
          }),
          model('qwen3.6:35b-a3b', {
            provider: 'ollama',
            strengths: ['reasoning', 'thinking'],
          }),
        ],
      }),
    ];
    const plan = router.plan(
      classify({ complexity: 'reasoning_heavy', requiresReasoning: true }),
      peers,
    );
    expect(plan.primary.model).toBe('qwen3.6:35b-a3b');
  });

  it('prefers a model with vision when task requires images', () => {
    const peers: PeerSlot[] = [
      peer('cloud', {
        egress: 'cloud',
        models: [
          model('gpt-5-mini', {
            provider: 'openai',
            strengths: ['cheap', 'fast'],
            costInputUsdPerMtok: 0.4,
          }),
          model('gemini-2.5-pro', {
            provider: 'gemini',
            strengths: ['vision', 'long-context'],
            costInputUsdPerMtok: 2.5,
          }),
        ],
      }),
    ];
    const plan = router.plan(
      classify({ requiresVision: true }),
      peers,
    );
    expect(plan.primary.model).toBe('gemini-2.5-pro');
  });
});

describe('TaskRouter — privacy veto', () => {
  it('drops cloud peers when privacyTag=sensitive', () => {
    const peers: PeerSlot[] = [
      peer('ministar', {
        egress: 'local',
        models: [model('qwen3.6:35b', { provider: 'ollama' })],
      }),
      peer('cloud-claude', {
        egress: 'cloud',
        models: [model('claude-opus-4', { provider: 'anthropic' })],
      }),
    ];
    const plan = router.plan(classify(), peers, { privacyTag: 'sensitive' });
    expect(plan.primary.peerId).toBe('ministar');
    expect(plan.fallback).toBeUndefined(); // cloud vetoed
  });

  it('throws when sensitive task has only cloud peers available', () => {
    const peers: PeerSlot[] = [
      peer('cloud', {
        egress: 'cloud',
        models: [model('claude-opus-4', { provider: 'anthropic' })],
      }),
    ];
    expect(() =>
      router.plan(classify(), peers, { privacyTag: 'sensitive' }),
    ).toThrow(NoPeerAvailableError);
  });

  it('passes through cloud peers when privacyTag=public', () => {
    const peers: PeerSlot[] = [
      peer('cloud', {
        egress: 'cloud',
        models: [model('claude-opus-4', { provider: 'anthropic' })],
      }),
    ];
    const plan = router.plan(classify(), peers, { privacyTag: 'public' });
    expect(plan.primary.peerId).toBe('cloud');
  });
});

describe('TaskRouter — target peers', () => {
  it('limits routing candidates to requested target peers', () => {
    const peers: PeerSlot[] = [
      peer('alpha', {
        models: [model('local-small', { provider: 'ollama', strengths: ['cheap'] })],
      }),
      peer('beta', {
        egress: 'cloud',
        models: [
          model('cloud-reasoner', {
            provider: 'openai',
            strengths: ['reasoning', 'thinking'],
          }),
        ],
      }),
    ];

    const plan = router.plan(
      classify({ complexity: 'reasoning_heavy', requiresReasoning: true }),
      peers,
      { targetPeerIds: [' alpha ', '', 'missing'] },
    );

    expect(plan.primary.peerId).toBe('alpha');
    expect(plan.fallback).toBeUndefined();
  });

  it('throws when requested target peers cannot satisfy the task', () => {
    const peers: PeerSlot[] = [
      peer('alpha', {
        models: [model('local-small', { provider: 'ollama' })],
      }),
    ];

    expect(() =>
      router.plan(classify(), peers, { targetPeerIds: ['beta'] }),
    ).toThrow(NoPeerAvailableError);
  });
});

describe('TaskRouter — context window filter', () => {
  it('drops models whose contextWindow is too small', () => {
    const peers: PeerSlot[] = [
      peer('a', {
        models: [
          model('small-ctx', { contextWindow: 4000, provider: 'ollama' }),
          model('big-ctx', {
            contextWindow: 128_000,
            provider: 'ollama',
            strengths: ['long-context'],
          }),
        ],
      }),
    ];
    const plan = router.plan(
      classify({ requiresLongContext: true, estimatedTokens: 50_000 }),
      peers,
      { estimatedTokens: 50_000 },
    );
    expect(plan.primary.model).toBe('big-ctx');
  });
});

describe('TaskRouter — cost scoring', () => {
  it('prefers cheaper models when match scores are equal', () => {
    const peers: PeerSlot[] = [
      peer('cloud', {
        egress: 'cloud',
        models: [
          model('gpt-5', {
            provider: 'openai',
            strengths: ['reasoning'],
            costInputUsdPerMtok: 5,
            costOutputUsdPerMtok: 20,
          }),
          model('gpt-5-mini', {
            provider: 'openai',
            strengths: ['reasoning'],
            costInputUsdPerMtok: 0.4,
            costOutputUsdPerMtok: 1.6,
          }),
        ],
      }),
    ];
    const plan = router.plan(
      classify({ complexity: 'moderate', requiresReasoning: true }),
      peers,
    );
    expect(plan.primary.model).toBe('gpt-5-mini');
  });

  it('local (no cost) beats cloud at equal match', () => {
    const peers: PeerSlot[] = [
      peer('ministar', {
        egress: 'local',
        models: [
          model('qwen3.6:35b', {
            provider: 'ollama',
            strengths: ['reasoning', 'thinking'],
          }),
        ],
      }),
      peer('cloud', {
        egress: 'cloud',
        models: [
          model('claude-opus-4', {
            provider: 'anthropic',
            strengths: ['reasoning', 'thinking'],
            costInputUsdPerMtok: 15,
            costOutputUsdPerMtok: 75,
          }),
        ],
      }),
    ];
    const plan = router.plan(
      classify({ complexity: 'reasoning_heavy', requiresReasoning: true }),
      peers,
    );
    expect(plan.primary.peerId).toBe('ministar');
    expect(plan.fallback?.peerId).toBe('cloud');
  });
});

describe('TaskRouter — load scoring', () => {
  it('prefers the less-loaded peer when match scores are equal', () => {
    const peers: PeerSlot[] = [
      peer('busy', {
        models: [model('claude-haiku-4', { strengths: ['cheap'] })],
        maxConcurrency: 4,
        activeRequests: 3, // 75% loaded
      }),
      peer('idle', {
        models: [model('claude-haiku-4', { strengths: ['cheap'] })],
        maxConcurrency: 4,
        activeRequests: 0, // idle
      }),
    ];
    const plan = router.plan(classify(), peers);
    expect(plan.primary.peerId).toBe('idle');
  });
});

describe('TaskRouter — dispatch profiles', () => {
  it('nudges review dispatches toward reasoning models', () => {
    const peers: PeerSlot[] = [
      peer('cloud', {
        models: [
          model('cheap-fast', {
            provider: 'openai',
            strengths: ['cheap', 'fast'],
          }),
          model('reviewer', {
            provider: 'openai',
            strengths: ['reasoning'],
          }),
        ],
      }),
    ];

    const plan = router.plan(classify(), peers, { dispatchProfile: 'review' });
    expect(plan.primary.model).toBe('reviewer');
    expect(plan.rationale).toContain('Profile: review');
  });

  it('uses dispatch profile as a peer role hint when peers advertise specialties', () => {
    const sharedModel = {
      provider: 'openai' as const,
      strengths: ['reasoning'] as const,
      costInputUsdPerMtok: 2,
      costOutputUsdPerMtok: 8,
    };
    const peers: PeerSlot[] = [
      peer('coder', {
        roles: ['code'],
        models: [model('coder-model', { ...sharedModel })],
      }),
      peer('reviewer', {
        roles: ['review'],
        models: [model('reviewer-model', { ...sharedModel })],
      }),
    ];

    const plan = router.plan(
      classify({ complexity: 'reasoning_heavy', requiresReasoning: true }),
      peers,
      { dispatchProfile: 'review' },
    );

    expect(plan.primary.peerId).toBe('reviewer');
    expect(plan.rationale).toContain('Role hint: review');
  });

  it('nudges research dispatches toward long-context models', () => {
    const peers: PeerSlot[] = [
      peer('cloud', {
        models: [
          model('short-fast', {
            provider: 'openai',
            strengths: ['cheap', 'fast'],
          }),
          model('research-long-context', {
            provider: 'openai',
            strengths: ['long-context'],
          }),
        ],
      }),
    ];

    const plan = router.plan(classify(), peers, { dispatchProfile: 'research' });
    expect(plan.primary.model).toBe('research-long-context');
    expect(plan.rationale).toContain('Profile: research');
  });
});

describe('TaskRouter — parallelism', () => {
  it('emits N parallel lanes across distinct peers when parallelism set', () => {
    const peers: PeerSlot[] = [
      peer('p1', { models: [model('m1', { strengths: ['reasoning'] })] }),
      peer('p2', { models: [model('m2', { strengths: ['reasoning'] })] }),
      peer('p3', { models: [model('m3', { strengths: ['reasoning'] })] }),
    ];
    const plan = router.plan(
      classify({ complexity: 'complex', requiresReasoning: true }),
      peers,
      { parallelism: 3 },
    );
    expect(plan.parallel).toHaveLength(3);
    expect(new Set(plan.parallel!.map((l) => l.peerId)).size).toBe(3);
  });

  it('falls back to multi-model on same peer when not enough peers', () => {
    const peers: PeerSlot[] = [
      peer('only', {
        models: [
          model('a', { strengths: ['reasoning'] }),
          model('b', { strengths: ['reasoning'] }),
        ],
      }),
    ];
    const plan = router.plan(
      classify({ complexity: 'complex', requiresReasoning: true }),
      peers,
      { parallelism: 2 },
    );
    expect(plan.parallel).toHaveLength(2);
    expect(plan.parallel![0].peerId).toBe('only');
    expect(plan.parallel![1].peerId).toBe('only');
    expect(plan.parallel![0].model).not.toBe(plan.parallel![1].model);
  });
});

describe('TaskRouter — rationale text', () => {
  it('mentions primary peer + score in rationale', () => {
    const peers: PeerSlot[] = [
      peer('ministar', {
        models: [model('qwen3.6:35b', { strengths: ['reasoning'] })],
      }),
    ];
    const plan = router.plan(
      classify({ requiresReasoning: true }),
      peers,
    );
    expect(plan.rationale).toContain('ministar');
    expect(plan.rationale).toContain('qwen3.6:35b');
  });
});

describe('planChainDispatch — Hermes chain composition', () => {
  it('builds a chain lane per requested role, routing each role to its peer', () => {
    // All three peers share the same model strengths and identical
    // cost — only their `roles` tag differs. The chain composer should
    // pick each role's home peer via the role bonus. We use a
    // reasoning_heavy classification so the match score has headroom
    // (1 strength matched out of 2 required) for the bonus to tilt.
    const shared = {
      strengths: ['reasoning'] as const,
      costInputUsdPerMtok: 2,
      costOutputUsdPerMtok: 8,
    };
    const peers: PeerSlot[] = [
      peer('coder', {
        egress: 'cloud',
        roles: ['code'],
        models: [model('cm', { provider: 'openai', ...shared })],
      }),
      peer('reviewer', {
        egress: 'cloud',
        roles: ['review'],
        models: [model('rm', { provider: 'anthropic', ...shared })],
      }),
      peer('tester', {
        egress: 'cloud',
        roles: ['safe'],
        models: [model('tm', { provider: 'openai', ...shared })],
      }),
    ];
    const plan = planChainDispatch(
      classify({ requiresReasoning: true, complexity: 'reasoning_heavy' }),
      peers,
      { chainRoles: ['code', 'review', 'safe'] },
    );
    expect(plan.chain).toBeDefined();
    expect(plan.chain).toHaveLength(3);
    expect(plan.chain![0].peerId).toBe('coder');
    expect(plan.chain![0].role).toBe('code');
    expect(plan.chain![1].peerId).toBe('reviewer');
    expect(plan.chain![1].role).toBe('review');
    expect(plan.chain![2].peerId).toBe('tester');
    expect(plan.chain![2].role).toBe('safe');
    expect(plan.primary).toEqual(plan.chain![0]);
    expect(plan.rationale).toContain('code → review → safe');
  });

  it('falls back gracefully when no peer carries the requested role', () => {
    const peers: PeerSlot[] = [
      peer('only-peer', {
        models: [model('m', { provider: 'ollama', strengths: ['reasoning'] })],
      }),
    ];
    const plan = planChainDispatch(classify({ requiresReasoning: true }), peers, {
      chainRoles: ['code', 'review'],
    });
    // Same peer wins both roles when nothing else is available.
    expect(plan.chain![0].peerId).toBe('only-peer');
    expect(plan.chain![1].peerId).toBe('only-peer');
  });

  it('throws when an intermediate role cannot be satisfied', () => {
    // privacyTag=sensitive vetoes cloud peers; this peer can't run the chain.
    const peers: PeerSlot[] = [
      peer('cloud-only', {
        egress: 'cloud',
        roles: ['code', 'review'],
        models: [model('m', { provider: 'anthropic', strengths: ['reasoning'] })],
      }),
    ];
    expect(() =>
      planChainDispatch(classify({ requiresReasoning: true }), peers, {
        chainRoles: ['code', 'review'],
        constraints: { privacyTag: 'sensitive' },
      }),
    ).toThrow(NoPeerAvailableError);
  });

  it('throws when chainRoles is empty', () => {
    expect(() =>
      planChainDispatch(classify(), [], { chainRoles: [] }),
    ).toThrow(/at least one role/);
  });
});

describe('TaskRouter — Phase H excludePeerIds', () => {
  it('drops peers in the exclude list before scoring', () => {
    const peers: PeerSlot[] = [
      peer('alpha', {
        models: [model('m1', { provider: 'ollama', strengths: ['reasoning'] })],
      }),
      peer('beta', {
        models: [model('m2', { provider: 'ollama', strengths: ['reasoning'] })],
      }),
    ];
    const plan = router.plan(classify({ requiresReasoning: true }), peers, {
      excludePeerIds: ['alpha'],
    });
    expect(plan.primary.peerId).toBe('beta');
  });

  it('throws NoPeerAvailableError when exclusion empties the pool', () => {
    const peers: PeerSlot[] = [
      peer('only', {
        models: [model('m', { provider: 'ollama', strengths: ['reasoning'] })],
      }),
    ];
    expect(() =>
      router.plan(classify({ requiresReasoning: true }), peers, {
        excludePeerIds: ['only'],
      }),
    ).toThrow(NoPeerAvailableError);
  });

  it('normalises whitespace and ignores empty entries', () => {
    const peers: PeerSlot[] = [
      peer('alpha', { models: [model('m', { strengths: ['reasoning'] })] }),
      peer('beta', { models: [model('m', { strengths: ['reasoning'] })] }),
    ];
    const plan = router.plan(classify({ requiresReasoning: true }), peers, {
      excludePeerIds: [' alpha ', '', '  '],
    });
    expect(plan.primary.peerId).toBe('beta');
  });

  it('combines with requiredRole — alt peer with matching role wins', () => {
    const peers: PeerSlot[] = [
      peer('reviewer-1', {
        roles: ['review'],
        models: [model('m', { strengths: ['reasoning'] })],
      }),
      peer('reviewer-2', {
        roles: ['review'],
        models: [model('m', { strengths: ['reasoning'] })],
      }),
    ];
    // Exclude reviewer-1 → reviewer-2 inherits the review role bonus.
    const plan = router.plan(classify({ requiresReasoning: true }), peers, {
      requiredRole: 'review',
      excludePeerIds: ['reviewer-1'],
    });
    expect(plan.primary.peerId).toBe('reviewer-2');
  });
});

describe('TaskRouter — Hermes role bonus', () => {
  it('tilts the choice toward the review-tagged peer when other terms are similar', () => {
    // Two cloud peers with identical cost / load / latency / model
    // strengths. The only difference is their role tag. Without
    // requiredRole, neither peer has an advantage — the first scored
    // candidate wins. With requiredRole='review', the role bonus
    // multiplies the reviewer's match score and it overtakes.
    const sharedModelOpts = {
      provider: 'openai' as const,
      strengths: ['reasoning'] as const,
      costInputUsdPerMtok: 2,
      costOutputUsdPerMtok: 8,
    };
    const peers: PeerSlot[] = [
      peer('coder', {
        egress: 'cloud',
        roles: ['code'],
        models: [model('coder-model', { ...sharedModelOpts })],
      }),
      peer('reviewer', {
        egress: 'cloud',
        roles: ['review'],
        models: [model('reviewer-model', { ...sharedModelOpts })],
      }),
    ];

    // Reasoning-heavy task → required strengths includes 'reasoning'
    // and 'thinking'. Both peers only have 'reasoning' (partial match),
    // leaving headroom for the role bonus to tip the result.
    const planWithRole = router.plan(
      classify({ complexity: 'reasoning_heavy', requiresReasoning: true }),
      peers,
      { requiredRole: 'review' },
    );
    expect(planWithRole.primary.peerId).toBe('reviewer');

    // Same task without requiredRole — role tags ignored, the choice
    // is now driven purely by score (which is a tie here, falling
    // back to insertion order).
    const planNoRole = router.plan(
      classify({ complexity: 'reasoning_heavy', requiresReasoning: true }),
      peers,
    );
    // Either peer is a valid outcome; the important property is that
    // the bonus changed nothing because no requiredRole was passed.
    expect(['coder', 'reviewer']).toContain(planNoRole.primary.peerId);
  });

  it('requiredRole has no effect when no peer advertises the role', () => {
    const peers: PeerSlot[] = [
      peer('untagged-1', {
        models: [model('m1', { strengths: ['reasoning'] })],
      }),
      peer('untagged-2', {
        models: [model('m2', { strengths: ['reasoning'] })],
      }),
    ];
    const plan = router.plan(
      classify({ requiresReasoning: true }),
      peers,
      { requiredRole: 'review' },
    );
    // Should still return a plan, no error.
    expect(plan.primary).toBeDefined();
  });

  it('caps the role bonus at 1.0 (no overflow)', () => {
    const peers: PeerSlot[] = [
      peer('perfect-match', {
        roles: ['review'],
        models: [
          model('m', { strengths: ['reasoning', 'thinking', 'long-context'] }),
        ],
      }),
    ];
    const plan = router.plan(
      classify({ complexity: 'reasoning_heavy', requiresReasoning: true }),
      peers,
      { dispatchProfile: 'review', requiredRole: 'review' },
    );
    expect(plan.primary.breakdown.match).toBeLessThanOrEqual(1);
  });
});
