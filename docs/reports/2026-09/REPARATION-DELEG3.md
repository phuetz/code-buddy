# Réparation DELEG3 — QualityGate et Verifier multiplexés

Date : 2026-09-04
Agent : Codex (GPT-5)
Dépôt : `~/DEV/cb-deleg3-2026-09-04`
Branche attendue : `feat/deleg3-qualitygate-verifier-2026-09-04`
HEAD de départ annoncé : `7337b6883`

## Mission

- Faire exécuter CodeGuardian et SecurityReview par deux délégués légers en parallèle, avec concurrence et budgets bornés, multiplexage étiqueté et agrégation compatible.
- Faire passer `executeOn('verifier', …)` par un délégué à contexte frais et budget borné.
- Conserver les contrats fail-closed : toute erreur ou tout dépassement rend la revue incomplète ; aucune prose seule ne peut produire `CONFIRMED`.
- Écrire les tests rouge puis vert, produire une preuve Ollama locale et exécuter les gates demandées.

## Contraintes

- Aucune écriture dans `~/code-buddy`, aucun push, aucune API payante, aucun service modifié.
- Ollama local `qwen3:4b-instruct` uniquement après `ollama ps`.
- HOME de QA : `~/DEV/cb-deleg3-2026-09-04/_qa/deleg3/home`, ignoré par Git.
- Ajouts Git nommés fichier par fichier ; aucun `git add -A`, `git commit -a`, `git reset --hard`, `git prune` ou `rm -rf`.

## Journal

- 2026-09-04 — Rapport créé avant toute inspection du chantier ; réservation de coordination effectuée dans le même changement documentaire initial.
- Brique QualityGate, rouge avant code produit :
  `HOME=$PWD/_qa/deleg3/home npx vitest run tests/agent/middleware/quality-gate-middleware.test.ts`
  → 1 fichier, 27 tests, 3 rouges. Les deux gates restaient séquentielles
  (`maxActive=1`), aucun événement multiplexé n'était exposé, et une exception
  ou un budget épuisé rendait encore `continue`.
- Brique QualityGate, vert :
  `HOME=$PWD/_qa/deleg3/home npx vitest run tests/agent/middleware/quality-gate-middleware.test.ts tests/agent/delegation/thread-task-runner.test.ts tests/agent/delegation/thread-delegation.test.ts`
  → 3 fichiers, 42 tests réussis. Les deux revues atteignent `maxActive=2`,
  leurs sorties sont étiquetées, et les erreurs/budgets deviennent
  `INCOMPLETE REVIEW`. Le défaut hérité de `ThreadTaskRunner` reste 1.
- Brique Verifier, rouge avant code produit :
  `HOME=$PWD/_qa/deleg3/home npx vitest run tests/agent/delegation/thread-delegation.test.ts tests/agents/verifier-delegation.test.ts`
  → 2 fichiers, 14 tests, 3 rouges. `executeOn('verifier')` réutilisait
  l'instance (`initialize` 1 fois au lieu de 2), exécutait 999 étapes demandées,
  et un tour ayant franchi son budget coût restait déclaré réussi.
- Brique Verifier, vert :
  `HOME=$PWD/_qa/deleg3/home npx vitest run tests/agent/delegation tests/agents/verifier-delegation.test.ts tests/unit/verifier-agent.test.ts tests/agent/dev-loop.test.ts tests/agent/middleware/quality-gate-middleware.test.ts`
  → 6 fichiers, 74 tests réussis. Chaque appel utilise une instance fraîche,
  émet un résultat étiqueté, reçoit un budget enfant de 6 tours / 0,50 USD /
  16 000 tokens et refuse toujours `CONFIRMED` sans oracle. Le coût est contrôlé
  avant et après le tour.

## Résultats

### Inspection et conception

Lecture intégrale effectuée avant modification produit : rapports DELEG1 et
DELEG2, `src/agent/middleware/quality-gate-middleware.ts`, tout `src/agents/`
et tout `src/agent/dev-loop/`. Le moteur DELEG1/2 et ses tests ont également
été lus avant raccordement.

- QualityGate utilise un `ThreadTaskRunner` unique : CodeGuardian et
  SecurityReview disposent chacun de leur contexte de tâche et peuvent occuper
  deux créneaux simultanés. La limite dure est 2, tandis que le défaut hérité du
  moteur reste 1. Les événements `status`, `output`, `error`, budget et `done`
  restent étiquetés par délégué puis drainés sans bloquer l'agrégation.
