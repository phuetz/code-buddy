# RÉPARATION IDLINKS1 — Temporaires `identity-links.json.tmp.*` orphelins

Mission : `MISSION-IDLINKS1-TEMPORAIRES-ORPHELINS.md` (vague 04/09/2026).
Clone : `~/DEV/cb-idlinks1-2026-09-04`, branche `fix/idlinks1-temporaires-orphelins-2026-09-04`, base `1709228c8`.
`~/code-buddy` (original) : interdit en écriture, jamais touché. `~/.codebuddy` réel : lecture seule
(`ls`/`stat`/`cat` uniquement), jamais nettoyé ni écrit.

## Constat mesuré (rappel mission)

`ls -lt ~/.codebuddy/identity-links.json.tmp.*` : 79 fichiers, par paquets de 16 aux heures des
redémarrages des services robot (03/09 18:00, 21:54 ; 04/09 01:47, 03:52), alors que
`identity-links.json` lui-même n'avait pas changé depuis le 03/09 13:28.

Ré-observé en direct pendant cette mission (lecture seule, aucune écriture de ma part) :
`~/.codebuddy/identity-links.json.tmp.*` comptait **84** entrées, avec deux nouveaux paquets
(3 et 2 fichiers) apparus le 04/09 à 08:04 et 08:10 — **pendant que j'inspectais le dépôt** — et le
contenu de `identity-links.json` avait changé (775 octets, `carol-tg`/`carol-dc`/`carol-sl`,
`idCounter: 1`, mtime 08:10:09). C'est la preuve directe de la cause n°2 ci-dessous.

## Deux causes distinctes trouvées et fermées, plus une troisième découverte en cours de route

### Cause 1 — écritures redondantes (`src/channels/identity-links.ts:396-416` avant correctif)

`autoPersist()` déclenche `persist().catch(()=>{})` **sans attendre**, à chaque `link()`/`unlink()`
qui marque `dirty`. `persist()` sérialisait et écrivait inconditionnellement via `writeJsonAtomic`,
sans comparer au contenu déjà sur disque ni empêcher deux appels concurrents de lancer chacun leur
propre écriture physique (chacune avec son propre `<cible>.tmp.<pid>.<hex>`, généré par
`createTemporaryPath()` dans `src/utils/atomic-write.ts:60-62`). Un paquet d'appels rapprochés
(16 canaux/identités résolus autour du même instant) ouvrait donc jusqu'à 16 fichiers temporaires
pour la même cible, même à contenu inchangé.

