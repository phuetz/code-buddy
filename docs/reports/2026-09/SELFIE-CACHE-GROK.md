# SELFIE-CACHE-GROK — « envoie-moi une photo de toi » sert le cache d'abord

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-selfie-2026-09-06`
Branche : `feat/selfie-cache-2026-09-06`
HEAD au départ : `8c878d393` (`fix(gemini): Gemini 3.x tool round-trip`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code.
HOME temporaire : `_qa/selfie/home`. Aucune écriture dans le vrai `~/.codebuddy`.
Vitest : `HOME=…/_qa/selfie/home` et `env -u FORCE_COLOR`.

## Mission

Dans cet ordre, chacun avec tests rouge→vert :

1. **Cache d'abord** — profil compagnon (Telegram/mobile ET voix) : une demande de photo/selfie/portrait de Lisa (motifs FR/EN, avec ou sans style) → réponse IMMÉDIATE avec un selfie du cache du palier autorisé (`CONTENT_TIER` + gate). Rotation anti-répétition (jamais la même image deux fois de suite). Légende dans la persona. La génération n'enrichit que le cache. Router explicite AVANT le LLM (pas seulement une description d'outil).
2. **Mise en cache de tout selfie généré** — quand `image_generate` / l'outil selfie produit une image de Lisa, copie dans `CODEBUDDY_LISA_SELFIE_CACHE_DIR/<tier>/<style>/` (nom horodaté + hash, sidecar JSON). Plafond `CODEBUDDY_LISA_SELFIE_CACHE_MAX` (défaut 200), éviction des plus anciennes non favorites. Jamais dans le dépôt.
3. **Remplissage en arrière-plan** — opt-in `CODEBUDDY_LISA_SELFIE_REFILL=true`. Traitement de battement (comme `system-vitals`) : ComfyUI joignable ET load < N → une image par cycle jusqu'à un minimum par palier/style. Never-throws. S'arrête si le générateur est injoignable. Tests : générateur factice seulement.

## Invariants

- Code public. Jamais `/home/<user>`, prénom, secret, ni image réelle dans les fichiers suivis (fixtures = PNG 1×1 générés dans le test).
- `git add` nommément fichier par fichier. Commit par point.
- Aucun push. ComfyUI 8188/8189 non touché.
- Byte-identique sans persona compagnon.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-selfie-2026-09-06/_qa/selfie/home` et `env -u FORCE_COLOR`.
- Jamais `~/code-buddy` ni `~/.codebuddy`.
- Ne pas lancer de génération réelle pendant les tests.

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `8c878d393`. Branche déjà extraite (persona copine, profil compagnon, Gemini 3.x). Working tree propre. Réservation `427572c2f`.

### Inspection

Cause racine : le profil compagnon n’a **pas d’outils** (`runCompanionChannelTurn` : `tools: []`, `tool_choice: 'none'`). `lisa_selfie` n’est donc jamais choisi. Sur la PWA, `assistant=companion` appelle `produceCompanionReply` → `defaultReply` (texte seul). L’interception Telegram existait mais (a) telegram-only, (b) sautait le cache dès qu’un style était nommé (`inferLisaSelfieScene`), (c) tombait sur `generateImage` / ComfyUI. Phrase d’échec vue par l’utilisateur = parole du LLM (« backend non configuré »), pas le cache.

Cache déjà là : `selectCachedLisaSelfie` + `CODEBUDDY_LISA_SELFIE_CACHE_DIR/<tier>/<style>/`. Rotation par `atime` seulement. Les images générées allaient dans `lora/lisa/selfies/`, pas dans le cache.

### Correctifs

1. **Router cache-first** (`src/companion/lisa-selfie-router.ts`) — `tryServeCompanionSelfie` AVANT le LLM, sur Telegram (tous canaux compagnon), WS mobile, voix (`defaultReply` + hybrid). Palier `CONTENT_TIER` + gate adulte (refus poli, pas de substitution). Style FR/EN (plage, pull, …) → dossier si présent, sinon n’importe quelle image du palier. Rotation persistée (`recent-selfies.json`, atomic-write). Légendes persona copine. Jamais de génération sur ce chemin.
2. **Ingest** (`lisa-selfie-ingest.ts`) — copie après `lisa_selfie` et après `image_generate` si le prompt est un selfie Lisa (LoRA / `ohwx lisa`). Nom horodaté + hash, sidecar JSON. Plafond 200, éviction des plus anciennes non `favorite`.
3. **Refill** (`lisa-selfie-refill.ts`) — opt-in `CODEBUDDY_LISA_SELFIE_REFILL=true`, heartbeat comme `system-vitals`. Une image par battement si générateur joignable et load < N. Tests : générateur factice. Never-throws.