- Les actions par défaut sont les actions réelles des agents spécialisés :
  `find-issues` et `quick-scan`. L'ordre et le format des résultats agrégés sont
  conservés.
- Toute exception, absence de sortie, erreur de l'agent ou fin de budget
  produit un résultat `passed: false`, un finding `high` et l'en-tête
  `INCOMPLETE REVIEW`. Une gate optionnelle défaillante ne peut donc plus
  fabriquer un vert.
- `AgentRegistry.executeOn('verifier', …)` construit désormais un
  `VerifierAgent` neuf dans un `ThreadTaskRunner`. Le budget enfant par défaut
  est 6 étapes, 0,50 USD et 16 000 tokens ; les observations sont bornées pour
  rester dans ce contexte. Le coût est mesuré en delta et contrôlé avant et
  après le tour.
- Le contexte LLM du Verifier repart toujours de ses seuls messages `system`
  et `user`. Son garde-fou historique demeure : aucune prose sans appel réussi
  à un outil-oracle ne peut produire le metadata verdict `CONFIRMED`.

### Preuve Ollama réelle

Avant l'appel, `HOME=$PWD/_qa/deleg3/home ollama ps` était vide. Le dépôt jouet
`~/DEV/cb-deleg3-2026-09-04/_qa/deleg3/toy` contenait une fonction `add`, un test
Node et son propre dépôt Git ; son test initial passait 1/1. Le harnais a appelé
le vrai `CodeBuddyClient` sur `http://127.0.0.1:11434/v1`, fallbacks désactivés,
clés distantes retirées de l'environnement, modèle unique
`qwen3:4b-instruct`. Extrait exact :

```text
[delegate:verifier:status]
FRESH_CONTEXT_ROLES=system,user
[delegate:verifier:status]
ORACLE_EXIT=0
> test
> node --test
✔ add returns the arithmetic sum (0.374288ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
[delegate:verifier:output]
[delegate:verifier:status]
[delegate:verifier:done]
LLM_TURNS=3
ORACLE_RUNS=1
DELEGATE_OUTPUT_EVENTS=1
VERDICT=CONFIRMED
EXIT_CODE=0
```

Le processus a duré 23,1 s. Après la preuve, `ollama ps` montrait uniquement
`qwen3:4b-instruct`, 100 % GPU. Aucun service n'a été lancé ou modifié.

### Vérifications finales

```text
$ HOME=$PWD/_qa/deleg3/home npx vitest run tests/agent tests/agents tests/commands
Test Files  336 passed (336)
Tests       3942 passed (3942)
Duration    20.04s
EXIT_CODE=0

$ HOME=$PWD/_qa/deleg3/home npx tsc --noEmit -p .
EXIT_CODE=0

$ HOME=$PWD/_qa/deleg3/home npx eslint <7 fichiers TypeScript touchés> --max-warnings=0
EXIT_CODE=0

$ git diff --check
EXIT_CODE=0
```

Aucun test n'a été supprimé, ignoré ou désarmé. Les répertoires HOME, TMPDIR,
cache npm, dépôt jouet et harnais de preuve restent sous `_qa/deleg3/`, ignoré
par Git. `~/code-buddy` n'a pas été écrit ; aucun push, API payante ou service.

### Commits

- `5bd7aad00` — réservation, rapport initial et HOME QA ignoré.
- `8976a0c5e` — QualityGate multiplexé, parallèle et incomplet fail-closed.
- `c6971eee7` — Verifier frais et borné via délégué ; contrôle coût après tour.

### Bilan

1. QualityGate exécute CodeGuardian et SecurityReview via le moteur DELEG1/2.
2. Deux gates applicables se chevauchent, avec une limite dure de deux.
3. Le flux est multiplexé et étiqueté ; l'agrégation publique reste ordonnée.
4. Exception, sortie absente et budget épuisé donnent `INCOMPLETE REVIEW`.
5. `executeOn('verifier')` crée un délégué neuf à chaque appel.
6. Ses étapes, son coût et son contexte sont bornés ; le coût est contrôlé en sortie.
7. La prose seule reste incapable de produire `CONFIRMED`.
8. Ollama réel : test 1/1, oracle exit 0, événement délégué, verdict `CONFIRMED`.
9. Suite imposée : 336 fichiers / 3 942 tests ; tsc, ESLint et diff-check à 0.
10. Rien ne reste ouvert dans le périmètre DELEG3 ; aucun push n'a été effectué.
