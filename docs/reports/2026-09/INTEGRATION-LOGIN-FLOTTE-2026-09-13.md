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
