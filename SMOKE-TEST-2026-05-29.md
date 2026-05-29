# Smoke-test « clone à blanc » — 2026-05-29

> But : simuler un **nouvel utilisateur** qui installe Code Buddy *from source* et fait ses premières actions, et **journaliser chaque friction réelle**. C'est le test qui répond factuellement à « est-ce vraiment utilisable ? » — il n'ajoute presque pas de code, il *observe*.

## Méthode

- Clone propre de l'état réel (`tmp-self-improve-default`, HEAD `97b23ddd`) dans un dossier temp, **sans `node_modules`** (vrai départ à blanc).
- Chemin testé : **from source** (docs `getting-started.md`) → `npm install` → `npm run build` → `node dist/index.js …`.
- Pas de fan-out d'agents. Observation locale uniquement. Aucun appel LLM réel facturé sans accord explicite (étape « première tâche utile » déférée).

## Environnement de départ

| Élément | Valeur |
|--------|--------|
| OS | Windows 11 Pro 10.0.28020 |
| Node | v24.14.0 |
| npm | 11.8.0 |
| git | 2.51.1 |
| Lockfile | `package-lock.json` présent (install déterministe possible) |
| `engines` | `node >=18.0.0` (⚠️ testé sur Node 24 — modules natifs à surveiller) |

## Étapes & frictions

| # | Étape | Résultat | Friction |
|---|-------|----------|----------|
| 1 | `git clone` + checkout branche | ✅ HEAD 97b23ddd, 72 fichiers racine, pas de node_modules | — |
| 2 | `npm install` | ✅ exit 0, **1 min**, 1625 paquets, **0 échec de build natif** sur Node 24 | F3 (audit) |
| 3 | `npm run build` (`tsc`) | ✅ exit 0 | — |
| 4 | `node dist/index.js --version` | ✅ `1.0.0-rc.8`, **démarrage à froid 0,2 s** | — |
| 5 | `node dist/index.js --help` | ✅ propre, complet | F4 (cosmétique) |
| 6 | `buddy doctor` | ✅ **1,57 s**, exit 0, « 8 passed / 11 warnings / 0 errors », warnings actionnables | — |
| 7 | Première tâche utile (LLM réel, gpt-5.5 via login ChatGPT) | ✅ boucle complète OK (auto-provider → `view_file` → réponse correcte, exit 0, 31 s) | **F5/F6/F7/F8** |
| A | Chemin **recommandé** `npm install -g @phuetz/code-buddy` | ⚠️ installe **0.4.0** (publiée 22/02/2026) | **F1 (bloquant newcomer)** |
| B | Badges README (Tests/Coverage) | ⚠️ `27 334` / `85 %` affichés | **F2 (crédibilité)** |

## Frictions relevées (détail)

