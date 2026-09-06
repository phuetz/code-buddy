# COMPANION-CORE — extraction du socle relationnel (Opus, 2026-09-06)

- **Lane** : `feat/companion-core-2026-09-06` (worktree dédié), base `533b32d47`.
- **Mission** : étape 1 du plan de partage Lisa ↔ MySoulmate v3 — extraire le socle
  relationnel en un paquet réutilisable `@phuetz/companion-core`, TypeScript pur, sans UI,
  sans réseau, sans dépendance à Code Buddy.
- **Sources lues** : `docs/audits/2026-09-06-lisa-petite-copine-grok.md` §3-4,
  `docs/reports/2026-09/LISA-COPINE-V1-GROK.md`, l'audit de partage MySoulmate
  (lecture seule, section « socle commun »), et le code :
  `src/companion/personas/*`, `relational-context.ts`, `relationship-state.ts`,
  `proactive-engine.ts`, `away-mode.ts`, `reply-augment.ts`, `recent-said.ts`,
  `src/sensory/episodic-journal.ts`, `respond-decider.ts`, `src/memory/user-model.ts`.
- **Commits** : `4b9476c3d` (paquet) · `b2d2c168a` (workspace) · `b08179617` (adaptateur).
  Aucun push.

---

## 1. Arborescence livrée

```
packages/companion-core/
  package.json            @phuetz/companion-core 0.1.0, MIT, type module,
                          seule dépendance : zod ^3.25.0 ; prepare = build
  tsconfig.json           strict + noUncheckedIndexedAccess (src + tests)
  tsconfig.build.json     rootDir src → dist (d.ts + js), tests exclus
  README.md               ce qu'il contient, ce qu'il exclut délibérément
  src/
    index.ts              API publique documentée en 15 lignes + réexports
    types.ts              CompanionProfile, RelationshipState, Fact,
                          Initiative, LimitsVerdict (+ RelationshipTraits,
                          RapportTier, GreetingSlot, InitiativeAngle)
    runtime/
      clock.ts            Clock injectable, resolveCivilClock (fuseau de
                          l'utilisateur, repli UTC, ne lève jamais)
      rng.ts              Rng injectable, seededRng (mulberry32), constantRng
      store.ts            KeyValueStore (async) + MemoryKeyValueStore
    persona/
      schema.ts           schéma Zod, safeLoad/load/loadJson
      copine.ts           COPINE_PROFILE — premier profil intégré
      registry.ts         createPersonaRegistry, pickLine/pickGreeting,
                          interpolateName, openerKey
    relationship/
      state.ts            port de relationship-state.ts (dérive, inertie,
                          jalons, palier, résumés)
      emotion.ts          port du détecteur de reply-augment.ts
    memory/
      what-matters.ts     fiche « ce qui compte » (remember/recall/forget,
                          oubli doux, refus clinique, plafond 12)
      store.ts            WhatMattersMemory adossé à un KeyValueStore
    initiative/
      planner.ts          port pur de away-mode.ts (cadence, fenêtre, angles,
                          fil chaud, stop 24 h, garde anti-culpabilisation)
      triggers.ts         port du scoreur de proactive-engine.ts
    limits/
      contract.ts         contrat de sortie FR/EN, cinq motifs, réparations
                          surchargeables par l'hôte
  tests/                  6 fichiers, 105 tests déterministes
```

Côté Code Buddy : `src/companion/core-adapter.ts` (adaptateur opt-in) et
`tests/companion/core-adapter.test.ts` (preuve du byte-identique).
Racine : `package.json` (`workspaces: ["packages/*"]` + `typecheck:companion-core`),
`vitest.config.ts` (`packages/*/tests/**`), `.gitignore` (`_qa/core/home/`).

Volume : ~2 060 lignes de source paquet, ~1 000 lignes de tests.

---

## 2. API publique (quinze lignes, en tête de `src/index.ts`)

```
 1. loadPersonaProfile(json)          → un CompanionProfile validé (Zod)
 2. createPersonaRegistry(profiles)   → .get(id) pour un hôte multi-persona
 3. pickGreeting(profile, slot, o)    → un bonjour, en évitant ce qui vient d'être dit
 4. detectEmotion(heard)              → { emotion, intensity, confidence }
 5. detectRelationalSignal(heard)     → le signal de dérive grossier
 6. evolveRelationship(state, sig)    → un nouvel état ; il dérive, il ne cliquette jamais
 7. evolveRelationshipWithDayInertia  → idem, avec une humeur cohérente sur la journée
 8. rapportTier(sessions)             → palier de phrasé, jamais un score, jamais dit
 9. remember(sheet, fact, now)        → la fiche « ce qui compte » ; le clinique est refusé
10. recall(sheet, options)            → les faits les plus forts d'abord, épinglés en tête
11. forget(sheet, key) / applySoftForgetting(sheet, now) → suppression, et effacement doux
12. planInitiative({state, clock, profile}) → puis-je écrire le premier, et avec quelle ligne
13. isPauseRequest(text) / pauseInitiatives(state, now)  → le stop de 24 h
14. applyLimitsContract(output, {heard}) → la garde de sortie → LimitsVerdict
15. WhatMattersMemory({store, clock})    → la même fiche, persistée via un KeyValueStore
```

