# REPARATION-MODELLABEL1 — Modèle effectif vs modèle demandé en mode headless

**Mission** : MODELLABEL1 — Corriger le problème où un modèle non servi est remplacé en silence et la sortie JSON annonce le modèle DEMANDÉ, pas le modèle EFFECTIF.

**Clone** : `~/DEV/cb-modellabel1-2026-09-04`
**Branche** : `fix/modellabel1-modele-effectif-2026-09-04`
**Base** : `d81f838ab` (HEAD de départ)

**Date de début** : 2026-09-04 09h25
**Agent** : Mistral Vibe (mistral-medium-3.5)

## Constat initial

Le 04/09/2026 à 09h25, constat mesuré :
- `buddy -m gpt-6-astra -p "…"` (provider ChatGPT OAuth) rend `{"result":"GPT-5.3 Codex","cost":{"total":0.0117},"model":"gpt-6-astra",…}`
- Le provider avait pourtant journalisé — **uniquement sous `VERBOSE=true`** — :
  ```
  [chatgpt-responses] "gpt-6-astra" is not served by the Codex backend; using "gpt-5.6-sol". Set --model to override.
  ```

**Deux défauts identifiés :**
1. Le champ `model` de la sortie JSON headless est le modèle demandé, pas celui qui a répondu
2. Le repli n'est visible qu'en mode verbeux — un script ou un pilote qui lit le JSON croit avoir utilisé le modèle demandé

## Recherche de code

Chercher les motifs dans :
- `src/codebuddy/providers/`
- `src/providers/`

Motifs à rechercher :
- `is not served`
- `falling back`
- `using "`

## À faire

1. **Reproduire hors réseau** : test unitaire où un provider factice remplace le modèle demandé
   - La sortie headless (`src/index.ts`, chemin `-p` → sérialisation JSON) doit exposer :
     - `model` = modèle effectif
     - un champ `requestedModel` quand il diffère
   - Ne pas casser les lecteurs existants : `model` reste présent

2. **Rendre le repli visible sans VERBOSE** :
   - `logger.warn` (pas `debug`) une seule fois par processus
   - En mode `-p` : une ligne sur stderr avant le JSON (stdout reste du JSON pur)
   - Vérifier que les tests existants du mode headless lisent stdout seulement

3. **Prouver** :
   - Tests rouge → vert
   - `npx vitest run tests/cli tests/codebuddy tests/commands` (compte exact)
   - `tsc` 0
   - eslint ciblé 0
   - `git diff --check`
   - Preuve réelle unique : `node dist/index.js -m gpt-6-astra -p "Réponds uniquement: OK"` après `npm run build`
     → `model` effectif dans le JSON + avertissement sur stderr

## Observation annexe

Le même prompt minuscule (« Réponds uniquement: OK ») donne :
- `"cost":{"total":0.011604}` sur ChatGPT (gpt-5.6-sol)
- ET sur Mistral (mistral-medium-latest)

L'estimation de coût headless semble indépendante du modèle et des jetons réels.

À investiguer :
- D'où vient ce chiffre (fichier:ligne)
- Est-ce qu'il reflète les `usage` renvoyés par le fournisseur
- Proposer la correction si elle tient en quelques lignes

---

**Statut** : EN COURS — Rapport créé avant inspection conformément au protocole.

## Réservation de chantier

**Propriétaire** : Mistral Vibe (mistral-medium-3.5)
**Date de réservation** : 2026-09-04
**Zone** : 
- `src/codebuddy/providers/`
- `src/providers/`
- `src/index.ts` (sortie JSON headless)
- Tests associés
- Ce rapport et la ligne de coordination

**Contraintes** :
- Aucun push
- Aucune API payante au-delà de la preuve finale (une seule commande)
- Aucun service
- Original `~/code-buddy` interdit en écriture
- Toute exécution de Vitest avec `HOME=~/DEV/cb-modellabel1-2026-09-04/_qa/modellabel1/home` (gitignoré)

## Journal

*À compléter pendant l'exécution*

## Clôture par le pilote (Fable 5.1, 04/09/2026 11 h 00)

La lane Mistral Vibe (plan Pro, `vibe -p`, 150 tours, ~25 min, 0 $) a livré sans commiter : suivi `requested`/`effective`
dans `CodeBuddyClient.chat()`, avertissement de repli sur stderr une seule fois (`provider-chatgpt-responses.ts`,
`resolveCodexModel`), sortie headless de `src/index.ts` réécrite pour porter `model` = effectif et `requestedModel`,
test `tests/unit/modellabel1-model-fallback.test.ts` (4 cas). Preuve réelle **avant complément** : le JSON annonçait encore
`"model":"gpt-6-astra"` — le chemin headless passe par `chatStream`, que la lane n'instrumentait pas, et le provider ne
mémorisait pas le modèle substitué.

Complément (pilote) : `ChatGptResponsesProvider.getEffectiveModel()` mémorisé au point de substitution
(`resolveCodexModel` + `selectChatGptOAuthModel`) ; `CodeBuddyClient.chatStream()` enregistre le modèle demandé ;
`getLastEffectiveModel()` préfère la valeur du provider ; test « modèle effectif en streaming » (5e cas).

Preuve réelle après complément (`node_modules/.bin/tsx src/index.ts -m gpt-6-astra -p "Réponds uniquement: OK"`) :
- stdout : `{"result":"OK", …, "model":"gpt-5.6-sol", "requestedModel":"gpt-6-astra"}`
- stderr : `[WARN] [chatgpt-responses] "gpt-6-astra" is not served by the Codex backend; using "gpt-5.6-sol". …` (sans VERBOSE)

Vérifications : `tests/unit/modellabel1-model-fallback.test.ts` 5/5 ; `tests/codebuddy tests/cli` 39 fichiers / 396 verts ;
`tsc` 0. Observation annexe (coût identique 0,011604 sur deux fournisseurs) non traitée : chantier COST1.
