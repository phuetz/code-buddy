# RAPPORT GK34 — `/batch`, `/swarm`, `/team` et le Verifier en vrai

Date : 2026-09-03  
Agent : Grok 4.6  
Clone : `/home/patrice/DEV/cb-repar-security-2026-09-02`  
Branche : `fix/gk34-multi-agents-reel-2026-09-03`  
HEAD de départ : `1ecb8a07e` (`Merge IMG1/IMG2 … into codex/audit-systeme-nerveux-2026-09-01`)

Ce rapport a été créé **avant** toute inspection de `src/agents/`, `src/orchestration/`, `src/commands/{batch,swarm,team}*.ts` et des tests associés. Il est complété au fil de l'eau.

## Contraintes

- Clone uniquement. Original `~/code-buddy` interdit.
- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Ollama local ; `ollama ps` avant chaque lancement : un seul gros modèle à la fois, jamais deux 27B.
- Aucun service (ComfyUI 8188/8189, buddy 3000/3001) touché.
- HOME isolé `_qa/gk34/home` (gitignoré), dans le clone seulement.
- Dépôt jouet `_qa/gk34/toy/` : trois tâches indépendantes (corriger un test, ajouter une fonction documentée, écrire un README).

## Parcours prévu (loi : se servir des applis EN VRAI)

1. `/batch` décompose et exécute en parallèle — preuve : diffs distincts, pas de course d'écriture sur un même fichier.
2. `/swarm` : chef d'équipe qui délègue et rend compte.
3. `/team start|add|status` : coordination visible.
4. Verifier (`executeOn('verifier', …)`) : CONFIRMED / NEEDS REVIEW avec preuves, sur un travail volontairement incomplet.

Chaque défaut (« terminé » sans diff, deux agents qui écrasent le même fichier, Verifier qui confirme sans preuve, blocage, sortie polluée, doc fausse) : test rouge → correctif → vert, un commit.

## Tableau commande → attendu → obtenu → correctif → commit

| Commande | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| *(à remplir après inspection et parcours réel)* | | | | |

## Inspection

*(vide — rapport créé avant lecture des sources)*

## Preuves live

*(vide)*

## Ouvert

*(vide)*
