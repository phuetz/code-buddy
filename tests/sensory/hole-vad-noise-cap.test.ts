import { describe, it, expect } from 'vitest';

describe('Mission SENSE2 — Trou 6 : VAD sous le bruit ambiant (BUDDY_SENSE_MIC_THRESHOLD=0.01 vs bruit 0.007)', () => {
  it('le VAD ne doit pas rester bloqué en speaking indéfiniment sur un bruit de fond supérieur à t_low (0.006)', () => {
    // Paramètres de buddy-sense/src/senses/live_audio.rs et audio.rs
    const threshold = 0.01; // BUDDY_SENSE_MIC_THRESHOLD
    const t_low = threshold * 0.6; // 0.006 (hystérésis off)
    const frameMs = 30; // tranches de 30ms
    const hangoverFrames = Math.round(500 / frameMs); // 500ms de silence requis pour fermer
    const maxUtteranceMs = 15_000; // Cap hard à 15s

    // Simulation d'un signal audio :
    // - 0 à 300ms : pic vocal à RMS = 0.015 (déclenche le VAD)
    // - 300ms à 20000ms : silence de l'humain, mais bruit de fond de la pièce (PC/ventilation/micro) à RMS = 0.007
    let speaking = false;
    let silenceRun = 0;
    let endpointReason: 'silence' | 'cap' | null = null;
    let totalSpeakingMs = 0;

    for (let t = 0; t < 20_000; t += frameMs) {
      // 0.015 pendant la parole (300ms), puis bruit résiduel à 0.007
      const rms = t < 300 ? 0.015 : 0.007;

      const isSpeech = speaking ? rms >= t_low : rms >= threshold;

      if (isSpeech) {
        silenceRun = 0;
        if (!speaking) {
          speaking = true;
          totalSpeakingMs = 0;
        }
      } else {
        silenceRun += 1;
        if (speaking && silenceRun >= hangoverFrames) {
          speaking = false;
          endpointReason = 'silence';
          break;
        }
      }

      if (speaking) {
        totalSpeakingMs += frameMs;
        if (totalSpeakingMs >= maxUtteranceMs) {
          speaking = false;
          endpointReason = 'cap';
          break;
        }
      }
    }

    // TROU PROUVÉ : Parce que le bruit résiduel de 0.007 est supérieur à t_low (0.006),
    // la condition rms < t_low n'est JAMAIS vérifiée. silenceRun reste à 0.
    // L'utterance est incapable de se refermer sur "silence" après que l'humain a cessé de parler.
    // Elle reste bloquée et continue jusqu'à être violemment interrompue par le cap de 15 000 ms.
    // Le comportement attendu pour un VAD robuste est de détecter la fin de parole ('silence').
    // Dans le code actuel, endpointReason est 'cap' (15 secondes de son envoyées au STT),
    // donc cette assertion échoue en ROUGE.
    expect(endpointReason).toBe('silence');
    expect(totalSpeakingMs).toBeLessThan(2000); // Devrait se clore rapidement après les 300ms
  });
});
