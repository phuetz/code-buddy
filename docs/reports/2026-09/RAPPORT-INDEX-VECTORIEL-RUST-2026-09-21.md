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

---

# Étape 3 : la mesure, et le renversement qu'elle impose

## Elle a d'abord accusé le portage. À tort.

Premier banc, vecteurs aléatoires uniformes en dimension 384 : l'accord entre les
deux moteurs s'effondrait — 93 %, puis 66 %, puis **8 %** au top-1 à 20 000 vecteurs.
Conclusion tentante : le portage Rust est mauvais.

**Le geste qui tranche a été de calculer la vérité terrain en force brute**, au lieu
de comparer les deux moteurs entre eux. Résultat :

| N | rappel usearch | rappel rust | top-1 usearch | top-1 rust |
|---|---|---|---|---|
| 1 000 | 94 % | 92 % | 90 % | 92 % |
| 5 000 | 59 % | 60 % | 68 % | 64 % |
| 20 000 | **23 %** | **22 %** | **0 %** | 6 % |

**Les deux s'effondrent ensemble.** Un moteur mûr ne tombe pas à 0 % de top-1 sans
raison : c'était **le banc**, pas les moteurs. Des vecteurs aléatoires uniformes en
dimension 384 sont le pire cas de la recherche approchée — tout y est équidistant,
le classement devient arbitraire. Suspecter l'outil de mesure avant le produit, une
fois de plus.

## Avec des embeddings réalistes (en grappes), tout rentre dans l'ordre

| N | rappel usearch | rappel rust | top-1 usearch | top-1 rust | latence us | latence rust |
|---|---|---|---|---|---|---|
| 5 000 | 67 % | 70 % | 74 % | 72 % | 0,26 ms | 1,32 ms |
| 20 000 | 86 % | 83 % | **100 %** | 96 % | 0,39 ms | 2,09 ms |

**Le portage est fidèle** : à qualité égale, l'écart tient dans le bruit. La seule
différence est la latence — **environ 5×**, soit le coût de l'aller-retour stdio.

## Ce qui renverse la conclusion du chantier

Le vrai point de comparaison n'est pas `usearch` : c'est **ce que Windows exécute
aujourd'hui**, la boucle cosinus O(n) de `BruteForceIndex`. Reprise à l'identique
dans le banc :

