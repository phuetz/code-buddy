# REPARATION-PHOTO-FR-FILESEARCH-GROK — souvenir photo en français + `file_search` ancré sur le cwd

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Worktree : `~/DEV/cb-photo-fr-2026-09-06`
Branche : `fix/photo-memoire-fr-2026-09-06`
HEAD au départ : `631071f6f` (`Merge branch 'fix/failover-handoff-2026-09-06' into codex/audit-systeme-nerveux-2026-09-01`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection**.
HOME temporaire : `_qa/pf/home`. Aucune écriture dans le vrai `~/.codebuddy`.
Ollama : `http://127.0.0.1:11435`. Modèles autorisés : `qwen3:4b-instruct` et `moondream` uniquement.

Source des réserves : `docs/reports/2026-09/PHOTOS-PARTAGEES-OPUS.md` § 10 (description moondream anglaise dans `photos:recent`).

## Mission

Deux réserves ouvertes :

1. **Souvenir en français.** Quand la description vient du VLM local (anglais), la ligne mémoire `photos:recent` et le sidecar `descriptionLisa` passent par un court résumé FRANÇAIS produit par le modèle compagnon courant (≤ 25 mots, une phrase, à la première personne de Lisa : « tu m'as montré … »), avec repli déterministe (traduction des 30 mots de couleur/forme/lieu les plus fréquents) si le modèle est indisponible ; jamais d'anglais brut dans `<recent_photos>`.
2. **`file_search` en `-p`.** Reproduire d'abord (dossier temporaire à 3 fichiers, `CODEBUDDY_PROVIDER=ollama … node dist/index.js -p "liste les fichiers du dossier courant"` après `npm run build`) — l'outil cherche depuis la racine du dépôt ou du cwd ? Corriger pour que la racine par défaut soit `process.cwd()` (le dossier de lancement), sans casser l'usage interactif dans un dépôt (test des deux cas).

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-photo-fr-2026-09-06/_qa/pf/home` et `env -u FORCE_COLOR`.
- Ports ≥ 5200. ComfyUI 8188/8189 non touché.
- Jamais `/home/<user>` ni prénom dans les fichiers suivis (écrire `~`).
- Un commit par point. `git add` fichier par fichier.
- Pas de verdict dans ce rapport (le pilote le fera).

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `631071f6f`. Branche déjà extraite. Réservation commitée `c79e8bf2f`.

### Inspection

- `photoMemoryLine` préfixe « tu m'as montré » + le texte VLM **brut**. Moondream est anglophone → `photos:recent` et le sidecar `descriptionLisa` gardaient « a large red circle… ».
- `FileSearchTool.safeRoot` exigeait un chemin **absolu**. `root` omis, `""` ou `"."` → `root must be absolute`. L'adaptateur authored ne transmettait pas `context.cwd`. En `-p`, le modèle devait inventer un absolu (souvent la racine du dépôt lue dans le prompt).

### Implémentation (un commit par point)

| Point | Commit | Contenu |
|---|---|---|
| Réservation | `c79e8bf2f` | Rapport + ligne Fable 5 |
| 1. Souvenir FR | `cf2846575` | `photo-memory-fr.ts` : modèle compagnon ≤ 25 mots, repli 30 lemmes couleur/forme/lieu |
| 2. `file_search` cwd | `ce620261c` | défaut = `context.cwd ?? process.cwd()` ; `root` optionnel ; pas de walk git |

### Reproduction point 2 (dossier `_qa/pf/cwd-probe` : `alpha.txt`, `beta.md`, `gamma.json`)

AVANT (dist à `c79e8bf2f`, lancé depuis le dossier à 3 fichiers) :

```text
cwd: ~/DEV/cb-photo-fr-2026-09-06/_qa/pf/cwd-probe
omitted: { success: false, error: "root must be absolute" }
dotted:  { success: false, error: "root must be absolute" }
withCwd: { success: false, error: "root must be absolute" }
```

L'outil **ne cherchait ni le cwd ni la racine du dépôt** : il refusait tout root non absolu. Le modèle en `-p` devait fournir un absolu (typiquement le dépôt).

APRÈS (dist à `ce620261c`, même dossier) :

```text
cwd: ~/DEV/cb-photo-fr-2026-09-06/_qa/pf/cwd-probe
omitted: { success: true, root: <cwd-probe>, files: ["alpha.txt", "beta.md", "gamma.json"] }
dotted:  { success: true, root: <cwd-probe>, files: ["alpha.txt", "beta.md", "gamma.json"] }
withCwd: { success: true, root: <cwd-probe>, files: ["alpha.txt", "beta.md", "gamma.json"] }
```

Usage interactif dans un dépôt : test Vitest `git init` + sous-dossier — depuis `sub/`, `repo-root-marker` est invisible ; depuis la racine du dépôt, il est trouvé. Pas de `git rev-parse --show-toplevel`.

### Preuves

```text
HOME=~/DEV/cb-photo-fr-2026-09-06/_qa/pf/home env -u FORCE_COLOR \
  npx vitest run tests/companion tests/tools/file-search-tool.test.ts \
  tests/tools/search-tools-context.test.ts tests/security/donnees-personnelles.test.ts
# 91 fichiers : 90 passed / 1 skipped
# 842 tests : 841 passed / 1 skipped / 0 failed
# Skip : tests/companion/gk23-rappels-reel.test.ts (Piper absent du HOME QA)

npx tsc --noEmit -p tsconfig.json    # exit 0
npx eslint . --ext .js,.jsx,.ts,.tsx --quiet    # exit 0
git diff --check    # exit 0
```

### Essai réel headless (point 2)

```text
cd _qa/pf/cwd-probe
HOME=_qa/pf/home CODEBUDDY_PROVIDER=ollama OLLAMA_HOST=http://127.0.0.1:11435 \
  GROK_MODEL=qwen3:4b-instruct CODEBUDDY_DISABLE_MCP=true \
  node dist/index.js --permission-mode dontAsk --allowed-tools file_search \
  --max-tool-rounds 4 -p "liste les fichiers du dossier courant"
```

- Auto-detect `ollama` / `qwen3:4b-instruct` OK.
- Premier tour : `Stream initialization failed … fetch failed` à 5 min, rejoué 3 fois.
- Cause mesurée : `GET http://127.0.0.1:11435/api/ps` ne montre que `qwen3.8-ctx32k:latest` (18 Go VRAM, keep-alive collé). Un `POST /api/generate` 4b a timeout 120 s / 0 octet. Le 4b n'a pas pu charger.
- Repli 90 s APRÈS correctif : même attente, `timeout` exit 124, SIGTERM, aucun appel d'outil.
- Preuve outil (même cwd, `node dist/tools/file-search-tool.js` via `_qa/pf/probe-file-search.mjs`) : collée ci-dessus, 3/3 fichiers.

ComfyUI 8188/8189 non touchés. Aucun push.

### Bilan

1. Souvenir FR : VLM anglais → résumé français (modèle compagnon) ou lexique 30 lemmes ; sidecar + `photos:recent` sans anglais.
2. `file_search` : défaut = dossier de lancement ; interactif dépôt = cwd, pas le toplevel git.
3. Vitest exigé : 90 fichiers verts, 1 skip Piper, 841 tests verts, 0 rouge.
4. `tsc --noEmit` 0 ; eslint `--quiet` 0 ; `git diff --check` 0.
5. Probe 3 fichiers : AVANT refus absolu ; APRÈS les 3 noms du cwd.
6. Live `-p` 4b non conclu : GPU occupé par `qwen3.8-ctx32k` sur `:11435`.
7. Commits `c79e8bf2f` / `cf2846575` / `ce620261c` + documentaire. Aucun push.
