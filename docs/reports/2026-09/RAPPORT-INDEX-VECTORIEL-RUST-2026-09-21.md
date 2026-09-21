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