Tout est injectable : `Clock`, `Rng`, `KeyValueStore`. Le paquet n'ouvre aucun
fichier, n'appelle aucun réseau, n'importe rien de Code Buddy.

---

## 3. Ce qui est porté, ce qui est ajusté, ce qui est laissé

### Porté à l'identique (comportement prouvé égal)

| Source | Destination | Preuve |
| --- | --- | --- |
| `relationship-state.ts` : `evolveTraits`, inertie, jalons, `moodBand`, `rapportTier`, `personalityOf` | `relationship/state.ts` | `core-adapter.test.ts` compare les deux sur 3 états × 8 signaux |
| `reply-augment.ts` : `detectEmotion`, `emotionToSignal`, `openerKey` | `relationship/emotion.ts`, `persona/registry.ts` | tests du paquet (négation, mixte, anglais, intensité) |
| `reply-augment.ts` : `applyLimitsContract`, `isFrankIdentityQuestion` | `limits/contract.ts` | `core-adapter.test.ts`, 9 sorties × 5 motifs |
| `away-mode.ts` : fenêtre, plafond, angles, fil chaud, stop, anti-honte | `initiative/planner.ts` | tests du paquet (16 cas) |
| `proactive-engine.ts` : `evaluateTriggers`, `pickTrigger`, `interpolate` | `initiative/triggers.ts` | tests du paquet |
| `personas/types.ts` + `copine.ts` (structure et pools) | `persona/schema.ts` + `copine.ts` | le profil du dépôt passe le schéma Zod du paquet |

### Ajusté délibérément (et pourquoi)

1. **Le profil `copine` du paquet est générique.** Les trois lignes qui évoquaient
   le foyer de l'auteur (animal, détail privé) sont reformulées : un paquet publié
   ne transporte pas la vie d'un utilisateur. Ce qui est propre à un foyer se
   range dans la fiche « ce qui compte », à l'exécution. Conséquence assumée :
   **l'adaptateur Code Buddy sert toujours l'objet `COPINE_PERSONA` du dépôt**, pas
   celui du paquet — il le fait seulement *valider* par le schéma. D'où le
   byte-identique absolu, et zéro divergence de pools tant que l'étape 2 n'a pas
   tranché quel profil fait foi.
2. **Une ligne du pool `away` ne cite plus l'anti-motif qu'elle refuse.**
   « Pas de "tu m'ignores" » déclenchait la garde anti-culpabilisation
   (`isShameLine`) sur son propre texte. Le paquet dit « Pas de reproche, pas de
   compte à rendre ». La garde reste stricte au lieu d'être trouée d'exceptions.
   *Le fichier `src/companion/away-mode.ts` du dépôt n'est pas touché.*
3. **`lastLine` survit au changement de jour** dans `rollInitiativeDay` (le port
   d'`away-mode` le perdait à minuit). Deux « bonjour » identiques deux jours de
   suite sont exactement la répétition que l'anneau existe pour éviter.
4. **Les réparations du contrat de limites sont surchargeables** (`options.repairs`).
   Le paquet décide **quel** motif est refusé ; l'hôte décide **comment** sa
   compagne le dit. C'est ce qui rend le verdict identique au dépôt mot pour mot.
5. **`describeRapport`** ajouté : un phrasé du lien **sans aucun chiffre**.
   `relationshipSummary` (qui contient `/100`) reste réservé au prompt ; un test
   fixe la frontière.
6. **`suppressInactivity`** ajouté sur `evaluateTriggers` : quand l'absence est
   connue, le déclencheur « ça fait N jours » ne se déclenche pas. C'est le C2 de
   l'étude, rendu structurel plutôt que laissé à l'appelant.

### Neuf (spécifié dans l'étude, jamais codé — C1)

**La fiche « ce qui compte »** (`memory/`). Faits nommés avec provenance
(`explicit` / `confirmed` / `inferred`), date de création, date de dernière
confirmation, confiance 0..1, épinglage. Douze au maximum. `remember` reconfirme
au lieu de dupliquer. `applySoftForgetting` érode l'inféré ancien (demi-vie 45 j,
plancher 0,2) et **n'efface jamais un fait épinglé**. Une valeur qui ressemble à
une affirmation clinique (diagnostic, ordonnance, posologie, symptômes — accents
pliés) est **refusée à l'entrée** : la fiche est un rythme de vie, pas un dossier.
`describeWhatMatters` rend un bloc de prompt sans jargon et sans chiffre.

