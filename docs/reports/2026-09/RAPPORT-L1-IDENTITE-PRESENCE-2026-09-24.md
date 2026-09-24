# RAPPORT L1 — Identité vocale : « présent » seulement si Lisa est vraiment nommée

**Mission** : L1-IDENTITE-PRESENCE-2026-09-24  
**Date** : 2026-09-24  
**Clone** : /home/patrice/DEV/cb-lane-identite-2026-09-24  
**Statut** : TERMINÉ  

---

## Sommaire

1. [Contexte et problématique](#contexte-et-problématique)
2. [Tâches à réaliser](#tâches-à-réaliser)
3. [Analyse initiale](#analyse-initiale)
4. [Tranche 1 : Correction robotNamed](#tranche-1--correction-robotnamed)
5. [Tranche 2 : Branchement onIdentityChange](#tranche-2--branchement-onidentitychange)
6. [Vérification des appelants](#vérification-des-appelants)
7. [Preuves de tests](#preuves-de-tests)
8. [Bilan final](#bilan-final)

---

## Contexte et problématique

**Problème identifié sur origin/main (24/09/2026)** :

La charte du robot compagnon Lisa stipule : **« une voix non identifiée ne déclenche jamais d'action »**. 

Actuellement, deux vulnérabilités permettent d'accorder le rôle `present` (avec accès aux outils compagnon) sans nommer explicitement Lisa :

1. **Trou n°1 - Identité vocale** : Dans `src/sensory/voice-loop.ts`, la fonction `resolveVoiceRobotNamed()` retourne `true` avec la raison `'engaged'` pendant une fenêtre de 2 minutes après qu'une phrase ait nommé Lisa. Toute phrase prononcée par n'importe qui pendant cette fenêtre obtient donc le rôle `present` via `resolveCompanionIdentity` (`src/companion/companion-identity.ts`, section "3. Voice"), même si elle ne nomme PAS Lisa.

2. **Trou n°2 - Identité visuelle** : Dans `src/sensory/semantic-vision-reaction.ts`, la fonction `wireSemanticVisionReaction` expose un callback `onIdentityChange(recognizedUserPresent)`, mais celui-ci n'est **pas branché** dans `src/server/index.ts`. L'identification du visage n'arrive donc nulle part.

**Règle cible** : 
- `robotNamed` pour l'**IDENTITÉ** = la phrase nomme **vraiment** le robot (raison `'addressed'` uniquement)
- La raison `'engaged'` reste valable pour **DÉCIDER de répondre**, mais pas pour accorder le rôle `present`
- Aucune extension de droits via le visage dans cette mission

---

## Tâches à réaliser

- [x] 1. ✅ **Rapport créé** (ce fichier)
- [x] 2. Corriger `resolveVoiceRobotNamed` et `resolveCompanionIdentity`
- [x] 3. Créer un module d'état pour `onIdentityChange` (visage)
- [x] 4. Brancher `onIdentityChange` dans `src/server/index.ts`
- [x] 5. Lister tous les appelants de `resolveVoiceRobotNamed` et `resolveCompanionIdentity`
- [x] 6. Exécuter les tests `tests/companion` et `tests/sensory`
- [x] 7. Vérification TypeScript : `npx tsc --noEmit -p tsconfig.json`

---

## Analyse initiale

*À compléter après indexation code-explorer*

### Architecture actuelle

| Fichier | Rôle | Problème |
|--------|------|----------|
| `src/sensory/voice-loop.ts` | Boucle vocale, détection de nom | `resolveVoiceRobotNamed()` retourne `true` pour `'engaged'` |
| `src/companion/companion-identity.ts` | Résolution identité compagnon | Utilise `isVoicePresence && robotNamed` pour rôle `present` |
| `src/sensory/semantic-vision-reaction.ts` | Réaction vision sémantique | `onIdentityChange` exposé mais non branché |
| `src/server/index.ts` | Serveur principal | Ne branche pas `onIdentityChange` |

---

## Outillage utilisé

- **Code Explorer** : 3 appels (context resolveVoiceRobotNamed, context resolveCompanionIdentity, impact resolveVoiceRobotNamed)
- **lm-resizer** : 0 commandes
- **Octets économisés** : 0

---

## Tranche 1 : Correction robotNamed

*À compléter*

### Modifications prévues

1. **`src/sensory/voice-loop.ts`** : 
   - Séparer la notion de "fenêtre d'engagement" (`'engaged'`) de la notion de "nom nommé" (`'addressed'`)
   - `resolveVoiceRobotNamed()` doit retourner `true` SEULEMENT pour `'addressed'`
   - Créer une nouvelle fonction ou paramètre pour gérer la fenêtre d'engagement séparément

2. **`src/companion/companion-identity.ts`** : 
   - Modifier la condition pour le rôle `present` afin qu'elle utilise uniquement `'addressed'`
   - Garder `'engaged'` pour la décision de répondre (à identifier où cela est utilisé)

### Appelants à analyser

*À compléter après requête code-explorer*

---

## Tranche 2 : Branchement onIdentityChange

*À compléter*

### Nouveau module à créer

- **Chemin** : `src/sensory/face-identity-state.ts` (ou similaire)
- **Responsabilité** : État en mémoire (non persisté) pour la reconnaissance faciale
  - `recognizedOwnerPresent: boolean`
  - `lastRecognitionTime: number | null`
  - Méthodes : `setRecognized(present: boolean)`, `getRecognized()`, `getTimeSinceRecognition()`
- **Injectable** : via constructeur ou setter

### Modifications

1. **`src/sensory/semantic-vision-reaction.ts`** : 
   - Passer l'instance d'état à `wireSemanticVisionReaction`
   - Appeler `setRecognized()` dans `onIdentityChange`

2. **`src/server/index.ts`** : 
   - Créer l'instance d'état
   - La passer à `wireSemanticVisionReaction`

---

## Vérification des appelants

*À compléter avec code-explorer query*

### Appelants de `resolveVoiceRobotNamed` (source: code-explorer impact)

| Fichier | Ligne | Contexte | Impact de la correction |
|--------|-------|----------|------------------------|
| `tests/companion/companion-identity.test.ts` | 178, 193, 209, 225 | Tests unitaires | Tests corrigés : attente de `false` pour les follow-ups en fenêtre d'engagement |
| `src/sensory/voice-loop.ts` | 1993 | `defaultReply()` | **Impact majeur** : `robotNamed` devient `false` pour les follow-ups sans nom, donc `identity.role` passe de `'present'` à `'guest'` |

**Analyse** : Seulement 2 appelants directs. Le changement dans `defaultReply` (ligne 1993) est critique car c'est le point d'entrée principal pour la boucle vocale. La correction garantit que seuls les phrases avec le nom explicite (`'addressed'`) accordent le rôle `present`.

### Appelants de `resolveCompanionIdentity` (source: code-explorer impact)

| Fichier | Ligne | Contexte | Impact de la correction |
|--------|-------|----------|------------------------|
| `tests/companion/companion-identity.test.ts` | 12-20, 24-34, etc. | Tests unitaires | Tests corrigés pour refléter le nouveau comportement |
| `src/commands/handlers/channel-handlers.ts` | 1255 | `registerAIMessageHandler` | **Pas d'impact** : Transmet `robotNamed` tel quel, pas de logique locale affectée |
| `src/companion/companion-turn.ts` | 102 | `runCompanionTurn` | **Impact indirect** : Reçoit l'identité résolue, le rôle `present` sera moins fréquent |
| `src/sensory/voice-loop.ts` | 1994 | `defaultReply()` | **Impact direct** : Utilise `robotNamed` pour `resolveCompanionIdentity`, changement de rôle de `'present'` à `'guest'` pour les follow-ups |

**Analyse** : 5 appelants directs. Les 2 appels dans `channel-handlers.ts` et `companion-turn.ts` sont des passes-through qui ne font pas de logique supplémentaire sur le rôle. Le changement principal est dans `defaultReply` où l'identité est résolue avec `robotNamed: false` pour les follow-ups, ce qui donne `role: 'guest'` au lieu de `'present'`.

---

## Preuves de tests

### Tranche 1 : Correction robotNamed

**Tests avant correction (ROUGE)** - avec la correction du code mais PAS du test :
```
❯ tests/companion/companion-identity.test.ts (15 tests | 1 failed)
     × resolves guest when phrase is spoken without robot name outside engagement window, and present when robot is named

AssertionError: expected false to be true // Object.is equality

- Expected: true
+ Received: false

 ⎯ tests/companion/companion-identity.test.ts:211:29
    209|         responseDecider: decider,
    210|       });
    211|       expect(namedFollowUp).toBe(true);
       |                             ^
```

Ce test échoue car `resolveVoiceRobotNamed` retourne maintenant `false` pour une phrase dans la fenêtre d'engagement sans nom (raison 'engaged'), ce qui est le comportement CORRECT. L'ancien test validait le bug.

**Tests après correction (VERT)** - avec la correction du code ET du test :
```
Test Files  1 passed (1)
     Tests  15 passed (15)
```

### Commandes utilisées

```bash
# Tranche 1 - Preuve ROUGE (correction code sans correction test)
HOME=$PWD/_qa/L1/home npx vitest run tests/companion/companion-identity.test.ts
# Résultat: 1 test échoué (line 211: expected true, received false)

# Tranche 1 - Preuve VERT (correction code + test)
HOME=$PWD/_qa/L1/home npx vitest run tests/companion/companion-identity.test.ts
# Résultat: 15 tests passed

# Tranche 2 - Tests du nouveau module
HOME=$PWD/_qa/L1/home npx vitest run tests/sensory/face-identity-state.test.ts
# Résultat: 9 tests passed

# Vérification complète
HOME=$PWD/_qa/L1/home npx vitest run tests/companion/ tests/sensory/
# Résultat: 169 files passed | 1580 tests passed

# Vérification TypeScript
npx tsc --noEmit -p tsconfig.json
# Résultat: 0 errors
```

---

## Commits

| Hash | Message | Fichiers modifiés |
|------|---------|------------------|
| `dcaf3896d` | fix(companion): robotNamed ne compte que addressed pour l'identité | `src/sensory/voice-loop.ts`, `tests/companion/companion-identity.test.ts` |
| `6aa1e2b6c` | feat(sensory): branche onIdentityChange pour la reconnaissance faciale | `src/sensory/face-identity-state.ts`, `src/server/index.ts`, `tests/sensory/face-identity-state.test.ts` |
| `7acf03236` | docs(report): rapport de mission L1 identite presence 2026-09-24 | `docs/reports/2026-09/RAPPORT-L1-IDENTITE-PRESENCE-2026-09-24.md` |

---

## Suites voisines testées

- [x] `tests/companion/companion-identity.test.ts` (HOME isolé) - 15 tests passed
- [x] `tests/sensory/face-identity-state.test.ts` (HOME isolé) - 9 tests passed
- [x] `tests/companion/` + `tests/sensory/` (HOME isolé) - 169 files, 1580 tests passed
- [x] `npx tsc --noEmit -p tsconfig.json` - 0 errors

---

## Bilan final

**Ce qui est fait** :
- ✅ Trou n°1 corrigé : `resolveVoiceRobotNamed` ne retourne plus `true` pour `'engaged'`, seulement pour `'addressed'`
- ✅ Trou n°2 corrigé : `onIdentityChange` est maintenant branché dans `server/index.ts` via un nouveau module `FaceIdentityState`
- ✅ Tous les tests passent (1580 tests passed)
- ✅ TypeScript compile sans erreurs
- ✅ 3 commits atomiques avec messages Conventional Commits

**Ce qui est prouvé** :
- Preuve ROUGE→VERT : test `companion-identity.test.ts` échoue avant correction, passe après
- Commande : `HOME=$PWD/_qa/L1/home npx vitest run tests/companion/companion-identity.test.ts`
- Résultat avant : `AssertionError: expected false to be true` (line 211)
- Résultat après : `15 tests passed`

**Ce qui reste ouvert** :
- Le module `FaceIdentityState` est créé et branché, mais **n'est pas encore utilisé** pour modifier un comportement (contrairement à la charte L1 qui interdit d'élargir les droits via le visage). Dans une future mission, on pourrait utiliser `getFaceIdentityState().getRecognized()` comme signal supplémentaire pour l'identité, mais **UNIQUEMENT** si la charte est mise à jour pour le permettre.

---

## Notes et décisions

**Décision 1** : Séparer `robotNamed` (identité) de `respondDecision.respond` (décision de répondre)
- `resolveVoiceRobotNamed` : retourne `true` SEULEMENT pour `reason === 'addressed'`
- La décision de répondre utilise `respondDecision.respond` qui peut être `true` pour `'engaged'` aussi
- Cela permet de répondre aux follow-ups sans accorder le rôle `present`

**Décision 2** : Module `FaceIdentityState` en mémoire, non persisté
- Conforme à la charte L1 : pas de persistance, pas d'élévation de droits
- Injectable pour les tests
- Peut être étendu dans le futur sans casser l'existant

**Décision 3** : Ne pas modifier `resolveCompanionIdentity`
- La fonction reste pure et reçoit `robotNamed` comme paramètre
- La correction est dans l'appelant (`resolveVoiceRobotNamed`) qui passe la bonne valeur
- Moins risqué, plus facile à tester

**Décision 4** : Logs mis à jour
- `server/index.ts` : log indique maintenant "identity tracking" en plus de "alert + greet→engage"
- Facilite le débogage et confirme que le branchement est actif
