# Réparation GT2 — tests utiles des gardes de la nuit

Date : 2026-09-03

Branche : `fix/gt2-tests-utiles-2026-09-03`

Base GT1 : `0bc701c6b`

Commits GT2 : `27ae16435`, `7495c6469`, `c08ab6d2e`, `b4c9e9156`

## 1. Cadre et état initial

Ce rapport a été créé avant toute inspection. Le chantier a ensuite été réservé dans
`docs/FABLE5-CODEX-COORDINATION.md`. Aucun push, service externe ou API payante n'a été utilisé.

Le premier baseline a été lancé avec le filtre sans slash final demandé par GT1 :

```text
npx vitest run tests/sensory tests/companion \
  --exclude tests/sensory/revue-gt1-mutations.test.ts --reporter=verbose
→ 133 fichiers : 132 passés, 1 échec, 1239 tests passés, 1 échec, 4 skippés
→ échec : vision-reaction asynchrone sous charge ; le rerun isolé est vert
```

Ce filtre est trop large : `tests/companion` sélectionne aussi 15 fichiers racine
`tests/companion-*.test.ts`. Au HEAD, la comparaison statique donne 118 fichiers / 1155 tests
dans les deux répertoires exacts, contre 133 / 1247 avec le filtre GT1, soit 15 fichiers et
92 tests hors périmètre. Le total GT1 de 1244 est donc gonflé par le même défaut de filtre.

Incident de confinement : ce tout premier baseline a précédé la redirection de `HOME` et
`TMPDIR`; les tests ont donc pu utiliser le répertoire temporaire système ou les stores de test
du compte. Aucune suppression hors clone n'a été tentée. Toutes les commandes suivantes ont été
préfixées par :

```bash
HOME="$PWD/node_modules/.gt2-home" \
TMPDIR="$PWD/node_modules/.gt2-tmp" \
NODE_COMPILE_CACHE="$PWD/node_modules/.cache/gt2"
```

Le fichier GT1 d'origine a été exécuté avant correction : 5 tests, 5 échecs. Son cas demi-duplex
émettait toutefois un événement `hearing/speech_final` que la production ne consomme pas et
n'aurait donc détecté aucune mutation. GT2 l'a remplacé par le vrai contrat
`audio/transcript_final` et par l'observation du percept persisté, sans mock `onHeard`.

## 2. Règles produit fixées

1. Une transcription commencée dans la queue `echo_tail` est analysée : un fragment robot est
   supprimé, une réponse humaine distincte est conservée.
2. Sous 90 secondes, une capture dont tous les tokens proviennent d'une phrase robot récente est
   un écho, quelle que soit la fraction de la phrase robot captée. Un token humain distinct suffit
   à ne pas appliquer cette règle de fragment pur.
3. Dans une fenêtre d'engagement active, les réponses exactes et bornées (`oui`, `non`,
   `d'accord`, `pas vraiment`, `pourquoi pas`, etc.) sont conversationnelles. Hors fenêtre, elles
   restent ambiantes.
4. Une surface `arrival` est un signal de transition autorisé même si la posture persistée est
   encore `away`; les autres surfaces locales restent bloquées.
5. Le cooldown visuel supprime le retour de la même identité, pas l'arrivée d'une identité
   différente après le départ d'un tiers.

## 3. Rejeu réel des cinq mutations

Chaque mutation a été appliquée seule au code restauré. La suite témoin est un fichier GT1
préexistant et non modifié pour détecter le mutant. Le test GT2 ciblé a ensuite été lancé avec
`-t`, puis le code restauré avec `apply_patch` et le même contrat relancé.

| Famille | Mutation appliquée | Suite témoin sous mutant | Contrat GT2 sous mutant | Après restauration |
|---|---|---:|---:|---:|
| Demi-duplex | retrait de `!canDiscriminateEchoTail` | `speech-reaction-workers`: 8/8 verts | 1/1 rouge, aucun percept créé | 1/1 vert |
| Filtre d'écho | retrait de `transcriptIsRobotFragment` | `voice-replay-lab`: 2/2 verts | 1/1 rouge, `distinct` reçu | 1/1 vert |
| Engagement | retrait de `isBriefConversationAnswer` | `hole-ambient-in-window-loop`: 2/2 verts | 1/1 rouge, `ambient-in-window` reçu | 1/1 vert |
| Maison | retrait de l'exception `surface !== 'arrival'` | `hole-arrival-home-policy`: 1/1 vert | 1/1 rouge, `allowed: false` | 1/1 vert |
| Présence | retrait du déblocage sur identité différente | `identity-reaction`: 2/2 verts | 1/1 rouge, aucun état d'accueil créé | 1/1 vert |

Commandes ciblées utilisées, avec le préfixe d'environnement ci-dessus :

```text
npx vitest run tests/sensory/revue-gt1-mutations.test.ts -t "demi-duplex" --reporter=dot
npx vitest run tests/sensory/revue-gt1-mutations.test.ts -t "filtre d’écho" --reporter=dot
npx vitest run tests/sensory/revue-gt1-mutations.test.ts -t "fenêtre d’engagement" --reporter=dot
npx vitest run tests/sensory/revue-gt1-mutations.test.ts -t "politique Maison" --reporter=dot
npx vitest run tests/sensory/revue-gt1-mutations.test.ts -t "hystérésis de présence" --reporter=dot
```

Le test présence couvre aussi l'anti-surcorrection : même identité dans les cinq minutes = pas de
nouvel accueil ; identité différente = accueil. Le lot fonctionnel complet passe 133/133 tests.