### F1 — Le chemin d'install n°1 livre un outil périmé (BLOQUANT pour un nouveau venu)
- README « Quick Start » et `getting-started.md` recommandent en **premier** : `npm install -g @phuetz/code-buddy` (et `npx @phuetz/code-buddy@latest`).
- Or `npm view @phuetz/code-buddy version` → **`0.4.0`**, `dist-tags.latest = 0.4.0`, dernière publication **2026-02-22**.
- État réel du dépôt = `1.0.0-rc.8` (≈ 3 mois + une ligne majeure d'avance). **Un utilisateur qui suit la page d'accueil reçoit un produit d'il y a 3 mois**, sans le Fleet Hub, sans Cowork à jour, sans les durcissements GA.
- **Seul** le chemin *from source* (clone + build) donne l'état actuel — mais il est présenté en 3ᵉ position, « pour développeurs ».
- **Correctif :** soit publier `1.0.0-rc.8` sur npm (idéalement sous un tag `next` puis `latest` à la GA), soit, tant que ce n'est pas publié, réordonner le README pour mettre *from source* en tête et signaler que npm est en retard. **C'est le geste « utilisable » à plus fort levier : le code est très en avance sur ce que les gens peuvent réellement installer.**

### F3 — `npm install` propre annonce 67 vulnérabilités prod (12 high)
- Bonne nouvelle : l'install **réussit** (exit 0, 1 min) et **aucun module natif n'échoue** sur Node 24 (les prebuilds suffisent — `better-sqlite3`, `usearch`, etc. n'ont pas cassé). C'est un point « utilisable » solide.
- Mais `npm audit --omit=dev` (ce qu'un utilisateur expédie réellement) → **67 vulnérabilités prod : 12 high / 34 moderate / 21 low** (785 deps prod). Transitives, p.ex. `music-metadata` (boucle infinie ASF), `picomatch` (ReDoS extglob).
- 90 lignes `npm warn` à l'install (surtout du bruit `ERESOLVE` peer-dep via `react-native-fs`, optionnel — pas un blocage Node 24, mais intimidant pour un nouveau venu).
- **Note :** `PLAN-NPM-AUDIT-2026-05.md` a déjà traité la racine ; ces 12 high sont **transitifs** et beaucoup probablement non-exploitables en l'état. Mais un évaluateur lit « 14 high » à l'install → mauvais signal. **À faire :** re-passer l'audit transitif (overrides ciblés `music-metadata`/`picomatch`) ou documenter l'inapplicabilité dans `SECURITY.md`.

### F2 — Badges README périmés (crédibilité)
- README affiche `Tests 27,334` et `Coverage 85%`. Réel ≈ 29 116 tests ; le seuil de couverture configuré est **70 %** (on vient d'aligner `tests/README.md` dessus dans la PR #42). Un évaluateur qui vérifie verra l'écart. Aligner ou rendre les badges dynamiques.

### F4 — Cosmétique (faible)
- `--help` affiche `Usage: codebuddy [options]` alors que les binaires sont `buddy` / `code-buddy` et le produit « Code Buddy ». Harmoniser le `program.name()`.
- `buddy doctor` sur un clone neuf liste 11 warnings (ripgrep, sox, RTK, ICM, audio, 4 clés API, config.json, schéma settings). Tous légitimes, mais le volume peut intimider. Piste : grouper « optionnel » vs « requis pour démarrer » et pointer vers `buddy onboard` / `--fix`.

### F6 — 🔴 VRAI BUG : `import * as fs from 'fs-extra'` casse fs au runtime (3 fonctionnalités mortes)
**Le smoke-test a trouvé un bug que les ~29K tests n'attrapent pas** (les tests *mockent* fs-extra ; le build réel non).

Symptôme observé pendant l'étape 7 :
```
❌ Failed to initialize WorkspaceIndexer {"error":"TypeError: fs.existsSync is not a function"}
❌ Workspace indexing failed: {"error":"TypeError: fs.writeFileSync is not a function"}
```

Cause : sous ESM (Node 24), `import * as fs from 'fs-extra'` ne donne **que** les helpers propres à fs-extra ; les méthodes node-fs sont `undefined` sur le namespace. Probe direct :

| méthode | via `import * as fs` | via `import fs` (default) |
|---|---|---|
| `existsSync` / `writeFileSync` / `readFileSync` | ❌ undefined | ✅ function |
| `writeFile` / `readFile` / `appendFile` | ❌ undefined | ✅ function |
| `pathExists` / `ensureDir` | ✅ function | ✅ function |

Fichiers touchés (3) et impact runtime :
- `src/knowledge/workspace-indexer.ts:10` → `existsSync`/`writeFileSync`/`readFileSync` ⇒ **indexation sémantique du workspace morte** (confirmé runtime).
- `src/tools/plan-tool.ts:4` → `writeFile`/`readFile`/`appendFile` ⇒ **persistance `/plan` cassée** (sauvegarde/chargement de plan).
- `src/tools/submit-plan-tool.ts:5` → `writeFile` ⇒ **`submit_plan` casse** après `ensureDir`.

**Correctif (trivial, uniforme, vérifié) :** remplacer dans les 3 fichiers `import * as fs from 'fs-extra';` par `import fs from 'fs-extra';` (le default export expose toutes les méthodes). Effort S, risque faible. À ajouter une garde de test qui charge le *vrai* fs-extra (pas le mock) sur ces chemins.

> ✅ **CORRIGÉ + VÉRIFIÉ (2026-05-29).** Les 3 imports passés en default. Rebuild `tsc` exit 0 (types OK). Re-run E2E sur le build frais :
> - Avant : `❌ Failed to initialize WorkspaceIndexer {"error":"fs.existsSync is not a function"}` + `❌ Workspace indexing failed {"error":"fs.writeFileSync is not a function"}` (2 lignes ❌)
> - Après : `Workspace indexing complete: 1 files, 1 chunks.` — **0 ligne ❌**, indexation sémantique réellement fonctionnelle.

### F7 — Routage de modèle incohérent (fallback gpt-4o → gpt-5.2)
Pendant l'étape 7, malgré l'auto-provider `gpt-5.5` :
```
⚠️ Model "gpt-4o" rejected by backend. Auto-falling back to "gpt-5.2".
```
Un sous-chemin (probablement embeddings/indexation ou un appel secondaire) demande encore `gpt-4o`, rejeté par le backend Codex, puis retombe sur `gpt-5.2` — alors que le modèle principal est `gpt-5.5`. Trois modèles différents dans un seul run. À tracer (probablement un défaut codé en dur, cf. `model-tools.ts` / chemin embeddings).

### F8 — Coût affiché `$0.02` malgré le forfait ChatGPT
README/`getting-started.md` annoncent « cost $0.0000 » avec le login ChatGPT (forfait). Le run réel affiche `cost: $0.02` (4 726 in / 56 out). Le tracker de coût estime au tarif token sans reconnaître le chemin forfaitaire flat-fee. Soit corriger l'affichage (→ $0.00 / « inclus dans l'abonnement »), soit nuancer la promesse marketing.

### F5 — Bruit `GLib-GObject-CRITICAL` en sortie headless (faible)
8 lignes `GLib-GObject-CRITICAL **: invalid unclassed type '(NULL)'` polluent la sortie d'un run CLI headless (probablement une dep native GUI/clipboard/notification qui tente de s'initialiser hors contexte graphique). Sans impact fonctionnel (la tâche réussit) mais salit la sortie et inquiète. À identifier (init paresseuse / garde headless).

## Ce qui marche (à ne pas perdre de vue)
- **Install from-source vert de bout en bout sur Node 24**, en ~1 min, **sans aucun échec de module natif** — c'est le piège habituel des gros projets, et il est évité.
- **Démarrage à froid 0,2 s** (`--version`) — bien en dessous des 1-2 s annoncés.
- **`buddy doctor` est un excellent accueil** : rapide, exit propre, diagnostic actionnable, auto-fix proposé.
- `--version` rapporte la **vraie** version (`1.0.0-rc.8`) : le binaire local est honnête, c'est uniquement la **distribution npm** qui ment (F1).

## Verdict

**Le chemin d'install est propre ; mais faire *tourner une vraie tâche* a révélé un vrai bug — exactement la valeur du dogfooding sur les tests unitaires.**

De bout en bout, l'expérience *from source* est solide : `npm install` (1 min, 0 échec natif sur Node 24) → `npm run build` (exit 0) → `buddy --version` (0,2 s, bonne version) → `buddy doctor` (1,57 s, diagnostic clair) → **boucle agentique E2E OK** (gpt-5.5 via login ChatGPT, appel d'outil, réponse correcte, exit 0).

| Priorité | Friction | Nature | Geste |
|----------|----------|--------|-------|
| 🔴 **P0** | **F1** — `npm install -g` livre `0.4.0` (3 mois de retard) | livraison | **Publier `1.0.0-rc.8` sur npm** (tag `next`), ou réordonner le README vers *from source* en attendant |
| ✅ **CORRIGÉ** | **F6** — `import * as fs from 'fs-extra'` cassait fs au runtime (indexation sémantique + `/plan` + `submit_plan`) | **code (bug)** | ✅ fait : `import fs from 'fs-extra'` (3 fichiers), rebuild + E2E vérifiés |
| 🟡 P1 | **F3** — 67 vulns prod transitives (12 high) | deps | Overrides `music-metadata`/`picomatch` ou note `SECURITY.md` |
| 🟡 P1 | **F7** — routage modèle incohérent (gpt-4o→gpt-5.2 alors que principal=gpt-5.5) | code | Tracer le chemin qui demande gpt-4o |
| 🟡 P2 | **F2** — badges README périmés | présentation | Aligner ~29K / 70 % |
| 🟡 P2 | **F8** — coût `$0.02` affiché malgré forfait ChatGPT | UX | Afficher $0.00 « inclus » sur le chemin flat-fee |
| ⚪ P3 | **F4/F5** — `codebuddy` vs `buddy`, warnings doctor, bruit GLib | cosmétique | Polish |

**Conclusion pour « est-ce vraiment utilisable ? »** :
- Pour *toi* / quiconque clone : l'outil **s'installe, se build, démarre vite et la boucle agentique tourne** — donc **oui, le socle est utilisable**.
- Mais deux choses cassent l'expérience réelle : (1) un inconnu qui suit la page d'accueil reçoit **0.4.0**, un produit d'il y a 3 mois ; (2) deux features (indexation sémantique, `/plan`) sont **silencieusement mortes dans le build** à cause d'un import — invisibles aux tests parce qu'ils mockent fs.

**La leçon stratégique se confirme noir sur blanc : le levier n'est pas d'ajouter du code, c'est de durcir au contact du réel.** Un seul vrai run a trouvé plus de problèmes réels que la suite de 29K tests sur ces chemins. La suite logique = (a) publier npm, (b) corriger F6 (trivial), (c) une vraie passe de dogfooding.
