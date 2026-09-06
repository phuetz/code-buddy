# Audit du système nerveux — 2026-09-01

## Résultat

Audit réalisé sur la branche `codex/audit-systeme-nerveux-2026-09-01`, sans accès ni modification de l'état runtime sous `~/.codebuddy/`, sans redémarrage des services et sans vérification live.

Les neuf modules prioritaires ont été relus, ainsi que leurs tests et leurs consommateurs directs. Sept cycles ROUGE → VERT ont couvert quinze défauts ou variantes de défaut. Le principal résultat est la fermeture de trois rotations de journaux qui pouvaient continuer à grossir après un échec, la suppression de cinq faux acquittements vocaux, la validation de quatre seuils runtime et l'annulation logique de deux traitements après teardown.

État des tests :

- référence avant modification : `tests/sensory/` — **40 fichiers, 457 tests verts** ;
- suite sensorielle finale : `tests/sensory/` — **41 fichiers, 480 tests verts** ;
- vérification intégrée finale : **44 fichiers, 505 tests verts** ;
- `npm run typecheck` : vert, y compris `typecheck:gpuNode-identity` ;
- ESLint ciblé sur les treize fichiers TypeScript touchés : vert, aucune sortie ;
- `git diff --check` : vert.

## Défauts corrigés

Les références `R1` à `R7` et `V1` à `V7` renvoient aux sorties littérales conservées plus bas.

| fichier:ligne | symptôme | preuve rouge | preuve verte |
| --- | --- | --- | --- |
| `src/sensory/dreaming.ts:96` | Une erreur de rotation autre que `ENOENT` était avalée ; le journal dépassait 512 Kio et l'écriture continuait. | `R1` : taille obtenue `524420`, attendue `524289`. | `V1` : seule l'absence du fichier est ignorée ; 459/459. |
| `src/sensory/episodic-journal.ts:234` | Même faux succès sur `episodes.jsonl` : échec de `rename`, puis append. | `R1` : taille obtenue `524491`, attendue `524289`. | `V1` : l'échec remonte au garde-fou de persistance ; 459/459. |
| `src/companion/percepts.ts:496` | Le journal commun `percepts.jsonl` possédait le même `catch` silencieux et pouvait croître après une rotation impossible. | `R7` : la promesse résout un percept au lieu de rejeter ; 1 test rouge. | `V7` : rejet et taille inchangée ; 486/486. |
| `src/sensory/episodic-journal.ts:210` | Un raffineur LLM en panne activait silencieusement le résumé déterministe. | `R2` : aucun `logger.warn` observé. | `V2` : repli conservé mais explicitement journalisé ; 462/462. |
| `src/sensory/episodic-journal.ts:191` | L'échec de lecture des percepts violait le contrat « never throws ». | `R2` : rejet `percept store unavailable`. | `V2` : avertissement puis `null` ; 462/462. |
| `src/sensory/episodic-journal.ts:250` | Une fonction `promote` injectée pouvait également faire rejeter une consolidation annoncée « never throws ». | `R2` : rejet `memory offline`. | `V2` : avertissement, épisode retourné ; 462/462. |
| `src/sensory/vision-reaction.ts:199` | `success: true` sans description publiait une scène vide et enregistrait un faux succès d'analyse. | `R3` : 1 scène publiée au lieu de 0. | `V3` : description trimée et obligatoire ; 464/464. |
| `src/sensory/vision-reaction.ts:239` | Une alerte Telegram rejetée armait quand même le cooldown, donc le prochain événement similaire n'était pas retenté. | `R3` : 1 appel réseau au lieu de 2. | `V3` : l'état n'est avancé qu'après livraison confirmée ; 464/464. |
| `src/sensory/voice-interactions.ts:221` | Cinq réponses directes annonçaient une action non exécutée (`autonomie`, vrais tests, réponse plus courte, répétition) ou interceptaient un vrai travail contenant « sexuel ». | `R4` : 6 échecs, dont les cinq phrases et le préchauffage 25 au lieu de 21. | `V4` : ces intentions retournent `null` vers l'agent ; seul l'arrêt instantané reste local ; 472/472. |
| `src/sensory/screen-reaction.ts:34` | Une valeur de debounce vide, non numérique ou négative devenait `NaN`/négative et désactivait de fait la garde. | `R5` : 2 analyses au lieu de 1. | `V5` : repli averti à 5000 ms ; 478/478. |
| `src/sensory/vision-reaction.ts:65` | Même défaut pour le debounce vision. | `R5` : 2 analyses au lieu de 1. | `V5` : repli averti à 8000 ms ; 478/478. |
| `src/sensory/vision-reaction.ts:162` | Un cooldown invalide désactivait l'alerte périodique attendue. | `R5` : 1 envoi au lieu de 2. | `V5` : repli averti à 300000 ms ; 478/478. |
| `src/sensory/vision-reaction.ts:78` | Un seuil de similarité hors `[0,1]` rendait la comparaison incohérente. | `R5` : avec `-1`, 1 envoi au lieu de 2. | `V5` : repli averti à `0.6` ; 478/478. |
| `src/sensory/screen-reaction.ts:69` | Le teardown retirait l'écouteur mais une analyse déjà lancée pouvait encore écrire un percept obsolète. | `R6` : le test attendait l'absence d'écriture, mais recevait le percept stale. | `V6` : garde `disposed` après l'analyse ; 480/480. |
| `src/sensory/vision-reaction.ts:188` | Même traitement post-teardown côté caméra : publication, journal et alerte restaient possibles après unwire. | `R6` : 1 scène décrite après teardown au lieu de 0. | `V6` : garde `disposed` avant tout effet ; 480/480. |

