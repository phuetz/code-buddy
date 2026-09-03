# RAPPORT VERIF1 — vérification croisée par MUTATION des lanes fusionnées le 03/09

Date : 2026-09-03
Agent : Grok 4.6 (vérificateur, **pas** l'auteur des lanes)
Clone : `/home/patrice/DEV/cb-verif1-2026-09-03`
Branche : `verif/verif1-mutation-2026-09-03`
HEAD de départ : `6c6e43b58` (`docs(coordination): reprise du quart de pilotage, FLOTTE1/GK34/GK35/GK36 intégrés, quatre lanes en vol`)
Lanes visées : GK34, GK35, GK36, FLOTTE1 (fusionnées sur `codex/audit-systeme-nerveux-2026-09-01`)

Ce rapport a été créé **avant** toute inspection de `src/commands/headless-slash.ts`, `src/commands/batch*`, de l'agent Verifier, de `src/mcp/`, `src/plugins/code-explorer/`, `src/commands/import*`, `src/companion/`, `src/sensory/arrival-opener.ts`, `episodic-journal.ts`, `scripts/lane-ledger.mjs` et des tests associés. Le vérificateur n'est pas l'auteur : son travail est de ne pas croire les rapports verts.

## Pourquoi

Le 02/09, une vérification par mutation a trouvé **14 défauts encore ouverts derrière 26 correctifs annoncés « verts »**. Un test qui ne peut pas rougir ne prouve rien. Quatre lanes viennent d'être fusionnées sur la seule foi de leurs rapports.

## Contraintes

- Clone uniquement. Original `~/code-buddy` interdit en écriture.
- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Aucun service systemd. ComfyUI 8188/8189, pont 8129 et ports robot intacts.
- Ne pas toucher au robot, à `~/.codebuddy` réel, ni à ComfyUI.
- Interdits : `it.skip`, affaiblir un test.
- Avant toute mutation : `git status` propre, tout commité. Une mutation à la fois, jamais deux. Restauration par `git checkout -- <fichier>`.
- Ne réparer RIEN sans l'avoir écrite d'abord comme trouvaille.

## Méthode

Pour CHAQUE contrat :

1. Lancer le test qui le protège → coller le **vert témoin**.
2. Muter la ligne de production qui l'implémente (une seule, la plus petite qui casse le contrat).
3. Relancer le MÊME test → **il doit rougir**. Coller la sortie.
4. Restaurer (`git checkout -- <fichier>`) → coller le vert de nouveau.
5. Si le test reste VERT sous mutation : **trouvaille**. Contrat annoncé, mutation qui passe inaperçue, ce que ça permettrait en vrai.

## Contrats à attaquer (minimum)

### GK34

- Le Verifier refuse `CONFIRMED` sans oracle (mute la condition d'oracle : le verdict doit cesser d'être NEEDS REVIEW).
- `/batch` n'exécute pas deux unités sur le même fichier en parallèle (mute la sérialisation : une course doit apparaître).
- Les slash `/batch`, `/swarm`, `/team` sont dispatchés en headless au lieu d'être envoyés au LLM comme du texte.

### GK35

- Un serveur MCP qui dépasse son délai d'init est SAUTÉ puis reconnecté en arrière-plan, sans bloquer le démarrage (mute le saut : le démarrage doit se remettre à attendre).
- `/tools` attend l'init avant de lister (mute l'attente : la liste doit devenir incomplète).
- `buddy import` fusionne `.claude/mcp.json` **sans doublon** (mute la déduplication).

### GK36

- L'accueil ne contient jamais de jargon XML, de score, ni de note d'auto-évolution non demandée (mute chaque filtre).
- Le moteur proactif n'ouvre pas la bouche par-dessus une parole en cours et honore `MIN_GAP` **y compris** sur Telegram.
- L'épisode du jour garde les faits saillants, pas seulement les six derniers tours.

### FLOTTE1

- Une entrée de journal falsifiée (signature ou chaînage) est REFUSÉE par `verify` (mute la vérification de signature, puis le chaînage du hash précédent : les deux doivent rougir séparément).

## Tableau des mutations

| # | Lane | Contrat | Fichier:ligne mutée | Mutation | Résultat | Commande |
|---|---|---|---|---|---|---|
| — | — | *(aucune inspection encore)* | — | — | — | — |

Légende résultat : `ROUGE attendu` = le test protège le contrat. **`VERT = trouvaille`** = le test ne peut pas rougir.

## Trouvailles

*(aucune encore — inspection non commencée)*

Classement prévu, du plus grave au moins grave : une garde de sécurité qui ne garde rien passe avant une jolie phrase d'accueil.

## Journal d'exécution

- 2026-09-03 : rapport créé, chantier réservé, branche `verif/verif1-mutation-2026-09-03` ouverte. Aucune lecture de production ni de test à cette étape.

## Bilan (à remplir en fin de mission, dix lignes maximum)

*(ouvert)*
