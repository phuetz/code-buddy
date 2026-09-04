# REPARATION-VERIFIX3B — fermeture des trouvailles T12 à T15 (VERIF3)

Lane : VERIFIX3B. Date d'ouverture : 2026-09-04.
Clone de travail : `~/DEV/cb-verifix3b-2026-09-04`, branche `fix/verifix3b-garde-fifo-2026-09-04`.
HOME temporaire de test : `_qa/verifix3b/home` (gitignoré). `~/code-buddy` et le vrai `~/.codebuddy` sont
interdits en ecriture pour cette lane.

Zone reservee : `tests/security/donnees-personnelles.test.ts`, `tests/agent/delegation/`,
`tests/commands/swarm*`, `tests/commands/team*`, `tests/commands/worktree-handlers*`,
`src/sandbox/execpolicy.ts` + son test.

Protocole applique a chaque trouvaille : mutation VERTE rejouee (preuve du trou) -> renforcement du
test -> mutation ROUGE (preuve de discrimination) -> restauration VERTE.

## Etat

| Trouvaille | Sujet | Etat |
| ---------- | ----- | ---- |
| T12 | Fixtures manquantes du garde-fou données personnelles | **FERMÉE** (`b20437050`) |
| T13 | FIFO non discriminant dans `/swarm` et `/team` | **FERMÉE** (`0f9a083d8`) |
| T14 | Entrée `-C` prétendument redondante dans execpolicy | **FERMÉE** (`62a91d593`) — l'entrée sert, elle est conservée |
| T15 | Assertions tautologiques de `worktree add` | **FERMÉE** (`978f39445`) |

## T12 — dix motifs du garde-fou sans fixture isolée

Fichier : `tests/security/donnees-personnelles.test.ts`.

`INTERDITS` porte seize motifs ; VERIFIX2 n'avait donné une fixture unitaire
qu'aux six construits par concaténation. Les dix autres n'étaient exercés que
par le balayage du corpus, actuellement propre : une faute de frappe ou une
suppression y serait passée inaperçue tant que le dépôt ne contient pas déjà la
fuite. C'est le garde-fou d'un dépôt public : le trou est le plus grave des
quatre.

**Mutation VERTE rejouée** — suffixe `-x` ajouté à chaque motif (préfixe réseau :
troisième octet changé), un à la fois, la commande étant
`npx vitest run tests/security/donnees-personnelles.test.ts` :

```
P1 ->       Tests  7 passed (7)
P2 ->       Tests  7 passed (7)
P3 ->       Tests  7 passed (7)
P4 ->       Tests  7 passed (7)
P5 ->       Tests  7 passed (7)
P6 ->       Tests  7 passed (7)
P7 ->       Tests  7 passed (7)
P8 ->       Tests  7 passed (7)
P9 ->       Tests  7 passed (7)
P10 ->      Tests  7 passed (7)
```

**Renforcement** — dix fixtures ajoutées à `DETECTION_FIXTURES`, une par motif
manquant. Chaque fixture reconstruit son motif par concaténation, INDÉPENDAMMENT
de l'entrée de `INTERDITS` : muter la liste ne mute donc pas l'attente. Le
fichier n'introduit aucun terme en clair — vérifié ligne à ligne, les seules
occurrences contiguës restantes sont celles, préexistantes, de l'en-tête et du
tableau `INTERDITS`. Les noms de fichiers des fixtures sont neutres, pour ne pas
déclencher la détection par chemin.

**Mutation ROUGE** — les mêmes dix mutations contre le test renforcé :

```
P1 ->       Tests  1 failed | 16 passed (17)
P2 ->       Tests  1 failed | 16 passed (17)
P3 ->       Tests  1 failed | 16 passed (17)
P4 ->       Tests  1 failed | 16 passed (17)
P5 ->       Tests  1 failed | 16 passed (17)
P6 ->       Tests  1 failed | 16 passed (17)
P7 ->       Tests  1 failed | 16 passed (17)
P8 ->       Tests  1 failed | 16 passed (17)
P9 ->       Tests  1 failed | 16 passed (17)
P10 ->      Tests  1 failed | 16 passed (17)
```