| N | brute-force JS (Windows aujourd'hui) | sidecar Rust | rapport |
|---|---|---|---|
| 5 000 | 6,40 ms | 1,52 ms | 4,2× |
| 20 000 | 26,03 ms | 2,02 ms | 12,9× |
| 50 000 | **69,16 ms** | **1,85 ms** | **37,3×** |

Le rapport importe moins que la **forme** : le Rust reste plat pendant que le
JavaScript croît linéairement. L'écart grandit avec la taille du dépôt.

## Décision (Patrice, 21/09) : usearch là où il s'installe, Rust ailleurs

Le chantier ne remplace donc pas `usearch` — il remplace le **repli**.

| Situation | Moteur | Latence mesurée |
|---|---|---|
| Linux / macOS, `usearch` installé | `usearch`, en processus | **0,39 ms** |
| Windows, ou `usearch` absent | **sidecar Rust** | ~2 ms, **plat** |
| *(aujourd'hui)* Windows | ~~brute-force JS~~ | 26 ms à 20 k, 69 ms à 50 k |

`usearch` **reste** dans les `optionalDependencies` : il est meilleur là où il
s'installe, et rien ne justifie de s'en priver. L'étape 5 du plan initial — le
retirer — est donc **abandonnée**, et la PR #189 garde son objet.

## Reste à faire

4. Brancher le choix à trois niveaux dans `workspace-indexer`, `graph-embeddings` et
   `hybrid-search` : `usearch` → sidecar Rust → brute-force JS (ce dernier ne servant
   plus que si le binaire Rust est absent lui aussi).

---

# Étape 4 : la fabrique, et un défaut trouvé en la branchant

## Le `try/catch` de `workspace-indexer` n'attrapait rien

```ts
try {
  const { USearchVectorIndex } = await import('../search/usearch-index.js');
  this.vectorIndex = new USearchVectorIndex({ dimensions: dim });
} catch {
  this.vectorIndex = new BruteForceIndex(dim);   // jamais atteint
}
```

L'import porte sur un **fichier TypeScript du dépôt**, qui se charge toujours ; et le
constructeur ne charge pas le paquet natif, `initialize()` étant paresseux. Le `catch`
ne peut donc pas se déclencher. Ce qui sert réellement sur Windows, c'est le repli
**interne** de `USearchVectorIndex` — `FallbackVectorIndex` — qui s'active plus tard,
silencieusement, à la première opération.

**Conséquence pour ma propre mesure :** j'ai chronométré `BruteForceIndex`, alors que
le repli réellement atteint est `FallbackVectorIndex`. Les deux sont des boucles O(n)
en JavaScript et la conclusion tient — mais le chiffre exact aurait dû être pris sur
l'autre. C'est dit ici plutôt que masqué.

## `vector-index-factory.ts`

Une fabrique qui **charge réellement** le paquet (`await import('usearch')`) au lieu
de supposer sa présence, puis choisit : `usearch` → sidecar Rust → JavaScript.
`prefer` force un moteur, pour les bancs et pour contourner un incident.

**Vérifié : les trois moteurs sont interchangeables sans changer un résultat.**

```
usearch reellement chargeable ici : true
choix automatique                 : usearch
auto  (usearch   ) -> a:0.997 b:0.555  ok  taille=2
rust  (rust      ) -> a:0.997 b:0.555  ok  taille=2
js    (javascript) -> a:0.997 b:0.555  ok  taille=2
```

Scores identiques au millième : la conversion distance→similarité est cohérente sur
les trois chemins, et un appelant peut changer de moteur sans réviser ses seuils.

---

# Étape 5 : la demi-précision (f16)

`hnsw_rs` est générique sur le type stocké : il accepte `f16` avec une métrique
adaptée, **sans usearch**. L'approche vient du banc `bench_storage.rs` de ragvec, qui
avait déjà éprouvé `Hnsw<'static, f16, …>` — plutôt que de la reconstituer.

## Ce qui est ajouté

- `buddy-memory/src/ann_f16.rs` — le même HNSW en demi-précision. La métrique
  **normalise**, comme `DistCosine` côté `f32` : deux index de précision différente
  doivent classer pareil, sinon changer de stockage deviendrait changer de résultats.
  Décodage par `convert_to_f32_slice` (instruction F16C quand le processeur la porte).
- `vindex.rs` — `Precision::{F32, F16}`, choisie à la création. **Les vecteurs
  conservés pour la persistance suivent la précision de l'index** : les garder en
  `f32` aurait annulé la moitié de l'économie.
- RPC — `vindex.create` accepte `precision`, `vindex.size` rend `precision` et
  `vectorBytes`.

## Preuve, mesurée et non supposée

Bancs prouvés par sabotage, comme les précédents : neutraliser la normalisation de la
métrique fait tomber le seul test de classement ; faire mentir `vector_bytes` fait
tomber le seul test de mémoire ; aucun autre ne bouge.

**26 tests au vert.** De bout en bout, sur le binaire release, même vecteur de 128
dimensions dans deux index :

```
5  {"dim":128,"precision":"f32","size":1,"vectorBytes":512}
6  {"dim":128,"precision":"f16","size":1,"vectorBytes":256}
8  ERREUR: précision inconnue « f8 » (f32, f16)
```

**512 → 256 octets : exactement la moitié.** Sur un index de 768 dimensions et un
million de points, cela fait passer les vecteurs conservés d'environ 3 Go à 1,5 Go.

## Un défaut trouvé au passage, dans l'outillage

`cargo test --lib` rendait « error: test failed » avec une sortie **tronquée à
« running 26 tests »**, alors qu'`exit=0` et que chaque test passait isolément. La
cause est `silence_stdout` (`ann.rs`), qui redirige le descripteur 1 **globalement**
par `dup2` pour empêcher `hnsw_rs` d'injecter une ligne non-JSON sur le flux du
sidecar. En test **parallèle**, il avale aussi la sortie du harnais.

`cargo test --lib -- --test-threads=1` rend le verdict lisible : **26 passed, 0
failed**. À savoir avant de croire un rouge sur ce paquet — l'outil de mesure était
en cause, pas le produit.

---

# Étape 6 : les deux appelants restants — 22/09/2026

`workspace-indexer` passait par la fabrique depuis le 21. Les deux autres
consommateurs, eux, instanciaient encore `usearch` en direct : **`hybrid-search`**
(les quatre index `memories`/`code`/`messages`/`cache`) et **`graph-embeddings`**.
Sur Windows, ils retombaient donc toujours sur la boucle O(n).

## Ce que le branchement a obligé à écrire

Le contrat de la fabrique était plus étroit que l'usage réel. `hybrid-search`
appelle `initialize`, `addBatch`, `getStats` et `dispose` : ces quatre méthodes
manquaient à `VectorIndexLike` et les deux dernières manquaient à
`RustVectorIndex`. Elles sont ajoutées, **obligatoires** — une méthode optionnelle
dans ce contrat recréerait le repli silencieux que la fabrique corrige.

`getStats()` côté Rust est synchrone alors que `vindex.size` répond de façon
asynchrone : la mémoire annoncée est donc une **estimation locale**, et la mesure
réelle — celle qui tient compte de la demi-précision — est rendue à part par
`vectorBytesReels()`. C'est dit dans le code plutôt que laissé à deviner.

Les réglages HNSW (`connectivity`, `expansionAdd`, `expansionSearch`) traversent
maintenant la fabrique. Le sidecar ne les prend pas par index : l'écart entre ce
qui est demandé et les constantes d'`ann.rs` est **journalisé** au lieu d'être
avalé.

## Deux mensonges corrigés au passage

- `getStats().usearchEnabled` valait `this.vectorIndexes.size > 0` : il répondait
  « oui » pour un index Rust comme pour la boucle JavaScript. Il ne vaut désormais
  vrai que si le moteur **est** usearch, et `vectorEngine` nomme celui qui sert.
  Le journal d'initialisation, qui annonçait « with USearch vector indexes » quel
  que soit le moteur, le nomme aussi.
- La branche `legacy-usearch` de `graph-embeddings` testait `add.length >= 2` pour
  retomber sur une signature `add(id, vec)` qu'**aucun index du dépôt n'expose** —
  seul le mock du test l'exposait. Du code de production plié à un faux. La branche
  disparaît, et le mock est remis sur l'interface réelle.

## Un défaut latent révélé par le typage

Retirer le `any` de `vectorIndex` a fait tomber `tsc` sur le `.filter(Boolean)` de
`search()` : il ne rétrécit pas le type, donc un identifiant absent traversait en
`undefined` sous couvert d'un tableau de `string`. Corrigé par un prédicat de type.

## Preuves

**Le câblage, pas seulement la logique.** Sabotage de la fabrique (un index qui ne
trouve jamais rien) : **5 tests de `graph-embeddings` tombent**, aucun autre. Le
branchement est donc réellement emprunté.

Les tests de `hybrid-search`, eux, **passent même saboté** — ils ne touchent pas le
chemin vectoriel. Ils ne prouvaient rien ici, et il fallait le dire plutôt que de
compter leur vert. Le câblage y est prouvé par exécution réelle :

```
moteur retenu      : usearch
usearchEnabled     : true
index vectoriels   : memories, code, messages, cache   (dim=384)
```

Chemin Rust exercé de bout en bout contre le **vrai sidecar** (`prefer: 'rust'`) :

```
moteur          : rust
recherche       : a:1.000 b:0.538        ← classement correct
getStats()      : {"size":3,"dimensions":8,"connectivity":16,...}
vectorBytes réel: 96                     ← exactement 3 × 8 × 4
après remove(b) : 2      dispose() → 0
```

`connectivity: 32` avait été demandé : `getStats()` rend 16, la valeur réelle du
sidecar, et l'écart est journalisé. Un réglage ignoré qu'on annoncerait appliqué
serait pire qu'un réglage refusé.

**Vérifications** : `tsc --noEmit` vert ; ESLint 0 erreur ; 72 tests
(`tests/search/` + `graph-embeddings`) et 103 tests en aval (hybrid sémantique,
unicode, outils mémoire, régression) au vert.

## Ce qui reste

`getUSearchIndex()` (`usearch-index.ts`) est encore exporté par `src/search/index.ts`
et instancie usearch en direct. **Aucun appelant dans le dépôt** : c'est une API
publique du module, laissée en place volontairement, pas un oubli.
