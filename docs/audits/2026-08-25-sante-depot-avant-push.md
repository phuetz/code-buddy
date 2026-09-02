# Santé du dépôt avant push — `fix/shorts-decimaux-karaoke`

**Date de la mesure :** 2026-08-25, ~06:00–06:20 CEST
**Machine :** ministar (Linux) · `/home/patrice/code-buddy`
**HEAD :** `6a889e67` — *fix(shorts): sonder le quota à son coût réel, et voir toutes les cartes*
**origin/main :** `63278824` (2026-08-23) · `FETCH_HEAD` rafraîchi le 2026-08-25 06:04
**Working tree :** propre (aucune modification non commitée au début de l'audit)

> Portée : **mesure uniquement**. Aucune correction, aucun commit, aucun push, aucune branche créée.
> Seul fichier écrit : ce rapport.

---

## Verdict

### ⚠️ À CORRIGER D'ABORD — mais le défaut n'est pas dans le code de la branche

**La branche a divergé : elle est 367 commits en avance ET 136 commits en retard sur `origin/main`, avec 176 fichiers modifiés des deux côtés — un push direct est impossible en fast-forward et une intégration sans rebase/merge préalable de `main` est une opération à haut risque de conflit.**

En revanche, **la qualité intrinsèque de la branche est bonne** :

- typecheck, lint, build et détection de cycles : **tous verts** ;
- **aucun** des 69 tests en échec n'est imputable aux 367 commits — les 5 fichiers concernés n'ont **jamais été touchés par la branche**, et `main` contient déjà les commits qui les réparent ;
- **aucun secret, aucune clé privée, aucun binaire ajouté**, **aucun chemin absolu `/home/patrice` dans `src/`, `tests/` ou `cowork/src/`**.

Le geste à faire avant de pousser est donc **une intégration de `main` (rebase ou merge), pas une campagne de réparation**.

---

## Tableau des mesures

| Mesure | Commande | Résultat | Durée |
|---|---|---|---|
| Typage | `npm run typecheck` | ✅ **0 erreur** (`tsc --noEmit` + projet `gpuNode-identity`) | **18,0 s** |
| Lint | `npm run lint` | ✅ **0 erreur**, ⚠️ 2 445 warnings (7 auto-corrigeables) | **38,8 s** |
| Build | `npm run build` | ✅ **succès** — `tsc` + 8 skills copiés + manifeste runtime généré | **20,7 s** |
| Dépendances circulaires | `npm run check:circular` | ✅ **6 cycles, tous connus et acceptés** | **14,6 s** |
| Suite de tests | `npx vitest run --reporter=dot` | ⚠️ **69 tests en échec / 35 108**, 5 fichiers / 1 675 | **80,6 s** |
| — fichiers | | 1 669 réussis · **5 échoués** · 1 ignoré | |
| — tests | | 35 035 réussis · **69 échoués** · 4 ignorés | |
| — erreurs hors test | | 1 rejet non capturé (voir §3) | |
| Divergence git | `git log HEAD..origin/main` | 🔴 **136 commits de retard** (367 d'avance) | — |
| Base de fusion | `git merge-base` | `f9a31a7e` — **2026-08-09** (16 jours) | — |

**Note sur la durée des tests :** le budget alloué était de 3 000 s (50 min). La suite complète a
terminé en **80,6 s de temps mural** (626 s de temps test cumulé, parallélisé sur les forks).
**Aucune troncature, aucune extrapolation** : les chiffres ci-dessus portent sur l'exécution
intégrale des 1 675 fichiers de test. Code de sortie vitest : `1`.

---

## 1. Forme des 367 commits

### Répartition par type (Conventional Commits)

| Type | Nombre | Part |
|---|---:|---:|
| `docs` | 162 | 44 % |
| `feat` | 130 | 35 % |
| `fix` | 58 | 16 % |
| `merge` | 10 | 3 % |
| `test` | 4 | 1 % |
| `chore` | 2 | <1 % |
| `perf` | 1 | <1 % |

**Auteur unique :** Patrice — 367/367 commits.

### Volume

Mesuré depuis la **base de fusion** `f9a31a7e` (et non depuis `origin/main`, qui a avancé de son côté) :

```
669 fichiers modifiés, +119 898 insertions, −2 668 suppressions
```

> ⚠️ `git diff --shortstat origin/main..HEAD` annonce « 1 294 fichiers, +102 250 / −20 197 ».
> **Ce chiffre est trompeur** : il compte comme « suppressions de la branche » les 625 fichiers
> ajoutés par les 136 commits de `main` que la branche n'a pas. Le chiffre juste est celui
> ci-dessus. **La branche ne supprime aucun fichier** (`--diff-filter=D` depuis la base : 0).

### Répartition par zone

| Zone | Fichiers touchés |
|---|---:|
| `scripts/` | 206 |
| `tests/` | 160 (dont **107 nouveaux fichiers de test**) |
| `src/` | 160 (70 ajoutés, 90 modifiés) |
| `docs/` | 75 |
| `cowork/` | 41 |
| `buddy-vision/` | 6 |
| `examples/` | 2 |
| racine | `package.json`, `README.md`, `.gitignore`, `tsconfig.gpuNode-identity.json` |
| `scratch/` | 1 |

### Les 15 fichiers les plus volumineux

| Lignes ajoutées | Fichier |
|---:|---|
| 2 763 | `scripts/influencer/visual-gate.py` |
| 2 425 | `scripts/influencer/veille-youtube.py` |
| 2 054 | `scripts/chaine-controle.py` |
| 1 989 | `scripts/influencer/lisa-presentatrice.py` |
| 1 962 | `scripts/influencer/lisa-decor-a-la-demande.py` |
| 1 897 | `scripts/influencer/longform/assemble_news_long.py` |
| 1 842 | `scripts/influencer/extract-candidates.py` |
| 1 395 | `scripts/lisa-studio/lisa-studio-pipeline.ts` |
| 1 362 | `scripts/influencer/collect-evidence.py` |
| 1 360 | `scripts/mysoulmate/render-youtube-short-batch.ts` |
| 1 343 | `scripts/influencer/flow-daily.py` |
| 1 229 | `scripts/mysoulmate/render-ambre-chalet-video.py` |
| 1 145 | `docs/studies/2026-07-28-raccordement-signal-autoblog.md` |
| 1 008 | `scripts/influencer/publish_queue.py` |
| 958 | `scripts/influencer/wrap-short.py` |

**Lecture :** ce n'est pas une branche de correctif. Les 14 plus gros fichiers sont **tous des
nouveaux outils** (aucune ligne supprimée), et 12 sur 15 relèvent du **pipeline média personnel**
(chaînes Lisa / Ambre, HeyGen, Flow, veille YouTube) — pas du produit Code Buddy.

### Modification de `package.json` par la branche

Minimale et bénigne :

```diff
-    "typecheck": "tsc --noEmit",
+    "typecheck": "tsc --noEmit && npm run typecheck:gpuNode-identity",
+    "typecheck:gpuNode-identity": "tsc --project tsconfig.gpuNode-identity.json",
...
   "files": [
     "dist",
     "codebuddy-runtime.json",
+    "examples/claude_desktop_config.json",
```

---

## 2. La divergence (risque n°1)

```
git merge-base --is-ancestor origin/main HEAD  →  DIVERGENT
367 commits d'avance · 136 commits de retard
base de fusion : f9a31a7e (2026-08-09)
```

**176 fichiers ont été modifiés des deux côtés de la base.** Extrait des plus sensibles :

- `package.json`, `README.md`, `CLAUDE.md`
- `src/agent/execution/agent-executor.ts`, `src/agent/tool-handler.ts`
- `src/codebuddy/tools.ts`, `src/codebuddy/tool-definitions/index.ts`, `.../multimodal-tools.ts`
- `src/agent/self-improvement/` (5 fichiers : `digest.ts`, `digest-sources.ts`, `learning-store.ts`, `continuous-benchmark.ts`, `index.ts`)
- `src/analytics/cost-report.ts`, `src/analytics/repo-explainer.ts`
- `cowork/src/main/index.ts`, `cowork/src/preload/index.ts`, `cowork/src/renderer/components/NewShell.tsx`
- `docs/FABLE5-CODEX-COORDINATION.md` (le fichier de coordination lui-même)

Côté `main`, les 136 commits manquants incluent des changements structurants qui **toucheront la
même surface** : PR #145 (voix contextuelle, 19 fichiers), #146 (binding SQLite Electron),
#144 (`matrix-js-sdk`, `npm ci` cassé sur npm 11 / Node 24), #141 (page GitHub Pages),
#136 (README + captures), #139 (`buddy mcp serve`), #121/#111 (outils Video Studio),
#118 (141 warnings ESLint cowork → 0).

⚠️ **Le chevauchement le plus délicat est `src/codebuddy/tool-definitions/multimodal-tools.ts` et
les outils vidéo** : `main` y a câblé les modules Video Studio (#111, #121) pendant que la branche
construisait son propre pipeline vidéo. C'est là qu'il faut s'attendre aux conflits sémantiques
(pas seulement textuels).

---

## 3. Les 69 tests en échec — détail et imputation

### Ventilation

| Fichier | Tests en échec | Touché par la branche ? | Touché par `main` ? |
|---|---:|---|---|
| `tests/unit/tool-executor.test.ts` | **53** | ❌ non (0 commit) | ✅ oui (`5ea3dfd0`) |
| `tests/unit/web-search.test.ts` | **12** | ❌ non (0 commit) | ✅ oui (`5ea3dfd0`) |
| `tests/server/peer-chat-bridge.test.ts` | **2** | ❌ non (0 commit) | ✅ oui (`13fca4af`, `5ea3dfd0`) |
| `tests/unit/agent-core.test.ts` | **1** | ❌ non (0 commit) | ✅ oui (`5ad15ace`) |
| `tests/docs/public-screenshots.test.ts` | **1** | ❌ non (0 commit) | ✅ oui (`3d4c00e2`, `90f38792`) |

**Aucun des 5 fichiers n'a été modifié par les 367 commits de la branche.** Les fichiers source
correspondants non plus (`src/agent/tool-executor.ts`, `src/tools/web-search.ts`,
`src/tools/index.ts` : 0 commit des deux côtés ; `src/fleet/peer-chat-bridge.ts` : 0 côté branche).

### Preuve que `main` a déjà réparé ces cas

1. `main` porte un commit dont le titre dit exactement cela :
   **`5ea3dfd0 — test: repair pre-existing test/source drift for the Ubuntu gate`**, qui touche
   `tool-executor.test.ts`, `web-search.test.ts` et `peer-chat-bridge.test.ts`.
2. Le mock manquant est **présent sur `main`** :
   `git diff <base>..origin/main -- tests/unit/tool-executor.test.ts` montre l'ajout de
   `+  WebScrapeTool: jest.fn().mockImplementation(...)`.
3. Le compteur d'ancres README est **recalibré sur `main`** :
   la branche exécute `expect(...).toBe(22)` (obtenu : 23) ; `origin/main` contient déjà
   `expect(...).toBe(24)` (`git show origin/main:tests/docs/public-screenshots.test.ts:218`).

**Conclusion : les 69 échecs sont une dette héritée de la base de fusion du 2026-08-09, déjà soldée
sur `main`. Ils devraient disparaître à l'intégration. Zéro régression imputable à la branche.**

### Messages d'erreur, par famille

**A — `tests/unit/tool-executor.test.ts` (53 échecs, cause unique)**

```
Error: [vitest] No "WebScrapeTool" export is defined on the
"/home/patrice/code-buddy/src/tools/index.ts" mock. Did you forget to return it from "vi.mock"?
```
Le `vi.mock` de `src/tools/index.ts` ne déclare pas `WebScrapeTool`, que le code de production
importe désormais. Les 53 cas (Constructor, view_file, create_file, str_replace_editor, Bash,
Search, Web Operations, Todo…) tombent tous sur cette même erreur au `beforeEach`.

**B — `tests/unit/web-search.test.ts` (12 échecs)** — dérive entre le format de sortie du scraper
et les assertions :
- `tests/unit/web-search.test.ts:550` — `expected true to be false` (objet non-`Error` levé)
- `tests/unit/web-search.test.ts:599` — `expected 'No results found for: "test"' to contain '1.'`
- 8 assertions `expected 'Content from https://example.com:\n\n…' to contain …`
  (`'Visible content'`, `'Main content'`, `'[Content truncated...]'`, `'B'`, `'–'`)
- `expected 'Failed to fetch page: Page request fa…' to contain '404 Not Found'`
- 2 × `expected "vi.fn()" to be called with arguments: [ 'https://example.com', …(1) ]`

**C — `tests/server/peer-chat-bridge.test.ts` (2 échecs)** — le pont passe désormais un
`maxTokens` par défaut que le test n'attend pas :
- ligne 205 : `expected { maxTokens: 4096 } to be undefined`
- ligne 318 : `expected { model: 'grok-3-mini-fast', maxTokens: 4096 } to deeply equal { model: 'grok-3-mini-fast' }`

**D — `tests/unit/agent-core.test.ts` (1 échec)** — signature d'appel bash élargie :
```
expected [ StringContaining "ls -la", undefined, Any<String> ]
received [ "ls -la", undefined, "/home/patrice/code-buddy", undefined ]
```

**E — `tests/docs/public-screenshots.test.ts` (1 échec)** — ligne 218 :
`expected 23 to be 22`. Le README de la branche a gagné une ancre (3 commits `README.md` côté
branche) ; `main` attend déjà 24.

### Erreur hors test (1)

```
Unhandled Rejection: ENOENT: no such file or directory,
open '/tmp/enhanced-mem-nHNZRj/.codebuddy/memory/bayesian-state.json'
  → originaire de tests/memory/enhanced-memory-recall.test.ts
```
Le fichier de test **passe** malgré tout. Rejet asynchrone échappé après nettoyage du dossier
temporaire — bruit à surveiller (source possible de flaky en CI), pas un échec.

---

## 4. Ce qui pourrait mordre

> Toutes les recherches ci-dessous ont été refaites depuis la **base de fusion** (`f9a31a7e..HEAD`),
> pour ne mesurer que ce que la branche apporte réellement.

### ✅ Ce qui est propre

| Contrôle | Résultat |
|---|---|
| Clés privées (`BEGIN … PRIVATE`) | **0 occurrence** |
| Motifs de clés connues (`sk-`, `sk-ant-`, `xoxb-`, `ghp_`, `AIza`, `hf_`, `xai-`, `AKIA`) | **0 occurrence** |
| Fichiers binaires / médias ajoutés | **0** (`git diff --stat` : aucune ligne `Bin`) |
| `/home/patrice` dans `src/` | **0** |
| `/home/patrice` dans `tests/` | **0** |
| `/home/patrice` dans `cowork/src/` | **0** |
| `/home/patrice` dans `.github/` | **0** |
| Fichiers supprimés par la branche | **0** |

Les 4 correspondances brutes du grep « secrets » sont toutes des faux positifs bénins :

| Fichier | Ligne | Valeur | Nature |
|---|---|---|---|
| `tests/**` (GPU worker) | ×2 | `'a-secret-token-longer-than-24-bytes'` | fixture de test, littérale |
| `tests/**` (ElevenLabs) | ×1 | `ELEVENLABS_API_KEY: 'available-but-paid'` | sentinelle de test |
| `scripts/influencer/lisa-presentatrice.py` | 64 | `ca66500fbb7f4abf8a43e5d413753cc5` | jeton d'aperçu HeyGen — **voir risque n°2** |

### 🔴 Risque n°1 — Divergence de 136 commits (bloquant)

Détaillé au §2. **176 fichiers en collision potentielle**, dont la surface outils/vidéo que
`main` a réécrite en parallèle. Un `git push` échouera ; un merge naïf produira des conflits sur
des fichiers structurants (`agent-executor.ts`, `tools.ts`, `multimodal-tools.ts`,
`self-improvement/*`, `cowork/src/main/index.ts`).

### 🟠 Risque n°2 — Identifiants de comptes tiers en clair dans un dépôt public

Le dépôt est public (le `.gitignore` de la branche le dit explicitement :
*« Le dépôt est public — elles sont sauvegardées hors dépôt dans ~/Sauvegardes-git/ »*).
Ce ne sont pas des secrets d'authentification, mais ce sont des **identifiants de comptes
personnels et d'un tiers**, exposés en dur :

| Fichier | Ligne | Valeur | Nature |
|---|---:|---|---|
| `scripts/influencer/lisa-presentatrice.py` | 62 | `LISA_VOICE_ID = '3fxbs2pB9bs8S6Z1N38A'` | ID de voix ElevenLabs (compte Patrice) |
| `scripts/influencer/lisa-presentatrice.py` | 63 | `DEFAULT_AVATAR_ID = '4507aec10b6f4cdbab4262180308bb69'` | ID d'avatar HeyGen (compte Patrice) |
| `scripts/influencer/lisa-presentatrice.py` | 64 | `DEFAULT_AVATAR_PREVIEW_TOKEN = 'ca66500fbb7f4abf8a43e5d413753cc5'` | jeton d'aperçu HeyGen — **le seul qui ressemble à un identifiant de session** |
| `scripts/influencer/veille-youtube.py` | (`VISION_IA_CHANNEL_ID`) | `'UCyc03X3uRuxM9n7fyRH_gIw'` | `channel_id` YouTube d'un **concurrent nommément ciblé** |
| `docs/` (étude veille) + `docs/**.json` | plusieurs | même `channel_id`, `"vision_ia_channel_id"` | idem, en documentation publique |

Deux problèmes distincts :
1. **Technique** — `DEFAULT_AVATAR_PREVIEW_TOKEN` est un jeton HeyGen : à vérifier s'il donne
   accès à quoi que ce soit hors session, et à sortir du code dans le doute.
2. **Réputationnel** — publier du code et de la documentation qui **nomment, ciblent et
   instrumentent la chaîne d'un concurrent** (extraction de candidats, décodage de format,
   filtrage par `channel_id`) dans un dépôt public qui sert de carte de visite. C'est un
   arbitrage pour Patrice, pas un défaut technique.

### 🟠 Risque n°3 — Le dépôt produit devient un atelier média personnel

**206 des 669 fichiers (31 %) sont dans `scripts/`**, et l'essentiel du volume (les 14 plus gros
fichiers, ~24 000 lignes) est un pipeline de production vidéo personnel : `scripts/influencer/`,
`scripts/mysoulmate/`, `scripts/gpuNode/`, `scripts/lisa-studio/`, `scripts/chaine-controle.py`.
S'y ajoutent :

- **44 chemins absolus `/home/patrice`** figés dans ces scripts — ils ne tourneront que sur
  ministar. Les plus concernés :
  `scripts/gpuNode/repair-wardrobe-qwen.mjs` (9), `scripts/gpuNode/rerender-ghost-contour-clips.sh` (5),
  `scripts/influencer/publication-manifest.example.json` (4), `scripts/overnight-lisa-pipeline.sh` (3),
  `scripts/gpuNode/replay-identity-composites.ts` (3), `scripts/gpuNode/repair-ambre-shorts-residuals-qwen.mjs` (3),
  `scripts/gpuNode/benchmark-krea2-local.mjs` (3), puis 8 fichiers à 1–2 occurrences.
  Exemples : `'/home/patrice/Videos/personas/garde-robe-reparee'`,
  `'/home/patrice/.codebuddy/personas/lisa/identity-kit/lisa-hotel-2.png'`,
  `ROOT = Path("/home/patrice/Videos/personas")`.
  **Aucun n'est dans le produit** (`src/`, `tests/`, `cowork/src/` : 0) — l'invariant tient.
- **68 occurrences supplémentaires dans `docs/`** (rapports d'exécution, chemins de preuve).
- `scratch/cdp-site-audit.py` — un fichier de brouillon versionné à la racine.

Ce n'est pas un défaut de correction, c'est une **question de périmètre** : faut-il que le dépôt
vitrine de Code Buddy héberge la chaîne de production YouTube ?

### 🟡 Point mineur — 2 445 warnings ESLint

Zéro erreur, donc le lint passe. Dominante : `@typescript-eslint/no-explicit-any` et
`no-unused-vars`, très majoritairement dans `tests/`. 7 sont auto-corrigeables (`--fix`).
Pour mémoire, `main` a mené la campagne inverse côté Cowork (#118 : 141 → 0).

### 🟡 Point mineur — la suite de tests écrit dans un fichier suivi par git

Constaté pendant cet audit : le working tree était **propre** au démarrage, et l'exécution de
`npx vitest run` a laissé une modification :

```
 M .codebuddy/agent-memory/alice/MEMORY.md   (+4 lignes, horodaté 06:05:08, pendant le run)
```

```diff
+## 2026-08-25
+
+done
```

Un test écrit dans un fichier **versionné** du dépôt au lieu d'un dossier temporaire. Conséquences :
tout `npm test` salit le working tree, et le fichier grossit d'une entrée par jour d'exécution.
Cette modification a été **laissée en l'état** (l'audit ne corrige rien) — elle est à annuler
(`git checkout -- .codebuddy/agent-memory/alice/MEMORY.md`) avant tout commit, sous peine de partir
dans le prochain `git add -A`.

---

## Ce qu'il faudrait faire avant de pousser (hors périmètre de cet audit)

1. **Intégrer `origin/main`** (merge ou rebase) et retraiter les 176 fichiers en chevauchement —
   en particulier la surface outils/vidéo. C'est le seul geste vraiment bloquant.
2. **Rejouer la suite complète après intégration** : l'hypothèse vérifiable est que les 69 échecs
   tombent à 0 (les correctifs sont déjà sur `main`). Si ce n'est pas le cas, la mesure aura
   révélé un vrai conflit sémantique.
3. **Décider** du sort de `DEFAULT_AVATAR_PREVIEW_TOKEN` et des identifiants de comptes.
4. **Décider** du périmètre : `scripts/influencer|mysoulmate|gpuNode|lisa-studio` et `scratch/`
   restent-ils dans le dépôt public ?

---

*Rapport produit par mesure directe. Aucune commande n'a dépassé son budget de temps ; la suite de
tests a tourné intégralement (80,6 s pour un budget de 3 000 s). Aucun chiffre n'est extrapolé.*
