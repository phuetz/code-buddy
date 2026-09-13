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
  un répertoire temporaire d’installation isolée ;
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

Une seconde avance rapide a ensuite intégré les tranches 4 à 9 et la clôture
CI portable : `origin/main` est passé de `ded4cd165` à `808e986f8`. Cette
version contient donc l'ensemble de la modernisation DGM, de la gestion des
outils, de la reprise de flotte, de Sense et de l'intégration MCP
WorkflowBuilder décrits ci-dessous. Le paquet npm reste inchangé.

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

La matrice Windows a repéré une attente POSIX codée en dur dans cette suite.
`085f2ceb7` compare désormais le workspace résolu par la plateforme ; les deux
tests du superviseur restent verts.

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

## Tranche 8 — outillage du harnais

Les commits `996693e15` et `780f55d6a` exposent les métadonnées de mission et
coordonnent les demandes d'index Code Explorer. La contre-validation donne six
fichiers et 138 tests verts, plus 10 contrôles du paquet, typecheck, build et
lint verts.

## Tranche 9 — MCP WorkflowBuilder

Le commit `5e0197932` connecte WorkflowBuilder aux commandes MCP natives, au
transport HTTP, au CLI et au service Cowork. Les tests donnent 97 cas verts
pour le noyau MCP et 25 pour les deux suites Cowork modifiées. Le contrôle du
paquet, le typecheck, le build et le lint du noyau ainsi que le lint Cowork sont
verts.

Le typecheck Cowork complet échoue sur des déclarations `adm-zip` et l'ancien
export `OSSandboxConfig`. Le même échec a été reproduit dans le worktree du lot
login avant les tranches d'amélioration ; il ne vient pas du delta MCP. Les
fichiers Cowork modifiés restent couverts par leurs tests et le lint.

La matrice complète a aussi révélé que deux assertions historiques de
`mcp-tool-adapter` décrivaient encore le rejet de l'ancien transport SSE.
`09934a25a` les remplace par une vérification de la délégation, de l'URL et des
en-têtes vers le transport streamable HTTP natif. Les 55 tests passent sous
Node 20.20.2 et Node 24.

Le dernier shard Windows a révélé deux fixtures supplémentaires : l'import du
processus concurrent MissionStore utilisait un chemin Windows brut comme
spécificateur ESM, et le test compagnon cherchait un chemin à antislash après
sa sérialisation JSON. `1121ddbab` emploie une URL `file:` et inspecte les
messages avant sérialisation. Les suites concernées donnent 16 tests verts et
un test ignoré. Le seul autre échec Windows Node 20 du run était un worker
Vitest sorti après 5 949 tests verts, sans assertion rouge.

Les neuf tranches prévues sont désormais portées. Le commit Grok `a9667d187`
reste exclu parce qu'il contient uniquement trois tests rouges intentionnels et
aucun correctif source.

## Clôture CI portable

Le premier run publié après les tranches 1 à 3 a révélé un chemin personnel
dans ce rapport. Le contrôle de confidentialité est repassé à 40/40 après son
remplacement par une description neutre.

Les deux autres échecs concernaient Windows et existaient déjà sur le run de
base `34762883281` : une attente de chemin POSIX codée en dur et l'absence de
reconnaissance d'un chemin média avec lettre de lecteur dans une sortie
textuelle. Le commit `bf61b6d42` rend l'attente portable et accepte les chemins
absolus Windows. La validation donne 74 tests ciblés, typecheck, build, lint et
10 contrôles du paquet verts.

Le premier rejeu macOS a ensuite exposé cinq tests qui supposaient encore que
les outils générés pouvaient s'exécuter sans Landlock. Le correctif
`931f1f735` conserve le refus fermé en production, vérifie explicitement ce
refus sur les plateformes non Linux et limite aux runners Linux les scénarios
comportementaux qui exigent le confinement noyau. Le test historique de lecture
absolue vérifie désormais que la sentinelle reste inaccessible. La suite élargie
self-improvement et sécurité donne 50 fichiers et 403 tests verts sous Linux,
avec lint ciblé et typecheck verts.

Le shard macOS suivant a repéré le même prérequis dans le test du cycle DGM
complet. `6cd223c01` applique la même borne Linux à ce scénario ; ses 13 tests
restent verts sur le runner Linux.

Le shard 5 macOS a enfin trouvé les deux scénarios ProposalStore qui évaluent
une proposition d'outil avant de tester sa persistance. `f4c825d8a` les borne
eux aussi au runner Linux ; la suite self-improvement complète repasse à 47
fichiers et 384 tests verts.

Le shard macOS Node 20 suivant a montré que le worker de préflight TypeScript
était encore lancé avec une option réservée aux versions récentes de Node.
`e54dca188` préfère le worker JavaScript produit par le build lorsqu'il est
disponible. Le préflight passe à 32/32 sous Node 20.20.2 réel ; avec le test
d'agent ajusté au refus fermé hors Linux, les deux suites concernées donnent
133 tests verts.

Une revue indépendante finale a ensuite contrôlé les correctifs de portabilité.
`ed1923c24` ferme le dernier cas d'un checkout source sans `dist` sous Node 20
en lançant le worker TypeScript avec le chargeur `tsx`. Elle resserre aussi la
borne Linux aux deux seuls scénarios ProposalStore qui exécutent un outil : les
six cas de skills, d'identité et de collisions restent actifs sur macOS et
Windows. Le chemin sans build a été forcé sous Node 20.20.2 : 40 tests sur 40,
typecheck, lint et contrôle du diff verts.

## Paquet final

Le paquet final 2.0.0 a été créé après les neuf tranches, installé avec ses
1 306 dépendances dans un répertoire temporaire d’installation isolée,
puis exécuté depuis ce préfixe neuf. Les six scénarios du CLI passent : version,
aide, aide login, état déconnecté, refus headless et doctor.
