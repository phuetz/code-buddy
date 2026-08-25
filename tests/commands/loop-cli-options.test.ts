import { describe, expect, it } from 'vitest';
import { createLoopCommand } from '../../src/commands/loop-cli.js';

describe('buddy loop — options de ligne de commande', () => {
  it('accepte --permission-mode APRÈS la sous-commande', () => {
    // Commander n'accepte une option du programme principal qu'AVANT la sous-commande.
    // `buddy loop "objectif" --permission-mode acceptEdits` échouait donc sur « unknown
    // option », sans indiquer où la placer — alors que c'est la forme naturelle, et que
    // c'est justement sur une boucle autonome qu'on veut préciser la posture.
    const noms = createLoopCommand()
      .options.map((o) => o.long)
      .filter(Boolean);
    expect(noms).toContain('--permission-mode');
  });

  it('documente les postures valides dans son aide', () => {
    const option = createLoopCommand().options.find((o) => o.long === '--permission-mode');
    expect(option?.description).toContain('acceptEdits');
    expect(option?.description).toContain('bypassPermissions');
  });
});