## Sorties ROUGES collées

### R1 — rotations des rêves et épisodes

```text
Test Files  2 failed | 38 passed (40)
Tests       2 failed | 457 passed (459)
dreaming: expected 524420 to be 524289
episodic-journal: expected 524491 to be 524289
```

### R2 — replis et contrat du journal épisodique

```text
Test Files  1 failed | 39 passed (40)
Tests       3 failed | 459 passed (462)
refinement warning: expected 1 call, received 0
reader: promise rejected "percept store unavailable" instead of resolving
promotion: promise rejected "memory offline" instead of resolving
```

### R3 — faux succès et livraison vision

```text
Test Files  1 failed | 39 passed (40)
Tests       2 failed | 462 passed (464)
empty success: expected 0 scene, received 1
rejected alert: expected 2 fetch calls, received 1
```

### R4 — faux acquittements vocaux

```text
tests/sensory/voice-interactions.test.ts (16 tests | 6 failed)
"corrige le filtre sexuel" -> réponse locale au lieu de null
"Continue en autonomie" -> fausse promesse locale
"Pas de mocks" -> fausse promesse locale
"Réponds plus court" -> fausse promesse locale
"Répète" -> acquittement sans répétition
prewarm: expected 21, received 25
Test Files  1 failed | 39 passed (40)
Tests       6 failed | 466 passed (472)
```

### R5 — seuils invalides

```text
screen invalid debounce: expected 1 call, received 2
vision invalid debounce: expected 1 call, received 2
vision invalid cooldown: expected 2 fetch calls, received 1
vision similarity -1: expected 2 fetch calls, received 1
Test Files  2 failed | 39 passed (41)
Tests       4 failed | 474 passed (478)
```

### R6 — travail post-teardown

```text
screen: promise resolved to a stale percept instead of rejecting ENOENT
vision: expected 0 described scene, received 1
Test Files  2 failed | 39 passed (41)
Tests       2 failed | 478 passed (480)
```

### R7 — rotation du journal commun des percepts

```text
FAIL tests/companion-percepts.test.ts
AssertionError: promise resolved "{ …(8) }" instead of rejecting
Test Files  1 failed | 41 passed (42)
Tests       1 failed | 485 passed (486)
```

## Sorties VERTES collées

```text
V1  Test Files 40 passed (40) | Tests 459 passed (459)
V2  Test Files 40 passed (40) | Tests 462 passed (462)
V3  Test Files 40 passed (40) | Tests 464 passed (464)
V4  Test Files 40 passed (40) | Tests 472 passed (472)
    ajout de la couverture sensory-memory : 41 passed | 474 passed
V5  Test Files 41 passed (41) | Tests 478 passed (478)
V6  Test Files 41 passed (41) | Tests 480 passed (480)
V7  Test Files 42 passed (42) | Tests 486 passed (486)

Vérification intégrée finale :
Test Files  44 passed (44)
Tests       505 passed (505)
```

## Défauts ou risques non corrigés

Ces points demandent une décision de conception ; aucun comportement de production n'a été choisi implicitement pendant l'audit.

