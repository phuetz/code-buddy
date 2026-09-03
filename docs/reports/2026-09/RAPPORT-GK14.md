# RAPPORT-GK14 — `buddy science` et `buddy research --deep --ckg` en vrai

Mission : se servir des applis EN VRAI. Ce qu’un utilisateur obtient, ce qui casse, réparé.

- Clone : `~/DEV/cb-repar-cb2-2026-09-02`
- Branche : `fix/gk14-science-reel-2026-09-03`
- Date de démarrage : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection du code source science/research/CKG (protocole mission).
- HEAD de départ : `13f878cec`
- Réservation : `971817daf`

## Garde-fous (rappel)

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. LLM local Ollama `qwen3:4b-instruct` et DuckDuckGo/SearXNG ($0).
- Aucun service systemd. ComfyUI 8188/8189 non touché.
- Aucune écriture hors du clone ni dans `~/.codebuddy` (HOME = `_gk14/home` dans le clone).
- Dépôt original `~/code-buddy` interdit.
- Aucune donnée personnelle.
- Un commit conventionnel par lot. Typecheck + lint + tests ciblés verts.
- Chaque défaut : test rouge → correctif → vert, un commit. Rejouer après correction.
- `DISPLAY` unset. `node_modules` installé dans le clone (absent au départ, 1848 paquets).

## Journal

### 2026-09-03 — création du rapport (avant inspection)

```
## fix/gk14-science-reel-2026-09-03
13f878cec Merge branch 'feat/gk5-pocket-tts-rust-2026-09-03' …
---
13f878cec7da22d59416b16b867fc409a730e104
0 fichiers sales
```

### Environnement mesuré

- Ollama `127.0.0.1:11434` : `qwen3:4b-instruct` (et d’autres modèles déjà chargés par d’autres chantiers).
- SearXNG opérateur `:8888` HTTP 200, JSON `results=0`, moteurs `brave=too many requests`, `duckduckgo=CAPTCHA`, `startpage=Suspended: CAPTCHA`.
- DuckDuckGo HTML (curl) : HTTP 202, `anomaly-modal=56`, `result__a=0`.
- `searchStructured` sans clé : 0 hit (Brave MCP absent + CAPTCHA DDG). Avec `SEARXNG_URL=:8888` : SearXNG 0 puis même chaîne.

## 1. `buddy science` — exécution réelle

Question : « l'hystérésis d'un VAD réduit-elle les fausses coupes ? »

Opt-in : sans `CODEBUDDY_AI_SCIENTIST=true` → exit 1, notice, rien n’est lancé.

### 1.a Sans TTY (ce qu’un script obtient)

```
[ok] ideate: [user] Un hangover de 3 frames …
[ok] novelty: novel — aucun voisin dans le CKG
[..] plan-gate: declined: réponse: non
=== AI-Scientist Phase 0 — DECLINED-AT-PLAN-GATE ===
EXIT=0   # AVANT correctif
DUR=2s
```

Honnête sur le refus. Mais exit 0 alors que l’expérience n’a pas tourné.

### 1.b Avec TTY (approbation `oui`) + `--code-file` + `--no-publish` — AVANT correctif Python

L’expérience Python est valide (stdlib, déterministe). `execute_code` prépendait le helper RPC :

```
File ".../script.py", line 26
    from __future__ import annotations
SyntaxError: from __future__ imports must occur at the beginning of the file
execute: non-zero/failed: execute_code exited with code 1
```

Rapport (honnête sur l’échec, pas de chiffres inventés) :

```
The experiment fails to execute due to a syntax error caused by an incorrect
placement of `from __future__ import annotations` … no conclusion …
statut : échec (exit 1)
_(stdout vide)_
```

### 1.c Rejeu après `027ff1719`

```
[ok] plan-gate: approved
[ok] author: python, 2462 chars
[ok] execute: exit 0 in 42ms
[ok] analyze: … reduces false cuts (from 16 to 0) …
[ok] report: 2552 chars
[..] review: NEEDS REVIEW
[..] publish-gate: declined: --no-publish
=== AI-Scientist Phase 0 — DECLINED-AT-PUBLISH-GATE ===
EXIT=0 DUR=737s (file d’attente Ollama 27B)
```

Stdout réel de l’expérience :

```
frames=149
speech_frames=112
false_cuts_no_hysteresis=16
false_cuts_with_hysteresis=0
accuracy_no_hysteresis=0.8571
accuracy_with_hysteresis=1.0000
accuracy=1.0000
hysteresis_reduces_false_cuts=True
delta_false_cuts=16
```

