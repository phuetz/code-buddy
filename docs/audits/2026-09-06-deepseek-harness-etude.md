# Étude : DeepSeek Harness vs Code Buddy — ce qu'il faut en retenir

> **Date :** 2026-09-06. **Auteur :** Grok 4.6. **Branche :** `etude/deepseek-harness-2026-09-06`.
> **Contexte :** résumé vidéo `_qa/RESUME-VIDEO-HARNESS.md` (Eliott Meunier, 19/08/2026) — chiffres de la vidéo **non vérifiés a priori**.
> **Méthode :** lecture des sources officielles (GitHub, docs, papier arXiv) + cartographie de Code Buddy. **Clean-room :** aucun code de DeepSeek Harness n'est copié ici (licence MIT ou pas). Idées, interfaces, invariants — jamais d'implémentation importée.
> **Périmètre :** un seul livrable. Pas d'adoption de Harness, pas de réécriture du cœur.

---

## 0. Sources officielles (dates et licences RÉELLES)

| Source | URL | Date / licence constatées le 2026-09-06 |
|---|---|---|
| Dépôt officiel | https://github.com/deepseek-ai/deepseek-harness | `created_at` GitHub API : **2026-08-13T11:56:32Z**. Licence **MIT**, `spdx_id: MIT`. Copyright `(c) 2026 DeepSeek`. Description : « Everything is a Plugin. » Homepage : https://deepseek.com/harness |
| README | https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md | Prévisualisation développeur. Phrase en capitales : *THERE WILL BE COMPATIBILITY-BREAKING CHANGES.* Lien papier : arXiv **2608.25512**. |
| Licence brute | https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE | MIT License, Copyright (c) 2026 DeepSeek. Commit README « Adopt MIT for DSH packages » daté **13 août 2026**. |
| Page produit | https://deepseek.com/harness/en/ | Slogan : *Everything is a plugin. Every run is traceable.* Agent = Model + Harness. |
| Docs développeur | https://deepseek-harness.github.io/deepseek-harness/ | Architecture, primer Cordis, sous-systèmes, catalogues générés. |
| Architecture | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md | Profiles / bundles, log de session, seams, flux de tour. |
| Primer Cordis | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md | Cinq idées : Service, Context, `inject`, events, effects réversibles. |
| SAFETY | https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.md | « Experimental developer-preview. **It has not undergone a security audit** and must not be treated as secure or production-ready. » |
| Cordis (runtime) | https://github.com/cordiverse/cordis | Méta-framework, MIT, « API is not yet stable ». |
| Papier (arXiv) | https://arxiv.org/abs/2608.25512 | **Soumis le 26 août 2026** (v1 08:22:19 UTC). 92 pages. Licence arXiv non-exclusive. |
| Papier (dépôt) | https://github.com/cordiverse/paper | Preprint sous révision active. |
| Sujet plugins | https://github.com/topics/dsh-plugin | Découvrabilité communautaire. |

**Papier — titre, auteurs, affiliation (corrige la vidéo) :**

