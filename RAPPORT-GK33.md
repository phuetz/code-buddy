# RAPPORT-GK33 — Les modes de recherche en vrai

Mission : se servir des applis EN VRAI. `buddy research --deep --iterations N`, `--storm --perspectives N`, `buddy flow`, PaperQA-lite. Ce qu’un utilisateur obtient, ce qui casse, réparé.

- Clone : `/home/patrice/DEV/cb-repar-slash-2026-09-02`
- Branche : `fix/gk33-recherche-modes-2026-09-03`
- Date : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection du code source research/flow/PaperQA.
- HEAD de départ : `4941ce857`
- Réservation : `e463d50fb`
- HOME : `_qa/gk33/home` dans le clone seulement

## Garde-fous

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. Ollama `qwen3:4b-instruct`. SearXNG opérateur `:8888` puis faux SearXNG loopback `:18033`.
- ComfyUI 8188 intact. `DISPLAY` unset. `~/code-buddy` interdit.
- Un commit par défaut. Tests ciblés + `tsc --noEmit` 0 + `typecheck:gpuNode-identity` 0.

## Environnement mesuré

- Ollama `127.0.0.1:11434` : `qwen3:4b-instruct` (et d’autres modèles déjà chargés).
- SearXNG opérateur `:8888` : HTTP 200, 20 résultats pour `vad+hysteresis` (DDG/Startpage CAPTCHA).
- DuckDuckGo HTML : HTTP 202, `anomaly-modal=56`, `result__a=0`.
- Faux SearXNG `_qa/gk33/fake-searxng.mjs` : pages locales à phrases connues (hangover 200–400 ms, 18 %→4 %, double seuil). Arrêté en fin de mission (`:18033` fermé).
- `fetchPage` refuse le loopback (SSRF) : le scrape des pages `:18033` est vide ; GK2 snippet fallback a servi (le JSON SearXNG porte le corps).

## Tableau commande → attendu → obtenu → correctif → commit

| Commande | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| `buddy research --deep --iterations 2` (opérateur `:8888`) | Bandeau Deep ; tour 2 ajoute des sources ou s’arrête honnêtement ; citations ancrées | Bandeau **Wide Research** + items/concurrency. 11 sources. Planner a lu VAD = ventilateur. Tour 2 : 6 requêtes, 0 hit (CAPTCHA). 5/5 citations contrôlées **fausses**. Dump `**Références**` LLM. « Collecting up to 0 ». | Bandeau Deep ; ancrage lexical des `[n]` ; strip `**Références**` ; cap annoncé avant scrape ; nettoyage `de à` | `81ca613e1` `c33a2e906` `df81e554f` `69c2b8105` |
| `buddy research --deep --iterations 2` (faux `:18033`) | Tour de comblement réel ; citations vérifiables sur pages connues | EXIT 0, 11 sources, 64 s. Banner Deep + gap loop. Tour 2 **sufficient** (0 nouvelle requête). Hangover 200–400 ms `[1]`, 18 %→4 % `[2]`, double seuil `[3]` : **vrais**. | (rejeu après ancrage) | — |
| `buddy research --storm --perspectives 3` | 3 perspectives distinctes, article outline-first | Practitioner / Skeptic / Historian. Requêtes distinctes (latence vs SNR vs analog 1950s). 27 sources, 9 doublons. 7 sections. Titre de section **répété** `#` puis `##`. | Strip du heading de tête qui recopie le titre | `f9f33707d` |
| Contrôle de 5 citations (opérateur) | L’idée est dans la page | 0/5 : `[10]` « ventilateur à débit variable » absent d’astuces-pratiques ; `[1]` « zone de décalage » absent de Wikipédia ; `[11]` « 0,2 °C » / « 5 °C » absents du blog électricité | `groundCitedClaims` | `c33a2e906` |
| Contrôle de 5 citations (faux serveur) | Idem, pages connues | 5/5 après correctif : hangover `[1]`, false cuts `[2]`, state machine `[3]`, extra 300 ms `[4…]` | — | — |
| `buddy flow --verbose` | plan → exécution → synthèse, plan réel | Avant : 1 step « Execute task » (JSON `",` parasite). Après : **8 steps**, phases planning/execution/synthesis. 6 completed / 2 blocked. EXIT 1 honnête. | `parseJsonResponse` + repair `",` + log des phases | `5a8090c28` `c4263ad3e` |
| `buddy papers ask` 3 PDF locaux | Extraits corrects, pas d’invention | 3/3 PDF, RCS **2 retenus** (hangover + false-cuts), optics **écarté**. Réponse `[1][2]` avec extraits 200–400 ms et 18 %→4 %. BM25 (pas d’`@xenova/transformers`). EXIT 0 | aucun (conforme) | — |