| fichier:ligne | constat | raison de l'absence de correction |
| --- | --- | --- |
| `src/sensory/episodic-journal.ts:242` puis `:250` | Le curseur de déduplication est persisté avant la promotion. Si la promotion échoue, le même épisode sera ensuite ignoré et ne sera pas retenté en mémoire longue. | Il faut choisir explicitement entre au-moins-une-fois, au-plus-une-fois, ou un état transactionnel séparant « journalisé » et « promu ». |
| `src/sensory/dreaming.ts:87` puis `:91` | Le buffer est drainé avant la persistance. Une panne disque consomme donc la fenêtre, même si elle est signalée. | Réinjecter les perceptions peut réordonner la fenêtre ou évincer de nouveaux événements au plafond de 1000 ; il faut définir la politique de reprise. |
| `src/sensory/heartbeat-scheduler.ts:98` | Une promesse de traitement qui ne se résout jamais garde son verrou pour toujours. | Un timeout impose une durée par organe et éventuellement une annulation coopérative ; aucune valeur sûre et commune ne ressort du code. |
| `src/sensory/heartbeat-scheduler.ts:79` | `stop()` retire l'écouteur mais conserve les tâches du singleton. Un redémarrage dans le même processus peut réactiver une tâche optionnelle désormais désactivée. | Il faut décider si `stop()` signifie pause réversible ou destruction ; une API `reset`/`dispose` changerait le contrat. |
| `src/server/index.ts:1813`, `:1846`, `:1858`, `:1879`, `:1903`, `:1976` | Plusieurs cadences utilisent `Math.max(1, Number(env))` : une chaîne invalide produit `NaN`, puis `register()` rejette après qu'une partie du système a déjà été câblée. Le `catch` avertit, mais `sensoryWired` était déjà positionné à `src/server/index.ts:1283`. | La correction sûre couple politique de repli des six variables et rollback transactionnel du démarrage partiel ; ce périmètre dépasse un ajustement local des neuf modules. |

## Ce qui a paru sain

| module | éléments relus et jugés sains |
| --- | --- |
| `sensory-memory.ts` | Buffer réellement borné à 1000, éviction du plus ancien, `snapshot()` défensif et `drain()` libérant l'ancien tableau. Deux tests directs ont été ajoutés ; 2/2 verts. |
| `heartbeat-scheduler.ts` | Validation entière `>= 1`, `start()` idempotent, désinscription du bus dans `stop()`, verrou indépendant par tâche, libération en `finally`, isolation des erreurs. Les tests existants prouvent l'absence d'auto-chevauchement et la progression parallèle d'organes différents. |
| `voice-turn-taking.ts` | Hold borné entre 0 et 3000 ms, ponctuation terminale prioritaire, détection locale français/anglais. Le timer de fragment est annulé lors de la jonction et du teardown dans son consommateur. |
| `camera-keyframe-policy.ts` | `realpath` sur racine et fichier, confinement anti-symlink/traversal, extensions autorisées, fichier non vide et plafond 20 Mio. L'envoi de la photo Telegram possède un consentement distinct. |
| `screen-reaction.ts` | Le verrou `inFlight` empêchait déjà deux analyses longues de se chevaucher ; les seuils et le teardown sont désormais couverts. |
| `vision-reaction.ts` | Garde d'activation caméra + token, confinement de l'image, verrou `inFlight`, redaction avant egress et consentement photo séparé. L'événement cognitif est publié avant les effets réseau optionnels. |
| `dreaming.ts` | Consolidation bornée (`salient.slice(0, 20)`), journal rotatif et promotion sous clé stable ; le passage d'oubli est opt-in et journalise ses erreurs. |
| `episodic-journal.ts` | Fenêtre limitée à 40 tours, extraits et listes bornés, empreinte de déduplication, journal rotatif et clé de mémoire stable `episode:recent`. Cette clé est bien lue par le contexte relationnel. |
| `voice-interactions.ts` | Normalisation et adressage explicite, catalogue fini, préchauffage dédupliqué. Les réponses purement conversationnelles et l'arrêt immédiat restent locaux ; toute intention qui implique une action repart maintenant vers l'agent. |

Les fichiers `dreams.jsonl` et `episodes.jsonl` ne sont pas relus directement par le code applicatif. Ce n'est pas classé comme « écrit mais jamais consommé » : leur rôle observable est celui de journal borné/audit récupérable, tandis que leurs résumés sont promus dans les clés de mémoire effectivement consommées. Si ces fichiers devaient servir à une restauration automatique, cette exigence n'est actuellement ni codée ni testée.

## Commandes de vérification finales

```text
npx vitest run tests/sensory/ tests/companion-percepts.test.ts tests/companion/relational-context.test.ts tests/companion/voice-callbacks.test.ts
=> 44 fichiers, 505 tests verts

npm run typecheck
=> tsc --noEmit + tsc --project tsconfig.gpuNode-identity.json, verts

npx eslint <13 fichiers TypeScript touchés>
=> code 0, aucune sortie

git diff --check
=> code 0
```

Les services `buddy-vision-brain` et `buddy-vision-eye` n'ont pas été interrogés ni redémarrés. Les changements ne prendront effet qu'au prochain redémarrage planifié par Patrice.
