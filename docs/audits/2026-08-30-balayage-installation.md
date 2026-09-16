> **STATUT : le défaut principal est SOLDÉ.** Re-vérifié le 2026-09-01 :
> le constat §4 (`timeout` sans `--kill-after`, donc hang possible à vie) **est corrigé** —
> les 4 appels de `scripts/balayage-installation.sh` (l. 47, 50, 115, 121) portent tous
> `timeout --kill-after=5 "$TIMEOUT"`.
> Le constat §5 reste vrai et **assumé** : le motif `^  [a-z][a-z0-9-]+` ne capte que les lignes
> indentées de 2 espaces, donc « 103 » est un **plancher** de commandes balayées, pas l'inventaire
> exhaustif des sous-commandes du binaire.

# RAPPORT — Audit du balayage d'installation

Fichier : `scripts/balayage-installation.sh` (82 lignes). Non référencé dans le dépôt
(aucun appel dans `*.sh`, `*.mjs`, `*.ts`, `*.json`, `*.md`) → pas d'exécution CI automatique.
Vérifications (lecture seule, hors `/tmp` partageable) :
- `node dist/index.js --help` → sortie complète récupérée.
- Motif d'extraction `^  [a-z][a-z0-9-]+` → **103** lignes → `total=103`.

Le script comporte 4 garde-fous amont (`exit 2`) : build (l. 25), `npm pack` (l. 29),
installation (l. 34), point d'entrée absent (l. 37). Le reste est analysé ci-dessous.

---

## 1. Succès annoncé même si une étape amont échoue

Partiellement oui, mais **pas** sur les 4 piliers gardés.

- Build (l. 25), pack (l. 29), install (l. 34), entry introuvable (l. 37) : chaque échec
  provoque un `exit 2` explicite → le script **ne peut pas** afficher le succès (exit 0) si l'un
  de ces 4 piliers tombe. La condition de succès (l. 74) n'est donc pas atteignable après un
  échec amont « classique ».
- **Cependant**, l'extraction des elle-même (l. 52) n'a **aucune** garde de succès :
  `appel --help | grep … | sort -u > commandes.txt`, puis `total=$(wc -l < commandes.txt)` (l. 53).
  Si `--help` ne liste plus de commandes au motif attendu (help restructuré, sortie redirigée sur
  stderr, ou `env -i` qui échoue), `commandes.txt` devient **vide** → `total=0` → la boucle (l. 58)
  ne tourne pas → `n=0` → **exit 0** avec « ✓ 0/0 commandes répondent ». Succès annoncé malgré un
  balayageeffectivement nul.
- De plus, `set -uo pipefail` (l. 16) mais **pas** `-e`. L'itération unique d'extraction (l. 52)
  ne sort jamais sur erreur : un `cd` raté ou un `timeout` bloqué pendant l'extraction n'est pas
  intercepté → le script peut continuer ou hangner sans `exit`.

Conclusion : un build/install/pack/entry raté est bien détecté (`exit 2`). Mais un **échec de
l'extraction** (l. 52) est muet et peut produire un succès (exit 0) sur `total=0`.

---

## 2. Le code de sortie distingue-t-il « aucune commande ne plante » de « balayage non exécuté » ?

Oui, **en partie**, via trois voies distinctes :
- `exit 2` → balayage n'a pas pu tourner (build/pack/install/entry, l. 25/29/34/37).
- `exit 0` → `n == 0` (aucune fautive, l. 74-76).
- `exit 1` → `n > 0` (l. 78-82).

Donc « non-tourne » (exit 2) et « répondent » (exit 0) sont distincts.
**Piège :** la condition de succès (l. 74) ne vérifie **pas** `total > 0`. Si
l'extraction échoue → `total=0` et `n=0` → **exit 0** = faux succès. Le message (l. 75) affirme
« sur une installation neuve » sans confirmer que l'installation a réellement tourné ni que des
commandes ont été testées. La distinction est donc réelle pour les 4 piliers, mais **hole** sur le
cas `total=0`.

