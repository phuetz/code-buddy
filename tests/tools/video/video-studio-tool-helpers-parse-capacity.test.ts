import { describe, expect, it } from 'vitest';
import {
  pickBoolean,
  parseHybridCapacity,
} from '../../../src/tools/video-studio-tool-helpers.js';

describe('pickBoolean — alias de la clé `capacity.localGpu` (GF3FIX R1)', () => {
  // La mission GF3FIX R1 demande d'accepter plusieurs alias génériques pour la
  // clé renommée `capacity.localGpu`, sans jamais réintroduire le nom d'une
  // machine dans le dépôt (le garde-fou `tests/security/donnees-personnelles.test.ts`
  // rougirait sinon). La mission demande explicitement un test rouge/vert sur
  // `pickBoolean` avec chaque alias : c'est ce que cette suite prouve.

  const keys = ['localGpu', 'local_gpu', 'localGpuAvailable', 'local_gpu_available'] as const;

  it.each(keys)('accepte la forme `%s`', (key) => {
    expect(pickBoolean({ [key]: true }, keys, 'capacity.localGpu')).toBe(true);
  });

  it('la première clé non-absente gagne (sémantique `firstPresent`)', () => {
    // Si l'appelant envoie plusieurs alias contradictoires, c'est l'ordre de
    // la liste d'alias qui tranche : `localGpu` d'abord, puis `local_gpu`, puis
    // `localGpuAvailable`. On documente la sémantique pour qu'un appelant
    // lisant la suite sache que l'ordre a un sens.
    expect(
      pickBoolean({ localGpu: true, localGpuAvailable: false }, keys, 'capacity.localGpu'),
    ).toBe(true);
  });

  it('jette avec un message nommé si la valeur n\'est pas un booléen', () => {
    // Protection de type : un alias présent avec une valeur non-booléenne
    // doit être rejeté explicitement, pas interprété silencieusement.
    expect(() =>
      pickBoolean({ localGpu: 'yes' }, keys, 'capacity.localGpu'),
    ).toThrow(/capacity\.localGpu must be a boolean/);
  });
});

describe('parseHybridCapacity — accepte les alias `localGpu` (GF3FIX R1)', () => {
  // Sanity-check du parseur hybride complet : passer un objet qui contient
  // tous les champs requis de la capacité, avec la clé `localGpu` sous une
  // forme alias, doit produire la même capacité qu'avec la forme canonique.
  const required = {
    gpuNode: false,
    googleFlow: true,
    remainingFlowCredits: 100,
    maxFlowCreditsPerBatch: 100,
  } as const;

  it('forme canonique `localGpu`', () => {
    const capacity = parseHybridCapacity({ ...required, localGpu: true });
    expect(capacity.localGpu).toBe(true);
  });

  it.each(['local_gpu', 'localGpuAvailable', 'local_gpu_available'] as const)(
    'forme alias `%s`',
    (key) => {
      const capacity = parseHybridCapacity({ ...required, [key]: true });
      expect(capacity.localGpu).toBe(true);
    },
  );
});