### Laissé dehors (délibérément)

- **Persistance réelle** : le paquet ne connaît que `KeyValueStore`. L'adaptateur
  fichier `atomic-write` 0o600 côté Code Buddy est l'étape 3.
- **Tout ce qui livre** : Telegram, Piper, ElevenLabs, caméra, WebSocket, le
  chef d'orchestre (`orchestrator.ts`), le budget journalier, `home-interaction-policy`.
- **`recent-said.ts`** : sa politique (anneau 32, 7 jours, fichier 0o600, portes
  d'environnement) est un choix d'hôte. Le paquet expose la brique pure
  (`openerKey`, `pickLine(avoid)`) et laisse l'anneau à l'hôte.
- **`relational-context.ts`**, `respond-decider.ts`, `episodic-journal.ts` : ils
  dépendent du bus d'événements, du LLM et du magasin mémoire de Code Buddy.
  `summarizeEpisode` est un bon candidat étape 2, il n'est pas dans l'étape 1.
- **`user-model.ts`** : volontairement non élargi (l'audit le dit trop étroit,
  et l'élargir ferait entrer la santé dans le modèle de travail).
- **Gamification sous toutes ses formes** : XP, séries, récompenses, barre
  d'affection. Un test parcourt les 56 lignes parlées du profil et vérifie
  qu'aucune ne porte de score ; le schéma Zod refuse d'en charger une.

---

## 4. L'adaptateur Code Buddy

`src/companion/core-adapter.ts`, opt-in `CODEBUDDY_COMPANION_CORE=true`.

- **Drapeau absent** ⇒ chaque fonction délègue au module historique. Zéro import
  du paquet, zéro coût, comportement byte-identique.
- **Drapeau présent** ⇒ le paquet est chargé **dynamiquement** (`await import`),
  mémoïsé, avec un verrou d'échec : paquet absent ou cassé ⇒ un avertissement,
  puis le chemin historique. Une installation publiée qui ne porte pas le paquet
  ne le résout donc jamais.
- Les anciens modules **restent en place et restent la source de vérité**.
  C'est un branchement, pas une migration.

Surface : `companionCoreEnabled`, `loadCompanionCore`, `resetCompanionCoreCache`
(couture de test), `resolveCompanionPersonaViaCore`, `validateCompanionPersona`,
`evolveTraitsViaCore`, `applyLimitsContractViaCore`.

**Preuve du byte-identique** (`tests/companion/core-adapter.test.ts`, 12 tests) :
3 états relationnels (dont deux aux bornes 0/100) × 8 signaux de dérive comparés
à `evolveTraits` ; 9 sorties couvrant les 5 motifs de limites, l'idiome
« ça me tue » et la question d'identité franche, comparées à `applyLimitsContract`,
drapeau éteint **et** allumé ; la persona rendue est **l'objet même**
(`toBe`, pas `toEqual`) que le chemin historique.

---

## 5. Plan des étapes 2 et 3

**Étape 2 — MySoulmate v3 consomme le paquet.**
`PersonalityManager.load()` → `createPersonaRegistry` sur des profils JSON, un
`personaId` persisté par compagnon (le multi-persona existe déjà côté CRUD).
`ProactiveScheduler` → `planInitiative` + `InitiativeState` persisté par
(userId, companionId) : le cooldown en `Map` du processus disparaît, le fuseau de
l'utilisateur entre. Garde de sortie `applyLimitsContract` après
`failoverManager.execute*`, avant `res.json` et avant le flux SSE. Nouveau
service relationnel : `mood`/`traits`/`sessions`/`celebratedMilestones` en
colonnes, `level`/`xp`/`affection` **conservées mais plus lues pour le ton**.
Nouvelle table `WhatMatters`, injectée en tête de `buildEnrichedMessages`, devant
le RAG. Drapeau `COMPANION_CORE=true` côté serveur.

**Étape 3 — Code Buddy bascule par défaut.**
Écrire l'adaptateur `KeyValueStore` sur `atomic-write` (0o600, sous
`~/.codebuddy/companion/`). Trancher quel profil `copine` fait foi (proposition :
celui du paquet, plus les pools spécifiques au foyer chargés depuis un JSON local
non suivi). Basculer module par module — persona, puis limites, puis dérive, puis
initiative — chacun derrière son propre test de byte-identique, puis retirer le
module historique une fois le remplaçant en place depuis une version. Publier
`@phuetz/companion-core` sur npm et l'ajouter aux dépendances racine seulement à
ce moment-là ; l'import dynamique de l'adaptateur redevient alors statique.

---

## 6. Risques

1. **Deux profils `copine` coexistent** (celui du dépôt, celui du paquet) jusqu'à
   l'étape 3. Ils peuvent diverger. Atténuation : l'adaptateur ne sert QUE celui du
   dépôt, et un test vérifie que celui du dépôt passe le schéma du paquet — une
   divergence structurelle rougit. Une divergence de *pools* ne rougit pas : c'est
   la décision explicite à prendre à l'étape 3.
2. **Le champ `workspaces` change la sémantique d'installation** du dépôt entier
   (hoisting, `prepare` du paquet joué à chaque `npm install`). Vérifié ici :
   installation propre en 2 min, lien créé, `dist` construit, `check:pack` vert
   (le paquet n'entre pas dans le tarball de `@phuetz/code-buddy`). `cowork/`
   n'est pas dans `packages/*` et garde son installation séparée.
3. **`packages/companion-core/dist` doit exister** pour que `tsc` racine résolve
   les types de l'adaptateur. C'est assuré par `prepare`, mais une arborescence
   où `npm install` n'a pas été rejoué typechecke rouge. Documenté ici ; l'étape 3
   (publication npm) le supprime.
4. **`KeyValueStore` est asynchrone.** Le chemin vocal de Code Buddy est
   majoritairement synchrone (`loadRelationshipState` est un `readJsonAtomicSync`).
   L'étape 3 devra soit rendre ces points d'appel asynchrones, soit envelopper un
   cache synchrone. Choix reporté volontairement : le paquet doit servir un hôte
   SQL, où le synchrone n'existe pas.
5. **L'oubli doux de la fiche est indépendant** de l'Ebbinghaus existant
   (`CODEBUDDY_MEMORY_FORGET`). Si les deux tournent un jour sur la même donnée,
   un fait pourrait être érodé deux fois. À l'étape 3, un seul des deux doit
   posséder la fiche — l'invariant de l'étude est clair : **Ebbinghaus ne touche
   pas les épinglés**.
6. **Le contrat de limites reste un filet à motifs.** Il attrape l'assertion
   franche, pas la manipulation subtile. Ce n'est pas une régression (c'était déjà
   le cas), mais l'ajouter au paquet ne le rend pas plus intelligent — seulement
   partageable.

---

## 7. Vérifications

| Vérification | Commande | Résultat |
| --- | --- | --- |
| Tests du paquet | `vitest run packages/companion-core/tests` | **105 / 105** verts (6 fichiers) |
| Adaptateur (byte-identique) | `vitest run tests/companion/core-adapter.test.ts` | **12 / 12** verts |
| Non-régression compagnon | `vitest run tests/companion` | **715 verts, 1 sauté** (Piper absent) |
| Sécurité + hygiène | `vitest run tests/security tests/hygiene` | **977 / 977** verts (52 fichiers) |
| Données personnelles | `vitest run tests/security/donnees-personnelles.test.ts` | **40 / 40** verts, fichiers indexés |
| Contenu du tarball npm | `vitest run tests/security/npm-pack-contents.test.ts` | **10 / 10** verts |
| Typecheck | `npm run typecheck` | **0** (racine + gpuNode + companion-core) |
| Lint des fichiers neufs | `eslint packages/companion-core src/companion/core-adapter.ts tests/companion/core-adapter.test.ts` | **0** |
| Lint complet | `npm run lint` | 6 erreurs **préexistantes** dans `src/server/mobile/assets/app.js` (`catch (err)` non utilisés, commit `753a0b19a`, hors lane) ; **0 apportée par ce travail** |
| Blancs de fin / conflits | `git diff --check` | **0** |

HOME de tests isolé sous `_qa/core/home` (gitignoré), `env -u FORCE_COLOR`.
`git add` fichier par fichier, trois commits, aucun push, `~/code-buddy` et
`~/.codebuddy` jamais touchés.

---

## Bilan (10 lignes)

Le socle relationnel de Lisa est extrait : `packages/companion-core`, TypeScript pur,
zéro UI, zéro réseau, zéro dépendance à Code Buddy, une seule dépendance (zod).
Cinq modules — persona validée par Zod, état relationnel qui dérive sans jamais
cliqueter, fiche « ce qui compte » (le C1 de l'étude, jamais codé jusqu'ici),
initiative plafonnée avec stop de 24 h, contrat de limites FR/EN — plus trois
coutures injectables : horloge, aléa, stockage. API publique en quinze lignes,
105 tests déterministes. L'adaptateur Code Buddy est branché mais **éteint par
défaut** et charge le paquet dynamiquement : drapeau absent, rien ne bouge ;
drapeau présent, 12 tests prouvent le byte-identique sur la grille complète des
signaux et des motifs. Les anciens modules restent en place — c'est l'étape 1.
Deux décisions attendent l'étape 3 : quel profil `copine` fait foi, et qui possède
l'oubli de la fiche. Le seul rouge du dépôt (6 erreurs eslint) est préexistant
et hors lane.
