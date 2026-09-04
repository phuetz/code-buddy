# Réparation IMPROVE2 — les trois points laissés ouverts par IMPROVE1

- Lane : IMPROVE2 (reprise, par Fable 5.1, d'une lane Codex arrêtée faute de quota)
- Date : 2026-09-04
- Clone : `~/DEV/cb-improve2-2026-09-04`, branche `fix/improve2-ouverts-2026-09-04`, base `7c93412ee`
- HOME temporaire : `_qa/improve2/home` (ajouté au `.gitignore`)
- Rapport d'origine : `docs/reports/2026-09/RAPPORT-IMPROVE1.md`, section « Ouvert »

## Reprise du travail en cours

`git status` montrait onze fichiers modifiés non commités et trois fichiers non suivis.
Évaluation fichier par fichier :

- **Gardé** : la bascule du scoring des outils authored vers une comparaison stricte
  (`sandbox-scorer.ts`, `tool-types.ts`, `tool-benchmark.ts`, `llm-tool-proposer.ts` et les
  trois tests mis à jour). Cohérent avec le point 2, aucun test affaibli.
- **Jeté** (`git checkout --`, fichier par fichier) : `provider-openai-compat.ts` — 234 lignes
  qui dupliquaient tout le chemin `chat()`/`chatStream()` en un client Ollama natif parallèle,
  court-circuitant la relance JSON, la pensée étendue, les métriques de tour et la
  classification d'erreur, sans test. Le besoin était réel, la forme non ; refait en un seul
  point de couture (voir point 1). `tests/config/ollama-context-override.test.ts` a suivi.
- **Jeté puis refait** : le garde-fou de `improve-command.ts` exigeait littéralement
  `CODEBUDDY_SELF_IMPROVE=auto-apply`, ce qui rendait `--apply` redondant alors que
  `types.ts` documente `--apply` comme l'escalade ponctuelle d'un opt-in déjà posé.
- **Corrigé** : `extension-forge-tool.ts` traduisait `expect_includes: string[]` en sortie
  attendue par un `join(' ')`. Un tableau joint par des espaces n'a jamais été une sortie
  exacte ; le champ public devient `expect_output: string`.

## Point 1 — `CODEBUDDY_MAX_CONTEXT` n'atteignait pas le serveur Ollama — **FERMÉ**

Re-mesuré avant de réparer : aucun consommateur TypeScript n'ignore la variable.
`getModelToolConfig()` l'applique bien au-dessus de la table déclarée et de la découverte.
C'est le **serveur** qui ne l'apprenait jamais. Mesures sur Ollama 0.30.7 :

```
POST /v1/chat/completions  {"options":{"num_ctx":4096}}      → ollama ps : CONTEXT 32768
POST /v1/chat/completions  {"num_ctx":4096}                  → ollama ps : CONTEXT 32768
POST /v1/chat/completions  {"context_length":4096}           → ollama ps : CONTEXT 32768
POST /api/chat             {"options":{"num_ctx":4096}}      → ollama ps : CONTEXT 4096
```

Le point d'arrivée compatible OpenAI ignore silencieusement `num_ctx` ; seul le point
d'arrivée natif l'honore. Ollama chargeait donc chaque modèle à sa fenêtre déclarée
complète — `qwen3:4b-instruct` à 262 144 jetons et 24 Go de VRAM pour 2,5 Go de poids.

**Correctif** : `src/codebuddy/providers/ollama-native-transport.ts` traduit la charge utile
OpenAI déjà construite vers `/api/chat` et la réponse en sens inverse, branché à **un seul**
endroit (`createChatCompletion`). Tout le reste du pipeline est intact. L'aiguillage se fait
sur l'URL de base (`:11434` / `ollama`), jamais sur le nom du modèle : LM Studio et vLLM
servent les mêmes poids et n'ont pas de `/api/chat`. Trappe de sortie
`CODEBUDDY_OLLAMA_NATIVE_CHAT=false`. La traduction couvre ce qui diffère vraiment et porte
une boucle agentique : arguments d'appel d'outil (chaîne JSON contre objet) et résultats
d'outil (`tool_call_id` contre `tool_name`, re-associé depuis le tour assistant demandeur).

**Rouge** — mutation unique `options.num_ctx` non transmis :

```
× carries num_ctx and the sampling options the compat endpoint dropped
× sends it as num_ctx on the native endpoint for a non-streaming chat
× sends it as num_ctx on a streaming chat too
× still pins the declared window when the override is unset
Tests  4 failed | 15 passed (19)
```

**Vert** après restauration : 19/19.

**Preuve réelle** (`CODEBUDDY_MAX_CONTEXT=32000`, Ollama local, HOME temporaire) :

```
=== ollama ps AVANT ===
gemma4:12b     8.0 GB   100% GPU   32768
qwen3.8:27b     25 GB   100% GPU   262144
{"result":"PONG","cost":{"total":0},"model":"qwen3:4b-instruct"}
=== ollama ps APRES ===
qwen3:4b-instruct   5.2 GB   100% GPU   32000
gemma4:12b          8.0 GB   100% GPU   32768
qwen3.8:27b          25 GB   100% GPU   262144
```

`qwen3:4b-instruct` passe de 262 144 / 24 Go à **32 000 / 5,2 Go**. La ligne `qwen3.8:27b`,
chargée au même moment par une autre lane sur le code non corrigé, reste à 262 144 / 25 Go :
témoin idéal.

Boucle d'outils réelle sur le même transport, pour prouver l'absence de régression :

```
[notification] view_file completed in 175ms
{"result":"1: bonjour improve2\n2:", ... "tool_calls":[{"function":{"name":"view_file",
 "arguments":"{\"path\":\"temoin.txt\"}"}}] ... "role":"tool","content":"Contents of ...
```

## Point 2 — scoring des outils authored par sous-chaîne — **FERMÉ**

Une sortie attendue `ok` était validée par `hello ok bye` : la porte anti-triche G3/G4 se
laissait battre par la seule verbosité. `ToolCase` porte maintenant un unique
`expectedOutput: string` et `scoreToolCases` compare après **une** normalisation déclarée
(trim + suites d'espaces réduites). Rien d'autre n'est toléré. Le schéma public
`extension_forge` suit (`expect_output: string`). Les bancs de compétences et de skills
gardent `expectIncludes` : une skill est de la prose, sa couverture est légitimement une
question de sous-chaîne.

**Rouge** — mutation unique, retour à `actual.includes(expected)` :

```
FAIL tool-gate — REJECTS output that only contains the expected value as a substring
AssertionError: expected 1 to be +0
```

**Vert** : `tests/agent/self-improvement` + `tests/tools/extension-forge-tool.test.ts` +
`tests/self-improvement` = 34 fichiers / 246 tests.

## Point 3 — `improve tools --apply` sans `CODEBUDDY_SELF_IMPROVE` — **FERMÉ**

**Mesuré d'abord**, variable absente, HOME temporaire, Ollama local :

```
Autonomy: auto-apply
Cycles: 1
  slugify: rejected (visible-fail)
No tool kept this run
exit 0
```

Le drapeau seul faisait tourner un cycle d'écriture d'outil complet en `auto-apply` et aurait
persisté l'outil dans `.codebuddy/self-improvement/` alors que l'interrupteur documenté était
fermé — c'est exactement ainsi qu'un `authored__slugify` avait fui pendant IMPROVE1.

`--apply` n'escalade désormais qu'à l'intérieur d'un opt-in explicite (`true` ou
`auto-apply`) ; sinon les quatre sous-commandes génératives (`cycle`, `tools`, `skills`,
`loop`) refusent en nommant la variable et sortent en 1, sans rien exécuter. Sans `--apply`,
tout fonctionne comme avant, en propose-only.

**Rouge** — mutation unique, garde retirée de `tools` : 2 tests rouges sur 5.

**Preuve réelle** :

```
❌ ERROR Refusing `buddy improve tools --apply`: self-improvement is opt-in and
CODEBUDDY_SELF_IMPROVE is unset. Export CODEBUDDY_SELF_IMPROVE=true (or =auto-apply)
before applying, or re-run without --apply to stay propose-only.
exit=1        (aucun fichier écrit dans le projet)

CODEBUDDY_SELF_IMPROVE=true → Autonomy: auto-apply / Cycles: 1 / exit=0
```

## Vérifications

- `npx vitest run tests/agent/self-improvement tests/config tests/context tests/commands`
  = **247 fichiers / 2 468 tests, tous verts**.
- Balayage large `tests/unit tests/codebuddy tests/agent tests/fleet tests/tools`
  = **796 fichiers / 20 356 tests** ; un seul rouge, `agent-teams` (persistance de métriques),
  vert au rejeu immédiat sans modification — instable préexistant, sans rapport avec ce lot.
- `npx tsc --noEmit -p .` = code 0.
- ESLint ciblé sur les treize fichiers touchés, `--max-warnings=0` = code 0. Réserve :
  `tests/unit/codebuddy-client.test.ts` porte quatre avertissements historiques
  (imports de types inutilisés) que ce lot n'a pas introduits et n'a pas corrigés — le bloc
  d'imports n'est pas touché par le diff.
- `git diff --check` = code 0.
- `tests/security/donnees-personnelles.test.ts` = 7 tests verts.
- Vrai `~/.codebuddy` intact : `memory.md e612eadc…`, `reminders.json 6a34fc33…`, identiques
  avant et après. `~/code-buddy` jamais écrit.
- Aucun push, aucune API payante, aucun service, aucun processus tué.

## Commits

| Commit | Objet |
| --- | --- |
| `f8cd4d0c6` | réservation de la lane, rapport ouvert, HOME QA ignoré |
| `b67ae5393` | point 2 — comparaison stricte du scoring des outils authored |
| `dcff2e7a8` | point 3 — `--apply` ne contourne plus `CODEBUDDY_SELF_IMPROVE` |
| `ec9cba55c` | point 1 — `CODEBUDDY_MAX_CONTEXT` porté jusqu'au serveur Ollama |

## Bilan (dix lignes)

1. Point 1 **fermé** : la variable était honorée côté client et perdue sur le fil ; Ollama ne
   lit `num_ctx` que sur `/api/chat`, mesuré sur quatre formulations.
2. Correctif en un point de couture, aiguillé sur l'URL et non sur le modèle, pour ne pas
   envoyer LM Studio ni vLLM sur un point d'arrivée qui n'existe pas chez eux.
3. Preuve réelle : `qwen3:4b-instruct` à 32 000 / 5,2 Go contre 262 144 / 24 Go, avec un
   témoin non corrigé à 262 144 dans la même sortie `ollama ps`.
4. Boucle d'outils réelle vérifiée sur le transport natif (`view_file` appelé, résultat
   ré-associé, réponse correcte).
5. Point 2 **fermé** : `hello ok bye` ne valide plus `ok` ; une seule normalisation déclarée,
   et les bancs de skills gardent volontairement la sous-chaîne.
6. Le schéma public `extension_forge` cesse de mentir : `expect_output` est une sortie exacte.
7. Point 3 **fermé** : mesuré d'abord (`Autonomy: auto-apply` sans opt-in), puis refus nommant
   la variable, exit 1, rien d'écrit ; les quatre sous-commandes génératives sont couvertes.
8. Une mutation par correctif, rouge collé à chaque fois ; aucun test supprimé ni désarmé,
   deux assertions Ollama déplacées du SDK simulé vers le fil réellement utilisé.
9. 247 fichiers / 2 468 tests verts sur les suites de la mission ; 796 / 20 356 sur le
   balayage large, un instable préexistant sans rapport.
10. Reste ouvert : rien sur ces trois points. Réserve unique — les quatre avertissements
    ESLint historiques de `tests/unit/codebuddy-client.test.ts`, hors périmètre.
