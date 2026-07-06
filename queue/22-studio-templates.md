# Vague — Nouveaux templates de projet (App Studio + agent)

Tu es GPT-5.5 (Codex). Tu ajoutes de nouveaux **starters** au TemplateEngine du noyau, pour qu'App Studio (et le tool `scaffold_app`) proposent plus de types d'apps. Worktree isolé `feat/studio-templates` — ne change pas de branche.

## Contexte
`src/templates/project-scaffolding.ts` contient `class TemplateEngine` avec des templates intégrés : `node-cli` (~:98), `react-ts` (~:270, Vite+React+TS), `express-api` (~:479). Chaque template = un descripteur (id, label, description, category, variables requises, liste de fichiers avec contenu interpolé `{{var}}`, postGenerate hooks npm install/git init). `generate()`/`generateProject()` créent le projet. `getTemplateEngine()` est le singleton.

## Tâches : ajouter 5 nouveaux templates (mêmes conventions que les existants)
Étudie d'abord la structure EXACTE d'un template existant (`react-ts`) — copie sa forme (variables, fichiers, postGenerate). Ajoute :
1. **`static-web`** : page statique HTML/CSS/JS moderne (index.html, style.css, main.js, README). Pas de build, pas de npm install (juste git init). Léger.
2. **`vue-ts`** : Vite + Vue 3 + TypeScript (package.json avec vue + vite + vue-tsc, vite.config, src/App.vue, src/main.ts, index.html, tsconfig). postGenerate npm install + git init.
3. **`svelte-ts`** : Vite + Svelte + TypeScript (package.json svelte + vite + @sveltejs/vite-plugin-svelte, vite.config, src/App.svelte, src/main.ts, index.html, tsconfig). npm install + git init.
4. **`fastify-api`** : API Node/Fastify + TypeScript (package.json fastify + tsx + typescript, src/server.ts avec une route /health, tsconfig, scripts dev/build). npm install + git init.
5. **`python-flask`** : API Python Flask (app.py avec une route /, requirements.txt flask, README, .gitignore). postGenerate = git init seulement (pas de pip install, documente-le dans le README).

Chaque template : variables minimales (projectName + les nécessaires), fichiers réels et valides (le projet doit démarrer avec la commande documentée), category cohérente (`web`/`api`/`cli`). Réutilise le mécanisme d'interpolation `{{var}}` existant.

## Contraintes
- Modifie UNIQUEMENT `src/templates/project-scaffolding.ts` (+ un fichier voisin `src/templates/extra-templates.ts` si tu préfères isoler les 5, importé dans project-scaffolding). Additif : n'altère pas les 3 templates existants. **NE TOUCHE PAS** le registry de tools, `tools.ts`, ni `cowork/`.
- TS strict, imports `.js`. `git add` explicite. NE PUSH PAS.
- Trailer :
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
  ```
  `feat(templates): add static/vue/svelte/fastify/flask starters`.
- Gate : `npx tsc --noEmit` (racine) = 0 sur tes fichiers. Si possible un smoke : `getTemplateEngine()` liste bien 8 templates. `git status` propre.

## Compte-rendu (français) : les 5 templates ajoutés (fichiers/vars de chacun), tsc, smoke (nb templates), SHA, limites. Ne pousse pas.
