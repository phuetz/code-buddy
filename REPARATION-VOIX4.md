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
- **Commit :** `8c2ef897e` (`fix(voice): conserver le tampon de tête dans Pcm16WavStreamGain avec gain figé (Point 2)`)

## 4. Point 3 — Arguments player audio (`aplay --buffer-time`, `ffplay`)
- **Options retenues :**
  - Pour `aplay` : `stdinArgs: ['-q', '--buffer-time=300000', '-']` (marge explicite de 300 000 µs = 300 ms dans le ring buffer ALSA pour absorber les à-coups d'alimentation).
  - Pour `ffplay` : `stdinArgs: ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-infbuf', '-buffer_size', '300000', '-i', 'pipe:0']` (`-infbuf` évite la limitation artificielle de la file d'entrée en flux temps réel et `-buffer_size 300000` alloue un tampon d'entrée équivalent pour le protocole pipe).
- **Test rouge :**
  Exécuté sur `tests/sensory/revue-voix-falsification.test.ts` :
  ```
  FAIL HYPOTHÈSE 4 (ROUGE) : la configuration aplay n’impose aucun buffer-time pour absorber les goulots d’étranglement de stdin
  AssertionError: expected false to be true // Object.is equality
  - Expected: true
  + Received: false
  ```
- **Implémentation :**
  - Mise à jour des `stdinArgs` de `aplay` et `ffplay` dans `resolveVoiceAudioPlayer` (`src/sensory/voice-loop.ts`).
  - Ajout des assertions unitaires dans `tests/voice/voice-audio-player.test.ts`.
- **Test vert :**
  ```
  npx vitest run tests/voice/voice-audio-player.test.ts
  Test Files  1 passed (1)
       Tests  3 passed (3)
  ```
  Et dans `tests/sensory/revue-voix-falsification.test.ts` :
  HYPOTHÈSE 4 passe au VERT.
- **Commit :** `fix(voice): arguments explicites de tampon pour aplay et ffplay (Point 3)`

## 5. Examen de `Pcm16WavStreamEdges` (H3)
- **Vérification expérimentale :**
  Dans `Pcm16WavStreamEdges` (`src/voice/pcm-edges.ts`), `bufferTail` retient temporairement les échantillons sous le seuil d'amplitude (-50 dBFS) en fin de chunk dans `this.tail`.
  Le test multi-chunks dans `tests/sensory/revue-voix-falsification.test.ts` démontre que :
  1. Lors de la réception du chunk 1 se terminant par une occlusive (40 ms de silence), ce silence est effectivement mis en réserve dans `this.tail`.
  2. Dès la réception du chunk 2 (reprise de parole sonore), `Buffer.concat([this.tail, payload])` restitue l'intégralité du silence occlusif dans le flux audio délivré au lecteur, sans la moindre perte d'échantillon.
  3. En fin de flux, `edges.flush()` applique le fondu de sortie sur le silence terminal naturel.
  4. Avec le tampon de gigue de 250 ms (Point 1) et le buffer de tête (Point 2), cette retenue temporaire de ~40 ms est totalement invisible pour le DAC et ne provoque aucune rupture de continuité sonore.
- **Conclusion :**
  `Pcm16WavStreamEdges` est conservé tel quel. L'hypothèse H3 (qui supposait un défaut de coupure) est infirmée : le comportement de rétention de queue est inhérent et indispensable au fenêtrage de bordure en flux continu.

## 6. Synthèse des tests et validations
- **`tests/sensory` et `tests/voice` :**
  64 fichiers de tests exécutés avec succès, 739 tests passés, 1 sauté (skip conditionnel), 0 échec.
  Commande : `npx vitest run tests/sensory tests/voice`
- **`npx tsc --noEmit -p .` :**
  Code retour : 0. Aucune erreur de compilation TypeScript.
- **ESLint :**
  Code retour : 0. Aucun avertissement ni erreur sur les fichiers modifiés (`src/sensory/voice-loop.ts`, `src/voice/tts-volume.ts`, `tests/sensory/voice-jitter-buffer.test.ts`, `tests/voice/tts-volume.test.ts`, `tests/voice/voice-audio-player.test.ts`, `tests/sensory/revue-voix-falsification.test.ts`).
  Commande : `npx eslint <fichiers>`
- **Commits réalisés :**
  1. Point 1 : `79c8ad61d` (`feat(voice): tampon de gigue initial dans makeDefaultStreamSpeak (Point 1)`)
  2. Point 2 : `8c2ef897e` (`fix(voice): conserver le tampon de tête dans Pcm16WavStreamGain avec gain figé (Point 2)`)
  3. Point 3 : `fix(voice): arguments explicites de tampon pour aplay et ffplay (Point 3)` (HEAD)