**Restauration** — `Test Files  1 passed (1)` / `Tests  17 passed (17)`.

## T13 — le FIFO de `/swarm` et `/team` n'était pas discriminé

Fichiers : `tests/commands/team-thread-delegation.test.ts`,
`tests/commands/swarm-thread-delegation.test.ts`.

Le test nommé « keeps FIFO order per member » ne met qu'un seul candidat en
attente : FIFO et LIFO y donnent le même ordre. Côté `/swarm`, les deux cas
n'observaient que le CÂBLAGE (`handleAgents` est bouchonné) et n'exécutaient
aucun créneau, donc rien ne pouvait distinguer les deux disciplines.

**Mutation VERTE rejouée** — `waiters.shift()` → `waiters.pop()` dans
`src/agent/delegation/thread-delegation.ts:267`, contre les deux fichiers
d'origine :

```
--- AVANT renforcement, mutation shift->pop ---
 Test Files  2 passed (2)
      Tests  7 passed (7)
```

**Renforcement** — un cas par fichier où trois candidats attendent ENSEMBLE
derrière un quatrième qui tient l'unique créneau (concurrence 1, la valeur par
défaut, inchangée), et où l'ordre d'admission est asserté
(`['active', 'first', 'second', 'third']`) :

- `/team` : quatre membres, une tâche chacun, l'agent du premier membre bloque
  jusqu'à ce que les trois autres aient atteint le sémaphore.
- `/swarm` : les options `threadDelegation` que la commande a RÉELLEMENT
  choisies (concurrence 1, budget, afficheur) sont passées au vrai runner du
  système multi-agent, puis quatre rôles (`orchestrator`, `coder`, `reviewer`,
  `tester`) sont ordonnancés par `executeParallel`.

**Mutation ROUGE** — même mutation `shift` → `pop` :

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  2 failed (2)
      Tests  2 failed | 7 passed (9)
```

**Restauration** — `Test Files  2 passed (2)` / `Tests  9 passed (9)`.

## T14 — l'entrée d'autorisation `-C` en lecture : elle SERT

Fichiers : `src/sandbox/execpolicy.ts` (LU, non modifié),
`tests/sandbox/execpolicy.test.ts` (renforcé).

**Lecture du code.** `matchesRule` refuse une règle dont aucun `allowedArgs` ne
correspond dès que les arguments sont non vides. Sonde directe sur la politique
initialisée :

```
ARGS: -C /repo status        => action: allow | rule: builtin-git-safe
ARGS: status                 => action: allow | rule: builtin-git-safe
ARGS: -C /repo log --oneline => action: allow | rule: builtin-git-safe
ARGS: -C /repo commit -m x   => action: ask   | rule: builtin-git-boundary
ARGS: -C /repo push          => action: ask   | rule: builtin-git-boundary
```

La même sonde, ligne `allowedArgs` retirée :

```
ARGS: -C /repo status        => action: sandbox | rule: none
ARGS: status                 => action: allow   | rule: builtin-git-safe
ARGS: -C /repo log --oneline => action: sandbox | rule: none
ARGS: -C /repo commit -m x   => action: ask     | rule: builtin-git-boundary
ARGS: -C /repo push          => action: ask     | rule: builtin-git-boundary
```

L'entrée n'est donc PAS morte : sans elle, `builtin-git-safe` cesse de
correspondre, `builtin-git-boundary` refuse déjà cette forme par son
`deniedArgs`, et la commande retombe sur l'action par DÉFAUT au lieu d'être
autorisée. Le test de bout en bout ne voyait rien parce qu'il observait l'action
finale `sandbox`, que la couche d'exécution impose de toute façon à un `allow`
(« Execution policy allowed the command; workspace sandbox remains enforced »).
**Verdict : l'entrée sert, elle est conservée ; c'est le test qui manquait.**

**Mutation VERTE rejouée** — ligne `allowedArgs` retirée, avant renforcement :
`npx vitest run tests/tools/bash-execution-policy.test.ts` → `Tests  13 passed (13)`.

**Renforcement** — `tests/sandbox/execpolicy.test.ts` observe désormais la
décision BRUTE : cinq sous-commandes de lecture doivent donner `allow` via
`builtin-git-safe` sous la forme `-C` comme sous la forme nue, et trois formes
mutantes (`commit`, `push`, `reset --hard`) doivent rester `ask` via
`builtin-git-boundary` — l'autorisation reste donc étroite.

**Mutation ROUGE** — même retrait de ligne :

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed | 1 passed (2)
      Tests  5 failed | 58 passed (63)
```