**Correctif** (`src/channels/identity-links.ts`, commit `c15eb98a3`) :
- `persist()` devient single-flight : un appel pendant qu'une écriture est en vol attend la MÊME
  promesse (avec au plus une écriture de rattrapage si l'état a encore changé) au lieu de démarrer
  une écriture parallèle.
- `writeIfChanged()` compare le JSON sérialisé (`serializeState()`) au dernier contenu réellement
  écrit — y compris après `load()` — et saute l'écriture si identique.

### Cause 2 — le temporaire survit à un processus tué entre `open` et `rename`

`writeFileAtomic()` (`src/utils/atomic-write.ts`) nettoie déjà son propre temporaire dans son
`catch` pour **toute exception JS** (open/write/sync/rename passent tous par le même bloc try/catch,
vérifié par lecture du code et par le test préexistant « keeps the previous content when the
temporary write is interrupted »). Mais rien ne peut s'exécuter quand le **processus entier** est
tué (SIGTERM du redémarrage, SIGKILL, crash) entre `open` et `rename` : aucun `catch` ne tourne, le
fichier reste orphelin indéfiniment. Rien dans `atomic-write.ts` ne les nettoyait au démarrage.

**Correctif** (`src/utils/atomic-write.ts` + `src/channels/identity-links.ts`, commit `ab2e21ff1`) :
- nouvel export `cleanupOrphanedTemporaries(filePath, options)` : balaie **uniquement** le dossier
  de `filePath`, ne retire que `<basename>.tmp` / `<basename>.tmp.*` plus vieux que `maxAgeMs`
  (5 min par défaut — un temporaire plus récent peut être en vol), ne touche **jamais** la cible
  elle-même, journalise une fois par chemin (`warnedCleanupPaths`), best-effort (une entrée
  illisible n'interrompt pas les autres).
- `IdentityLinker` l'appelle une fois dans son constructeur (fire-and-forget, jamais bloquant,
  jamais levé) — le nettoyage tourne donc au premier usage du singleton, c'est-à-dire au démarrage
  du process.

### Cause 3 (découverte en cours de mission, non demandée par le brief initial mais dominante)

`tests/channels/identity-links-integration.test.ts` et `tests/integration/multi-channel-identity.test.ts`
instanciaient `IdentityLinker`/`getIdentityLinker()` **sans jamais surcharger `persistPath` ni
`autoPersist`**. Le `persistPath` par défaut est `~/.codebuddy/identity-links.json` — le VRAI home
de la machine qui exécute `npm test` — et `link()`/`unlink()` y déclenchent une écriture asynchrone
non attendue à chaque test. Le test « three-way linking » de `multi-channel-identity.test.ts`
(lignes 112-121, fixtures `carol-tg`/`carol-dc`/`carol-sl`) correspond **exactement** au contenu
retrouvé dans le vrai `~/.codebuddy/identity-links.json` pendant cette mission. Ce fichier de test
existe (identique) dans des dizaines de clones actifs de la flotte (`~/DEV/cb-*-2026-09-*`), sans
aucun isolement — c'est la source la plus probable des paquets de 16 (le pool de forks Vitest) et
des batches observés en direct le 04/09 à 08:04/08:10, en dehors de toute fenêtre de redémarrage de
service.

**Correctif** (commit `66e8ff6aa`) : les deux fichiers passent par `autoPersist: false` (même
convention déjà en place dans `tests/channels/session-identity.test.ts`), qui coupe toute écriture
disque. Aucune de ces suites n'affirme quoi que ce soit sur le contenu persisté — rien perdu en
couverture.

## Reproduction (rouge → vert), avec sorties réelles

### Défaut 1 — `tests/channels/identity-links-persist.test.ts`

Rouge sur la base (`git stash` du seul `src/channels/identity-links.ts`) :

```
 ❯ tests/channels/identity-links-persist.test.ts (3 tests | 3 failed)
AssertionError: expected "writeFileAtomic" to be called 1 times, but got 0 times
 Test Files  1 failed (1)
      Tests  3 failed (3)
```

(0 et non 16 : le code de base appelait `writeJsonAtomic`, jamais `writeFileAtomic` directement —
la trace confirme que le mécanisme testé n'existait pas encore, pas seulement son résultat.)

Vert après le commit `c15eb98a3` :

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

### Défaut 2 — `tests/utils/atomic-write.test.ts` (describe `cleanupOrphanedTemporaries`)

Reproduction **réelle** (pas un mock) : un script enfant (`npx tsx`) lance 6 `writeFileAtomic()`
concurrents vers la même cible, chacun avec un `open()` artificiellement ralenti (2000 ms) ; le
parent envoie `SIGKILL` 400 ms après le lancement — garantissant que chaque temporaire est créé sur
disque (le flag `'w'` de `open()` le crée immédiatement) mais qu'aucun `rename()` n'a pu s'exécuter.

Rouge sur la base (`git stash` de `src/utils/atomic-write.ts` + `src/channels/identity-links.ts`) :

```
 ❯ tests/utils/atomic-write.test.ts (10 tests | 4 failed)
TypeError: resetAtomicCleanupWarningsForTests is not a function
 Test Files  1 failed (1)
      Tests  4 failed | 6 passed (10)
```

Vert après le commit `ab2e21ff1` :

```
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

## Preuve réelle sous HOME temporaire (`_qa/idlinks1/home`, gitignoré)

Script `_qa/idlinks1/proof.mts` (non commité) : deux passages successifs — `resetIdentityLinker()` +
`getIdentityLinker()` + `load()` + `link()` de la même paire + `persist()` — simulant un
redémarrage :

```
Passage 1 -> mtime= 1788504242739.26 orphelins= 0
Passage 2 -> mtime= 1788504242739.26 orphelins= 0
mtime inchange = true
0 orphelin = true
```

Script `_qa/idlinks1/proof-cleanup.mts` (non commité) : 3 orphelins simulés (mtime forcé à −10 min)
plantés à la main sous `~/.codebuddy/` (HOME temporaire), puis instanciation de `IdentityLinker` :

```
Orphelins avant instanciation: 3 [...]
[...] WARN  Removed 3 orphaned temporary file(s) for .../identity-links.json {"removed":[...]}
Orphelins apres instanciation: 0 []
Nettoyage au demarrage OK = true
```

La cible (`identity-links.json`) n'a jamais été touchée par le nettoyage (contenu et présence
vérifiés après coup dans les deux scripts).

## Vérifications

- `npx tsc --noEmit -p tsconfig.json` → **0 erreur**.
- `npx eslint src/channels/identity-links.ts src/utils/atomic-write.ts tests/channels/identity-links-integration.test.ts tests/channels/identity-links-persist.test.ts tests/integration/multi-channel-identity.test.ts tests/utils/atomic-write.test.ts`
  → **0 erreur**, 11 avertissements préexistants (confirmé sur la base : `fs` inutilisé dans
  `identity-links.ts` déjà présent avant ce chantier ; `any` dans `multi-channel-identity.test.ts`
  déjà présents, fichier non touché sur ces lignes).
- `HOME=<home temporaire> npx vitest run tests/utils tests/channels` :
  - **avant** (base `1709228c8`) : 86 fichiers / 1994 tests — 1990 verts, **1 rouge**
    (`tests/channels/telegram-inconnu-journey.test.ts`), 3 skip.
  - **après** (HEAD `66e8ff6aa`) : 87 fichiers / 2001 tests — 1997 verts, **1 rouge**
    (`tests/channels/telegram.test.ts`, échec `/sendPhoto` vs `/sendMessage`), 3 skip.
  - Le rouge après n'est PAS un fichier que j'ai touché ; reproduit indépendamment sur la base
    `1709228c8` (avant tout correctif, `git stash` complet), donc **préexistant et sans rapport avec
    IDLINKS1** — confirmé, pas juste supposé.
  - +7 tests = exactement les tests neufs de ce chantier (3 dans `identity-links-persist.test.ts`
    + 4 dans le nouveau describe `cleanupOrphanedTemporaries` de `atomic-write.test.ts`).
- `git diff --check HEAD~3 HEAD` → exit 0 (propre).
- `npx vitest run tests/security/donnees-personnelles.test.ts` → **31/31 verts** (garde-fou intact).

## Commits

1. `c15eb98a3` — `fix(channels)` : dédoublonnage + coalescing de `persist()` (défaut 1).
2. `ab2e21ff1` — `fix(utils)` : `cleanupOrphanedTemporaries` + câblage au démarrage (défaut 2).
3. `66e8ff6aa` — `test(channels)` : isolation des deux suites qui écrivaient dans le vrai
   `~/.codebuddy` (cause 3, découverte en cours de mission).

## Ce qui reste ouvert

- **Les 79 (→ 84 au moment de la mission) fichiers orphelins réels sous `~/.codebuddy/` ne sont PAS
  nettoyés** — mission explicite : lecture seule, jamais de suppression par cette lane. Commande
  proposée pour un nettoyage humain, à valider puis exécuter **hors de cette lane** :
  ```bash
  find ~/.codebuddy -maxdepth 1 -name 'identity-links.json.tmp.*' -mmin +5 -print -delete
  ```
  (`-mmin +5` reprend la même marge de sécurité que `maxAgeMs` par défaut du correctif — ne touche
  aucun fichier de moins de 5 minutes, donc aucun risque sur une écriture en cours ; `-maxdepth 1`
  et le nom exact excluent tout autre fichier de `~/.codebuddy`.) Le prochain démarrage normal du
  robot (ou tout code appelant `getIdentityLinker()`) les nettoiera aussi automatiquement grâce au
  commit `ab2e21ff1`, sans commande manuelle.
- La cause 3 (tests écrivant dans le vrai home) n'est corrigée que pour les deux fichiers identifiés
  dans **ce** clone ; les dizaines d'autres clones de la flotte (`~/DEV/cb-*-2026-09-*`) qui portent
  encore l'ancienne version de ces deux fichiers de test continueront à écrire dans le vrai
  `~/.codebuddy` tant qu'ils ne fusionnent pas ce correctif ou ne sont pas nettoyés — à signaler à la
  coordination.
- L'avertissement `'fs' is defined but never used` dans `identity-links.ts` est préexistant, hors
  zone réservée, non touché.
- `tests/channels/telegram.test.ts` (échec `/sendPhoto`) est un rouge préexistant sans rapport avec
  IDLINKS1, non investigué plus avant (hors zone réservée).
