# REPARATION-VOIX4.md — Robustesse aux à-coups réseau (Voix de Lisa)

**Date :** 2026-09-03
**Branche :** `fix/voix-robustesse-flux-2026-09-03`
**Objectif :** Rendre la lecture audio en flux robuste aux à-coups réseau sans hachage ni micro-coupures induites :
1. Tampon de gigue dans `makeDefaultStreamSpeak` (`src/sensory/voice-loop.ts`).
2. Tampon de tête conservé quand le gain est déjà figé (`Pcm16WavStreamGain`, `frozenFactor`).
3. Arguments de buffering explicite (`--buffer-time` pour `aplay`, options équivalentes pour `ffplay`).
4. Vérification de `Pcm16WavStreamEdges` (H3 de la revue).

---

## 1. Journal des inspections et fichiers consultés

- `REVUE-VOIX-GEMINI.md` : Revue logique de la chaîne audio (VOIX2), identification des 4 hypothèses initiales (H1 à H4).
- `tests/sensory/revue-voix-falsification.test.ts` : 4 tests falsifiant H1, H2, H3, H4 hors matériel audio.
- `src/sensory/voice-loop.ts` : `resolveVoiceAudioPlayer`, `makeDefaultStreamSpeak`, boucle `while (!signal?.aborted && !settled) { reader.read() ... }`.
- `src/voice/tts-volume.ts` : `Pcm16WavStreamGain`, gestion de `frozenFactor`, `bufferHead`, `releaseHead`.
- `src/voice/pcm-edges.ts` : `Pcm16WavStreamEdges`, trimming du front et de queue (`bufferTail`, `flush`).

## 2. Point 1 — Tampon de gigue (`makeDefaultStreamSpeak`)
- **Hypothèse et conception :**
  En l'absence de tampon de gigue initial, tout chunk audio de 40 ms transmis par ElevenLabs était écrit immédiatement sur stdin d'`aplay`. Tout à-coup réseau WAN (retard de 60 à 150 ms) vide le ring buffer ALSA et provoque des micro-coupures de 20 à 110 ms.
  La fonction `resolveVoiceJitterBufferMs(env)` lit `CODEBUDDY_VOICE_JITTER_BUFFER_MS` (défaut 250 ms, borné 0-1000).
  Dans `makeDefaultStreamSpeak`, un tampon d'accumulation `jitterQueue` retient les morceaux jusqu'à atteindre `targetJitterBytes` (ou déclenchement du timer de garde ou EOF), avant la moindre écriture sur le stdin du player. En cas d'épuisement temporaire mid-stream, le tuyau stdin reste ouvert (`stdin.end()` n'est appelé qu'à la terminaison complète du ReadableStream).
- **Test rouge (échec attendu sans tampon) :**
  Exécuté sur `tests/sensory/voice-jitter-buffer.test.ts` :
  ```
  FAIL tests/sensory/voice-jitter-buffer.test.ts > Tampon de gigue (Jitter Buffer) dans makeDefaultStreamSpeak > avec tampon de gigue (250 ms) : aucun trou n’apparaît et le premier son n’est pas retardé de plus que le tampon
  AssertionError: expected [ …(6) ] to have a length of +0 but got 6
  ```
  Sans tampon de gigue (`CODEBUDDY_VOICE_JITTER_BUFFER_MS=0`), le flux à gigue (délais 0, 60, 150 ms) produit 6 underruns sur le DAC simulé.
- **Implémentation :**
  - Ajout de `resolveVoiceJitterBufferMs` dans `src/sensory/voice-loop.ts`.
  - Intégration de `jitterQueue`, `jitterAudioBytes`, `targetJitterBytes`, `flushJitterBuffer`, et `jitterReleaseTimer` dans `makeDefaultStreamSpeak`.
  - Export de `resolveVoiceJitterBufferMs` dans `__voiceAudioPlayerTest`.
- **Test vert :**
  ```
  RUN  v4.1.9 /home/patrice/DEV/cb-voix-agy-2026-09-02
  Test Files  1 passed (1)
       Tests  4 passed (4)
    Duration  1.53s
  ```
  HYPOTHÈSE 1 dans `tests/sensory/revue-voix-falsification.test.ts` passe également au VERT.
- **Commit :** `79c8ad61d` (`feat(voice): tampon de gigue initial dans makeDefaultStreamSpeak (Point 1)`)

## 3. Point 2 — Tampon de tête conservé avec gain figé (`Pcm16WavStreamGain`)
- **Hypothèse et anomalie constatée :**
  Dans `Pcm16WavStreamGain` (`src/voice/tts-volume.ts`), lorsque `frozenFactor !== undefined` (cas des phrases 2+ d'un tour où le gain a déjà été mesuré sur la première phrase), le code court-circuitait le buffering de tête :
  `if (this.frozenFactor !== undefined) { this.mode = 'gain'; return [header, ...this.transformPayload(payload)]; }`.
  La phrase 2 et suivantes démarraient donc avec 0 ms de tampon d'absorption dans le processeur de volume.
- **Test rouge :**
  Exécuté sur `tests/sensory/revue-voix-falsification.test.ts` :
  ```
  FAIL HYPOTHÈSE 2 (ROUGE) : Pcm16WavStreamGain avec frozenFactor n’accumule aucun buffer de tête
  AssertionError: expected 2400 to be +0 // Object.is equality
  - Expected: 0
  + Received: 2400
  ```
- **Implémentation :**
  - Dans `push()` de `Pcm16WavStreamGain`, suppression du passage anticipé en `this.mode = 'gain'` quand `frozenFactor !== undefined`. Le flux reste en `this.mode = 'buffering'` avec `this.headBytes` (400 ms par défaut).
  - Dans `releaseHead()`, seul le calcul de normalisation (`planNormalization(paired, ...)`) est sauté si `this.frozenFactor !== undefined`, conservant le facteur figé et le plafond de crête précalculé. L'accumulation des échantillons est préservée.
  - Ajout d'un test dédié dans `tests/voice/tts-volume.test.ts` (`retains head buffer accumulation even when the factor is externally frozen`).
- **Test vert :**
  ```
  npx vitest run tests/voice/tts-volume.test.ts
  Test Files  1 passed (1)
       Tests  18 passed (18)
  ```
  Et dans `tests/sensory/revue-voix-falsification.test.ts` :
  HYPOTHÈSE 2 passe au VERT (0 underrun, buffer de tête bien accumulé).
- **Commit :** (En cours de création)

## 4. Point 3 — Arguments player audio (`aplay --buffer-time`, `ffplay`)
- Options retenues :
- Test rouge :
- Implémentation :
- Test vert :
- Commit :

## 5. Examen de `Pcm16WavStreamEdges` (H3)
- Vérification expérimentale :
- Conclusion :

## 6. Synthèse des tests et validations
- `tests/sensory` et `tests/voice` :
- `npx tsc --noEmit -p .` :
- ESLint :