## Détail des parcours

### `--deep --iterations 2` opérateur (avant correctifs)

```
🔬 Wide Research: "hystérésis d'un VAD"
   Items: 5 | Concurrency: 5 | Overall timeout: 5 min
  📝 4 sub-question(s), 12 search queries (LLM)
  📥 Kept 11 source(s)
  🧩 Round 2: 5 gap(s), 6 new queries
  🌐 Collecting up to 0 source(s)...
  🎯 Converged at round 2 (no-new-sources)
EXIT=0  Duration 161.9s
```

Le planner a décomposé « VAD » en ventilateur à débit variable / pompe. Les sources sont des glossaires d’hystérésis (Wikipédia, Larousse, blog électricité). Cinq affirmations citées ne sont pas dans les pages (audit `_qa/gk33/work/citation-audit.txt`).

### `--deep --iterations 2` faux SearXNG (après ancrage)

Sujet explicite : Voice Activity Detector. Banner :

```
🔬 Deep Research: "…"
   Mode: deep (gap loop, 2 round(s))
```

Tour 2 : draft jugé suffisant, pas de rejeu de recherche. Rapport `_qa/gk33/work/deep-fake.md`.

### `--storm --perspectives 3`

```
Mode: STORM (3 perspective(s))
🔭 Skeptic 12 sources
🔭 Practitioner 12 sources
🔭 Historian / State of the Art 12 sources
🧬 27 shared, 9 duplicates
🗂️ 7 sections (LLM) outline-first
EXIT=0  352.9s
```

Perspectives **distinctes** (pas trois fois la même). `_qa/gk33/work/storm.md`.

### `buddy flow`

Avant : `Plan: 1 steps` / `Execute task` — le JSON de qwen3 contenait `"id": "3",` puis une ligne `",`.

Après : `Phase: planning` / `Plan: 8 steps` / `Phase: execution` / 6 Done / `Phase: synthesis` / 2 blocked / EXIT 1.

### PaperQA-lite

```
PDFs: 3 | top-k: 8
Corpus : 3 passage(s) | retenus (RCS) : 2
L'hystérésis hangover d'un VAD réduit les fausses coupes [1][2].
[1] vad-hangover.pdf … 200 to 400 milliseconds. This hysteresis reduces false cuts
[2] vad-false-cuts.pdf … 18 percent … 300 millisecond … 4 percent
```

Le PDF d’optique (Fabry-Perot, 12 mW) n’est pas cité. Pas d’invention.

## Tests

Union ciblée 8 fichiers / **104 verts**. `npx tsc --noEmit -p .` 0. `npm run typecheck:gpuNode-identity` 0. ESLint ciblé 0 (`--max-warnings=0` sur les fichiers nouveaux / typés).

## Ouvert

- `fetchPage` bloque 127.0.0.1 : un corpus web local ne se scrape pas (snippets SearXNG seulement).
- Embeddings PaperQA : `@xenova/transformers` absent → BM25, annoncé.
- Flow 8 steps : 2 blocked (dépendances) ; EXIT 1 conservé.
- Sujet ambigu « VAD » sans « Voice Activity » : le planner 4b part en CVC/ventilateur (qualité modèle, pas un fail-closed).