## 4. Triage des « 87 tests creux » GT1

Le rapport GT1 ne fournit pas l'inventaire annoncé. Il nomme 12 signalements seulement (dont un
bloc de deux doublons), sans aucune correspondance pour les 75 restants. Sa liste dite exhaustive
de 64 fichiers sensoriels omet 18 fichiers présents au commit audité — dont `agent-reply.test.ts`,
qu'elle cite ensuite — et mentionne à leur place 18 fichiers absents de ce commit. Il serait donc
mensonger d'inventer 75 couples `fichier:test`.

Voici l'inventaire exhaustif des signalements réellement traçables dans GT1 :

| `fichier:test` signalé par GT1 | Lot | Action et preuve | Commit |
|---|---|---|---|
| `attached-image-grounding` : `analyzes all photos jointly…` | a | Réécrit : vérifie prompt, modèle, endpoint, signal, source et octets `front`/`back`, puis la carte dérivée | `c08ab6d2e` |
| `agent-reply:380-410` : cible décrite comme « outil autonome » | faux positif | La plage contient quatre contrats de panne/absence de sortie, aucun test d'outil ; assertions sur résultats et modes réels, conservées | — |
| `voice-replay-lab` : `detects a delayed acoustic repetition…` | a + code | Un candidat présent comme tour utilisateur est une fuite : couverture 0, `passed:false`; l'ancien `1 : 1` fait désormais rougir le test | `c08ab6d2e` |
| `signature-locations` : `is deterministic…` | a / faux positif | Deux appels distincts détectaient déjà l'aléa ; rendu explicite en deux passes + unicité des angles + taille minimale | `c08ab6d2e` |
| `fashion-scene-catalog` : `is deterministic…` | a / faux positif | Deux appels distincts + contenu exact du déclencheur, de la tenue et du décor | `c08ab6d2e` |
| `hole-vad-noise-cap` : simulation locale | c | Corps factice retiré, `it.todo` explicite. Dette : exposer un harnais Rust ; l'invariant produit existe dans `live_audio.rs::adaptive_return_to_room_noise_closes_by_silence` | `c08ab6d2e` |
| `sherpa-rs-stt` : `decodes the French sample…` | faux positif | `it.runIf(runnable)` documenté : vraie intégration binaire/modèle, utile mais conditionnelle | — |
| `sherpa-rs-stt` : `auto-selects sherpa-rs…` | faux positif | Même garde d'intégration, assertions sur le vrai worker | — |
| `sherpa-rs-stt` : `decodes five French fixtures…` | faux positif | Même garde, cinq WAV réels exigés | — |
| `sherpa-rs-stt` : `carries speech_end…` | faux positif | Même garde, chemin événement → worker → `heard` réel | — |
| `voice-activity` : `uses at least 60%…` | a + code | Attente inversée corrigée : fragment pur 2/5 = `echo`, phrase avec token humain = `distinct` | `7495c6469` |
| `reply-augment` : bloc `default voice reply evolves…` (2 tests) | b | Copie stricte prouvée dans le même fichier ; un exemplaire identique conservé, l'autre supprimé | `c08ab6d2e` |

Pour préserver la grille GT1, le calcul ci-dessous compte son signalement `agent-reply` comme
l'unique test qu'il décrit — bien que la plage citée en traverse quatre — et le bloc dupliqué comme
deux tests. Cela donne 13 unités traçables : 3 devenues utiles par réécriture comportementale,
7 faux positifs déjà utiles (dont les 4 intégrations), 2 doublons stricts supprimés et 1 dette
décorative désormais visible en `todo`. Les cinq contrats de mutation GT2 sont traités séparément
au §3.

## 5. Taux avant / après selon la grille GT1

| Lecture | Utile / total | Taux | Limite |
|---|---:|---:|---|
| GT1 publié | 1157 / 1244 | 93,0 % | total hors périmètre et 87 non inventoriés |
| Grille GT1 corrigée sur les 13 corps traçables | 1167 / 1242 | 94,0 % | 74 prétendus tests creux restent sans identité ; 1 `todo` explicite |
| Suite exacte GT2, indicateur opérationnel | 1159 non décoratifs / 1160 | 99,9 % | 4 intégrations valides sont conditionnelles ; ce n'est pas un ré-audit des 74 entrées absentes |

Le deuxième taux conserve volontairement la grille GT1 pour comparaison : +3 tests réellement
renforcés, +7 faux positifs reclassés utiles, -2 doublons. Le troisième compte les 1155 tests
passés et les 4 contrats d'intégration conditionnels comme non décoratifs, face au seul `todo`.

## 6. Vérifications finales

```text
npx vitest run tests/sensory/ tests/companion/ --reporter=dot
→ 119 fichiers : 118 passés, 1 fichier todo ; 1155 passés, 4 skippés, 1 todo (1160)

npx vitest run tests/sensory/screen-reaction.test.ts tests/sensory/vision-reaction.test.ts --reporter=dot
→ 2 fichiers, 18/18 tests passés

npm run typecheck
→ tsc --noEmit puis tsc -p tsconfig.gpuNode-identity.json : succès

npx eslint <tous les fichiers TypeScript modifiés>
→ succès, aucune sortie

git diff --check
→ succès, aucune sortie
```

L'échec intermittent initial de `screen-reaction` et celui observé au baseline dans
`vision-reaction` provenaient d'un délai fixe de 30 ms plus court que leur chaîne asynchrone sous
charge. Les tests attendent maintenant le percept persisté avant de réémettre ; aucun changement
produit n'a été nécessaire pour ce lot.
