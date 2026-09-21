# La porte de revue de diff, prouvée par exécution — 21/09/2026

Cinquième et dernière fonctionnalité de l'inventaire qui portait un `❓`. Elle est
désormais prouvée, **falsifiée dans les deux sens** et sans dépenser un centime :
le mode `static` n'appelle aucun modèle.

## Le banc

Le vrai outil d'écriture de l'agent (`TextEditorTool.create`, celui que `create_file`
emprunte), deux contenus, deux modes. Le drapeau est porté **sur la commande**, jamais
dans le `.env` du service qui tourne en continu.

| Contenu | `CODEBUDDY_DIFF_REVIEW=off` | `CODEBUDDY_DIFF_REVIEW=static` |
|---|---|---|
| fichier introduisant une clé AWS | passe, **fichier écrit** | **REJETÉ**, rien écrit |
| fichier anodin | passe, fichier écrit | **passe, fichier écrit** |

Message rendu à l'agent en cas de rejet :

```
review REJECTED the change (static: static-gate) — nothing applied.
  [blocker] static-avec-secret.ts:1 — introduces a AWS access key id
```

**Le journal existe et dit vrai** : `.codebuddy/diff-reviews.jsonl`, deux lignes,
`verdict=reject` sur le fichier au secret et `verdict=accept` sur l'anodin.

## Pourquoi les deux sens comptent

Une porte qui bloque tout « marche » aussi bien qu'une porte qui ne bloque rien : les
deux sont inutiles. Les quatre cases du tableau sont donc toutes nécessaires. La case
qui a demandé le plus de travail est la plus discrète : **anodin + `static` = passe**.
C'est elle qui établit que le rejet du secret vient de la règle et non d'un refus
systématique.

## Trois défauts de mon propre banc, avant qu'il ne prouve quoi que ce soit

Consignés parce que les trois auraient produit un verdict faux, et que deux d'entre
eux affichaient « ok » en se trompant.

1. **La confirmation masquait la porte.** Les quatre cas revenaient bloqués avec
   « Approval requires an interactive terminal ». Je mesurais le dialogue
   d'approbation. La porte s'exécute **après** la confirmation : sans
   `setSessionFlag('fileOperations', true)`, on ne l'atteint jamais.
2. **L'outil écrivait ailleurs que là où je regardais.** `setBaseDirectory` ne
   déplace pas le VFS : les fichiers atterrissaient dans `/home/patrice/code-buddy/`
   — dans le dépôt. `fichier_ecrit=false` était un artefact de mon observation, pas
   un fait. Corrigé en exécutant depuis le répertoire du banc.
3. **Le deuxième passage se bloquait sur lui-même.** Les deux modes écrivaient le
   même nom de fichier ; le second échouait sur « File already exists » et mon
   tableau affichait `bloque=true … ok` pour le secret. **Le verdict était juste
   pour une raison fausse** — exactement le piège qu'un banc doit éviter. Un nom
   distinct par passe l'a levé, et c'est seulement là que le vrai motif est apparu.

## Ce que ça ne dit pas

Le mode `full` (relecteurs LLM) n'est pas mesuré ici. La boucle de révision
automatique (`CODEBUDDY_DIFF_REVIEW_REVISE`) non plus. Seul `static` est prouvé,
sur deux règles de la porte (secret introduit, cas nominal) parmi les sept.
