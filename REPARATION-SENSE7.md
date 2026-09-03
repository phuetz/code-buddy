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

### Trou 3 — barge-in déclenché par la télévision

- Rouge initial : le test TV recevait un `barge-in-start` pour `aecActive: false`, sur la seule combinaison durée 350 ms + énergie 12 dB au-dessus du plancher.
- Correctif : le chemin sans transcript exige désormais simultanément une AEC active et une énergie mesurée au-dessus d’une référence de fuite. Une durée seule ne coupe plus ; sans AEC active, seul un transcript adressé (`Lisa` ou arrêt explicite) peut interrompre.
- Tests CONV2 faux corrigés avec preuve : trois scénarios positifs d’interruption acoustique omettaient `aecActive` et, pour l’un, toute référence de fuite. Ces préconditions sont ajoutées conformément à l’invariant imposé ; un nouveau test négatif conserve explicitement la preuve que le même signal sans AEC active ne coupe pas.
- Vert ciblé : trou 3 + trou 7 + `speech-reaction` + trois suites CONV2 → **6 fichiers, 63 tests réussis**.

### Trou 2 — réparation sur propre voix

- Rouge initial : **2/2 échecs** ; un STT vide après la voix récente et un fragment court déclenchaient chacun `Pardon, tu disais ?`.
- Correctif : `classifyRecentVoiceEcho` classe maintenant comme écho un fragment de 1–3 mots entièrement contenu dans une empreinte de moins de 90 s. Un STT vide, sans AEC explicitement fiable, ne réutilise plus une fenêtre d’attention adressée lorsqu’une empreinte récente rend plausible un résidu de haut-parleur ; un indice partiel réellement adressé et distinct reste admissible.
- Fixture fausse corrigée avec preuve : « Lisa écoute » était annoncé comme fragment de « Je suis là et je t écoute attentivement », qui ne contenait pas « Lisa ». La phrase source contient désormais réellement les deux mots ; l’assertion de silence reste inchangée.
- Vert ciblé : trous 2, 3, 7 + `voice-activity` + `speech-reaction` → **5 fichiers, 68 tests réussis**.

## Grille de traçabilité

| Trou | Correctif | Invariant préservé | Commit |
|---|---|---|---|
| 7 | Coupe-circuit de tour suspect + empreinte courte de propre voix ; chronométrage fautif du test corrigé avec preuve | Boucle d’auto-dialogue, toutes briques actives et `AEC_TRUST=false` | Ce commit |
| 3 | Exiger AEC active + marge de fuite mesurée avant tout barge-in sans transcript ; durée seule refusée | Demi-duplex ouvert uniquement pour AEC fiable ou barge-in adressé | Ce commit |
| 2 | Étendre l’empreinte aux fragments contenus de 1–3 mots et bloquer la réparation vide près d’une voix récente | Filtre de propre voix, y compris fragments courts de moins de 90 s | Ce commit |
| 1 | À établir | Aucun backchannel avant décision ni pendant la parole du robot | À venir |
| 4 | À établir | Aucune première phrase CONV3 avant décision | À venir |
| 6 | À établir | Repli ElevenLabs au segment interrompu, jamais au début | À venir |
| 5 | À établir | Grâce d’hésitation de 550–900 ms pour mots suspensifs | À venir |

## Vérifications finales

À compléter avec les commandes et totaux exacts.
