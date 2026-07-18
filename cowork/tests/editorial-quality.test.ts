import { describe, expect, it } from 'vitest';
import { assessEditorialQuality, promptSimilarity } from '../src/shared/editorial-quality';

describe('editorial quality gate', () => {
  it('detects near-duplicate prompts without comparing punctuation', () => {
    expect(promptSimilarity('Lisa marche dans Paris, lumière dorée', 'Lisa marche à Paris sous une lumière dorée')).toBeGreaterThan(0.6);
  });

  it('approves a distinct disclosed short with a stable companion and three clips', () => {
    const report = assessEditorialQuality({
      publication: true,
      title: 'Le café secret que Lisa préfère à Paris',
      description: 'Lisa découvre une terrasse calme au lever du jour et partage une idée personnelle sur les petits rituels qui rendent une journée plus douce.',
      prompt: 'Lisa entre dans un café parisien calme au lever du jour, commande un espresso, sourit avec une légère surprise puis partage son rituel du matin face caméra.',
      aspect: '9:16', duration: 8, syntheticMediaDisclosure: true,
      selectedAssets: [{ kind: 'character', companionId: 'lisa', contentTier: 'safe', qaStatus: 'approved' }],
      scenes: Array.from({ length: 3 }, (_, index) => ({ prompt: `plan ${index}`, status: 'done', mediaType: 'video' })),
      previousPrompts: ['Un défilé de mode nocturne dans une rue de Tokyo.'],
    });
    expect(report.ready).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(80);
  });

  it('rejects an undisclosed mass-produced empty template', () => {
    const report = assessEditorialQuality({ publication: true, title: 'Short', description: 'Belle femme', prompt: 'beautiful woman', aspect: '9:16', duration: 8, syntheticMediaDisclosure: false, selectedAssets: [], scenes: [] });
    expect(report.ready).toBe(false);
    expect(report.score).toBeLessThan(50);
  });

  it('fails closed when an asset omits explicit safe and approved metadata', () => {
    const report = assessEditorialQuality({
      publication: true,
      title: 'Le café secret que Lisa préfère à Paris',
      description: 'Lisa découvre une terrasse calme au lever du jour et partage une idée personnelle sur les petits rituels qui rendent une journée plus douce.',
      prompt: 'Lisa entre dans un café parisien calme au lever du jour, commande un espresso, sourit avec une légère surprise puis partage son rituel du matin face caméra.',
      aspect: '9:16', duration: 8, syntheticMediaDisclosure: true,
      selectedAssets: [{ kind: 'character', companionId: 'lisa' }],
      scenes: Array.from({ length: 3 }, (_, index) => ({ prompt: `plan ${index}`, status: 'done', mediaType: 'video' })),
    });
    expect(report.ready).toBe(false);
    expect(report.checks.find((check) => check.id === 'assets')?.status).toBe('fail');
  });
});
