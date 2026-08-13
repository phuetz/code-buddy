import { describe, expect, it, vi } from 'vitest';
import {
  ModelRoutingFacade,
  type ModelRoutingFacadeDeps,
} from '../../../src/agent/facades/model-routing-facade.js';

function createFacade(
  getTaskModelConfig?: ModelRoutingFacadeDeps['getTaskModelConfig'],
): ModelRoutingFacade {
  return new ModelRoutingFacade({
    modelRouter: {
      getTotalCost: vi.fn(() => 0),
      getEstimatedSavings: vi.fn(() => ({ saved: 0, percentage: 0 })),
      getUsageStats: vi.fn(() => new Map()),
      updateConfig: vi.fn(),
    } as unknown as ModelRoutingFacadeDeps['modelRouter'],
    costTracker: {} as ModelRoutingFacadeDeps['costTracker'],
    getTaskModelConfig,
  });
}

describe('ModelRoutingFacade task model map', () => {
  it('is a strict no-op when task_models and model_pairs are absent', () => {
    const facade = createFacade(() => ({}));

    expect(facade.resolveConfiguredModelForTask('architect')).toBeNull();
    expect(facade.resolveConfiguredModelForTask('edit')).toBeNull();
    expect(facade.resolveConfiguredModelForTask('chat')).toBeNull();
  });

  it('uses only the new map when legacy model_pairs merely comes from config', () => {
    const facade = createFacade(() => ({
      model_pairs: { architect: 'legacy-thinker', editor: 'legacy-editor' },
      task_models: { architect: 'new-thinker', review: 'review-model' },
    }));

    expect(facade.resolveConfiguredModelForTask('architect')).toBe('new-thinker');
    expect(facade.resolveConfiguredModelForTask('edit')).toBeNull();
    expect(facade.resolveConfiguredModelForTask('review')).toBe('review-model');
    expect(facade.resolveModelForIntent('reasoning')).toBe('new-thinker');
    expect(facade.resolveModelForIntent('editing')).toBeNull();
  });

  it('keeps setModelPairs as the explicit compatibility opt-in', () => {
    const facade = createFacade(() => ({
      model_pairs: { architect: 'dormant-architect', editor: 'dormant-editor' },
    }));

    facade.setModelPairs({ architect: 'opted-in-architect', editor: 'opted-in-editor' });

    expect(facade.resolveConfiguredModelForTask('architect')).toBe('opted-in-architect');
    expect(facade.resolveConfiguredModelForTask('edit')).toBe('opted-in-editor');
  });

  it('reads the live config for every turn so Cowork saves apply without reconstruction', () => {
    let reviewModel = 'review-v1';
    const facade = createFacade(() => ({ task_models: { review: reviewModel } }));

    expect(facade.resolveConfiguredModelForTask('review')).toBe('review-v1');
    reviewModel = 'review-v2';
    expect(facade.resolveConfiguredModelForTask('review')).toBe('review-v2');
  });

  it('keeps the explicit /switch override above every task mapping', () => {
    const facade = createFacade(() => ({ task_models: { research: 'research-model' } }));
    facade.setSwitchedModel('manual-model');

    expect(facade.resolveConfiguredModelForTask('research')).toBe('manual-model');
  });

  it('classifies architect, edit, review, research and chat tasks', () => {
    const facade = createFacade();

    expect(facade.classifyTaskType('Design the caching architecture')).toBe('architect');
    expect(facade.classifyTaskType('Implement the cache adapter')).toBe('edit');
    expect(facade.classifyTaskType('Review this pull request for risks')).toBe('review');
    expect(facade.classifyTaskType('Research the latest primary sources')).toBe('research');
    expect(facade.classifyTaskType('Hello, how are you?')).toBe('chat');
  });

  it('classifies French review, research, planning and editing requests', () => {
    const facade = createFacade();

    expect(facade.classifyTaskType('Relis cette PR et fais une revue complète')).toBe('review');
    expect(facade.classifyTaskType('Cherche des sources récentes sur ce sujet')).toBe('research');
    expect(facade.classifyTaskType('Conçois une stratégie de migration')).toBe('architect');
    expect(facade.classifyTaskType('Corrige puis refactorise ce module')).toBe('edit');
  });

  it('records configured task-map decisions for routing diagnostics', () => {
    const facade = createFacade();

    const decision = facade.recordConfiguredTaskModel('review', 'review-model');

    expect(decision).toMatchObject({
      recommendedModel: 'review-model',
      tier: 'standard',
      reason: 'Configured task model: review',
      estimatedCost: 0,
    });
    expect(facade.getLastRoutingDecision()).toBe(decision);
  });
});