### Preuves

Ciblé (10 fichiers) : **167/167**.
Suites exigées `tests/companion` + `tests/channels` + `tests/sensory` + `donnees-personnelles` : **225 fichiers verts / 3 skip**, **2979 verts / 12 skip / 1 todo** ; **1 rouge préexistant** `tests/channels/provider-failure-speech.test.ts` (`out_of_credits` classé `quota` avant `credits` — fichier hors lane).
Privacy : **40/40**. `tsc --noEmit` **0**. ESLint ciblé **0 erreur** (4 warnings préexistants). `git diff --check` **0**.

Essai headless (HOME isolé, cache de test = 3 PNG 1×1) :

```
[lisa-selfie-router] cache hit surface=mobile tier=safe image=one.png
handled true  reason ok  mimeType image/png  bytes 70
[lisa-selfie-router] cache hit surface=voice tier=safe image=two.png
[voice] lisa-selfie cache=ok image=true
defaultReply: Voilà. Celle-ci, là, tout de suite.
```

ComfyUI 8188/8189 non contactés. Aucun push.

### Ouvert

- Le refill production appelle ComfyUI seulement si `CODEBUDDY_LISA_SELFIE_REFILL=true` (défaut off).
- Rouge préexistant `provider-failure-speech` (crédits vs quota), hors zone.

## Bilan

Router cache-first avant le LLM (Telegram, PWA, voix) ; génération hors chemin de demande.
Tout selfie généré (`lisa_selfie` / `image_generate` Lisa) entre dans le cache borné, hors dépôt.
Refill heartbeat opt-in, une image/cycle, générateur injectable, stop si injoignable.
Preuve ciblée 167/167 ; suites exigées 2979 verts + 1 rouge hors lane ; privacy 40/40.
`tsc` 0, ESLint ciblé 0 erreur, `git diff --check` 0.
Essai headless : cache hit `one.png` puis `two.png`, légende persona, 70 octets PNG.
Byte-identique sans persona (légendes historiques, refill off).
ComfyUI 8188/8189 intacts. `~/code-buddy` et `~/.codebuddy` non ouverts.
Aucun push.
Reste : activer `CODEBUDDY_LISA_SELFIE_REFILL` en production (humain) ; rouge `out_of_credits` hors lane.

## Correctifs après vérification croisée

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Source : `docs/reports/2026-09/VERIF-SELFIE-CACHE-AGY.md` (verdict NON PUSHABLE, HEAD audité `aaa9c96ea`)
Branche : `feat/selfie-cache-2026-09-06`
HEAD au départ des correctifs : `b51bbd7f5`
HOME QA : `_qa/selfie2/home` (gitignoré). Vitest : `HOME=…/_qa/selfie2/home` et `env -u FORCE_COLOR`.
Original `~/code-buddy` et `~/.codebuddy` : interdits.
Section créée **avant toute modification de code**.

### Trous à lever (agy)

| Id | Gravité | Fait | Correctif prévu |
|---|---|---|---|
| A | A | Sidecar JSON du refill persiste le prompt avec `resolveUserName()` | Refill sans prénom ; sidecar = `{tier, style, hash, createdAt, source, favorite}` (+ `promptHash` sha256) |
| B1 | B | Cache défaut = `.codebuddy/lora/lisa/selfie-cache` du clone | Défaut unique `~/.codebuddy/companion/lisa/selfie-cache` via `os.homedir()` ; `CODEBUDDY_LISA_SELFIE_CACHE_DIR` prioritaire |
| B2 | B | Router atteint sans persona (Telegram `channel.type`, voix) | `isCompanionSurfaceEnabled(env)` identique à `runCompanionChannelTurn`, 3 surfaces |
| B3 | B | 4/16 motifs faux (FN « t'as une photo ? », « montre-toi », « send me a pic » ; FP « le selfie de Marie ») | Demande visant Lisa uniquement ; 16 phrases agy + 4 nouvelles |
| Opus b | B | Endpoint ComfyUI primaire mort toujours en tête | Mémoriser l'endpoint sain 5 min (`healthyComfyEndpoint`), le remettre en tête |

Chaque point : test rouge avant, vert après. Un commit par point. Aucun push.
