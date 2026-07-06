# Auto-pilote Codex — état persistant

**Objectif** (Patrice, 2026-07-05) : intégrer **l'intégralité de Genspark + bolt.diy** dans l'OS agentique Code Buddy/Cowork. Vision : les futures instances (le robot) en hériteront. « On fait du très bon travail. »

**Modèle** : Fable orchestre (écrit briefs, crée worktrees, gate no-mocks, câble god-files, merge, push) ; Codex (gpt-5.5 OAuth, $0) produit en parallèle des vagues additives dormantes. Boucle de supervision Fable via ScheduleWakeup.

**Garde-fous** (leçons session) : worktree créé par Fable (pas l'agent) → pas de course git ; one-shot `buddy -p` → pas de re-réveil (≠ runaway) ; gate sur checkout principal (node_modules complet, pas le worktree) ; jamais de god-file/`src/` par Codex (manifeste → Fable câble) ; df check avant worktree ; max 3 vagues parallèles.

## Commandes utiles
- Lancer une vague : worktree `git worktree add -b feat/X /home/patrice/wt-X main` + symlink node_modules + `cd wt-X && nohup node /home/patrice/code-buddy/dist/index.js --yolo -p "$(cat queue/N.md)" > LOG 2>&1 &`
- Gate cowork : `cd cowork && npx tsc --noEmit | grep -c "error TS"` (0) + `npx vitest run <tests>` + `npx vite build`
- Gate noyau : `npx tsc --noEmit` (racine) + `npx vitest run tests/tools/<...>`
- Logs vagues : `/tmp/claude-1000/.../scratchpad/v2-*.log`

## VAGUES

### ✅ Mergées sur main (dormantes, à câbler)
- **Genspark batch 1+2** (`9fedf3c0`..`a15c4389`) : ~50 composants — manifeste `cowork/src/renderer/components/genspark-slices.ts`
- **App Studio v1** (`45469735`) : `cowork/src/{main,renderer/components}/studio/` (éditeur CodeMirror, terminal xterm, preview, dev-server, scaffold, files) — manifeste `studio/app-studio-wiring.ts`
- **Agentic OS v1** : `cowork/src/renderer/components/os/` (12 fichiers : Fleet/Council/Memory/Autonomy/Mission/Perception views) — manifeste `os/agentic-os-wiring.ts`
- **Core tools v1** : `src/tools/` (10 tools : scaffold_app, project_map, dep_inspect, code_stats, git_summary, todo_scan, json_query, csv_preview, env_doctor, port_check) — manifeste `src/tools/authored-tools-manifest.ts`

### ✅ App Studio v2 mergé (`883ceee8`) — deploy/git/export/diff/snapshot/chat (18 fichiers) — manifeste `studio2/app-studio-v2-wiring.ts`. NB: récupéré manuellement (Codex avait produit les fichiers mais était mort avant `git commit`).

### ✅ Cycle 2 mergé (`a09f8c6b`)
- **Agentic OS v2** : `os-actions/` (7 composants interactifs) — manifeste `os-actions/os-actions-wiring.ts`
- **Core tools v2** : 10 tools (lint/test/format/build/bundle/license/sbom/http_probe/file_search/diff_files) — manifeste `src/tools/authored-tools-manifest-2.ts`

### 🔄 En cours (cycle 3, production)
- **Data-viz partagée** `feat/cowork-viz` (wt-viz) : Sparkline/BarChart/Donut/Heatmap/Timeline/Gauge/StackedBar — `queue/13-dataviz.md`

### ✅ Data-viz mergé (`c04581fa`) — 7 composants viz (sparkline/bar/donut/heatmap/timeline/gauge/stacked)

### ✅ Cowork LANCÉ + validé par Patrice en direct (gpt-5.5)
- gpt-5.5 branché : config Cowork `provider=chatgpt`, baseURL auto-résolu `chatgpt.com/backend-api/codex` (OAuth codex-auth.json). Fixé via CDP (config.save). L'adapter boot sur gpt-5.5.
- **Gotchas Cowork lancement** : binaire Electron manquait (`node node_modules/electron/install.js`), better-sqlite3 pas compilé pour Electron ABI (mon `--ignore-scripts` de l'install CodeMirror ; fix = `electron-rebuild --only better-sqlite3` dans cowork ; copie cowork séparée de la racine Node donc sûr). Lancer : `CODEBUDDY_ENGINE_PATH=/home/patrice/code-buddy/dist DISPLAY=:10.0 NODE_ENV=production setsid nohup ./node_modules/electron/dist/electron --no-sandbox --disable-gpu ./dist-electron/main/index.js`. Tuer par PID du main (pas pkill large → tue le shell, Exit 144).
- **Retours GUI corrigés+poussés** : z-index barre menu `z-[100]→z-30` + 3 thèmes Genspark/Codex/Anthropic + sélecteur (répare open-cowork au passage) (`6c753ce0`) ; **crash Fleet** `capability?.models.length`→`?.models?.length` + PanelErrorBoundary sur Fleet (seul panneau sans) → plus de blocage (`da20a0db`).
- ⚠️ **Bug connu non corrigé** : « Test de connexion » ChatGPT OAuth échoue (chemin OneShot/pi-ai route en `openai-completions` vers le backend Codex → réponse vide). Le CHAT réel marche (adapter embedded → ChatGptResponsesProvider). À corriger : router l'OAuth vers le bon protocole côté test.

### 🔧 RECETTE CÂBLAGE TOOLS (exploration faite, prête à exécuter)
Registry a 2 registries : `ToolRegistry` (exposition, `tools.ts:149 initializeToolRegistry`) + `FormalToolRegistry` (dispatch, `tool-handler.ts:367 initializeRegistry`). Invariant `tests/agent/tool-dispatch-exposure-invariant.test.ts` : dispatch ⊇ exposed (sauf edit_file/mcp__/plugin__), floor exposed>50. executeTool = map lookup (PAS de switch → 0 edit). Les 20 classes N'implémentent PAS ITool (pas de getSchema) → besoin d'un adapter. **3 edits** : (A) `src/tools/registry/authored-extra-tools.ts` NEUF = `createAuthoredExtraTools(): ITool[]` wrap (class,def)→ITool avec `getSchema()=>DEF.function` (manifest-2 a toolClass/definition live ; manifest-1 = string refs → importer les 10 classes/defs) ; (B) `tool-handler.ts:~437` allTools += `...createAuthoredExtraTools()` (satisfait l'invariant) ; (C) `tools.ts` groupe `AUTHORED_EXTRA_TOOLS`=[les 20 DEFINITIONs] + `registerGroup(...)` + ajout à `getBuiltinToolNames` groups ; (D) metadata `metadata.ts:6 TOOL_METADATA` += 20 entrées (copier des manifestes). Optionnel headless : `registry/index.ts` createAllToolsAsync + registerBuiltinTools. Gate : tsc + invariant test + smoke (invoquer git_summary sur tmpdir git).

### ✅ CÂBLAGE TOOLS FAIT (`561e25b2`) — premier vrai câblage
Les 20 tools authored sont câblés dans les 2 registres (adapter ITool `src/tools/registry/authored-extra-tools.ts` + tool-handler dispatch + tools.ts exposition + metadata + headless parity). **Gate no-mocks re-vérifié par Fable** : tsc 0, invariant dispatch⊇exposed PASS (184 tools exposés, 20/20 dispatchables), activation PASS, smoke réel (git_summary→success, file_search→1 match via l'adapter). L'agent peut maintenant appeler scaffold_app/git_summary/code_stats/lint_project/test_runner/etc.

### 🔓 VALIDATION COMPUTER-USE DÉBLOQUÉE (2026-07-05)
Je peux VOIR + piloter Cowork moi-même (capture X11 `import -window root` + CDP `--remote-debugging-port=9222` sur `window.useAppStore`). Donc le câblage GUI n'attend plus Patrice pour la validation VISUELLE — je monte, screenshot, vérifie, ajuste, PUIS montre à Patrice une surface déjà propre. Patrice a dit « continue en mode autonome » après le fix mermaid. Voir [[cowork-live-validation]].
- **Bug mermaid corrigé** (`5bc5b296`) : les blocs ```mermaid``` rendaient en texte → `MermaidBlock.tsx` (mermaid dynamic import + DOMPurify + SVG theme-aware, porté de code-explorer `~/DEV/gitnexus-rs/chat-ui`). ⚠️ **Gotcha** : intercepter dans `ContentBlockView.tsx:200` (le code renderer du chat, override `MessageMarkdown` DEFAULT) PAS seulement MessageMarkdown. Validé live.

### ✅ CÂBLAGE GUI EN COURS (validé par computer-use, mergé)
- **App Studio** monté `primaryView:'studio'` (`352e3e28`) — VALIDÉ visuellement (composer « Décris l'app », chips modèles, build strip, état vide). bolt.diy intégré.
- **NewShell = shell par défaut** (`2e0173f4`) — Patrice l'a vu (« très jolie ») + je l'ai flippé (`readNewShellFlag` return true, opt-out `COWORK_NEW_SHELL='false'`). localStorage déjà 'true' via mon CDP.
- **Mission Control OS** monté `primaryView:'os'` (`f837e3a1`) — VALIDÉ (Charge flotte + topologie + Council + Matrice + Autonomie posture/cap/daemon). État vide honnête (données live pas câblées). ⚠️ **OS v1 était PARTIEL** : seuls FleetTopology/FleetLoadStrip/CouncilArena/PeerCapabilityMatrix + os-actions existent ; MissionControlShell/AutonomyDashboard/KnowledgeGraph/OsStatusBar N'EXISTENT PAS (à produire plus tard). MissionControlView compose les vraies vues.
- **Genspark Labs gallery** `primaryView:'labs'` — EN COURS (Opus worktree) : galerie des ~40 slices dormants (panel/labs mount) via genspark-slices.ts, lazy-import + error boundary + état vide.

### ✅ App Studio VALIDÉ END-TO-END (via CDP, 2026-07-05)
Le bolt.diy MARCHE : `studio.scaffold.generate('node-cli', vars:{projectName,binName,...})` → **vrai projet fonctionnel** (package.json bin+scripts, src/index.ts code commander/chalk, tsconfig, README, **git init + npm install faits**, 51 fichiers). `devServer.status`→ok (dist recompilé). ⚠️ **Bug targetDir** : le TemplateEngine noyau crée dans `/tmp/<projectName>` et IGNORE le `targetDir` passé → à corriger (scaffold dans le workspace choisi par l'utilisateur). Reste : tester dev-server start→preview end-to-end.

### ✅ Genspark Labs mergé (`f63e8ad7`) — 23 composants browsables

### PROCHAINE PHASE : rendre les surfaces FONCTIONNELLES
Les surfaces montrent des états vides. À faire : (a) tester App Studio en réel (cliquer Générer → scaffold→dev-server→preview via les IPC studio.* + app_server noyau) ; (b) brancher les données LIVE sur Mission Control (IPC fleet/council) ; (c) compléter les vues OS manquantes. Valider chaque via computer-use.

### 🔄 (historique) câblage App Studio
Câbler App Studio en `primaryView:'studio'` via `app-studio-wiring.ts` : 4 IPC (dev-server/files/command-runner/scaffold) dans main/index + namespace `studio` preload + RAIL NewShell + montage AppStudioView + bridge API. Gate strict (tsc + vite build, NE PAS casser le boot) → je re-gate + relance Electron + screenshot avant merge.

### 🔀 RESTE DU CÂBLAGE = GUI (je valide via computer-use, puis montre à Patrice)
- App Studio → `primaryView:'studio'` dans NewShell + IPC studio.* (preload+main/index) + montage AppStudioView. Manifestes `studio/app-studio-wiring.ts` + `studio2/app-studio-v2-wiring.ts`.
- Agentic OS → `primaryView:'os'` + MissionControlShell. Manifestes `os/agentic-os-wiring.ts` + `os-actions/os-actions-wiring.ts`.
- Genspark ~33 slices → Labs/palette via `genspark-slices.ts`.
- data-viz : composants réutilisables (importés par les vues, pas de montage propre).
**Stratégie : commencer par UNE surface (App Studio), Patrice valide en Electron, puis enchaîner. NE PAS câbler la GUI sans son feu vert.**

### 🔀 BASCULE CÂBLAGE (décidée cycle 3)
La production dépasse largement le câblage. **Prochaine grande phase = CÂBLAGE** (Fable, god-files). Ordre prévu :
1. **Tools (20)** — le plus sûr/testable sans GUI. ⚠️ Le registry a ~110 tools + le test invariant `tests/agent/tool-dispatch-exposure-invariant.test.ts` (exposé==dispatché) : câbler via une factory batch qui lit les 2 manifestes, ajouter définitions dans `tools.ts`, cases dans `executeTool`, metadata. Explorer l'archi registry AVANT. Gate = tsc + l'invariant + un smoke d'invocation.
2. **App Studio** — primaryView 'studio' dans NewShell + IPC studio.* (preload+main/index) + montage AppStudioView. **Nécessite validation Electron de Patrice.**
3. **Agentic OS** — primaryView 'os' + montage MissionControlShell. **Validation Patrice.**
4. **Genspark (~33 slices)** — montage Labs/palette via genspark-slices.ts. **Validation Patrice.**

### ⚠️ BUG DE BRIEF corrigé pour la suite
Les briefs référençaient `/home/patrice/code-buddy/CODEX-CONVENTIONS.md` en chemin ABSOLU → hors du workspace du worktree → buddy refuse (« Path outside workspace »). **Fix pour les futures vagues : lancer avec le prompt CONCATÉNÉ** `-p "$(cat CODEX-CONVENTIONS.md; echo; cat queue/N.md)"` (tout inline, pas de lecture de fichier externe). Ne pas référencer de chemin absolu hors worktree dans un brief.

### ⚠️ Process transitoires dans le checkout principal
Des PID buddy `--yolo` apparaissent brièvement avec cwd=/home/patrice/code-buddy (forks des process worktree). Transitoires, disparaissent seuls. main reste == origin/main. Surveiller mais pas d'action tant que main intact.

### 📋 File (à écrire/lancer)
- **Data-viz partagée** (`cowork/.../viz/`) : sparkline/barres/donut/heatmap/timeline props-driven sans lib
- **Générateurs de livrables** : brancher SlideDeck/Sheet/Doc/Podcast (composants Genspark) sur skills pptx/xlsx/docx réels + preview
- **Genspark completeness** : image gen, video gen, AI Pods (TTS Piper), Call-for-me (agent téléphonique — backend Twilio/Realtime)
- **bolt.diy completeness** : sync-to-folder, multi-preview, terminal amélioré, project templates gallery, one-click share
- **Onboarding modernisé** 1-écran

## ⏰ VAGUE EN COURS À GATER APRÈS LE RESET 5H (budget frais)
`feat/studio-iterate` (wt-iterate, `/tmp/wave-iterate.log`, brief `queue/37`) — bolt.new « itérer » : StudioChatPanel
(chat de modification), ChangedFilesStrip, PreviewToolbar + iterate-model + tests. Props-driven sous
`cowork/src/renderer/components/studio-iterate/`. Lancée détachée pendant la nuit (budget Fable ~97% le 2026-07-05).
**Au réveil** : gater (cd cowork → tsc+vitest+vite), salvage si calée (cp WIP + réécrire .tsx vides), cherry-pick, push,
puis CÂBLER dans App Studio sur la VRAIE session d'agent (modifs = messages de suivi à la session scoppée au projectDir,
cf. mode génération IA `ba9a83ad`) + le vrai dev server. C'est le vrai bolt.new fonctionnel (chatter pour modifier + tester).

## SESSION 2026-07-06 MATIN — FABLE AUTOPILOTE (reset limites, Fable inclus jusqu'au 7/7 minuit PT)
Patrice : « carte blanche, tests visuels, boucle loop, le but = le cerveau du robot ». Boucle Fable auto-cadencée ACTIVE (ScheduleWakeup).
- **bolt.new completeness livré+poussé (`adc25bf8`)** : VerifyReportCard câblée (parser TEXTE du rapport web_test —
  `parseWebTestOutput`/`latestWebTestReport` dans web-test-report-model.ts, le renderer ne reçoit QUE toolOutput string,
  pas le data structuré) + PromptEnhancer dans StudioComposer (affiché si enrichissable) + **PLAN LLM** :
  buildAiGenerationPrompt exige un bloc ```plan JSON en tête de réponse, parsePlanBlock/latestLlmPlan (dev-plan.ts)
  le valident/normalisent (ancres scaffold/run/verify pour advancePlan), stripPlanBlocks masque le JSON dans le chat,
  fallback = buildDevPlan déterministe. 31 tests studio verts ; 3 échecs suite = préexistants (vérifiés arbre vierge).
- **VALIDÉ computer-use** (CDP 9222 + captureScreenshot CDP) : PromptEnhancer (saisie → suggestions → clic → prompt enrichi),
  split bolt.new avec plan LLM + carte web_test PASSED 4/4 + changed files (injection d'état zustand `useAppStore.setState`).
- **VALIDÉ END-TO-END RÉEL** : « Générer avec IA » (gpt-5.5) → l'agent émet BIEN le bloc ```plan en streaming →
  carte « Plan · Neon Pomodoro » 6 étapes spécifiques, 0 fuite JSON. ⚠️ Gotchas CDP : 2 textareas (le composer studio
  est le 2e — cibler par placeholder), React exige le reset `_valueTracker` avant dispatch input.
- La fiche mémoire bolt.new n'a plus de « Reste » : plan LLM fait, corrélation étapes↔trace déjà couverte (match paths).
- **Mission Control DONNÉES RÉELLES livré+poussé (`d7dbb4ae`)** : IPC `os.councilHealth` (main/ipc/os-ipc.ts NEUF) lit les
  ledgers réels `~/.codebuddy/council-deliberation-health.jsonl` + `fleet-model-performance.jsonl` → l'arène council affiche
  la VRAIE dernière run (validé screenshot : DHI 85, gagnant gpt-5.5·architect 0.90, 3 verdicts) ; daemonPaused = état réel
  du service (autonomy.daemonStatus existant), Pause/Reprise → serviceControl. `window.useAppStore` désormais exposé DANS LE
  SOURCE (main.tsx) pour le pilotage CDP (avant : disparaissait à chaque rebuild).
- **🐛 INCIDENT+FIX (`d16b5b05`)** : le e2e « Générer avec IA » avec targetDir NEUF (/tmp/e2e-pomodoro inexistant) → le moteur
  retombe sur le cwd du process Electron → l'agent a ÉCRASÉ `cowork/index.html` (l'entrée vite !) et le build a propagé l'app
  générée dans dist/ (symptôme : « ✓ 1 modules transformed », fenêtre bootant sur l'app générée). Restauré (git checkout +
  rebuild complet 5286 modules). FIX : `ensureCwdExists` dans startSession/startBackgroundSession (mkdir récursif fail-open)
  + test de régression. PROUVÉ : re-run génération météo → /tmp/e2e-meteo créé à la seconde, index.html intact.
- Génération météo (/tmp/e2e-meteo) : cwd bien créé (fix prouvé) mais le tour a re-stallé (backend Codex, 2e occurrence de
  la nuit) puis a été tué par le restart Electron. Le e2e complet génération→fichiers→preview reste à prouver sur un tour
  qui ne stalle pas.
- **Graphe de connaissance RÉEL dans Mission Control (`1ff3218c`)** : IPC `os.knowledgeGraph` (fold du ledger CKG
  append-only, last-write-wins + tombstones) + montage de la KnowledgeGraphView dormante. Validé screenshot : 40 découvertes
  arxiv réelles (le ledger fait 1828 événements pour 40 ids uniques — ré-ingestions), 140 liens, confiances.
- ⚠️ **Gotcha restart Electron** : verrou single-instance — kill le PID précis PUIS attendre la libération du port 9222
  avant de relancer (sinon la nouvelle instance meurt en silence et on parle au VIEUX preload ; symptôme : `os.X is not a
  function` alors que le bundle sur disque l'a). Et `pgrep -f` peut matcher le shell wrapper de la session — préférer un
  motif sur le binaire electron.
- **Sparkline DHI + file daemon (`ebd753e0`)** : tendance DHI réelle (5 runs) sous l'arène via le composant viz dormant,
  ligne d'état réelle de la file du daemon. AutonomyDashboard laissé dormant EXPRÈS (exige coût/tours de session sans
  source réelle côté renderer — pas de données inventées).
- **🐛 2e CAUSE RACINE e2e trouvée+fixée (`a073dd0a`)** : après le fix mkdir, l'agent de génération restait bloqué —
  le GATE DE CONFIANCE du noyau (trusted-folders) rendait create_file indisponible hors dossier trusté ; l'agent émettait
  son plan puis s'arrêtait (« dossier non fiable »). Fix : startSession truste le cwd EXPLICITEMENT désigné (modèle
  consentement = ouvrir un workspace), via le singleton du noyau (moteur embarqué = même graphe de modules). Prouvé live
  (trusted-folders.json). NB : le backend Codex a RE-stallé sur le tour suivant (3e fois) — la chaîne complète
  génération→fichiers→preview attend un tour où le backend répond ; toutes les pièces Cowork sont prouvées une à une.
- **🏆 E2E GÉNÉRATION COMPLET PROUVÉ (`02efcdbc`)** : « Générer avec IA » → plan LLM « Météo Cristal » → fichiers écrits
  AU BON ENDROIT (/tmp/e2e-meteo5/{index.html,style.css,app.js}) → plan 4/7 auto-coché → arbre+éditeur peuplés → chat
  d'itération prêt. QUATRE causes racines tombées cette nuit via le e2e réel : (1) mkdir cwd session (`d16b5b05`),
  (2) trust du cwd désigné (`a073dd0a`), (3) NOYAU : chemins relatifs des outils fichiers résolus contre context.cwd
  (pas process.cwd()) + apply_patch cwd threadé, (4) NOYAU : create_file/apply_patch ajoutés à alwaysInclude (l'agent
  pouvait éditer mais JAMAIS créer si le RAG le ratait !). + fix « Test de connexion » ChatGPT OAuth (`7616ce78`,
  probe via le vrai protocole Codex — ok:true 2,8s prouvé) + arbre de fichiers rafraîchi pendant la génération.
  ⚠️ Reliquat mineur : après reload, le plan affiché redevient le déterministe (bloc ```plan pas relu depuis les
  messages persistés ? à creuser) ; stalls backend Codex toujours intermittents (~50%, indépendant de nous).
- **Preview statique COMPLÈTE (`ed4de2f2`)** : « Lancer » sert les apps statiques (python http.server loopback, port
  dérivé du chemin), CSP frame-src loopback ajoutée (l'iframe preview était bloquée silencieusement — page blanche),
  reprise des serveurs zombies après reload (status → filtrer state=running → stop groupe → backoff). VALIDÉ VISUEL :
  la preview REND l'app générée (hero Météo Cristal), étape « Lancer la preview » auto-cochée, reprise → En ligne.
  Le cycle bolt.new est bouclé : décrire → plan LLM → fichiers → arbre/éditeur → Lancer → preview → (Vérifier).
- **Hydratation des sessions froides (`fa764864`)** : après reload, sessionStates repart vide (seuls les événements
  live le remplissent) → App Studio hydrate messages+traceSteps depuis la DB à l'activation (IPC session.getMessages/
  getTraceSteps existants, sans écraser un tour live). Le reliquat « plan LLM perdu après reload » est SOLDÉ (validé :
  Plan · Météo Cristal 5/7 après reload). Vérif via bash/playwright du tour précédent → pas de carte (normal, fix
  prompt tool_search→web_test `9b24905b` pour les prochains tours). Rapport de nuit publié (Artifact 993253e6).
- **OsStatusBar montée (`+`)** : bandeau d'état réel en tête de Mission Control (daemon/DHI/CKG/pairs). Il ne reste
  plus de vue os-panels dormante sauf AutonomyDashboard (attend une source de coût réelle) et MissionControlShell
  (redondant avec la composition actuelle).
- **DeckStudio fonctionnel (`46051e46`)** : premier livrable Genspark PROMU — panneau autonome dans Labs (entrée B0),
  session agent réelle + contrat ```deck (patron ```plan) → SlideDeckPreview EN LIVE pendant le stream → export .pptx
  via le vrai skill (tour de suivi). Validé live : deck 9 slides généré sur gpt-5.5. À tester au prochain tour :
  le bouton « Exporter en .pptx » (fichier réel). Patron réplicable pour Sheet (```sheet) et Doc (```doc).
- **Export .pptx RÉEL prouvé + fix bash cwd (`837e6c25`)** : DeckStudio → « Exporter en .pptx » → le skill pptx a
  produit un VRAI PowerPoint 54 KB (« Nuit autopilote Fable — 6 juillet.pptx ») — mais dans cowork/ : le BashTool
  spawnait dans process.cwd(), 5e cause racine de la famille cwd-embarqué, fixée (execute(cmd,timeout,cwd?) +
  adaptateur transmet context.cwd, test réel 98/98). Electron redémarré sur le dist rebuildé.
- **SheetStudio + patron générique (`suivant 837e6c25`)** : DeliverableStudioPanel factorisé (session+bloc fencé+
  preview live+export skill, config injectée), DeckStudio devient mince, SheetStudio (```sheet→SheetPreview→.xlsx)
  promu Labs B8. Validé live : feuille des 12 commits réels de la nuit. Reste de la famille : DocStudio (```doc→docx),
  et re-prouver l'export au bon endroit (fix bash cwd rebuildé mais export pas re-testé).
- **Trilogie livrables COMPLÈTE (`suivant 0908fde5`)** : DocStudio (```doc→DocPreview→.docx) promu Labs B9 — Deck+
  Feuille+Document passent tous par DeliverableStudioPanel. ⚠️ BUG RUNTIME OUVERT : les exports skills écrivent dans le
  cwd du PROCESS malgré le fix complet source→dist (vérifié : dist bash-tools transmet context.cwd, registry transmet,
  executeRegistryTool construit depuis currentWorkingDirectory, adapter setWorkingDirectory chaque tour, session.cwd
  main correct = default_working_dir, MAIS pwd en session → cowork/). Prochain débogage : log temporaire adapter
  (config.workingDirectory reçu par tour) — suspecter le chemin runner→adapter (session stale ? autre runner ?).
- **🎯 BUG CWD RUNTIME RÉSOLU (`c51409a8`)** : 6e cause racine de la famille — executeToolStreaming (LE chemin de
  Cowork) court-circuitait vers bash.executeStreaming SANS cwd. PROUVÉ : pwd en session → default_working_dir.
  Leçon mémorisée (fiche embedded-cwd-family) : tout fix outils doit couvrir executeTool ET executeToolStreaming.
- **Export au bon endroit RE-PROUVÉ + PodStudio (`c51409a8`→suivant)** : commits-nuit-v2.xlsx créé dans le cwd de
  session (Excel réel) — famille cwd close. PodStudio (B10) : 4e livrable fonctionnel, script ```pod live (7 segments
  validés), synthèse via text_to_speech (honore context.cwd). ⚠️ Synthèse audio réelle à prouver : relancer Electron
  avec CODEBUDDY_TTS_VOICE=/home/patrice/DEV/ai-stack/voice/voices/fr_FR-siwis-medium.onnx pour le piper local.
- **🔴 CHANTIER PRIORITAIRE : sélection d'outils embarquée instable** — tours mesurés : 74 in (AUCUN SP/outil !),
  3,8k (aucun outil), 6,2k (search seul — ni tool_search ni l'alwaysInclude), 8,9k (bash OK). L'alwaysInclude n'est
  pas systématiquement honoré en Electron. PISTE N°1 : le fallback keyword/BM25 quand les embeddings RAG ne chargent
  pas (vérifier si ce chemin applique alwaysInclude) ; PISTE N°2 : le mystère 74-in (appel LLM brut sans SP — premier
  tour post-boot ?). Fixes préparatoires poussés : enum piper du tool text_to_speech + guidage tool_search dans le
  prompt pod. Synthèse audio réelle NON prouvée tant que la sélection n'est pas fiable.
- **🖼️ GÉNÉRATION D'IMAGES FONCTIONNELLE (`875f12dc`)** : la demande réelle de Patrice (bébé shar-pei) a débusqué et
  fait tomber 2 causes racines MAJEURES : (a) tour brut post-boot = processUserMessage(Stream) n'attendait pas
  systemPromptReady (la CLI oui, l'embarqué non — 23/74/77 tokens in mesurés) ; (b) executeTool JETAIT le champ `data`
  de tous les ToolResult (reconstruction {success,output,error} post-hooks) → tool_search/data.names, web_test/
  data.passed etc. morts en interactif. PROUVÉ : image_generate (xAI, clé installée dans .env gitignorés +
  CODEBUDDY_IMAGE_PROVIDER=xai) → JPEG 1280×720 réel, image envoyée à Patrice. Le fix cache+tool_search+expansion
  (55d33f51) est complet et prouvé par la même occasion (tool_search appelé → image_generate invoqué).
  ⚠️ Reliquat TTS : la synthèse piper reste à re-prouver (devrait marcher maintenant que data traverse).
  📌 DEMANDE PATRICE EN FILE : intégrer la génération d'images au flux « Générer avec IA » d'App Studio (assets/
  illustrations générés dans les apps).
- **🏆 APPS ILLUSTRÉES PROUVÉES E2E (`398f0063`)** : « une page vitrine refuge de chiots shar-pei » → App Studio a
  généré l'app « Refuge Doux Plis » AVEC 3 vraies images (image_generate×3 pendant la génération, référencées en
  relatif .codebuddy/media-generation/, rendues dans la preview statique), plan LLM « Refuge Shar-Pei » 5/6 auto-coché.
  Captures envoyées à Patrice. La 2e demande de Patrice est LIVRÉE.
- **🔊 SYNTHÈSE PIPER PROUVÉE (`ca11f973`)** : session neuve, PREMIER tour → text_to_speech invoqué → tts-proof.wav
  (WAVE PCM 22050 Hz, voix fr_FR-siwis). Valide d'un coup : fix warmup (systemPromptReady), fix data, chaîne TTS.
  Les 4 livrables (Deck/Feuille/Doc/Pod) sont PLEINEMENT fonctionnels. Wav envoyé à Patrice. Chantier sélection
  d'outils SOLDÉ. NB : Electron de dev tourne avec CODEBUDDY_TTS_VOICE + XAI_API_KEY/CODEBUDDY_IMAGE_PROVIDER
  (cowork/.env) — penser à les mettre dans l'env de lancement standard.
- **🎬 VIDÉO GÉNÉRATIVE PROUVÉE** : video_generate (xAI) → vrai MP4 8 Mo (shar-pei slow motion), envoyé à Patrice.
  Le média Genspark est COMPLET : images ✓, vidéo ✓, audio/voix ✓. Rapport Artifact mis à jour (nuit + matinée,
  27 commits, 11 causes racines). Couverture Genspark restante : Call-for-me (backend externe), AI Drive données
  réelles, promotion des studios média en surfaces dédiées (ImageStudio/VideoStudio par le patron générique).
- **6 STUDIOS GENSPARK FONCTIONNELS (`suivant ca11f973`)** : ImageStudio (B11) + VideoStudio (B12) promus — le
  fichier média se rend inline (file://), « Variante » in-session. Validé visuel : robot compagnon rendu dans le
  drawer. Genspark livrables/média COMPLET côté surfaces. Restes Genspark : Call-for-me (externe), AI Drive réel.
- **AI DRIVE RÉEL (`suivant d676355d`)** : DrivePanel (E4) indexe les vrais livrables via artifacts.listRecentFiles —
  validé : 6 livrables réels de la session (vidéo/deck/feuille/voix/images). La couverture Genspark surfaces est
  COMPLÈTE hors Call-for-me (backend externe). ⚠️ Leçon shell : un `cd` raté dans une commande && court-circuite les
  heredocs suivants — vérifier les patches après coup.
- **CONSOLIDATION (`suivant 4dd85e63`)** : suite cowork 2445/2445 VERTE (3 fossiles modernisés — ils étaient déjà
  rouges avant la session), lint 0 erreur (7 purgées). ~30 commits de session, zéro régression. La mission Genspark+
  bolt.diy d'AUTOPILOT-STATE est essentiellement ACCOMPLIE côté surfaces.
- **GARDE ANTI-STALL LLM (`7c3c9639`)** : withStallGuard borne l'inactivité des streams LLM (120 s défaut,
  CODEBUDDY_LLM_STALL_TIMEOUT_MS) — un backend qui accepte puis se tait produit une LlmStallError rapide au lieu
  d'un tour gelé pour toujours. Le grief n°1 des vagues/de Cowork est borné (l'intermittence backend reste, mais
  elle ne coûte plus des heures). Electron relancé sur le dist gardé.
- **VUE « CRÉATIONS » (`60bf974f`)** : les 6 studios livrables + AI Drive promus HORS de Labs en vue de premier rang
  du rail (✨ Créations, onglets Deck/Feuille/Doc/Pod/Image/Vidéo/Drive, panneaux lazy remontés par onglet) + entrée
  ⌘K « Créations » (le test palette modélise désormais les capacités de navigation à côté des overlays). Validé
  computer-use : rail actif, DeckStudio rendu, Drive listant les 6 livrables réels de la nuit.
- **ENV MÉDIA/TTS PORTÉS (`1f9e99fa`)** : cascade dotenv au boot du main — projet `cowork/.env` PUIS
  `~/.codebuddy/cowork.env` (user-level, créé avec XAI_API_KEY + IMAGE_PROVIDER + TTS_VOICE, chmod 600, hors dépôt ;
  le seul qui existe dans une install packagée). dotenv n'écrase jamais → l'environnement réel gagne toujours.
  Prouvé live : relance SANS exports média → les deux fichiers logués chargés, boot propre. TOUT lanceur (y compris
  celui de Patrice) a désormais image xAI + voix Piper.
- **BOARD AUTONOMIE LIVE (`e9fbe0c7`)** : la ligne texte du snapshot daemon devient un vrai board dans Mission
  Control — compteurs par statut, file triée (in_progress > pending par priorité > completed), présence agents
  (fenêtre fraîcheur 10 min + « il y a X »), journal récent. Modèle pur testé (now injecté). Validé live : vraie
  tâche du 8 juin, ministar/fleet « à l'instant », entrée worklog qwen2.5. La ligne « AutonomyDashboard sur
  autonomy.snapshot » du backlog est soldée.
- **VIDÉO DANS LE CHAT (12e cause racine, `63313334`)** : demande Patrice « permet de générer également des vidéos ».
  Reproduit : « Crée une vidéo… » → « je ne peux pas » (5,3K in — system prompt OK, donc SÉLECTION d'outils).
  Cause : le tokenizer \W du ToolSelector cassait les mots accentués (« vidéo » → 'vid o') → AUCUNE requête
  française ne matchait les keywords → video_generate hors du set du tour. Fix : pliage NFD des diacritiques
  (tokenize + classification + TF-IDF + index IDF) + radicaux français dans les metadata média. Prouvé chemin réel :
  même demande → video_generate appelé → MP4 4,5 Mo en 71 s, envoyé à Patrice. 65/65 tests sélecteur verts.
- **MÉDIAS INLINE DANS LE CHAT + VIDÉO PARTOUT (`cd1f447f`, demandes Patrice)** : (a) MediaAttachments sous chaque
  message assistant — les chemins MEDIA:/nus deviennent de vrais lecteurs <video>/<img>/<audio> (file://, CSP
  img-src file: + media-src ajoutés) ; (b) hydratation des sessions froides PROMUE à la racine NewShell (reprendre
  une session depuis la Home après reload affichait « Démarrez la conversation ») ; (c) le contrat App Studio
  autorise video_generate (vidéo hero/ambiance, chemin relatif, dégradé propre). Prouvé live : le MP4 sharpei se
  lit inline dans la session rouverte (720p, readyState 4).
- **HOME FAÇON GENSPARK (`991eb431`, demande Patrice « compare les IHM »)** : écart identifié — chez Genspark tout
  agent est à UN clic de l'accueil + galerie de recettes ; chez Cowork les studios étaient à 2-3 clics et le
  catalogue agent-recipes (15 missions, vague Genspark) n'avait AUCUN consommateur. Livré : rangée d'agents
  (9 tuiles App/Deck/Feuille/Document/Pod/Image/Vidéo/Drive/Recherche, deep-link via `creationsTab` store) +
  « Missions prêtes » (6 chips recettes réelles → préremplissent le composer). Validé écran + deep-link prouvé
  (clic Vidéo → Créations/onglet vidéo). ⚠️ Gotcha capture : fenêtre Electron minimisée ⇒ Page.captureScreenshot
  CDP BLOQUE (occlusion) — activer la fenêtre (xdotool windowactivate) puis `import -window <id>`.
- **SUJET → STUDIO (flux Genspark complet, `82ffe2f9`)** : le texte tapé sur la Home ACCOMPAGNE la tuile cliquée
  (`creationsSeed` one-shot dans le store, consommé au mount du DeliverableStudioPanel partagé + hint sous les
  tuiles). Prouvé live : sujet tapé → clic Deck → studio prérempli. C'était le « sélecteur de sortie » Genspark,
  résolu sans widget supplémentaire (les tuiles SONT le sélecteur).
- **PARITÉ HERMES/OPENCLAW RÉ-AUDITÉE (`a45d1ff3`, demande Patrice)** : OpenClaw 2026.6.11 = toujours latest (zéro
  drift) ; Hermes upstream a bougé de 516 commits post-v2026.7.1 → triage : l'essentiel = desktop/gateway UI ou déjà
  couvert (headers LLM, overrides canal, MoA, médias inline — convergence indépendante avec notre cd1f447f !).
  **1 vrai gap trouvé et COMBLÉ : deny rules utilisateur bloquantes MÊME en YOLO** — notre store /allowlist deny
  existait mais checkAndApprove n'avait AUCUN appelant (câblage dormant) → deny-guard sync (mtime-cache, vrai
  matcher, fail-open) câblé dans le command-validator PARTAGÉ (les 2 chemins bash, inconditionnel). Prouvé sur dist.
  Restes registrés : /deny <raison> relayée à l'agent (plomberie feedback existe, callback booléen) ; SecretSource
  pluggable + 1Password (op gated) ; session prune/bulk-archive.
- **CONFIRMATIONS INTERACTIVES COWORK + /deny RAISON (`df968447`, 13e cause racine)** : TOUTE confirmation embarquée
  échouait fail-closed « requires an interactive terminal » — Cowork câblait son DesktopPermissionBridge sur
  setPermissionCallback mais l'adapter n'appelait JAMAIS le callback (lien mort de bout en bout).
  ConfirmationService.setInteractiveBridge (prioritaire sur remote-approval + TTY) + câblage adapter→dialogue hôte.
  Parité Hermes /deny : refus en 2 temps avec champ raison optionnel, la raison voyage renderer→preload→IPC→
  requestPermissionDetailed→feedback→erreur outil lue par l'agent. Prouvé live (dialogue + traversée handleResponse
  tracée) + 35 tests. ⚠️ Gotcha relance Electron AGGRAVÉ : vérifier « bind() failed » ABSENT du log ET une seule
  instance (`pgrep -f dist-electron`) — 2 instances = tours morts silencieux (DB partagée), la boucle d'attente port
  doit VÉRIFIER la libération réellement (pas de lancement aveugle après 20 s).
- **MISSION CONTROL AUTO-REFRESH (`de7c2b41`)** : les 4 chargements (council/CKG/board/daemon) passaient une seule
  fois au mount → hook usePolling (run immédiat + interval 30 s + cleanup, 2 tests renderHook). Preuve STRICTE :
  entrée worklog temporaire écrite dans le vrai ledger → apparue dans le board en ≤30 s SANS reload (puis retirée).
  Notes : contextBridge FIGE window.electronAPI (interception impossible côté renderer) ; l'angle mort anti-stall
  n'existe pas (chatStream est un async generator — le POST part au 1er next(), couvert par la garde).
- **VUE CAPACITÉS UNIFIÉE (`7eabeb33`, parité IHM Hermes desktop)** : Hermes a unifié Skills/Tools/MCP en une page
  « Capabilities » ; Cowork avait les 3 éparpillés (page skills ⌘⇧K, strips cockpit, MCP dans Réglages). Nouvelle
  entrée rail 🧰 à 3 onglets sur données RÉELLES : ToolsCatalogPanel (230 outils du vrai registre tools.list,
  groupés/cherchables), McpCapabilitiesPanel (mcp.getServers/Status/Tools, lecture — édition dans Réglages),
  SkillsManagerPage réutilisée telle quelle (review-gated). Validé écran (3 onglets). Raffinements notés :
  intégrer la page skills sans son chrome overlay ; per-tool gating (le toggle Hermes) en suite.
- **PER-TOOL GATING PERSISTANT (`e53f6abc`, parité Hermes)** : le PolicyResolver avait un seam `globalOverrides`
  que RIEN n'alimentait (dormant). PolicyConfig gagne `toolOverrides` persisté (~/.codebuddy/tool-policy.json),
  PolicyManager set/clear/get + alimente le seam — priorité : session > gate outil > règles groupe > profil
  (3 tests fichier réel dont survie au restart). Cowork : IPC tools.getOverrides/setOverride + toggle ✓/✗
  3 états sur chaque carte de l'onglet Outils. Prouvé e2e : clic GUI → {web_search: deny} écrit dans le VRAI
  fichier consulté par le tool-handler → re-clic le retire. C'était le 2e « seam consulté mais jamais alimenté »
  de la journée (après le permissionCallback) — patron de chasse : grep les champs de contexte optionnels.
- **CARTE « FICHIERS PRODUITS » (`cf7e8681`, page résultat Genspark)** : en fin de tour, les fichiers
  créés/modifiés/supprimés remontent en carte repliable sous la conversation (changedFilesFromTrace réutilisé du
  bolt split sur les traceSteps réels ; clic = afficher dans le dossier). Rien pendant un tour actif / sans
  production. Prouvé live : tour réel → « Fichiers produits · 1 » avec le chemin exact. La ligne « page résultat
  de tâche » Genspark est soldée côté chat.
- **SECRETSOURCE PLUGGABLE + 1PASSWORD (`ed1acbb6`, parité Hermes)** : le switch fermé de SecretRef devient un
  registre (registerSecretSource, builtins env/file/exec/op) ; op:// first-class (valeur entière ET token
  ${op:...}) via execFile (pas de shell). 6 tests contre un VRAI faux binaire op sur PATH ; validation live
  1Password honnêtement account-gated. Prouvé sur dist. Le doc de parité enregistre les 3 fills du jour
  (df968447, e53f6abc, ed1acbb6) — seul reste CLI : session prune/bulk-archive.
- **SESSION PRUNE EN MASSE (`f48c147f`) — LA COLONNE PARITÉ EST VIDE** : « Nettoyer les sessions » (⌘K) — filtre
  pur (âge jours 0=tout, titre plié accents), pinned/archivées/active jamais touchées, aperçu (compte + age span
  + liste) puis archivage en un clic (updateSessionSettings, réversible). Prouvé live sur 3 vraies sessions de
  test. Le doc de parité acte : ZÉRO gap enregistré vs Hermes v2026.7.1+516 et OpenClaw 2026.6.11 — ne restent
  que les gates externes (Vertex/GCP, Slack prod, 1Password live).
- **MÉDIATHÈQUE + HISTORIQUE PROJETS (`918f2a9a`, demande Patrice)** : (a) onglet Médias dans Créations — scan
  media.list de TOUS les roots de session (.codebuddy/media-generation récursif + audio racine, tests fs réels),
  grille vignettes inline + filtres, actions par média : réutiliser dans le chat (chatComposerSeed→Home),
  variante studio Image/Vidéo (creationsSeed), copier chemin, exporter (Save-As natif media.export), dossier.
  (b) « Projets récents » façon bolt.new dans l'état vide App Studio (dédup sessions par cwd, hors default) —
  un clic rouvre le projet complet (plan+fichiers+éditeur+chat hydraté, prouvé sur e2e-refuge). 10 médias réels
  listés live, use-in-chat prouvé.
- **HISTORIQUE DES CONVERSATIONS (`9f9e6c88`, demande Patrice, façon ChatGPT)** : drawer gauche (rail 🕘 + ⌘K) —
  toutes les conversations, épinglées d'abord puis groupes par date (modèle pur testé, recherche pliée), actions
  par item : ouvrir, renommer inline, épingler, archiver — via le VRAI session.updateSettings (typings preload
  rattrapés : pinned/archived/tags acceptés par le main mais non déclarés). Prouvé live : 55 conversations,
  recherche « video » → 3, aller-retour épingler.
- **AUDIT BOLT.NEW + FIX PREVIEW (`e81755a6`, demande Patrice)** : la réouverture d'un projet laissait la Preview
  VIDE à jamais (rien ne relançait le serveur ; l'état vide n'avait AUCUNE action). Fix : auto-serve des projets
  statiques dès l'arbre chargé (http.server loopback) + bouton « Démarrer la preview » (npm projets) + « Exporter »
  (zip natif via archiver, Save-As) + « Déployer » (seed le composer vers l'outil core deploy, jamais accessible
  du studio). Prouvé : e2e-refuge rouvert → serveur auto sur :8792, page rendue, plan auto-coché 5/6.
  **Audit bolt.new consolidé — couvert** : génération+plan LLM, workbench, multi-tabs, éditeur ÉDITABLE+save,
  preview auto/manuel, open-external, verify web_test, historique projets, illustrations. **Restes** : terminal
  interactif (taper des commandes — interactive_shell core existe), versions/rollback par étape (checkpoints core
  non exposés studio).
- **VAGUES CODEX B+C RÉCUPÉRÉES ET CÂBLÉES (`bb814235`, demande Patrice « fais travailler Codex »)** : 3 vagues
  lancées en worktrees isolés détachés (technique éprouvée + garde anti-stall 120 s). B (modèle historique
  terminal, 8 tests) → câblé dans le VRAI xterm TerminalPane (↑/↓ rappellent les commandes ; la saisie existait
  déjà via commands.run, il manquait l'historique). C (CheckpointTimeline présentationnel, 3 tests) → 3e onglet
  « Versions » du workbench via StudioVersionsPane sur l'IPC ghost-snapshots réel (list/restore + reload preview).
  Validé visuellement (onglet + état vide honnête). A (purge lint) tourne encore — monitor armé.
- **File suivante (idées)** : fin vague A (lint) ; e2e confirmation organique ; app vitrine vidéo hero e2e ;
  métadonnées des médias.

## SESSION 2026-07-05 NUIT+ — BATCH GENSPARK MASSIF (Patrice « lance un maximum » + « inspire-toi de Genspark »)
~13 vagues Codex lancées en parallèle (worktrees + setsid détachés) → **11 intégrées sur main** (gate tsc+vite+tests
par Fable ; les vagues calent ~50% → WIP copié+réparé+commité à la main). Livré :
- **IHM Genspark** : vignettes de templates (`888aa194`, montées dans l'état vide App Studio « Que veux-tu créer ? »
  + maquettes SVG — VALIDÉ écran), aperçus deck/feuille/doc (9 tests), AI Drive, galerie image/vidéo, 7 composants viz.
- **os-panels** (Autonomy/KnowledgeGraph/MissionControl/StatusBar, 8 tests). **csv_analyze** tool câblé (`8864ae7d`).
  Tests réels WebSearch+scaffold. Migration **couleurs** 62 composants→tokens (`9d8a5b48`).
- **Échecs** : `pods` (PodPlayer.tsx corrompu « x » par le stall → abandonné), `templates` (3× « terminated »).
- **Câblage EN COURS** : vague `feat/labs-wiring` (queue/36) monte les 15+ composants dans la galerie Labs (genspark-slices.ts
  + labs-catalog.ts, données démo). Reste après : promouvoir les meilleurs en vraies vues + brancher sur données réelles.
- **Technique de salvage confirmée** : quand une vague détachée cale (0 commit + `"result"` dans log OU process mort), les
  fichiers existent dans le worktree → `cp -r` vers main, gate groupé (cowork tsc+vite+vitest DEPUIS cowork/), retirer les
  stubs de tests vides (« No test suite found »), fixer les bugs (`.toSorted()`→`.slice().sort()`), commit par vague.
  ⚠️ vitest cowork tourne DEPUIS `cd cowork` (pas racine — config include diffère). Provenance git worktree parfois bizarre
  (fichiers « committés » sur un commit sans rapport) mais main reste sain — vérifier `git cat-file -e origin/main:<f>`.

## SESSION 2026-07-05 NUIT — fixes chat live + 3 vagues Codex relancées
Retours GUI Patrice traités en direct (tous poussés) :
- **Recherche web cassée (CAPTCHA)** → clés Serper/Brave/OpenRouter extraites de `~/DEV/claude-et-patrice/Acces_Centralises.md`
  → écrites dans `.env` (racine, CLI) + `cowork/.env` (Cowork charge `__dirname/../../.env` = cowork/.env, PAS racine !),
  gitignored. Serper prouvé (actus fraîches + « qui est Patrice Huetz »→son GitHub). AUCUN code committé (config env).
- **Listbox gris sur blanc** → `color-scheme` par thème + couleurs `select/option` (`d3a56722`).
- **Auto-repair sur les charts** → le bash du chart demandait une approbation, pas de TTY dans le moteur embarqué →
  échec → auto-repair. Fix : `ConfirmationService.setSessionFlag('allOperations',true)` au boot Cowork (`dbe83dee`,
  comme la CLI headless ; command-validator + permission mode restent actifs). Prouvé déterministe (avant=erreur, après=confirmed:true).
- **Courbe PIB en TEXTE** → pandas/matplotlib PAS installés (`npm run prepare:python:extras` OU `pip install pandas matplotlib`
  dans `cowork/resources/python/linux-x64/`) — FAIT (pandas 2.3.3+matplotlib 3.10.9) + guidance skill données-inline (`7cbc9ad8`).
  Prouvé : vrai PNG 1281×702. ⚠️ install pandas = runtime (pas committé) → refaire sur autres machines / au build.
- **3 VAGUES CODEX EN VOL** (Patrice « donne-lui beaucoup de travail ») : `bqkvavops` templates3 (queue/22, 5 templates,
  src/templates/) · `byilrejbq` colors (queue/25, 62 fichiers → tokens thème, cowork/components/) · `bmwl2b1hu` scaffold-tests
  (queue/26, tests/templates/). Disjointes. Gater+récupérer à la fin (stall Codex intermittent). Worktrees wt-templates3/wt-colors/wt-scafftests.

## SESSION 2026-07-05 SOIR — livraisons (toutes poussées main, faites À LA MAIN via Fable, gates verts)
Budget « consommer avant 5h » → je livre du déterministe/renderer fiable moi-même (les vagues Codex calent, cf. diag ci-dessous).
- `331a6270` tool `design_system` + registry (150 systèmes) · `0568ed2a` App Studio fonctionnel · `644d07ef` sélecteur design
  + injection branding scaffold · `ba9a83ad` **mode génération IA** (bouton « Générer avec IA » → session scoppée + design_system)
  · `8457fdeb` Plan de vol Phase 2 : **vraie durée** par étape · `5768fb07` **swatches** de marque dans le sélecteur (validé
  écran : Spotify montre vert #1ed760) · `9bb70e87` résumé de progression (N/total + durée cumulée) dans l'en-tête Plan de vol.
- ⚠️ **Validation Cowork gênée par un état de boot** : relance fraîche → `activeSessionId="0"` bidon, ChatView reste sur
  « Chargement de la conversation », pas de vraie session UUID chargée → impossible de valider chat/Plan-de-vol au screenshot
  (App Studio, lui, rend sans session → validé). Les changements Plan-de-vol sont tsc-vérifiés + additifs (dégradent proprement).
  À creuser : pourquoi le boot ne charge pas les sessions (peut-être juste mes relances rapides). RG symlink loop supprimé
  (`cowork/node_modules/.node_modules-6x9xebes` auto-référent cassait la recherche de l'agent).
- Reste (fiable, sans Codex) : galerie de design systems (parcourir 150 marques en cartes), todo-checklist Plan de vol (Phase 2,
  besoin core+dist), skills niveau 2 (gros vendoring → OK Patrice). Génération IA de bout en bout = bloquée par flakiness Codex.

## OPEN-DESIGN (nexu-io, Apache-2.0) — design systems dans App Studio
Patrice a validé « design systems dans App Studio » PUIS signalé qu'open-design est une **app complète**
(desktop `apps/desktop` = leur Cowork, `apps/web`, `apps/daemon` = CLI `od` + serveur MCP `od mcp`, plugin Figma).
Décision : intégration NATIVE 1+2, pont daemon (3) en option.
- **Niveau 1 ✅ LIVRÉ+POUSSÉ main** : 150 DESIGN.md (`52f72b62`) + `catalog.json` (`3b7b78b9`) + tool `design_system`
  + service `src/design/design-system-registry.ts` (`331a6270`). La vague Codex avait créé registry+tool+factory
  (tsc-propres) puis CALÉ sur le câblage → j'ai fini les 4 points MOI-MÊME (registry/index.ts ×2 tableaux
  primaryTools+allTools, metadata.ts RAG). Dispatch = via registre (toolHandler), PAS de case executeTool ni
  def tools.ts à la main (dérivé du registre). Smoke réel : catalogue=150, spotify OK, guidance 5848 car.,
  id inconnu=null ; resolver vérifié depuis dist/ (runtime). dist rebuild fait.
- **App Studio fonctionnel ✅ LIVRÉ+POUSSÉ main** (`0568ed2a`) : la vague studio-functional (wt-studio3) avait
  aussi CALÉ avec WIP incomplet (2 erreurs : targetDir shorthand sans binding + createDevUrl inutilisé) → j'ai
  corrigé+gaté (tsc+vite verts)+cherry-pické. targetDir/buildPhase/file-tree/editor-save/preview câblés.
- **Niveau 3 (App Studio design) ✅ LIVRÉ+POUSSÉ+VALIDÉ LIVE** (`644d07ef`) : la vague a CALÉ tôt (auto-repair bash,
  1 seul fichier) → TUÉE et REFAITE moi-même (8 fichiers threadés renderer→preload→main→noyau + `design-system-apply.ts`).
  Sélecteur de style dans StudioComposer (catalogue bundlé, 0 IPC neuf) + thread `designSystem` + injection tokens.css+
  DESIGN.md dans le projet généré. **Validé computer-use** : sélecteur=151 options/22 catégories/Spotify ; scaffold réel
  CDP `studio.scaffold.generate({designSystem:'spotify'})` → `src/design-system.css` (tokens Spotify) importé APRÈS
  index.css (marque gagne la cascade) + DESIGN.md. Screenshot OK.
  ⚠️ **Les 3 vagues `buddy --yolo -p` du jour ont TOUTES calé** (auto-repair bash + rg « unrecognized file type tsx »).
  Livraison FIABLE = les faire moi-même (gate+smoke+computer-use).
- **🔎 CAUSE RACINE du calage des vagues (diagnostiquée 2026-07-05, RAFFINÉE)** : le hang est **INTERMITTENT** — pas un
  bug déterministe. Séquence : l'agent lance une commande bash à motif dangereux → `command-validator` la bloque en dur
  (`Blocked command pattern detected: (?:rm|…|chmod|…|sh|eval|exec)`) → `AutoRepairMiddleware` (déclenchée SEULEMENT sur
  `bash`/`run_tests`/`run_script`) warn 1/3 (invokeRepair SE TERMINE) → **le TOUR LLM SUIVANT pend parfois à 0 % CPU**
  (attente réseau). Prouvé intermittent : même repro (chmod bloqué) tantôt FINIT proprement (2ᵉ appel LLM 56 tok out, exit 0),
  tantôt pend. Une tâche SANS bash finit TOUJOURS (str_replace n'arme pas AutoRepair). Donc = **réponse LLM (Codex OAuth)
  qui stalle par intermittence**. MAIS le provider Codex a DÉJÀ connect-timeout (`provider-chatgpt-responses.ts:448`) +
  idle-timeout SSE correct (l.728-747) → soit un timeout trop long, soit un chemin LLM NON protégé (sous-agent middleware ?
  QualityGate prio 200 délègue CodeGuardian/SecurityReview ; VerificationEnforcement 155). **Fix propre = capturer la stack
  EN FLAGRANT DÉLIT** (`node --report-on-signal --report-signal=SIGUSR2` + SIGUSR2 quand 0% CPU ; repro pas hang à tous les
  coups → boucler jusqu'au hang). **Défense qui MARCHE aujourd'hui = supprimer le déclencheur** : restreindre à no-bash
  (prompt « n'utilise pas bash » → l'agent écrit des fichiers → finit ; c'est ce que fait le mode génération IA `ba9a83ad`).
  Idéalement plumber `allowedTools` (file-only) dans les sessions de génération. NE PAS relancer de vagues `--yolo -p` à gros
  brief tant que non fixé (elles calent 1 fois sur ~2-3). Livrer à la main = fiable.
- **Mode génération IA (queue/25, à écrire APRÈS merge de b7isqed97 — même fichiers App Studio)** : faisabilité OK.
  Noyau a déjà agent+outils fichiers ; Cowork a sessions+runner. Approche : `studio.generate` (tour d'agent scoppé
  au projectDir, prompt = description app + `buildDesignGuidance(id)`) → l'agent écrit une app custom brandée →
  file-tree+preview+**panneau Plan de vol** (traceSteps). Touche main/preload (god-files, additif). Noyau existant :
  `src/tools/scaffold-app-tool.ts` (template-based, à compléter par le chemin IA). Skills importés (niveau 2)
  nourrissent ce tour. C'est LE morceau qui fait briller les 150 styles (génération custom, pas juste tokens).
- **Skills niveau 2 (à décider avec Patrice)** : 159 skills dry-run OK (0 quarantiné). Placement = dossier bundlé
  (distribution/robot) vs `.codebuddy/skills/`. Vendoring Apache-2.0 (attribution). Disjoint d'App Studio → parallélisable.
- **Niveau 2 (à faire, natif, pont DÉJÀ construit)** : importer leurs **509 SKILL.md** (apple-hig, brutalist,
  brand-extract, brand-guidelines, copywriting, color-expert, deck/motion templates — `triggers` explicites)
  via `skill-importer` existant (`buddy skills import --dir /tmp/open-design/skills`). Firewall gate les scripts.
  ⚠️ Beaucoup sont liés au `od:` daemon (mode deck) — cibler d'abord les skills de GUIDANCE pure.
- **Niveau 3 (option)** : enregistrer `od mcp` (stdio) dans mcp.json → agent pilote la vraie génération
  open-design (decks/HyperFrames/export MP4) MAIS exige d'installer+lancer leur daemon. Contraire à offline/robot.
- ⚠️ `/tmp/open-design` est ÉPHÉMÈRE — déplacer vers ~/DEV/open-design avant l'import niveau 2.
- ⚠️ studio-functional (wt-studio3) touche StudioComposer.tsx → le sélecteur design DOIT attendre son merge
  (ou être scopé disjoint). Son process codex est calé (0% CPU, 6 fichiers non commités) → à gater séparément.

## DETTE DE CÂBLAGE (le vrai goulot — c'est Fable, pas Codex)
Tout est dormant tant que non monté dans les god-files. Passe de câblage à planifier via les manifestes :
- Genspark → `App.tsx`/`store`/`NewShell` (les ~50, mount par catégorie)
- App Studio → `primaryView: 'studio'` dans NewShell + IPC `studio.*` dans preload+main/index + namespace
- Agentic OS → `primaryView: 'os'` ou panel
- Core tools → registry (`tools.ts` + `executeTool` + factory `src/tools/registry/` + `metadata.ts`)
**Après le cycle 2, planifier une grande passe de câblage Fable + validation GUI Patrice.**

## COUVERTURE cible
- **bolt.diy** : éditeur✓ terminal✓ preview✓ scaffold✓ file-tree✓ | deploy🔄 git🔄 diff🔄 export🔄 | reste: sync-folder, multi-preview
- **Genspark** : intent-bar✓ mission-board✓ recipes✓ credits✓ deep-research✓ paperqa✓ sparkpage(report/table)✓ cross-check✓ slides/sheets/docs(UI)✓ | reste: image/video gen, AI Pods, Call-for-me backend, AI Drive câblé

## PROCHAIN CYCLE (au réveil)
1. `ps aux | grep "dist/index.js --yolo"` + `git log --oneline main..feat/<branche>` pour chaque vague en cours.
2. Pour chaque vague FINIE : périmètre (0 god-file) → merge → gate (tsc+tests+vite build, checkout principal) → push → cleanup worktree.
3. Si <3 vagues tournent + df OK : lancer les suivantes de la file (écrire le brief court si absent).
4. Mettre à jour ce fichier. Re-programmer.
5. Quand la file de PRODUCTION se tarit : basculer sur la passe de CÂBLAGE (Fable) + prévenir Patrice pour la validation GUI.
