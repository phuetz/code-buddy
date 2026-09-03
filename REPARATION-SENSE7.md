# Réparation SENSE7

## Périmètre

Mission SENSE7 — fermeture des sept trous d’interaction issus de la revue Gemini SENSE6, dans l’ordre imposé : 7, 3, 2, 1, 4, 6, 5.

## Journal rouge / vert

### Baseline SENSE6

- Commande : `npx vitest run tests/sensory/hole-sense6-*.test.ts`
- Rouge : **7 fichiers en échec, 9 tests en échec, 1 test réussi**. Les neuf assertions attendues ont reproduit les sept trous.

### Trou 7 — boucle d’auto-dialogue

- Rouge initial : `hole-sense6-auto-dialogue-loop.test.ts` recevait `['barge-in-start', 'cue:backchannel']` au lieu de `[]`.
- Preuve d’un défaut dans le test : le tour humain initial arme son backchannel à 120 ms, mais le journal était vidé à 50 ms ; ce cue légitime était ensuite attribué à tort à l’écho injecté. Le délai est porté à 150 ms avant remise à zéro, sans relâcher l’exigence `[]` sur la fuite.
- Correctif : pendant une lecture connue, sans AEC active et avec réparation/backchannel actifs, `speech_start` devient un tour suspect au lieu de couper immédiatement la bouche. Un transcript de 1–3 mots entièrement contenu dans une empreinte vocale récente (< 90 s) est supprimé avant barge-in, cue, décision ou file d’attente.
- Vert ciblé : `hole-sense6-auto-dialogue-loop`, `voice-activity`, `speech-reaction`, `conversation-conv2`, `conversation-conv2-adaptive`, `conversation-conv2-resume` → **6 fichiers, 70 tests réussis**.

## Grille de traçabilité

| Trou | Correctif | Invariant préservé | Commit |
|---|---|---|---|
| 7 | Coupe-circuit de tour suspect + empreinte courte de propre voix ; chronométrage fautif du test corrigé avec preuve | Boucle d’auto-dialogue, toutes briques actives et `AEC_TRUST=false` | Ce commit |
| 3 | À établir | Demi-duplex ouvert uniquement pour AEC fiable ou barge-in adressé | À venir |
| 2 | À établir | Filtre de propre voix, y compris fragments courts de moins de 90 s | À venir |
| 1 | À établir | Aucun backchannel avant décision ni pendant la parole du robot | À venir |
| 4 | À établir | Aucune première phrase CONV3 avant décision | À venir |
| 6 | À établir | Repli ElevenLabs au segment interrompu, jamais au début | À venir |
| 5 | À établir | Grâce d’hésitation de 550–900 ms pour mots suspensifs | À venir |

## Vérifications finales

À compléter avec les commandes et totaux exacts.