Le rapport collé cite **16 → 0**, embarque le stdout brut, ne fabrique pas d’URL. Il reste prudent sur « sans changer le seuil » (le stdout ne répète pas `THRESHOLD=0.5`) : interprétation un peu pédante, pas un mensonge. Pas de `<think>`.

| Phase | Annoncée | Exécutée | Honnêteté |
|---|---|---|---|
| hypothèse | oui (`--hypothesis` user) | oui | honnête |
| expérience | oui (après porte plan) | oui après correctif (42 ms, exit 0) | avant : SyntaxError du runner, pas du script |
| résultat | stdout 16→0 | oui, dans « Sortie de l'expérience » | chiffres = stdout |
| rapport | Markdown + revue NEEDS REVIEW | oui | ne revendique pas d’exécution manquée |

### 1.d Exit 1 hors TTY — rejeu après `e2308cb77`

```
[..] plan-gate: declined: réponse: non
=== DECLINED-AT-PLAN-GATE ===
EXIT_NONTTY_GREEN=1
```

## 2. `buddy research --deep --ckg`

Sujet : `Vitest TypeScript testing framework`. Modèle `qwen3:4b-instruct`. HOME isolé.

### 2.a Ce que la machine donne aujourd’hui (SearXNG :8888 + DDG CAPTCHA)

```
🔎 Local SearXNG discovered at http://localhost:8888
📝 4 sub-question(s), 12 search queries (LLM)
🔎 Search: 0 hit(s) in → 0 unique URL(s) from 12 queries
❌ Deep Research produced 0 cited source(s)
❌ Deep Research failed: … refusing to report success.
EXIT=1 DUR=31s
Status: failed   (rapport 17 Ko de CAPTCHA dupliqués)
```

GK2 tient : pas de succès à 0 source. CKG non alimenté :

```
buddy research stats  →  0 découvertes, 0 liens
buddy research recall →  Rien trouvé.
ledger absent
```

Le dump 17 Ko vient du mélange `lastStructuredAttempts` entre 12 requêtes parallèles.

### 2.b SearXNG loopback factice (port libre 46714, JSON à 6 URL publiques Vitest) — $0, pas :8888

```
SEARXNG_URL=http://127.0.0.1:46714
CODEBUDDY_SEARXNG_AUTODISCOVER=false
🔎 Search: 60 hit(s) in → 5 unique URL(s) from 12 queries
📥 Kept 5 source(s) after scrape/snippet fallback
✅ Deep Research complete (5 cited source(s))
EXIT=0 DUR=240s
Mémoire collective (CKG): 0 rappelée(s), 5 ingérée(s)
```

Puis :

```
buddy research stats
Graphe de connaissances collectif : 5 découvertes, 9 liens.

buddy research recall "Vitest TypeScript testing framework"
[0.54] Vitest | Next Generation testing framework. Content from https://vitest.dev/ …
[0.50] Writing Tests | Guide | Vitest. Content from https://vitest.dev/guide/features.html
[0.46] Getting Started | Guide | Vitest. Content from https://vitest.dev/guide/
[0.40] Configuring Vitest. Content from https://vitest.dev/config/
[0.10] vitest-dev/vitest … github.com/vitest-dev/vitest

buddy research list
5 entrée(s) — source deep-research — urls vitest.dev + github
```

`0 rappelée(s)` au premier run est cohérent (recall au **début**, ingest à la **fin**). `recall` ensuite retrouve les 5. `stats` 5/9 cohérent avec 5 nœuds + auto-liens. Pas de `<think>` dans le rapport. Pas d’ingestion dans le vrai `~/.codebuddy`.

## 3. Défauts (rouge → correctif → vert)

### D1 — Python `from __future__` cassé par le helper RPC

- Rouge : `tests/tools/execute-code-python-future.test.ts` — 2 failed, `SyntaxError` ligne 22.
- Correctif : `injectAfterPythonPreamble` insère le helper **après** docstring / `__future__`.
- Vert : 5/5 dans ce fichier + 20 RPC voisins. Rejeu science : execute exit 0, stdout 16→0.
- Commit : `027ff1719`

### D2 — tentatives de recherche mélangées en parallèle (rapport d’échec 17 Ko)

