# Réparation SENSE4

## Objet et périmètre

Rebaser les sept preuves, le rapport de revue et les six correctifs SENSE3 de la branche
`fix/sense-gemini-2026-09-03` sur la branche intégrée SENSE1 + CONV1 + CONV2, sans perdre
les comportements de l'une ou l'autre lignée.

Ce rapport a été créé avant toute inspection du dépôt, conformément à la mission. Le clone
travaillé est `/home/patrice/DEV/cb-succes-sensory-2026-09-02`. Le dépôt source
`/home/patrice/code-buddy` a uniquement servi de source de `git fetch`; aucune écriture ni aucun
push n'y a été effectué.

## État initial et rebase

- HEAD initial : `8e3cb43d5`, branche `fix/sense-gemini-2026-09-03`.
- Cible vérifiée après `git fetch /home/patrice/code-buddy codex/audit-systeme-nerveux-2026-09-01` :
  `FETCH_HEAD=4ac91f2561b52944329817970d88b06983ce9d4b`.
- Base commune : `facea986446db20cfcb63085be0344756e8c6122`.
- `git rebase FETCH_HEAD` a rejoué 14 commits propres à SENSE3 : sept preuves, le rapport de
  revue, puis six correctifs.
- `REPARATION-SENSE3.md` était modifié avant SENSE4. Il a été mis de côté par chemin explicite,
  restauré après le rebase et laissé hors de tous les commits SENSE4.

## Conflits rencontrés et décisions

### 1. Écho et conversation — commit `bd3b91690`

Conflits textuels dans :

- `src/sensory/speech-reaction.ts` ;
- `src/sensory/voice-activity.ts` ;
- `tests/sensory/speech-reaction.test.ts` ;
- `tests/sensory/voice-activity.test.ts`.

Résolution : une seule chaîne de classification d'écho, avec l'union des garanties.

- L'anneau SENSE1 reste borné à huit phrases et valable 90 secondes.
- La normalisation des accents et le seuil SENSE3 sont conservés : au moins 60 % des mots de la
  phrase prononcée doivent réapparaître. Le seuil porte sur la référence, pas sur un petit extrait
  STT, afin qu'un fragment de deux mots ne devienne pas un faux écho.
- Toutes les références récentes de l'anneau sont examinées, de la plus récente à la plus ancienne;
  l'ajout d'une nouvelle phrase ne fait donc pas oublier les segments TTS précédents.
- Le filtre d'écho reste indépendant de l'AEC. En revanche, l'ouverture du garde demi-duplex par
  AEC exige toujours l'opt-in SENSE1 `CODEBUDDY_SENSORY_AEC_TRUST=true`.
- Le garde demi-duplex SENSE1 reste prioritaire pendant la lecture et sa queue acoustique : la
  capture est jetée avant transcription et avant persistance.
- Hors de cette queue, l'écho SENSE3 est encore supprimé par la classification mémoire; son percept
  d'audit ne contient pas le texte prononcé.
- La règle CONV2 est conservée : un tour qui a déjà interrompu la lecture acoustiquement passe le
  garde et la porte `during_playback_non_explicit`.
- La fermeture de la fenêtre d'engagement SENSE3 reste inchangée.

Le conflit de test « seule la dernière phrase » contre « anneau des phrases » a été tranché en
faveur de l'anneau explicitement demandé : le test conserve les seuils 2/5 (distinct) et 3/5 (écho),
puis vérifie que l'ancienne et la nouvelle phrase de l'anneau restent toutes deux reconnues.

### 2. Obscurité et mémoire de rêve — commit `6dec31b1a`

Conflit textuel dans `src/sensory/vision-reaction.ts`; le test
`tests/sensory/vision-reaction.test.ts` s'est fusionné textuellement mais portait un conflit de
contrat.

Résolution : une seule lecture du payload, enrichie de `meanLuma` et `motionScore`, avec deux couches
complémentaires.

- La porte SENSE1 `meanLuma < 12` court-circuite l'analyse VLM avant debounce, quota et persistance.
- Le plafond SENSE1 de quatre analyses par minute reste actif.
- Si `meanLuma` manque mais que `motionScore < 0.05`, la scène peut rester observable à court terme,
  mais SENSE3 la marque à faible saillance (`64`) et `dreaming.ts` interdit sa promotion en mémoire
  durable.
