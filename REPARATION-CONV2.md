# Réparation CONV2 — barge-in vocal Luna

## État initial

Ce rapport a été créé avant toute inspection du dépôt, conformément à la mission. Le banc est
strictement déterministe : faux flux, faux player et bus d’événements ; aucune lecture audio,
aucun rappel parlé, aucun service et aucun appel ElevenLabs n’ont été lancés.

## Références lues en premier

- `/home/patrice/DEV/vitrine-drafts/vague-2026-09-02/recherche-conversation/CONTEXTE-LISA.md:1-13` — boucle actuelle, absence de barge-in fiable et AEC imparfaite.
- `/home/patrice/DEV/vitrine-drafts/vague-2026-09-02/recherche-conversation/RECH1-LITTERATURE-GEMINI.md:412-495` — section 8 et ses cinq mécanismes : VAP, AEC-VAD/reference-aware barge-in, backchannels, réparation communicative, TTS local réactif.
- `docs/FABLE5-CODEX-COORDINATION.md:1-260` — zone CONV2 réservée avant les modifications.
- `/home/patrice/.claude/projects/-home-patrice-code-buddy/memory/voice-barge-in.md:1-22` — état antérieur : interruption programmatique déjà présente dans la boucle voix, déclenchement VAD/AEC live manquant.

## Fichiers lus et lignes

Les quatre fichiers explicitement demandés ont été lus intégralement avant modification ; les
plages ci-dessous correspondent à leur longueur au moment de l’inspection initiale.

| Fichier | Lignes lues | Rôle inspecté |
|---|---:|---|
| `src/sensory/voice-loop.ts` | `1-3797` | file de phrases, préchargement, `aplay`, signal d’annulation, contexte de réponse |
| `src/sensory/voice-stream.ts` | `1-629` | assemblage phrase par phrase, flux TTS, workers et queues |
| `src/sensory/speech-reaction.ts` | `1-2181` | événements `speech_start`, finals/partials, debounce et barge-in transcript |
| `buddy-sense/src/senses/audio.rs` | `1-295` | capture audio/RMS/AEC et contrat sensoriel |
| note mémoire barge-in | `1-22` | état antérieur |

Inspection complémentaire ciblée : `src/sensory/voice-activity.ts:1-276`,
`src/sensory/voice-turn-coordinator.ts:1-350`, `src/sensory/respond-decider.ts`,
`src/sensory/hybrid-reply.ts`, `src/server/index.ts:1762-1800` et la table d’environnement de
`CLAUDE.md:231-292`.

## Rouge puis vert

### Brique 1 — interruption propre

Test rouge initial, avant implémentation :

```text
$ npx vitest run tests/sensory/conversation-conv2.test.ts
❯ tests/sensory/conversation-conv2.test.ts (3 tests | 1 failed) 2139ms
× stops a fake streamed player within 150ms ...
AssertionError: expected stoppedAt to be greater than 0
2 tests passed
```

Implémentation : `speech_start` opt-in appelle `onBargeInStart`, le serveur le relie à
`reply.interrupt()`, le signal annule la génération/TTS, tue le player et vide les queues de
phrases ; le résultat conserve le numéro de phrase interrompue. Le chemin ElevenLabs reçoit le
même `AbortSignal`, y compris le préchargement.

Vert :

```text
$ npx vitest run tests/sensory/conversation-conv2.test.ts
Test Files  1 passed (1)
     Tests  2 passed (2)
```

Commit : `17050487f fix(sensory): stop voice playback on opt-in speech start`.

### Brique 2 — anti-auto-déclenchement adaptatif

La référence est la moyenne des RMS disponibles dans les 300 premières millisecondes de la
lecture, avec `noiseFloorRms` du VAD comme référence de secours ; après cette fenêtre, l’énergie
doit dépasser la marge en dB. La voie indépendante `durationMs/audioMs >= 250` reste autorisée.

Vert :

```text
$ npx vitest run tests/sensory/conversation-conv2-adaptive.test.ts
Test Files  1 passed (1)
     Tests  1 passed (1)
```

Le banc prouve qu’une fuite à 0,015 contre une référence 0,01 ne coupe pas à 6 dB, tandis que
0,035 coupe ; il vérifie aussi la marge configurable à 9 dB.

Commit : `562c3a6a fix(sensory): gate barge-in with adaptive leakage energy`.

### Brique 3 — reprise sans répétition et fenêtre d’engagement

Le tour interrompu expose un contexte éphémère `{ interruptedTurnId, phraseNumber, spokenText }`.
La réponse suivante reçoit une consigne de reprise qui exclut les phrases déjà confirmées ; la
formule « Tu m'as coupée, je disais… » n’est ajoutée que pour une demande de continuation ou de
correction. `speech_start` ne ferme pas la fenêtre d’engagement du `respond-decider`.

Vert :

```text
$ npx vitest run tests/sensory/conversation-conv2-resume.test.ts
Test Files  1 passed (1)
     Tests  2 passed (2)
```

Commits : `1daf4b19 fix(sensory): resume after an interrupted spoken phrase` puis
`a732e5a39 fix(sensory): keep interruption context opt-in`.

## Vérifications finales

```text
$ npx vitest run tests/sensory/conversation-conv2.test.ts tests/sensory/conversation-conv2-adaptive.test.ts tests/sensory/conversation-conv2-resume.test.ts tests/sensory/voice-activity.test.ts tests/sensory/voice-streaming.test.ts tests/sensory/speech-reaction-workers.test.ts tests/sensory/voice-loop.test.ts tests/sensory/speech-reaction.test.ts tests/sensory/voice-turn-coordinator.test.ts
Test Files  9 passed (9)
     Tests  202 passed (202)

$ npx tsc --noEmit -p .
exit code 0, sortie vide

$ npx eslint src/sensory/speech-reaction.ts src/sensory/voice-loop.ts src/sensory/voice-stream.ts src/sensory/voice-turn-coordinator.ts src/server/index.ts tests/sensory/conversation-conv2.test.ts tests/sensory/conversation-conv2-adaptive.test.ts tests/sensory/conversation-conv2-resume.test.ts
exit code 0, sortie vide

$ npm run lint
exit code 0 — 0 erreur, 2466 avertissements préexistants du dépôt
```

## Fichiers modifiés

- `src/sensory/speech-reaction.ts`
- `src/sensory/voice-stream.ts`
- `src/sensory/voice-loop.ts`
- `src/sensory/voice-turn-coordinator.ts`
- `src/server/index.ts`
- `tests/sensory/conversation-conv2.test.ts`
- `tests/sensory/conversation-conv2-adaptive.test.ts`
- `tests/sensory/conversation-conv2-resume.test.ts`
- `CLAUDE.md`
- `REPARATION-CONV2.md`

`buddy-sense/src/senses/audio.rs` a été lu mais n’a pas nécessité de modification : le contrat
`speech_start` existant fournit déjà RMS, plancher adaptatif et état AEC nécessaires au banc.

## Commits et coordination

Branche : `feat/conversation-luna-2026-09-03`. Base annoncée : `facea9864`. Aucun push et aucune
écriture dans `~/code-buddy`.

Le tableau de `docs/FABLE5-CODEX-COORDINATION.md` sera clôturé avec le commit de documentation
final et les vérifications ci-dessus avant passation.

## Bilan

Le barge-in opt-in coupe le flux et le player, l’anti-fuite adaptatif filtre une fuite faible et
la reprise est bornée à la prochaine phrase sans fermer l’engagement. Les bancs déterministes,
TypeScript et ESLint ciblé sont verts ; le lint global est vert avec les avertissements existants.
