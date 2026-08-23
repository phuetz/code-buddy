# Démarrage à froid — 2026-08-23

## Résultat

Mesure sur Linux 6.17, AMD Ryzen AI 9 HX 470, Node `v24.14.1`, avec le
worktree compilé par `npm run build`. `hyperfine` n’étant pas installé, chaque
valeur est la médiane de 10 processus indépendants, mesurée avec
`process.hrtime.bigint()`.

| Parcours | Avant (ms) | Après (ms) | Évolution | Cible |
|---|---:|---:|---:|---:|
| `node dist/index.js --version` | 96,81 | 102,07 | 0,95× (bruit de mesure) | < 150 — OK |
| `node dist/index.js --help` | 88,70 | 138,25 | 0,64× (bruit de mesure) | < 400 — OK |
| `buddy try`, providerless → message | 162,86 | 146,51 | 1,11× | message immédiat — OK |
| TUI, marqueur `ui-first-render` | 838 | 494 | **1,70× / −41 %** | < 1 200 — OK |

Les deux chemins CLI courts ne passent pas par le bootstrap interactif modifié
et restent largement sous leur seuil. Leur variation avant/après est donc du
bruit de lancement de processus, pas un gain revendiqué.

## Méthode

1. `npm run build` a été exécuté avant chaque série. Aucun `npm install`.
2. Version et aide ont été lancées 10 fois avec `spawnSync(process.execPath,
   ['dist/index.js', ...])`, sortie ignorée, puis triées pour prendre la 6e
   valeur.
3. Le TUI a été lancé dans un pseudo-terminal avec :

   ```bash
   timeout -k 0.2s 2s script -qec \
     'PERF_TIMING=true CODEBUDDY_PROVIDER=chatgpt node dist/index.js --no-alt-screen --ephemeral' \
     /dev/null
   ```

   La mesure est le champ `ui-first-render` de `PERF_TIMING=true`. La référence
   utilisait le marqueur historique `ui-render`. `--ephemeral` évite la
   persistance de session ; le processus est arrêté après capture du premier
   rendu.
4. Une authentification ChatGPT existe sur cette machine. Pour tester le cas
   `buddy try` sans provider sans toucher au fichier d’authentification, la
   série utilise un preload Node éphémère qui redirige uniquement
   `os` dans `codex-oauth` vers `/codebuddy-no-home`, plus
   `OLLAMA_HOST=http://127.0.0.1:1`. La commande exacte reste
   `node dist/index.js try`, retourne le code 2 et affiche `No free provider is
   ready for the demo.` ; aucun fichier n’est créé par ce parcours.

## Profil et changement

Le profil de référence `PERF_TIMING=true` montrait deux bloqueurs avant le
premier rendu : l’import du barrel des renderers (`lazy:renderers`, environ
913 ms) et l’import du graphe `CodeBuddyAgent` (environ 815 ms). Le graphe de
l’agent inclut notamment le registre complet des outils et ses dépendances.

Le correctif :

- `src/renderers/startup.ts` ne charge d’abord que `RenderManager` ; les six
  renderers spécialisés sont importés dynamiquement et enregistrés en
  arrière-plan. Le barrel public `src/renderers/index.ts` reste inchangé.
- `ChatHistory` et `StructuredOutput` importent directement le manager et les
  types légers, sans réveiller le barrel spécialisé pendant le premier paint.
- Le CLI affiche un shell TUI minimal, puis fait `rerender` avec l’agent après
  son import dynamique. Le rendu complet, les options, le message initial et
  les tâches d’arrière-plan conservent leur chemin existant.

Le premier rendu final observé est donc inférieur à 1,2 s, tandis que l’agent
continue son initialisation derrière ce premier écran.