---

## 3. Formes d'échec qui passent à travers le `grep` (l. 61)

Condition de détection : `statut -ne 0 || grep -qE "Cannot find package|ERR_MODULE_NOT_FOUND|Unhandled promise|Crash context saved"`.
Donc échec = (code != 0) ou (un des 4 motifs). Les échecs qui **passent** :

- **Sortie == 0 mais échec réel.** Tout ce qui renvoie code 0 est ACCEPTÉ, quel que soit le
  contenu. Ex. : `buddy <cmd> --help` qui imprime un help minimal (0 commande au motif) et sort 0 →
  PASS. Échec fonctionnel (la commande ne fait pas ce qu'elle promet mais sort 0) → PASS.
- **Le script ne teste QUE `--help`.** Jamais l'exécution réelle d'une commande. « 103/103
  répondent » = « 103/103 `--help` », jamais « 103/103 exécutent leur fonction ». C'est le défaut
  structurel majeur.
- **Motifs non couverts :** le `grep` ne contient pas `command not found`, `EACCES`, `ENOSPC`,
  `EADDRINUSE`, `npm ERR`… mais ces échecs sont **déjà** capturés par `statut -ne 0`, donc le manque
  de motif ne fait passer qu'un seul type : **succès apparent (code 0)**.
- **stderr masqué :** la substitution `sortie="$(appel …)"` (l. 59) ne garde pas le stderr dans une
  variable exploitable par le grep `<<<"$sortie"` — en fait `2>&1` dans `appel` (l. 49) fusionne
  stderr dans stdout, donc le grep le voit **si** le code est 0 mais qu'il y a un motif. Sinon (code
  0) → PASS.

Résumé : le seul type d'échec qui traverse est **code de sortie == 0**. Tout crash (code != 0) est
détecté, avec ou sans motif.

---

## 4. `timeout 45` (l. 49) : une commande qui dépasse est-elle un succès ?

Non, mais le script **peut hangner** plutôt que de signaler un échec.

- l. 49 : `env -i … timeout 45 node "$ENTREE" "$@" 2>&1`. l. 59 : `sortie="$(appel …)"` ;
  l. 60 : `statut=$?`.
- Cas A — `node` meurt au SIGTERM de `timeout` : `statut = 143` (> 0) → `statut -ne 0` → **FAIL**.
  Correct.
- **Cas B — `node` ignore le SIGTERM** (boucle non bloquante, handler perso, interface Interactive
  en attente de saisie) : `timeout 45` **n'envoie pas de SIGKILL par défaut** (absence de
  `--kill-after`). `timeout` **attend** que le process meure → `env -i … timeout 45` bloque.
  `sortie="$(…)"` (l. 59) **n'est jamais terminé** → le script **hangne à vie** sur cette boucle.
  Ce n'est ni succès ni échec : c'est un blocage définitif, et la boucle (l. 58) n'a pas de
  timeout global.
- Donc `timeout 45` **sans** `--kill-after` ne peut pas forcer la fin d'un process récalcitrant.
  Une commande qui tourne sans jamais répondre → **hang**, pas de verdict.

Fix recommandé : `timeout --kill-after=5 45 …` pour forcer le SIGKILL si SIGTERM échoue.

---

## 5. Le comptage « 103 » n'est pas l'ensemble des sous-commands

Le motif `^  [a-z][a-z0-9-]+` (l. 52) ne capte que les lignes indentées de exactly 2 espaces.
Les 6 démos introductives (format `1. buddy try`, `2. /loop …`, `5. /think deep …`) et les
sous-entrées non indentées à 2 espaces ne sont **pas** extractibles. « 103 » est donc un **plancher**
de commandes testées, pas l'ensemble des sous-commands réelles du binaire. Un balayage de
103/103 peut masquer des sous-commands non testées.
