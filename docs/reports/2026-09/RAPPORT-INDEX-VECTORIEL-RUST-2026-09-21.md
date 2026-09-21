# Un seul moteur vectoriel, en Rust, sur les trois systèmes — 21/09/2026

**Décision de Patrice** : « fait du rust partout ». Ce rapport tient le journal du
chantier, y compris ce qui sera mesuré avant d'être cru.

## Pourquoi

Code Buddy porte **deux** moteurs vectoriels pour le même travail :

| | Moteur | Plateformes | Sert à |
|---|---|---|---|
| `buddy-memory/` | `hnsw_rs 0.3` (**Rust**) | partout où cargo compile | le graphe de connaissances collectif |
| `src/knowledge/workspace-indexer.ts` | `usearch` (**C++/npm**) | Linux + macOS **seulement** | `semantic_search`, Deep Research, embeddings de graphe |

Le second ne s'installe pas sur Windows : le paquet npm ne livre aucun binaire
`win32` (seulement `darwin-arm64+x64`, `linux-arm64`, `linux-x64`) et l'amont n'a
même pas de script `prebuild-win`. `node-gyp-build` doit alors compiler du C++ via
MSVC, ce qui échoue sur un runner — **silencieusement**, puisque c'est une
`optionalDependency`. Mesuré : 1831 paquets installés côté Windows/Node 22 contre
1842 côté Node 20, sur le même run, sans une ligne d'erreur.

Conséquence aujourd'hui : sur Windows, `semantic_search` retombe sur un
`BruteForceIndex` écrit à la main — une boucle cosinus **O(n) en JavaScript**, qui
recalcule les deux normes à chaque comparaison.

**Et la brique Rust qui règle ça existe déjà** : `buddy-memory/src/ann.rs` expose un
index générique, sans rien de spécifique au graphe de connaissances —
`with_capacity(dim, capacity)`, `insert(id, vec)`, `search(query, k)`,
`from_pairs(...)`. C'est exactement l'interface dont `workspace-indexer` a besoin.
C'est aussi **la crate qu'emploie ragvec** (`hnsw_rs 0.3.4`), qui sert 1,99 M chunks
en production chez RagChat.

## Ce qui manque

Le sidecar ne traite que quatre méthodes RPC — `ping`, `remember`, `ingest`,
`recall` — toutes spécifiques au graphe. **Aucune n'expose l'index vectoriel
générique.** Le chantier consiste donc à publier `AnnIndex` par-dessus le même
transport JSON-RPC, puis à brancher le client TypeScript.

## Étapes, et l'ordre dans lequel elles se prouvent

1. Exposer un index générique en RPC (`vindex.*`) dans `buddy-memory`.
2. Un client TypeScript implémentant **la même interface** que `USearchVectorIndex`,
   pour que les appelants ne changent pas.
3. **Mesurer** contre `usearch` en processus : c'est le point qui peut invalider le
   chantier. Un sidecar parle par stdio ; pour un appel unitaire, l'aller-retour
   peut dominer là où `usearch` est en processus. À constater, pas à supposer.
4. Brancher dans `workspace-indexer`, `graph-embeddings`, `hybrid-search`.
5. Retirer `usearch` des `optionalDependencies` — ce qui rendra la PR #189 sans objet.

## Le risque que ce chantier déplace au lieu de le supprimer

Le CLAUDE.md est explicite : le moteur Rust n'est retenu que « quand le binaire
`buddy-memory` existe sur disque ». Un utilisateur qui fait `npm install -g` ne l'a
pas. **On remplace donc une dépendance C++ qui ne compile pas sur Windows par un
binaire Rust qu'il faut distribuer.** Tant que la distribution n'est pas réglée, le
repli reste nécessaire — mais il doit cesser d'être une boucle O(n) en JavaScript.

---

# Journal — étapes 1 et 2 faites et prouvées

## Étape 1 : l'index générique, exposé en RPC (`8896d4596`)