- Titre réel : **« A Programming Paradigm for Spatiotemporal Composability »** — pas « Special Temporal Composability ».
- Auteurs : Yifan Shi (1 et 2), Wei Zhang (1), Tianyi Cui (2). (1) **Peking University**, (2) **DeepSeek-AI**. L'affiliation PKU est **vraie**.
- arXiv : `cs.PL` / `cs.SE`. Abstract : deux dimensions orthogonales — *temporal composability* (réversion complète des effets d'un composant à son retrait) et *spatial composability* (déclaration et gestion réactive des dépendances). Mécanismes : **revertible effects** + **reactive coeffects**, unifiés dans un *context paradigm*. Implémentation : **Cordis**.
- Longueur arXiv : **92 pages** (la vidéo dit 88 — chiffre de preprint / PDF GitHub, pas de la notice arXiv).
- Date : le harness public est du **13/08** ; le dépôt arXiv est du **26/08**. Un draft GitHub `cordiverse/paper` circule dès le 13, mais **citer arXiv:2608.25512 comme « papier du 13/08 » est faux**.

**État du produit (pas de la vidéo) :** developer preview, npm `@deepseek-ai/dsh`, UI locale `npx @deepseek-ai/dsh web` sur `http://127.0.0.1:3080`. GitHub API au 2026-09-06 : ~213 k étoiles, ~25 k forks, ~15 k commits, tag récent `dsh-0.1.3-alpha.1` (4 sept. 2026). Ce n'est **pas** un runtime d'entreprise stabilisé.

---

## 1. Ce qu'est DeepSeek Harness (idées, pas le code)

### 1.1 Thèse réelle (pas le slogan)

Harness n'est pas « un agent DeepSeek ». C'est le **châssis** : *Agent = Model + Harness*. Le noyau Cordis **ne porte aucune capacité d'agent**. Il charge, décharge, et relie des plugins. Modèle, outils, skills, sessions, sandbox, stockage, boucle, ordonnancement, UI — tout est un plugin monté dans un `Context` partagé. La composition se fait **en configuration** (profiles, bundles, `cordis.patch.yml`), sans patcher un « cœur privilégié ».

Cordis n'est pas né avec Harness : c'est le runtime de **Koishi** (chatbots, milliers de plugins communautaires). Le papier **formalise** une pratique déjà en production. Harness est la preuve de vie « agent coding », pas l'invention du micro-noyau.

### 1.2 Modèle de plugin — interface, cycle de vie, activation à chaud

**Interface (idées) :**

- Un plugin est un objet qui implémente `Service`, ou une fonction avec `inject` + `apply(ctx)`.
- Un **contexte** est un dépôt de services : `ctx.tools`, `ctx.llm`, `ctx.sessions`… Les plugins se trouvent par **clé**, pas par import concret.
- `inject` déclare les services requis. Tant qu'ils manquent, le plugin **n'entre pas en ACTIVE**.
- Communication : événements typés (`emit`, `waterfall`, `parallel`, `serial`, `bail`).
- **Toute inscription est un effet réversible** : `ctx.effect()` / `ctx.on()`. Un timer, une connexion, un watcher hors API Cordis **doit** être enveloppé dans `ctx.effect()` et renvoyer un disposer — sinon il survit au déchargement.

**Cycle de vie d'une fibre (instance chargée) :**

```
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
                 ↘ FAILED
```

- `PENDING` : déclaré, dépendance de service absente (réponse usuelle à « mon plugin ne s'imprime pas »).
- `LOADING` / `ACTIVE` : `apply` en cours / terminé.
- `FAILED` : `apply` ou validation de config a levé.
- `UNLOADING` / `DISPOSED` : disposers en cours / tout démonté.
- Un `fiber.dispose()` attend le nettoyage (y compris disposers async) et décharge récursivement les enfants.

**Activation à chaud :**

- Un `dsh` qui tourne est un **arbre de plugins** composé au boot par couches ordonnées : bundles du profil, puis `cordis.patch.yml` du profil, puis overlay home, puis `--patch`.
- Profils livrés : `web`, `headless`, `sdk`, `sdk-minimal`, `acp`.
- **Rechargement live** : profils custom et le profil `web` livré. `headless` / `sdk` / `sdk-minimal` / `acp` appliquent les couches **une fois** au démarrage — remplacer les dépendances d'un one-shot après qu'il possède du travail **invaliderait** ce cycle de vie.
- HMR = réconciliation de configuration, pas un « hot reload de fichiers JS » naïf.

**Point de couture pour Code Buddy :** nous avons `activate` / `deactivate` et un hot-reload par watcher de fichiers. Nous n'avons **pas** d'effets réversibles tenus par le runtime, ni de fibre `PENDING` qui attend un service.

### 1.3 Interface *Trajectory* — traces, format, stockage, API

La « Trajectory » n'est **pas** une API de requête séparée du type SQL. C'est une **vue** (Web UI : inspecter par source) sur **un seul journal append-only** : le log de session. Invariant produit : *model-visible means logged*. Tout ce qui atteint une requête modèle doit être reconstructible depuis le log ; un invariant runtime l'affirme. D'où : nouvelle entrée modèle-visible ⇒ nouvel événement de session.

**Traces (vocabulaire d'événements, d'après la doc session officielle) :**

| Famille | Exemples | Rôle |
|---|---|---|
| Bornes d'exécution | `turn/start`, `turn/end`, `step/start`, `step/end` | Un *step* = une requête modèle + les outils qu'elle appelle. Un *turn* = zéro ou plusieurs steps. |
| Surface (historique modèle) | `user/message`, `assistant/message`, `tool/result` | Seuls ces types projettent l'historique LLM via `deriveMessages()`. |
| Tentatives | `assistant/attempt` | Échec / retry / cancel / erreur de flux **sans** fabriquer d'historique modèle. |
| Outils | `tool/call` (arguments bruts), `tool/result` (résultat + `meta` JSON) | Appariés par `callId`. |
| Requête | `request/header` (config, prompt système, schémas d'outils), `request/context` (route / fenêtre) | L'enveloppe de la requête est une fonction du log. |
| Permissions (log-only) | `approval/asked`, `approval/decided`, `approval/policy`, `permission/preset` | Audit ; `permission/preset` **hors** transcript modèle. |
| Autres plugins | `compaction/*`, `hook/invoked` / `hook/result` | Merge-extensible : un plugin déclare de nouveaux types. |

`assistant/message` embarque le flux compact **et** `usage` (tokens) quand l'adaptateur les a fournis. Pas d'enregistrement d'usage séparé.

**Format / stockage :**

- Persistance JSONL append-only, une session = un répertoire. Générations immuables : v0 `session.jsonl[.zstd]`, v1+ `session.vN.jsonl[.zstd]`. Compression zstd par défaut.
- `seq` monotone, `time` epoch ms, payload JSON strict (rejet à l'`append` si non sérialisable).
- Fork / resume : préfixe hérité + marqueur `session/end-seed`. Interdit de forker *pendant* un tour ouvert.
- Crash : réparation des bornes turn/step/outil ; les `compaction/*` ouverts restent au plugin propriétaire.

**API de requête (idées) :**

- In-process : `ctx.sessions.create/prepare/enter/announce/get/list/fork/flush` ; `session.append`, `snapshotEvents`, `deriveMessages`, `eventAt`.
- Hôte distant : `list`, `search`, `page`, `follow` (flux), `inspect`, `fork`, `prompt`, `cancel`. `follow` = snapshot d'ouverture puis événements sans trou.
- Projections : `ctx.sessionProjections` — unités qui plient les événements commités ; `stateOf()` / `snapshot()`.

**Ce que la Trajectory Harness n'est pas :** un undo du monde réel, un SIEM, ni une preuve que « rien n'est caché ». Les événements `ignorable` existent ; les plugins peuvent écrire n'importe quoi *hors* Context ; l'audit tiers (#454) a montré un RPC loopback non authentifié lisant le contenu de session.

### 1.4 Composabilité temporelle — inverse, effets de bord, échec de l'inverse

**Ce que le papier prouve :** un *revertible effect* est une transformation du Context **qui porte son inverse**, détenu par le runtime. Décharger un composant rejoue les inverses (ordre inverse d'enregistrement). Théorème de composabilité temporelle : réverter les effets d'un composant ramène le système à l'état où ce composant **n'aurait jamais agi**, même si d'autres ont travaillé entre-temps — **sous les hypothèses du calcul**.

**Ce que ça inverse vraiment :** inscriptions Cordis — listeners, services, schémas d'outils, adaptateurs, timers wrappés dans `ctx.effect()`. C'est le *unload propre d'un plugin*, pas l'annulation d'un `curl`, d'un `rm`, ni d'un processus fils lancé par un outil.

**Ce que le papier place hors modèle (crucial) :**

- Les **émissions irréversibles** (réseau, écritures disque hors Context) restent **à la frontière du système**. Le théorème ne les couvre pas.
- Les inverses doivent être **corrects** ; le graphe de dépendances **sans cycle** ; les opérations indépendantes **commutent**.
- La preuve ne dit pas que le code de chaque plugin tient ses promesses, ni que l'implémentation TypeScript est fidèle au calcul.

**Quand l'inverse échoue :**

- Le théorème **cesse de s'appliquer**. On n'a plus « l'état comme si le plugin n'avait jamais existé ».
- En pratique Cordis : `apply` qui jette → fibre `FAILED`. Les disposers async tournent **en parallèle** ; si l'ordre compte, il faut **un** disposer séquentiel. Un timer/connexion **non wrappé** n'est jamais inversé.
- Un HTTP déjà parti, un fichier déjà écrit hors Context, un processus déjà spawn : **pas d'inverse**. C'est précisément le trou que la vidéo présente comme résolu.

**Traduction pour un agent coding :** « chaque action a un inverse » est **faux** au sens outil. Vrai au sens « enregistrer un listener a un unregister ». Confondre les deux est le principal mensonge utile de la vidéo.

### 1.5 Composabilité spatiale — résolution des dépendances

Un **coeffect** = ce que le plugin **exige** du Context (un `ctx.llm`, un `ctx.sandbox`…). Le runtime classe chaque changement de Context contre cette spécification et **active / désactive** le plugin.

Conséquences (théorèmes) :

- Personne ne s'active sans dépendances servies (`PENDING` tant que ça manque).
- Un fournisseur ne se retire qu'après désactivation des dépendants.
- Pas de cycle ⇒ chaque transition finit (Progress).
- Sous conditions : confluence — plusieurs ordres de load/unload convergent vers le **même** état stable qu'un assemblage en une fois.

Chez Harness, ça se voit : `dsh-tool-cordis` **n'active pas** ses outils si `ctx.dynamicCordisRunner` est absent. Une composition partielle de sandbox + approval **échoue bruyamment** au load. Ce n'est pas un graphe npm : c'est un graphe **runtime**.

### 1.6 Creator Mode — comment les plugins générés sont validés

Page produit : le Creator Mode permet d'inspecter le runtime courant, **tester des plugins Cordis en mémoire**, et les recombiner en nouveaux presets / modes. Modes livrés : Standard, Code/PTC (le modèle écrit un programme TypeScript qui orchestre plusieurs appels d'outils), Minimal (shell + éditeur), Creator.

Outils associés (catalogue officiel, **opt-in, pas dans l'arbre livré par défaut**) : `cordis_define`, `cordis_inspect_list/query/self`, `cordis_run`, `cordis_stop`, `cordis_undefine`. Service `ctx.dynamicCordisRunner` : registre de définitions **en mémoire**, **bac `vm` pour les moitiés hôte**, aller-retour request-run. Un paquet dynamique **peut enregistrer d'autres outils visibles du modèle** jusqu'à stop / undefine / redémarrage.

**Validation constatée :** sandbox `vm` + cycle de vie Cordis (define → run → inspect → stop). **Pas** de porte comportementale held-out, **pas** de scan anti-reward-hacking du type G4 Code Buddy. La doc dit explicitement : le code de paquet dynamique **atteint le vrai runtime**. Audit communautaire #454 (discussion GitHub) : **axe B (code plugin) sans conception de sécurité** — plugins dans le process hôte, privilèges hôte, pas de signature / intégrité / TOFU à l'install. `!!js` dans la config = RCE au load. Ce n'est pas un détail : c'est l'envers du Creator Mode.

SAFETY.md officiel : *has not undergone a security audit*. Un audit tiers défensif existe ; DeepSeek ne le revendique pas comme audit interne.

### 1.7 Permissions

Deux **boutons indépendants**, regroupés en presets :

| Bouton | Valeurs | Défaut prudent |
|---|---|---|
| Mode sandbox (effets **fichier** seulement) | `read-only` / `workspace-write` / `danger-full-access` | Doc policy : `read-only` fail-safe ; le bundle produit part souvent de `workspace-write`. |
| Politique d'approbation | `ask` (chaîne d'answerers ; sans answerer → **`unavailable` fail-closed**) / `never` (rejet déterministe) | `ask` |

Presets livrés : `workspace-write` (sandbox workspace-write + ask) et `danger-full-access` (danger-full-access + never). Une combinaison hors table se lit `custom` (affichable, non sélectionnable).

Exécution : waterfall `tools/pre-execute`. Sandbox process : bwrap / Landlock / Seatbelt / ACL Windows ; **fail-closed** `SANDBOX_UNAVAILABLE` — jamais d'exécution non confinée sous étiquette sandbox. L'enforcement est un **fait rapporté** (`full` / `partial`), pas une promesse. Réseau et visibilité des process **hors vocabulaire** du sandbox fichier.

Limites documentées par la communauté (à traiter comme risques, pas comme code à copier) : lectures souvent non bornées par le mode write ; sandbox fichier ≠ isolation réseau/PID.

---

## 2. Cartographie Code Buddy en face

Légende : **déjà** = mécanisme réel avec `fichier:ligne` de *ce* clone. **Manque** = trou utile. **Mieux chez nous** = ne pas régresser.

### 2.1 Plugin = capacité interchangeable

| Harness | Code Buddy déjà | Manque | Mieux chez nous |
|---|---|---|---|
| Tout est plugin Cordis, y compris la boucle | Interface `Plugin` `activate` / `deactivate` (`src/plugins/types.ts:195-201`). Permissions déclarées fs/network/shell/env (`types.ts:154-159`). Isolation Worker **par défaut** `forceIsolation ?? true` (`plugin-manager.ts:59`). Hot-reload watcher (`hot-reload.ts:36-44`). Providers bundlés (`plugin-manager.ts:69-79`). | Pas d'effets réversibles tenus par le runtime. `registerTool` inscrit dans `ToolManager` **sans disposer** (`plugin-manager.ts:616-618`) : un `deactivate` (`:560-585`) n'inverse pas l'outil. Deux gestionnaires coexistent (`plugin-system.ts` *et* `plugin-manager.ts`). La boucle agent, le client LLM, le log de run **ne sont pas** des plugins. | Isolation Worker + permissions + `strictTrust` / `trustedPlugins`. Harness Axis B = process hôte. `registerContextEngine` refuse `ownsCompaction` aux non-trusted (`plugin-manager.ts:635-638`). |
| `inject` → PENDING jusqu'au service | MCP : init en fond, skip serveur lent (`infrastructure-facade.ts:115-130`, `CODEBUDDY_MCP_INIT_TIMEOUT_MS`). | Pas de graphe de coeffects. Un plugin qui a besoin de `ctx.sessions` n'attend pas : il casse ou no-op. | Fail-open volontaire sur MCP (les autres serveurs chargent). Harness fail-loud sur composition partielle — mieux pour un SDK, pire pour un compagnon 24/7. |
| HMR config live (profil web) | Hot-reload **fichiers** debounce 300 ms (`hot-reload.ts:36-41`). | Pas de réconciliation d'arbre de config. Reload = unload/load best-effort. | — |

### 2.2 Trajectory / observabilité d'un run

| Harness | Code Buddy déjà | Manque | Mieux chez nous |
|---|---|---|---|
| Un log = source de vérité ; l'historique modèle est *dérivé* | **Plusieurs** journaux : `RunStore` JSONL (`src/observability/run-store.ts:1-47`, types `run_start`…`pause_suggested`, métriques tokens/coût `:79-87`) ; export rédigé `buildRunTrajectoryExport` (`run-trajectory-export.ts:111`) ; CLI `buddy run trajectory-export` (`src/commands/run-cli/index.ts:211-224`) ; timeline session preview-only (`src/sessions/timeline.ts:12-20, 51-56`) ; audit sécurité (`src/security/audit-logger.ts:14-30`) ; cost tracker (`src/utils/cost-tracker.ts:158`). | **Pas une vue unifiée** tokens + outils + permissions + effets de bord + coût. L'historique chat n'est **pas** une projection du RunStore. `buddy run trajectory <id>` n'existe pas (seulement `trajectory-export` / `trajectory-batch`). Cowork a une bande Hermes (`cowork/tests/hermes-trajectories-strip.test.ts`) pas un panneau Trajectory. Timeline : `name` + `ok`, pas d'args, pas de permissions. | Export **rédigé** (`mode: 'redacted_review_export'`, `privacy.redaction: 'secrets-redacted'`). Harness log = tout ce que le modèle a vu, y compris secrets si un outil les a lus. `buddy run replay` relit des lectures enregistrées. Policy-evals / golden-evals sur trajectoires. |
| `follow` / fork / search sur le même flux | `buddy run list\|show\|tail\|replay\|lineage\|search` (`run-cli/index.ts:5-27`). Timeline never-throws (`timeline.ts:54-55`). | Replay ≠ re-dérivation de l'historique modèle. Fork de run (`parentRolloutId`, `run-store.ts:69-76`) ≠ fork de session Harness au `turn/end`. | Rédaction + never-throws : invariants Code Buddy à conserver. |

### 2.3 Undo / effets de bord

| Harness | Code Buddy déjà | Manque | Mieux chez nous |
|---|---|---|---|
| Inverse = unload plugin (Context seulement) | Checkpoints **fichiers** + undo/redo (`src/undo/checkpoint-manager.ts:1-13, 461-495`). Shadow workspace opt-in (`src/speculative/shadow-workspace.ts:110, 147`, `CODEBUDDY_SHADOW_WORKSPACE`). Diff-review transactionnel + `rollbackAppliedDiff` (`src/review/apply-transaction.ts:135-139`, `types.ts:15-19`). | **Aucun journal d'effets** processus / HTTP / état hors fichiers. Pas d'inverse déclaré par outil. Un `bash` qui spawn, un webhook sensoriel, un `kill_process` : pas de rollback. | Diff-review **fail-closed** (`review/types.ts:15-19`, `write-gate.ts:35, 155-156`) : un diff illisible n'est **jamais** appliqué. Shadow = valider dans un fantôme **avant** de toucher l'arbre. Held-out G4 (ci-dessous). Harness ne gate pas ça. |

### 2.4 Creator Mode / auto-génération

| Harness | Code Buddy déjà | Manque | Mieux chez nous |
|---|---|---|---|
| Plugins générés, testés en mémoire, `vm`, **atteignent le vrai runtime** (opt-in) | `register_tool` (`src/tools/register-tool-handler.ts`) + runtime sandboxed (`authored-tool-runtime.ts:1-12, 22`) namespace `authored__`. Porte **G0 AST / G1 scan / G3 visible / G4 held-out** (`tool-gate.ts:1-12, 76-83`) : scénario sans held-out **refusé**. Proposeur **ne voit pas** les cas held-out (`tool-proposer.ts:3-13`). Skills : pare-feu + coverage, pas de held-out comportemental (honnête). Stratégies : schéma Zod qui **ne peut pas** désarmer une garde. Kill-switch `CODEBUDDY_SELF_IMPROVE` défaut OFF. **Jamais `src/`.** | Pas d'inspect runtime « Creator » (lister services/fibres). Pas d'expérimentation in-memory d'un *preset* d'agent. | **Anti-reward-hacking held-out** : Harness Creator n'a pas l'équivalent. Isolation des authored tools (cwd jetable, RPC off, HOME détourné). Skill Exchange ed25519 + TOFU + re-scan. |

### 2.5 Permissions

| Harness | Code Buddy déjà | Manque | Mieux chez nous |
|---|---|---|---|
| Deux knobs sandbox × approval, presets, fail-closed `unavailable` | `ConfirmationService.requestConfirmation` (`src/utils/confirmation-service.ts:281+`) : PolicyEngine → mode permission (blocage non contournable, `:347-368`) → règles déclaratives deny (`:387-393`) → AUTO_CONFIRM → allow policy → session flags (`:421+`) → Guardian. Modes `default\|plan\|acceptEdits\|dontAsk\|bypassPermissions` (`permission-modes.ts:18`). `PolicyEngine` kill-switch (`policy-engine.ts:43-70`). Sandbox natif opt-in fail-closed (`native-sandbox.ts:1-7`). | Décisions d'approbation **pas** dans le même flux que `buddy run show`. Pas d'événement unique `approval/asked` + `approval/decided` corrélé au `tool/call`. | Write-policy `strict`. Diff-review en **aval** de la confirmation humaine. Peer tools fail-closed sans `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT`. Sensory `kill_process` double opt-in (`sensory-action-executor.ts`, `CODEBUDDY_RUNAWAY_KILL`). |

### 2.6 Modèle-comme-plugin — jusqu'où `client.ts` en est

Harness : l'adaptateur LLM est un plugin `ctx.llm` ; en config on permute DeepSeek / Anthropic / replay **sans recompiler**.

Code Buddy, **déjà un dispatcher à stratégies**, pas un monolithe :

- Interface `Provider` (`src/codebuddy/providers/provider-interface.ts:24-44`) : `chat` / `chatStream` / `setModel`.
- `CodeBuddyClient` (`src/codebuddy/client.ts:227`, constructeur `:306-437`) instancie **exactement une** stratégie : `GeminiNativeProvider` (baseURL `generativelanguage.googleapis.com`) **ou** `ChatGptResponsesProvider` (sentinel OAuth / Codex) **ou** `GeminiCliProvider` **ou** `AgyCliProvider` **ou** `OpenAICompatProvider`.
- Commentaire explicite `:368-371` : *exactly one of geminiProvider / openaiCompatProvider / chatgptProvider is non-null*.
- Fallback runtime (`setRuntimeFallbackProviders`, `:293-300`) = liste post-construction, pas un montage de plugin.
- Ajouter un fournisseur = **nouveau fichier stratégie + branche constructeur**. Ce n'est pas « tout est plugin ». C'est **Strategy + factory**, le bon niveau — à **ne pas** remplacer par Cordis.

Écart restant : permutation **en configuration à chaud** (sans redémarrer le process) d'un adaptateur, et enregistrement d'un adaptateur hors-arbre. Les providers bundlés (`src/plugins/bundled/`) couvrent Ollama / vLLM / Groq… comme *plugins de catalogue*, pas comme stratégies `Provider` montées dans le client.

### 2.7 Sensory / règles (hors Harness, notre surface d'effets)

Harness n'a pas d'équivalent « système nerveux ». Chez nous, `src/sensory/sensory-rules-engine.ts` + `sensory-action-executor.ts` : actions `shell` / `kill_process` / webhook, `isDestructive` à l'écriture, plafonds in-flight. Ce sont des **émissions** (signaux, HTTP). Un Creator Mode Harness qui inverse des listeners **ne les annule pas**. Tout chantier « undo transactionnel » doit **inclure** cette surface, sinon on undo le dépôt et on laisse un SIGTERM parti.

---

## 3. Ce que le papier apporte vraiment vs le marketing

**Vraiment nouveau (à prendre au sérieux) :**

1. **Séparer deux problèmes** que tout le monde mélange : décharger un composant (temps) vs câbler ses dépendances (espace).
2. **Remonter effect / coeffect au runtime** (plus seulement à la compilation) : l'inverse n'est pas une convention `onUnload`, c'est un objet que le runtime **détient**.
3. **Un seul Context** médiant effets et coeffects → équivalence observationnelle des entrelacements (sous hypothèses).
4. **Cinq théorèmes** (Preservation, Temporal, Spatial, Progress, Confluence) — utiles comme **cahier des charges** d'un chargeur de plugins, pas comme certificat RGPD.
5. **HMR = réconciliation de config**, pas un watcher de fichiers.

**Marketing / vidéo, pas dans le papier :**

- « Observabilité totale » et vue Trajectory : **produit** Harness, pas le papier.
- « Chaque action d'agent a un inverse » : **contredit** la frontière « émissions irréversibles ».
- Creator Mode / panda animé / plugins générés : **hors papier**.
- « Déploiement sécurisé entreprise enfin viable » : SAFETY.md dit l'inverse ; Axis B sans sécu.
- « Everything is a plugin » : slogan Koishi/Cordis, pas une invention 2026.

**Pour Code Buddy :** voler le **cahier des charges** (effets réversibles + coeffects + un log reconstructible), pas le runtime Cordis, pas les théorèmes à implémenter.

---

## 4. Propositions — 7 chantiers (valeur / effort)

Tous : **opt-in défaut OFF**, **never-throws** sur le chemin de lecture, **rien de personnel** dans les artefacts (rédaction existante), **git add nominatif**, pas de copie Harness.

### C1 — Vue Trajectory unifiée d'un run

- **Titre :** `buddy run trajectory <id> [--json]` + panneau Cowork.
- **Pour l'utilisateur :** une page / une commande qui aligne **tokens, appels d'outils, décisions de permission, effets de bord classés, coût**. Aujourd'hui il faut croiser `run show`, `trajectory-export`, `cost`, l'audit JSONL et la timeline session.
- **Branche :** `src/observability/run-trajectory-export.ts` (étendre le schéma v1 → v2 **additif**), `src/observability/run-store.ts` (événements `permission` / `effect` nouveaux, ignorer les vieux logs), `src/commands/run-cli/index.ts` (alias `trajectory` en plus de `trajectory-export`), `src/security/audit-logger.ts` + `confirmation-service.ts` (émettre dans le RunStore, pas un 6ᵉ fichier), `cowork/` panneau lecture seule (la bande Hermes existe déjà en test).
- **Invariants :** défaut = vue rédigée (`secrets-redacted`) ; `--include-artifact-content` inchangé ; jamais de secrets en clair ; lecture never-throws ; logs anciens restent lisibles (champs absents = `unknown`).
- **Test :** fixture RunStore + audit + cost → JSON contient les 5 familles ; mutation qui omet `permission` → rouge ; golden « run sans audit » → clés présentes à `null` pas d'exception.
- **Effort :** M. **Moteur :** Grok (produit + CLI) ; revue Astra sur le schéma.

### C2 — Undo transactionnel des effets d'un outil / plugin au-delà des fichiers

- **Titre :** journal d'effets + inverses déclarés, fail-closed si pas d'inverse.
- **Pour l'utilisateur :** « annule ce tour » ne restaure pas seulement les fichiers : stoppe le process spawné, n'invente pas un DELETE HTTP, et **refuse** d'annoncer un undo complet si un effet n'a pas d'inverse.
- **Branche :** nouveau module `src/effects/` (idée : `declareEffect({ kind, inverse, emission?: true })`) branché depuis les outils write/bash **et** `sensory-action-executor.ts`. Consommateur : `checkpoint-manager.ts` + `rollbackAppliedDiff`. **Ne pas** toucher à Cordis.
- **Invariants :** opt-in `CODEBUDDY_EFFECT_JOURNAL=true` défaut OFF (byte-identique). Émission réseau = `emission: true` **sans** inverse → undo d'outil **fail-closed** (rapport honnête, pas un rollback partiel silencieux). Never-throws sur le journal (best-effort append, comme la timeline). Rien de personnel : cibles hashées / rédigées.
- **Test :** outil fake `spawn` + inverse `kill` → undo tue le pid enregistré ; pid réutilisé refusé (comme `kill_process`) ; outil `http_post` sans inverse → undo retourne `incomplete` / refus ; flag off → zéro fichier d'effets.
- **Effort :** L. **Moteur :** Astra (contrats + fail-closed) puis Grok (câblage bash/sensory).

### C3 — Modèle-comme-stratégie : aller au bout de `client.ts` sans Cordis

- **Titre :** registre d'adaptateurs, une stratégie par process, permutation config **sans** micro-noyau.
- **Pour l'utilisateur :** ajouter un fournisseur = un fichier stratégie + une ligne de registre, pas une nouvelle branche `if` dans le constructeur. `/switch` et le council voient la même table.
- **Branche :** `src/codebuddy/client.ts:306-437`, `provider-interface.ts:24-44`, `src/plugins/bundled/` (ne **pas** fusionner catalogue et transport). Extraire les `isXProvider` en table `match(baseURL, apiKey)`.
- **Invariants :** toujours **exactement une** stratégie active (test d'unicité). Pas de chargement à chaud d'un `.js` fournisseur dans le process (le trou Axis B Harness). Opt-in seulement pour un *loader* externe signé — hors chantier.
- **Test :** chaque sentinelle (Gemini native, Codex, gemini-cli, agy-cli, OpenAI-compat) instancie la bonne classe ; deux matches → erreur explicite ; snapshot des branches actuelles = même comportement.
- **Effort :** M. **Moteur :** Luna (refactor mécanique + tests d'unicité).

### C4 — Enregistrements de plugins réversibles (sans adopter Cordis)

- **Titre :** `registerTool` / `registerCommand` / `registerProvider` renvoient un disposer, `deactivate` les joue.
- **Pour l'utilisateur :** désactiver un plugin **enlève** ses outils du prochain tour, au lieu de laisser un fantôme.
- **Branche :** `src/plugins/plugin-manager.ts:560-638`, `src/tools/tool-manager.ts` (unregister public), `hot-reload.ts`.
- **Invariants :** disposer never-throws (log + continue, comme Harness « observer failures contained » mais **sans** copier). Isolation Worker inchangée. Défaut : comportement actuel inchangé si le plugin ne s'est pas enregistré via le nouveau helper (compat).
- **Test :** plugin fixture enregistre `echo_marker` → deactivate → `/tools` ne le liste plus ; throw dans disposer → les autres inscriptions quand même retirées ; hot-reload n'empile pas deux copies.
- **Effort :** M. **Moteur :** Luna.

### C5 — Taxonomie réversible vs émission dans les métadonnées d'outils

- **Titre :** chaque outil déclare `effects: { files?, processes?, network?, state? }` et `reversible: boolean`.
- **Pour l'utilisateur :** la Trajectory (C1) peut afficher « cet appel n'est pas annulable ». Le plan mode / ConfirmationService peut exiger une confirmation **plus** forte sur une émission.
- **Branche :** `src/tools/metadata.ts`, consommateurs C1/C2, éventuellement `tool-policy`.
- **Invariants :** champ additif ; outil sans champ = `reversible: unknown` (pas un mensonge `true`). Défaut OFF sur toute *enforcement* nouvelle (`CODEBUDDY_EFFECT_DECLARE=true` pour bloquer un outil `reversible: false` en undo).
- **Test :** snapshot metadata : `view_file` reversible, `bash` unknown/false, `stock_quote` emission réseau ; un outil write sans champ → warning unique, pas de throw.
- **Effort :** S. **Moteur :** Grok.

### C6 — Notre « Creator Mode » : inspecter + expérimenter, gaté comme IMPROVE1

- **Titre :** `buddy improve runtime inspect` + expérimentation **in-memory** d'un outil authored, **sans** l'enregistrer.
- **Pour l'utilisateur :** voir ce qui est monté (stratégie LLM, plugins actifs, MCP, sandbox). Tester un outil généré **dans le scorer** (déjà `sandbox-scorer.ts` ne enregistre pas) exposé en CLI. Harness Creator atteint le vrai runtime ; **nous non**.
- **Branche :** `src/agent/self-improvement/sandbox-scorer.ts`, `tool-gate.ts`, `src/commands/cli/improve-command.ts`. Interdire tout chemin vers `register()` sans G4. Pas de `vm` hôte à la Harness.
- **Invariants :** `CODEBUDDY_SELF_IMPROVE` toujours requis pour `--apply`. Inspect = lecture. Expérimenter = scoring sandboxed, cwd jetable, **held-out invisible au proposeur**.
- **Test :** inspect JSON sans env → sous-ensemble non sensible ; `improve tools` sans env refuse `--apply` (déjà IMPROVE2) ; scorer d'un tricheur held-out → reject, registre inchangé.
- **Effort :** M. **Moteur :** Astra (portes) ; Grok (CLI inspect).

### C7 — Dépendances déclarées plugins / MCP (spatial, petit)

- **Titre :** manifeste `requires: ["mcp:code-explorer"]` ; plugin `PENDING` jusqu'à dispo ; décharge si la dépendance part.
- **Pour l'utilisateur :** plus de plugin sourd qui s'active et échoue au premier outil.
- **Branche :** `src/plugins/types.ts` (manifest), `plugin-manager.ts`, init MCP `infrastructure-facade.ts`.
- **Invariants :** défaut = pas de `requires` ⇒ comportement actuel. Cycle → refuse le load (Progress). Never-throws si MCP down : reste PENDING, log unique.
- **Test :** plugin `requires: ["service:absent"]` n'est pas ACTIVE ; fournir le service → ACTIVE ; retirer → DISABLED ; cycle A↔B → erreur de load.
- **Effort :** S–M. **Moteur :** Luna.

---

## 5. Ce qu'il ne faut PAS faire

1. **Adopter DeepSeek Harness** comme runtime Code Buddy. Developer preview, breaking changes, SAFETY.md, Axis B sans sécu, licence MIT **n'efface pas** le coût d'une réécriture. Nous avons 27 k tests, un compagnon 24/7, une flotte, un GUI Electron : greffer Cordis = tout casser pour un slogan.
2. **Copier du code Harness** (même MIT). Clean-room. Les idées tiennent en invariants ; le code Cordis vendu dans `vendor/` n'entre pas dans ce dépôt.
3. **Réécrire le cœur** (`agent-executor.ts` / `runTurnLoop`, `client.ts` en micro-noyau, fusionner RunStore + historique chat en un seul log Harness-like d'un coup). La Trajectory unifiée est une **vue** et des événements **additifs**, pas un big-bang event-sourcing.
4. **Croire que « inverse » = undo métier.** Implémenter C2 sans taxonomie C5 produira des rollbacks partiels silencieux — pire que pas d'undo.
5. **Ouvrir un Creator Mode qui exécute du JS généré dans le process hôte.** C'est le trou #454. Notre G4 + sandbox cwd est la ligne à tenir.
6. **Chasser les étoiles GitHub / les modes PTC / Minimal** comme différenciateurs. PTC est un transport d'outils ; nous avons déjà des outils et un registry. Minimal = banc ; nous avons `buddy improve bench`.

---

## 6. Trois affirmations de la vidéo — vérifiées / infirmées

La vidéo mélange Harness, benchmarks de modèles, GrokBot, Mistral, Meta. Trois affirmations **centrales Harness**, confrontées aux sources du 2026-09-06 :

| # | Affirmation vidéo | Verdict | Preuve |
|---|---|---|---|
| 1 | « Sorti le 13/08/2026, licence MIT » | **VRAI** | GitHub API `created_at: 2026-08-13T11:56:32Z` ; `license.spdx_id: MIT` ; fichier LICENSE Copyright 2026 DeepSeek. Reuters confirme aussi la **hausse API 50 %–1 100 %** annoncée le même jour (effet 16 ou 17/08 selon les dépêches) — la stratégie « open-sourcer le châssis / monétiser les tokens » est **plausible**, pas un théorème. |
| 2 | Papier *« Programming Paradigm for Special Temporal Composability »*, 88 pages, Université de Pékin, sorti avec le harness | **FAUX** sur le titre, la pagination arXiv et la date arXiv ; **VRAI** sur PKU | Titre : **Spatiotemporal**. arXiv:2608.25512 soumis **26/08/2026**, **92 pages**. Auteurs Shi/Zhang/Cui, affiliations PKU + DeepSeek-AI **confirmées**. Un preprint GitHub circule dès mi-août ; ce n'est pas « le papier 88 p. du 13/08 ». |
| 3 | « Qwen 3.8 (27 **M** params) dépasse Opus 4 Max » + « chaque action a un inverse, observabilité totale contrairement à Claude Code » | **FAUX** (params) ; **SURVENDU** (inverse / observabilité) | Le modèle public est **Qwen3.8-27B** (27 **milliards**, carte HF). Le tableau Qwen vs **Opus 4.6 Max** est **mixte** (Qwen gagne SWE-bench Pro 61.7 vs 53.4, perd Terminal-Bench 73.0 vs 78.2). « 27 M » et « Opus 4 Max » sont des artefacts de transcription. L'inverse du papier **ne couvre pas** les outils. L'observabilité Harness est un **bon log de session** ; Code Buddy a déjà RunStore + export rédigé + audit ; SAFETY.md + audit #454 interdisent de vendre « rien n'est caché / prod-ready ». |

Contrôle hors périmètre mais cité par la vidéo : **Grok 4.6 à 2 $/M input et 6 $/M output** — **VRAI** au tarif xAI documenté (`https://x.ai/docs/developers/pricing.md`, palier &lt; 200k). Ce n'est pas un argument pour adopter Harness.

---

## 7. Bilan (≤ 10 lignes)

Étude clean-room livrée dans ce seul fichier. Sources officielles lues : dépôt `deepseek-ai/deepseek-harness` (MIT, créé 2026-08-13T11:56:32Z), README + architecture + primer + SAFETY, page `deepseek.com/harness/en/`, arXiv:2608.25512 (26/08, 92 p., Spatiotemporal, PKU+DeepSeek). Aucun code Harness copié, aucun `~/code-buddy` / `~/.codebuddy` écrit, aucun push, ComfyUI intact. Cartographie Code Buddy : plugins isolés mais inscriptions non réversibles ; Trajectory **éclatée** (RunStore + export rédigé déjà là, pas de vue unique) ; undo fichiers + diff-review fail-closed + G4 held-out **en avance** sur Creator Harness ; `client.ts` déjà dispatcher à une stratégie. À prendre : log reconstructible, effets réversibles **de plugins**, taxonomie émission vs inverse. À refuser : Cordis comme cœur, inverse magique des outils, JS généré in-process. Sept chantiers opt-in, jamais le runtime.

ETUDE HARNESS: 7 chantiers proposés
