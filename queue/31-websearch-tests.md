# Vague — Tests réels (no-mocks) du WebSearchTool (chaîne de providers)

Tu es GPT-5.5 (Codex). Respecte `CODEX-CONVENTIONS.md` (concaténé au-dessus). Worktree `feat/websearch-tests`.

## But
Tests Vitest **no-mocks** du `WebSearchTool` (`src/tools/web-search.ts`) via un **vrai serveur HTTP local** qui joue
Serper/SearXNG (comme `tests/tools/weather-tool-real.test.ts` le fait pour Open-Meteo — étudie-le comme modèle EXACT).
Aucun mock de transport ; on lance un `http.createServer` local, on pointe le tool dessus par env/base-url, on vérifie le
parsing et la sélection de provider pour de vrai.

## Étude préalable OBLIGATOIRE
Lis `src/tools/web-search.ts` : la classe `WebSearchTool`, la méthode `search(query, options)`, comment le provider est
choisi (env `SERPER_API_KEY`/`SEARXNG_URL`/…, l'ordre de chaîne, l'option `provider` pour forcer), et les URLs par provider
(`google.serper.dev`, `{SEARXNG_URL}/search?format=json`). Lis `tests/tools/weather-tool-real.test.ts` pour le PATTERN
(serveur local, capture des requêtes, `beforeEach/afterEach`). Reproduis-le.

## Fichier NEUF : `tests/tools/web-search-real.test.ts`
Couvre (adapte aux vrais points d'injection que tu trouves dans le code — si le tool ne permet pas d'injecter la base URL,
utilise `SEARXNG_URL` pointant sur ton serveur local, qui est la voie la plus simple et documentée) :
1. **SearXNG** : `SEARXNG_URL=http://localhost:<port>`, le serveur renvoie un JSON `{results:[...]}` → `search()` réussit,
   les titres/URLs sont parsés, `success===true`. Vérifie que la requête reçue est bien `/search?format=json&q=...`.
2. **Provider forcé** : si l'option `provider` existe, force-le et vérifie qu'il est utilisé.
3. **Échec propre** : serveur qui renvoie 500 ou du JSON vide → le tool ne throw pas, `success===false` ou fallback documenté.
4. **Query encodée** : une requête avec espaces/accents est correctement URL-encodée dans la requête reçue.
Nettoie le serveur en `afterEach`. Restaure les env modifiés.

## NE MODIFIE PAS `src/`. Fichier de test uniquement. Gate : `npx vitest run tests/tools/web-search-real.test.ts` verts
(colle la sortie). Ne pousse pas. Compte-rendu FR : cas, vitest (X passed), SHA. `test(tools): real WebSearchTool provider tests`.