`buddy-memory/src/vindex.rs`, 294 lignes. Un registre d'index nommés par-dessus
`AnnIndex`, et onze méthodes `vindex.*` : `create`, `insert` (unitaire **ou par
lot**), `search`, `remove`, `size`, `clear`, `drop`, `list`, `dump`, `load`.

La suppression est **logique** — HNSW ne sait pas retirer un point à moindre coût —
et la recherche sur-demande en conséquence pour rendre tout de même `k` résultats.
La persistance appartient au client : le sidecar reste sans état sur disque.

**Le banc a été prouvé avant de servir.** Sept tests passent, mais un banc qui passe
ne vaut rien tant qu'il n'a pas montré qu'il sait tomber. Deux sabotages :

| Ce qui est neutralisé | Ce qui tombe |
|---|---|
| le filtrage des identifiants retirés | `un_identifiant_retire_ne_ressort_plus` — **seul** |
| le contrôle de dimension | `refuse_une_dimension_qui_ne_correspond_pas` — **seul** |

Chaque sabotage fait tomber exactement le test visé et aucun autre ; le code restauré
rend 7/7. Le banc mesure donc bien ce qu'il prétend mesurer.

**La chaîne RPC a été exercée sur le binaire**, pas seulement les fonctions : lot de
trois vecteurs, recherche, suppression puis nouvelle recherche (l'élément retiré a
bien disparu), dimension erronée refusée, index inconnu refusé, `list` et `dump`
conformes.

## Étape 2 : le client TypeScript

`src/search/rust-vector-index.ts`, 188 lignes, même interface que
`USearchVectorIndex`. Typecheck propre.

**Deux pièges rencontrés, tous deux capables de casser en silence :**

1. **Le sidecar rend une distance, l'interface promet une similarité.**
   `VectorSearchResult.score` est documenté « 0-1, higher is better », alors que
   `vindex.search` rend une distance cosinus (0 = identique, 2 = opposé). Reprendre
   le score tel quel aurait **inversé le classement** sans qu'aucun type ne proteste.
   Le client applique donc la conversion exacte de `USearchVectorIndex.distanceToScore` :
   `max(0, 1 − distance/2)`, afin que les seuils des appelants gardent leur sens.
2. **Le binaire `release` est préféré au `debug`.** Celui présent datait de juillet et
   n'avait pas `vindex` : le client aurait parlé à un moteur sans les nouvelles
   méthodes. Recompilé en release.

**Une limite assumée, pas contournée** : `remove`, `size` et `clear` sont
**synchrones** dans l'interface d'origine, conçue pour une bibliothèque en processus.
Un sidecar répond de façon asynchrone. Elles sont donc servies par un miroir local
des identifiants vivants, l'appel distant partant sans être attendu ; une erreur
distante est journalisée, jamais avalée. Vérifié de bout en bout : après `remove('a')`,
le miroir dit 2 **et** la recherche distante ne rend plus `a`.

### Preuve de câblage, client TS → sidecar Rust

```
moteur joignable : true
recherche : a score=0.997 dist=0.006   b score=0.555 dist=0.890   c score=0.500 dist=1.000
score decroissant (higher is better) : OUI
metadonnee portee : {"fichier":"a.ts"}
remove(a) : true  taille : 2
apres suppression : b, c (a bien parti)
dump : 2 vecteurs, dim 3
dimension erronee : refusee — vecteur de dimension 2 alors que l'index en attend 3
```

## Ce qui reste, dans l'ordre

3. **Mesurer** `RustVectorIndex` contre `usearch` en processus, sur un volume réaliste.
   **C'est l'étape qui peut invalider la suite** : le transport par stdio ajoute un
   aller-retour là où `usearch` n'en a aucun. `addBatch` existe pour cette raison,
   mais il faut le constater, pas le supposer.
4. Brancher dans `workspace-indexer`, `graph-embeddings`, `hybrid-search`, avec repli.
5. Retirer `usearch` des `optionalDependencies` — ce qui rendra la PR #189 sans objet.
