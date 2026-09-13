# Intégration login et reprise de flotte — 13 septembre 2026

## Résultat

Le correctif de `buddy login` est porté sur une branche propre issue de
`origin/main` au commit `13e27f057`. Les quatre commits ont été repris sans
conflit :

- `ae883f5d6` — affichage de l'URL OAuth, poursuite manuelle si le navigateur
  ne s'ouvre pas et erreur explicite si les identifiants ne sont pas écrits ;
- `1cc3b0374` — rejet d'une réponse de jetons arrivée après annulation ;
- `96f1b175f` — smoke test portable d'un paquet installé ;
- `a692062e1` — sonde login isolée reproductible.

La documentation historique propre à l'ancien worktree n'a pas été portée en
bloc. Elle contenait des chemins machine et une version périmée du tableau de
coordination.

## Vérifications

- tests ciblés : 11 fichiers, 130 tests verts ;
- contenu du paquet : 10 tests verts ;
- `npm run typecheck` : code 0 ;
- `npm run build` : code 0 ;
- `npm run lint` : code 0, avertissements historiques autorisés ;
- tarball `@phuetz/code-buddy@2.0.0` : 8,4 MB, 5 067 fichiers ;
- installation fraîche : 1 306 paquets sous
  `/home/patrice/DEV/cb-login-package-qa-GRLsKr/install` ;
- smoke du binaire installé : 6/6 verts (`--version`, `--help`, aide login,
  `whoami`, refus login headless et `doctor`).

## Pilotage de la flotte

Les anciennes réservations vidéo/chaînes et suite déléguée sont libérées :
aucun agent ni processus associé n'est encore actif. La création de la chaîne
Jade et la diffusion restent des décisions humaines. Le correctif
WorkflowBuilder MCP layout est livré sur sa branche. Le commit Grok
`a9667d187` contient trois tests rouges intentionnels sans correctif source et
reste exclu de l'intégration.

La pile `codex/audit-ameliorations-2026-09-13` doit être portée depuis
`8b5c61def..2455a5c5f`, jamais fusionnée en bloc avec ses 32 commits
historiques divergents. Ordre des tranches :

1. persistance ;
2. exécution, observabilité et harnais ;
3. corrections harnais et RPC ;
4. skills, sandbox et évolution ;
5. reprise flotte ;
6. intégration des trois harnais ;
7. Sense ;
8. outillage du harnais ;
9. MCP WorkflowBuilder.

Chaque tranche exige ses tests ciblés et une résolution additive du tableau de
coordination. Aucun push GitHub ni publication npm n'a été effectué.

## Tranche 1 — persistance

La première tranche a ensuite été portée sur
`integration/improvements-persistence-2026-09-13`, à partir du lot login :

- `f2e5081c1` — sessions chiffrées, reprise du contenu et mémoire limitée au
  projet ;
- `7ffe48a71` — rapport comparatif et passation documentaire.

Le conflit attendu dans le tableau de coordination a été résolu de façon
additive. La contre-validation sur la nouvelle base donne 10 fichiers de tests
et 213 tests verts, la sonde réelle de persistance verte, le typecheck vert et
le lint code 0. Le worktree est propre après les deux commits portés.

## Tranche 2 — exécution, observabilité et harnais

Les quatre commits suivants ont été portés sur la tranche 1 :

- `023bc1e6f` — sorties bornées et terminaison des processus bloqués ;
- `a7841e302` — accusés d'écriture et erreurs du journal observables ;
- `8c16c2246` — découverte limitée au périmètre et appels programmatiques
  structurés ;
- `7f847806a` — audit complémentaire du harnais et du cycle RPC.

La contre-validation donne 9 fichiers et 48 tests verts, 10 contrôles du
paquet verts, ainsi que le typecheck et le build verts. La sonde d'audit
s'exécute correctement et reproduit quatre lacunes destinées à la tranche 3 :
lecture par symlink hors workspace, changement de bot accepté, appel RPC après
la fin du script et incohérence du catalogue au-delà de 512 outils.

## Tranche 3 — corrections harnais et RPC

Les défauts de la sonde ont été corrigés par `f0d1667e2` et `356f50d97`, puis
documentés par `efb2d461c`. La même sonde prouve maintenant que le lien sortant
est refusé, que le bot reste lié au harnais, que l'outil 513 est découvert et
appelé, et qu'aucun appel RPC ne démarre après la fin du script.

La contre-validation donne 76 tests normaux et 35 tests avec le runner réel,
plus 10 contrôles du paquet, le typecheck et le build verts. Les trois premières
tranches de la pile sont donc portées et validées sur la base login. Les six
tranches suivantes restent ordonnées dans la section de pilotage et ne sont pas
réservées.

## Intégration GitHub

Après une nouvelle récupération de `origin/main`, sa tête était toujours
`13e27f057`. Le graphe confirmait une avance rapide de 19 commits, le diff-check
était vert, le lint global sortait avec le code 0 et le push à blanc était
accepté. La branche cumulée a donc été poussée directement sur GitHub :
`origin/main` est passé de `13e27f057` à `dc66232a8`. Le paquet npm n'a pas été
publié.

## Tranche 4 — skills, sandbox et DGM

La modernisation DGM est portée avec le confinement Landlock/seccomp, la
vérification d'identité et de comportement des skills, l'évaluation de tâches
comportementales et la promotion du SHA effectivement évalué. Les commits
portés vont de `fba371800` à `fb841c7c0`.

La contre-validation donne 34 tests et 10 contrôles du paquet verts, les sondes
skills/DGM et le benchmark exécutés avec succès, ainsi que typecheck, build et
lint code 0. La sonde de reprise conserve trois défauts documentés pour la
tranche 5 : collision de chemins de propositions, installation sans journal
cohérent et descendants survivant au timeout.

## Tranche 5 — reprise de flotte

Les commits `ab9920c80`, `c81f691a3`, `e54a75883` et `95bf9c8f3`
isolent les propositions, terminent les descendants d'évaluation, rendent les
applications de skills récupérables par journal et ajoutent le superviseur des
opérations locales fixes.

La sonde de reprise est passée rouge→vert. La validation finale donne 55 tests
et 10 contrôles du paquet verts, ainsi que typecheck, build et lint verts. Un
premier lancement parallèle avait exécuté le test du superviseur avant le build
et échoué faute d'artefact `dist`; le rejeu après build est entièrement vert.

## Tranche 6 — intégration des trois harnais

Les commits `a51a74890`, `1b0cd8765`, `1873b38bd`, `4f390aee8` et
`207ffc3b4` ajoutent les missions persistantes avec leases, handoffs et
résultats, le diagnostic de stabilité du cache, le préflight TypeScript borné
des programmes et la continuité/reprise des tâches cron.

Après compilation, les huit fichiers ciblés donnent 144 tests verts. Les dix
contrôles du paquet, le typecheck et le lint sont également verts.

## Tranche 7 — Sense

Les commits `fb1a6d734` et `c74197c80` bornent les attentes réseau du bridge
Sense et préservent les événements reçus dans un ordre différent. Les tests
Rust passent à 42/42 et les trois suites d'intégration TypeScript donnent 20/20.
