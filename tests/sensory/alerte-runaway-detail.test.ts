import { describe, expect, it } from 'vitest';
import { describeSystemPercept } from '../../src/sensory/sensory-action-executor.js';

// 05/09/2026 : sept alertes « processus emballé » sans pid ni nom — l'opérateur ne pouvait rien
// en faire. Le message d'alerte porte désormais un résumé sûr du percept système.
describe('describeSystemPercept', () => {
  it('nomme le processus emballé : comm, pid, CPU, durée', () => {
    const s = describeSystemPercept({
      modality: 'system',
      kind: 'process_runaway',
      payload: { pid: 12345, comm: 'bash', pcpuTotal: 99.94, etimeSec: 9060 },
    });
    expect(s).toBe(' — bash, pid 12345, 99,9 %, 2 h 31');
  });

  it('assainit comm (pas de retour à la ligne ni de balisage) et ignore les valeurs non numériques', () => {
    const s = describeSystemPercept({
      modality: 'system',
      kind: 'process_runaway',
      payload: { pid: '12', comm: 'evil\n<b>rm -rf</b>', pcpuTotal: 'x', etimeSec: 120 },
    });
    expect(s).toBe(' — evilbrm-rfb, 2 min');
  });

  it('reste vide hors modalité system', () => {
    expect(describeSystemPercept({ modality: 'vision', kind: 'motion', payload: { pid: 1 } })).toBe('');
    expect(describeSystemPercept({ modality: 'system', kind: 'x' })).toBe('');
  });
});
