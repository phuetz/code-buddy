import { describe, expect, it } from 'vitest';
import { createGoalCommand } from '../../src/commands/goal-cli.js';

describe('buddy goal — options de ligne de commande', () => {
  it('accepte --permission-mode APRÈS la sous-commande', () => {
    const noms = createGoalCommand()
      .options.map((o) => o.long)
      .filter(Boolean);
    expect(noms).toContain('--permission-mode');
  });

  it('documente les postures valides dans son aide', () => {
    const option = createGoalCommand().options.find((o) => o.long === '--permission-mode');
    expect(option?.description).toContain('acceptEdits');
    expect(option?.description).toContain('bypassPermissions');
  });
});