- Le test SENSE3 a donc été conservé sur le cas complémentaire « luminance absente, mouvement quasi
  nul », tandis que le test SENSE1 continue de prouver l'absence totale d'analyse sur image noire.

### 3. Preuve Python du bruit vidéo — conflit sémantique après rebase

`buddy-vision/test_hole_dark_motion_threshold.py` n'a pas eu de marqueur Git, mais son ancienne
assertion exigeait que `motion_score()` expose un score brut supérieur à `0.025`. SENSE1 a remplacé
ce contrat par `MotionGate`, qui filtre les pixels et applique la porte de luminance.

Le test mesure désormais séparément le bruit brut et prouve qu'il dépasse encore
`MOTION_THRESH`; il vérifie ensuite que `MotionGate` classe les trames sous `MOTION_MIN_LUMA` comme
sombres et retourne `moved=false`. La prémisse adversariale et le résultat produit sont donc tous
deux vérifiés.

### 4. Correctifs sans conflit

Les trois règles d'arrivée SENSE3 se sont rejouées sans conflit et restent toutes présentes : claim
du chef d'orchestre, politique Maison et refus pendant une voix active. La quarantaine de rêve et la
VAD adaptative Rust (plancher de bruit, fermeture et plafond de récupération) ont également été
conservées.

## Vérifications

- Sept fichiers `hole-*` : six fichiers Vitest → `Test Files 6 passed (6)`, `Tests 7 passed (7)`;
  le fichier Python → `1 passed`. Tous sortent avec le code 0.
- Ciblage SENSE3 + SENSE1 + CONV2 : 11 fichiers Vitest, `79 passed`.
- Vision Python, trou d'obscurité inclus : `python3 -m pytest -q
  buddy-vision/test_hole_dark_motion_threshold.py buddy-vision/test_watch.py` → `19 passed`.
- Suite exigée : `npx vitest run tests/sensory tests/companion` → `Test Files 130 passed (130)`,
  `Tests 1219 passed | 1 skipped (1220)`.
- TypeScript : `npm run typecheck` → exit 0 (`tsc --noEmit` puis
  `tsconfig.gpuNode-identity.json`).
- Lint ciblé : `git diff --name-only FETCH_HEAD -- '*.ts' | xargs -r npx eslint` → exit 0, aucune
  sortie.

Deux contrôles intermédiaires ont échoué et ont été corrigés avant la preuve finale :

1. Le premier essai du test d'écho attendait un percept pendant la queue demi-duplex; aucun fichier
   n'était créé, conformément à SENSE1. Le test final vérifie cette absence de persistance pendant
   la queue; l'observabilité SENSE3 reste testée hors queue.
2. Le premier essai Python a obtenu `motion_score=0.0` contre l'ancienne attente `> 0.025`. La preuve
   a été réalignée sur le contrat public `MotionGate` sans supprimer la mesure du bruit brut.

## Commits

Correspondance ancien commit SENSE3 → commit rebasé :

- `2aab527b8` → `354e70799` — preuve course chef d'orchestre;
- `17f33bf4f` → `17f87b414` — preuve politique Maison;
- `7d78accca` → `7a4bd2732` — preuve fenêtre d'engagement;
- `d5a762d85` → `7f6ba6174` — preuve collision voix;
- `a659ef19b` → `44bbb4b03` — preuve mémoire hallucinée;
- `be189599e` → `a5f81d4c8` — preuve plafond VAD;
- `73b2bd0e7` → `bd3c26de6` — preuve bruit vidéo sombre;
- `f65817c9f` → `8737e41aa` — rapport de revue;
- `bd3b91690` → `ef2a825c5` — engagement + écho;
- `3bbbf039a` → `334d59320` — chef d'orchestre;
- `6b6bad53d` → `be96f481b` — politique Maison;
- `d97d8983e` → `6fae1cced` — collision voix;
- `6dec31b1a` → `d63f55e7d` — quarantaine des rêves;
- `8e3cb43d5` → `10ece5ccd` — VAD adaptative;
- `3e188c5e7` — réconciliation finale des preuves écho/obscurité avec les contrats intégrés.

Aucun test n'a été supprimé, ignoré ou affaibli pour faire passer le rebase. Aucun service n'a été
touché et aucun push n'a été effectué.