- Rouge : `tests/tools/web-search-structured-race.test.ts` — `alpha` voyait `searx-fail-beta-unique`.
- Correctif : `searchStructuredTraced` (tableau d’attempts **local**) ; Deep Research l’utilise ; `formatZeroSourceFailure` borne/déduplique.
- Vert : 7 fichiers / 56 tests (race + SearXNG + zero-sources + wide-research-deep + ckg).
- Commit : `3473498d6`

### D3 — `buddy science` exit 0 si la porte plan refuse

- Rouge : CLI réel EXIT=0 à `DECLINED-AT-PLAN-GATE`.
- Correctif : `sciencePassExitCode` → 1 pour `declined-at-plan-gate` et `failed`.
- Vert : 23 tests science CLI ; rejeu non-TTY EXIT=1.
- Commit : `e2308cb77`

## Tableau final commande → attendu → obtenu → correctif → commit

| Commande | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| `buddy science --help` | aide, exit 0 | exit 0 | — | — |
| `buddy science` sans opt-in | refuse, exit 1 | notice + exit 1 | déjà là | — |
| `buddy science` sans TTY | porte fermée, **exit 1** | refuse honnête, **exit 0** puis 1 | `sciencePassExitCode` | `e2308cb77` |
| `buddy science` TTY + code Python `__future__` | expérience exécutée | SyntaxError helper RPC | preamble Python | `027ff1719` |
| rejeu science après D1 | stdout 16→0 dans le rapport | oui, 42 ms, chiffres collés | — | `027ff1719` |
| `research --deep --ckg` (8888+DDG morts) | échec explicite 0 source | EXIT=1, Status: failed, CKG 0 | GK2 tient ; dump 17 Ko | `3473498d6` |
| `research --deep --ckg` SearXNG factice 5 URL | sources + ingest CKG | 5 sources, 5 ingérées | — | — |
| `research recall` / `stats` | rappel + compteurs | 5 hits, 5 découvertes, 9 liens | — | — |

## Vérifications

```
npx tsc --noEmit -p tsconfig.json                 # TSC=0
npx tsc --noEmit -p tsconfig.gpuNode-identity.json # TSC_GPU=0
npx eslint <fichiers touchés> --max-warnings=0     # 0
vitest execute-code-python-future + race + science-command + deep-research-zero-sources
  → 4 fichiers / 32 verts (rejeu final)
```

## Commits

| Commit | Message |
|---|---|
| `971817daf` | `chore(gk14): réserver le chantier science/research réel` |
| `027ff1719` | `fix(execute-code): conserver from __future__ en tête des scripts Python` |
| `3473498d6` | `fix(research): isoler les tentatives de recherche parallèles` |
| `e2308cb77` | `fix(science): exit 1 quand le plan est refusé` |
| `b4bf31038` | `docs(gk14): consigner science/research --deep --ckg en vrai` |

## Ouvert (non corrigé ici)

- Pas de `--yes` / `--approve-plan` : la porte humaine reste TTY-only (fail-closed volontaire). Un script doit fournir un PTY.
- GATE #1 approuve l’hypothèse **avant** l’écriture du code généré (avec `--code-file` l’utilisateur a déjà vu le fichier).
- Appels LLM de `buddy science` sans timeout : 4+ min d’attente derrière un Ollama 27B occupé ; l’analyse a fini, mais un hang indéfini reste possible.
- SearXNG opérateur `:8888` et DuckDuckGo HTML sont CAPTCHA/quota — $0 fragile ; le chemin local-first (`SEARXNG_URL` ou découverte) reste juste.
- `review: NEEDS REVIEW` sur un rapport pourtant étayé par le stdout (juge LLM 4b, pas un mensonge).

## Bilan (≤10 lignes)

`buddy science` opt-in refuse sans flag ; hors TTY la porte plan refuse (désormais exit 1). Avec TTY + script Python, l’expérience **ne tournait pas** (`from __future__` déplacé par le helper RPC) — rapport honnête sur l’échec, pas de chiffres fictifs. Après `027ff1719` : execute 42 ms, 16→0 fausses coupes collées au stdout. `research --deep --ckg` à 0 hit : EXIT 1 (GK2), CKG vide ; le dump 17 Ko de CAPTCHA parallèles est borné (`3473498d6`). Avec SearXNG loopback $0 : 5 sources, 5 ingérées, `recall` les 5, `stats` 5/9. Preuves : tsc 0, tsc GPU 0, eslint ciblé 0, 32 tests ciblés verts. Aucun push, aucune API payante, aucun service, HOME uniquement `_gk14/home`.
