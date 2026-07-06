# Étude — Remplacer `rtk` par `lm-resizer` ?

_2026-07-02 · analyse à base de preuves (mesures réelles + lecture de code des deux outils). Doc de décision, non committé par défaut._

## Verdict en une ligne

**Remplacement FAISABLE et stratégiquement justifié, mais PAS drop-in aujourd'hui.** `lm-resizer` est un **sur-ensemble fonctionnel** de `rtk` (il contient déjà le cœur « exécute une commande, filtre façon RTK, compresse »), mais il lui manque **deux choses bornées** pour atteindre la parité — sans elles, une bascule en bloc **régresse sur le poste n°1 de rtk** (les test-runners = **76 % de ses économies**). Reco : combler ces deux gaps, faire un **A/B mesuré**, puis basculer.

---

## Les deux outils

| | **rtk** (Rust Token Killer) | **lm-resizer** (projet Patrice, Apache-2.0, $0) |
|---|---|---|
| Nature | Proxy **conscient de la commande** (~40 handlers taillés main, figés en Rust) | Moteur de **compression** générique + filtrage conscient de la commande (`exec`) + offload récupérable |
| Interception | Hook Claude `rtk hook claude` (PreToolUse **réécrit** `X`→`rtk X`, la sortie compressée devient le résultat) | `init-shims` (PATH), `exec` explicite, `hook` natif **(mesure seule, voir gap #1)**, `serve` (proxy HTTP payloads) |
| Gain réel **mesuré** | **10,7M tokens / 76 %** sur 10 268 cmds ; **vitest seul = 8,2M (98 %)** | non instrumenté sur ce poste ; `lm-resizer stats` expose le CCR |
| Récupération sortie complète | non | **oui** (store CCR SQLite, `retrieve <hash>`) |
| Biais requête | non (query-blind) | **oui** (`-q`, rétention BM25) + `--token-budget` dur |
| Filtres | figés dans le binaire | **TOML de projet** extensibles, audités, testés inline, trustés par hash (`.lm-resizer/filters.toml`) |
| Surfaces | CLI + hook | CLI + **MCP stdio** + **HTTP** + WASM + C-ABI |
| Extras | `gain`, `discover`, `cc-economics` | `learn` (propose AGENTS.md/CLAUDE.md), `voice` (nettoyage transcript), `discover`, `eval` |
| Maturité | rodé en prod (10 268 cmds mesurées ici) | **réel, pas un stub** : ~1 000 tests, CI Ubuntu+Windows, v0.1.0, artefacts `dist/` |
| Propriété | dépendance tierce | **la sienne** (stack maison, argument carrière/infra) |

---

## Filtres conscients de la commande — ce que `lm-resizer exec` couvre déjà

Dispatch réel (`src/main.rs:1966` `filter_command_output`) :

`git status`/`diff`/`log`, `cargo test`/`check`/`build`/`clippy`, `tsc` (groupé par fichier), **`pytest`**, `rg`/`grep` (comptes par fichier), `find`/`fd`/`ls`/`tree`, `npm`/`pnpm`/`yarn` (diagnostics), + **filtres TOML built-in** (Terraform, Docker/Podman, k8s, AWS, Go, .NET, JVM, pip/uv, gh…). Repli `filter_generic` (dédup + cap) pour le reste. Marqueur `... omitted N low-signal lines`. Puis pipeline structurel (log/diff/JSON crush) + offload CCR + token-budget + rétention par requête. **Pas de résumé LLM** — tout est déterministe/heuristique.

**Manque notable : aucun filtre `vitest`/`jest`.** → un `npx vitest run` tombe sur `filter_generic`.

---

## Mesures réelles (ce jour, sur ce repo)

> ⚠️ Sorties **petites** = ni l'un ni l'autre ne brille (les gains sont sur le volumineux). Ce qui est révélateur, c'est l'**asymétrie de comportement**, pas les octets absolus.

| Commande | Brut | `rtk` | `lm-resizer exec` | Lecture |
|---|---:|---:|---:|---|
| `vitest run <1 fichier, passe>` | 402 | **19** | 546 | rtk **collapse sémantique** (« 24 passed ») ; lm-resizer tombe sur `filter_generic` + footer → **plus gros que le brut** |
| `grep -rn export <fichier>` | 705 | 705 (passthrough) | 904 | petite sortie : rtk neutre, lm-resizer ajoute son footer de récupération |
| `git status` | 257 | 257 (passthrough) | 408 | idem |

**Ce que ça prouve :**
1. rtk gagne **même à petite taille sur du structuré** parce qu'il sait sémantiquement quoi jeter (« N passed » suffit). C'est **exactement** son poste n°1 (vitest = 76 % des gains).
2. lm-resizer porte un **overhead fixe** (footer CCR + annotations) → net-négatif sur les petites sorties ; ses gains sont réels mais sur les **gros dumps bruyants/répétitifs** (logs, JSON, diffs) où le dédup + crush + rétention-requête paient — un axe que rtk ne couvre pas.

---

## Les deux gaps concrets à combler pour la parité

### Gap #1 — Mécanisme d'interception (le hook natif ne substitue pas)
Le `lm-resizer hook --event PostToolUse` **ne fait que MESURER** les octets économisables (`run_native_hook`, `main.rs:3302` → `record_exec_history`) ; il **n'émet aucune sortie compressée de remplacement**. rtk, lui, **réécrit la commande en PreToolUse** (`X`→`rtk X`) donc la sortie compressée EST le résultat de l'outil.
**Solutions (par ordre d'effort) :**
- **(a) PATH shims — déjà implémenté, marche aujourd'hui.** `lm-resizer init-shims` écrit `.lm-resizer/shims/{git,cargo,rg,grep,find,npm,pytest,…}` qui `exec -- <binaire réel>` de façon transparente (capture le vrai chemin → pas de récursion). Prepend au `PATH` = interception drop-in, **sans hook**. C'est le vrai chemin de remplacement.
- **(b) Mode hook PreToolUse substituant** — petit ajout : un hook qui réécrit la commande via la logique **déjà présente** (`rewrite-shell` sort littéralement `lm-resizer exec -- <cmd>`). C'est le calque exact du mécanisme rtk.
- **(c) Proxy HTTP** (`serve --upstream`) — couche différente (compresse les payloads provider en vol), complémentaire pas équivalente.

### Gap #2 — Filtre test-runners JS (le poste n°1 de rtk)
Sans `filter_vitest`/`filter_jest`, le **plus gros gain** (vitest 8,2M) se dégrade. **Solution :** ajouter un filtre vitest/jest — soit un `.lm-resizer/filters.toml` de projet (extensible, testé inline, la voie idiomatique de lm-resizer), soit un handler natif façon `filter_pytest`/`filter_cargo_test` (`main.rs:2958`/`2837`). Effort faible, la charpente existe.

---

## Ce que le remplacement fait GAGNER (au-delà de la parité)

- **Récupérabilité** : la sortie complète reste `retrieve`-able par hash (rtk jette).
- **Query-relevance + token-budget dur** : compresse vers ce que la session demande, cap à N tokens.
- **Filtres extensibles/audités/testés/trustés** (TOML) vs figés en Rust → tu ajoutes un filtre sans recompiler un binaire tiers.
- **MCP + HTTP** : un même moteur exposé aux agents (MCP) et au trafic provider (proxy).
- **`learn`/`voice`** : propose des règles AGENTS.md, nettoie les transcripts (utile companion).
- **Stack maison** (Apache-2.0, $0) : cohérent avec la suite (Code Explorer, buddy-memory/CKG) et l'argument « agents engineer ».

## Ce que rtk fait MIEUX aujourd'hui

- **Collapse sémantique par-commande** sur ~40 outils **dont vitest/jest**, overhead quasi-nul même sur petites sorties.
- **Rodage terrain prouvé** (10 268 cmds, 10,7M tokens, 76 %).

---

## Recommandation — plan de migration réversible (empirique, pas de foi)

0. **Déjà en place** : code-buddy utilise déjà `lm-resizer compress` comme post-filtre opt-in de sortie d'outil (`src/context/lm-resizer-compressor.ts`, `CODEBUDDY_LM_RESIZER=true`). Rien à défaire.
1. **Combler le gap #2 d'abord** : pousser un filtre `vitest`/`jest` dans lm-resizer (TOML de projet le plus simple). **Sans ça, tout remplacement régresse** sur 76 % des gains.
2. **Choisir le mécanisme (gap #1)** : activer les **PATH shims** (drop-in, zéro hook) — ou ajouter le mode hook PreToolUse substituant si tu veux le calque exact de rtk.
3. **A/B mesuré** : faire tourner lm-resizer (shims/`exec`) **en parallèle** de rtk sur une vraie session, comparer `lm-resizer stats` vs `rtk gain` sur le **même workload** (surtout vitest/tsc/grep/find).
4. **Basculer seulement si parité prouvée** sur les postes qui comptent, puis désinstaller le hook rtk (lm-resizer `init-native-hooks`). Garder rtk en fallback un temps.

**Ne pas remplacer en bloc aujourd'hui.** Le bénéfice stratégique est réel (stack maison, récupérable, extensible, MCP), mais la bascule doit passer par (1) un filtre test-runner et (2) une preuve A/B — sinon on perd le gros gain de rtk le jour du switch.

---

## RÉSOLUTION (2026-07-02) — gaps comblés + bascule faite

Les gaps ont été **implémentés dans lm-resizer** (`~/DEV/lm-resizer`, `master`), prouvés, poussés :

| Commit | Gap | Preuve |
|---|---|---|
| `8ba8ba2` | #2 filtre **vitest/jest** (`filter_vitest` + routeur, câblé) | exec vitest passant **546→54 o** (≈ rtk 19) ; échec garde tout le signal + récupérable ; 84 tests |
| `40c9958` | #1 **hook PreToolUse** substituant (`updatedInput` → `"{exe}" exec -- <cmd>`) | même mécanisme que rtk, prouvé end-to-end ; 86 tests |
| `bff15a1` | #3 (trouvé en basculant) rewrite **verbatim** | l'ancien re-tokenizer jetait `\|` dans les guillemets (grep → 0 match) ; corrigé, quoting/backslash préservés ; 88 tests |

**Sécurité** : codes de sortie propagés (`exit 7`→7, vitest échoué→≠0), zéro régression, glob/quoting/backslash fidèles.

**Bascule** : binaire installé `~/.local/bin/lm-resizer` ; `~/.claude/settings.json` → `lm-resizer hook --client claude --event PreToolUse`. **⚠️ S'active au prochain démarrage de Claude Code** (hooks chargés au boot, pas de hot-reload — vérifié). Backup `~/.claude/settings.json.bak-rtk-*` ; revert = restaurer `"rtk hook claude"`.

**Gap mineur assumé** : `cat`/`read` (rtk `read`, ~31 % de gain, son n°2) non filtré — filtrer du contenu de fichier est lossy ; l'agent lit via l'outil Read. Correction > couverture.

## Anchors vérifiés

- rtk : hook `~/.claude/settings.json:12` (`rtk hook claude`, PreToolUse Bash) ; `rtk gain` = 10,7M/76 %, vitest 8,2M/98 %.
- lm-resizer : `exec`/`run_exec_command` `main.rs:1627` ; filtres `filter_command_output` `main.rs:1966` ; hook mesure-seule `run_native_hook` `main.rs:3302` ; `init-shims` `main.rs:4391` ; `rewrite-shell` `main.rs:1772` ; MCP `run_mcp` `main.rs:5547` (3 outils : compress/retrieve/stats) ; intégration existante code-buddy `src/context/lm-resizer-compressor.ts` (`lm-resizer compress --json`).