**Restauration** — `Test Files  2 passed (2)` / `Tests  63 passed (63)`.

## T15 — `worktree add` : assertions quasi tautologiques

Fichier : `tests/commands/worktree-handlers.test.ts`.

Les cas « add worktree » n'affirmaient que `handled === true` et la présence de
la chaîne qu'ils avaient eux-mêmes passée en argument.

**Renforcement** — quatre cas lisent les arguments RÉELLEMENT remis à `git` via
le bouchon `execFileSync`, ainsi que le chemin résolu et la branche rendus à
l'utilisateur :

1. branche déduite du répertoire → `['worktree', 'add', '-b', <base>, <chemin résolu>]` ;
2. branche demandée absente (les deux sondes `rev-parse` échouent) → `-b` ;
3. branche existante (les deux sondes réussissent) →
   `['worktree', 'add', <chemin résolu>, <branche>]`, sans `-b`, la branche
   servant de base ;
4. chemin déjà présent → AUCUNE commande git lancée.

**Mutations, avant renforcement puis après** (`git checkout --` entre chaque) :

```
M46    (argv branche existante dévié) | AVANT: 17 passed (17) | APRES: 1 failed | 20 passed (21)
M46bis (branche rapportée falsifiée)  | AVANT: 17 passed (17) | APRES: 3 failed | 18 passed (21)
M46ter (chemin et branche masqués)    | AVANT: 17 passed (17) | APRES: 3 failed | 18 passed (21)
M46q   (argv création `-b` dévié)     | AVANT: 17 passed (17) | APRES: 1 failed | 20 passed (21)
```

**Restauration** — `Test Files  1 passed (1)` / `Tests  21 passed (21)`.

**Hermétisme conservé** : `execFileSync` et `fs.existsSync` restent bouchonnés ;
après la suite, ni `branch/`, ni `feature-branch/`, ni `wt-*` n'existent dans le
clone ou son parent, et `git status --short` ne signale rien.

## Vérifications finales

- `npx vitest run tests/security tests/agent/delegation tests/commands tests/sandbox`
  → **187 fichiers (186 verts, 1 rouge), 2 350 tests (2 347 verts, 3 rouges)**.
  Les 3 rouges sont **préexistants et étrangers à cette lane** :
  `tests/commands/hermes-commands.test.ts` (« real local Hermes browser smoke »,
  « real auto Hermes browser smoke », « safe aggregate Hermes local smoke
  suite »). Le fichier est identique bit à bit au commit de base `ee51f1096` et
  y échoue exactement de la même façon (3 rouges / 51), vérifié dans un
  worktree détaché du commit de base puis supprimé. Ce sont des fumigations qui
  demandent un navigateur / un moteur local absent de cet environnement.
- `npx tsc --noEmit -p .` → code `0`.
- `npx eslint <les 4 fichiers touchés> --max-warnings=0` → code `0`.
- `git diff --check` → code `0`.
- `git status` → propre.

## Portée

Aucun `it.skip`, aucun test supprimé, aucune assertion affaiblie. Le code
produit est intact : T14 a été tranché en faveur de la conservation de
l'entrée `-C`, preuves à l'appui. Cinq commits, fichiers nommés un à un, jamais
`git add -A`.

