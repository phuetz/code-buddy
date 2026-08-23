# ST3c — Où partent les 88 ms ? (agent-ready HEAD vs main)

Analyse + prototype sur `perf/cold-start-st3c`, à partir de
`perf/cold-start-2026-08-23` (`dcd729cd`). **Pas de merge, pas de push,
PR #142 non modifiée.**

Objectif : **agent-ready ≤ main** tout en gardant un premier cadre tôt.
ST3b (série HEAD puis main, n=12 PTY) : first-paint 770 → 528 ms (−31 %),
mais agent-ready **bannière ASCII 860 → 947 ms (+10 %, +87 ms)**.

## Verdict

**Garder le splash, le rendre léger (`light`). Ne pas préfetcher le graphe
agent avant le premier cadre. Ne pas abandonner le splash.**

| Question | Réponse mesurée |
|---|---|
| Les +87 ms ST3b sont-ils du travail réel ? | **Surtout non.** Série HEAD-puis-main (HEAD plus froid). En **entrelacé**, `serial` (HEAD) est **plus rapide** que main à la bannière (871 vs 921 ms). |
| `await renderersReady` bloque-t-il ? | **Non. 0 ms / 12 runs** sur serial, prefetch et light. |
| Double montage Ink ? | **Non.** Un `render()` + `rerender()` (même instance). Coût splash Ink = **10 ms** médiane. |
| Prefetch agent **avant** le splash ? | **Rejeté.** L’évaluation ESM est sur le thread principal : React/Ink/ChatInterface sont affamés. First-paint **725 ms** (pire que HEAD 465 ms). |
| Variante `light` | **Gagnante.** Splash = `StartupScreen` (React+Ink seulement). First-paint **270 ms**. Agent-ready **801 ms app / 884 ms bannière** ≤ main (832 / 921). |

Le défaut runtime (sans env) est désormais `light`.
`CODEBUDDY_COLD_START_VARIANT=serial` reproduit HEAD PR #142 ;
`=prefetch` est l’essai rejeté.

## Méthode

Même protocole que ST3b (`docs/perf/_bench-st3b.mjs`), étendu :

```bash
npx tsc --pretty false          # exit 0
node docs/perf/_bench-st3c.mjs probe
node docs/perf/_bench-st3c.mjs tui --runs 12
```

- n=12 PTY (`script -qec`), `PERF_TIMING=true CODEBUDDY_PROVIDER=chatgpt`,
  `--no-alt-screen --ephemeral`, timeout 8 s, arrêt à la bannière ASCII.
- **Entrelacement** à chaque run : main → serial → prefetch → light
  (même régime thermique, contrairement à ST3b « HEAD puis main »).
- `main` = `dist-main-bench/` figé ST3b = `aaa4224c` (pas le `origin/main`
  actuel `71b566ef`).
- serial / prefetch / light = `dist/index.js` + `CODEBUDDY_COLD_START_VARIANT`.
- Node `v24.14.1`. `hyperfine` toujours absent. Pas de `npm install`.

Brut : `docs/perf/_bench-st3c-tui.json` (non commité, régénérable).

## Chronologie HEAD (`serial`) — un run médian

Run le plus proche de first-paint 464,5 ms (app 463, agent-ready 776) :

```
  189  renderers-mod-done
  192  ui-load-start
  463  lazy:ChatInterface (199ms)     ← premier cadre attend CE module
  463  ui-first-render                ← splash ChatInterface { loading:true }
  473  splash-render-done             ← Ink = 10 ms
  725  lazy:CodeBuddyAgent (251ms)    ← démarre APRÈS le splash
  747  agent-create-done
  776  renderers-await (0ms)
  776  ui-render / agent-ready-render
```

Wall : `ui-first-render` ligne 534 ms, bannière ASCII 847 ms.

Ce que HEAD **sérialise** alors qu’on pourrait recouvrir :

1. **Import `ChatInterface` (199–223 ms) sur le chemin du premier cadre**,
   pour peindre deux lignes de texte. Le module tire ThemeProvider,
   ToastProvider, hooks, historique, TTS, ConfirmationService, etc.
   L’early-return `loading && <StartupScreen />` est *runtime* : les
   imports ont déjà eu lieu.
2. **`CodeBuddyAgent` ne démarre qu’après** `render()` + dump PERF
   (`logStartupMetrics` au splash). 251 ms d’import agent *en plus*
   des 199 ms ChatInterface.
3. **Pas de second `render()` Ink** — `rerender()` sur la même instance.
4. **`await renderersReady` ne coûte rien** (les 6 renderers spécialisés
   ont fini pendant ChatInterface).

Le graphe agent n’est **pas** plus lent que sur main. Sur main, l’agent
est importé *en premier* (386 ms à froid) puis ChatInterface est *bon marché*
(59 ms, graphe chaud). HEAD inverse l’ordre : ChatInterface froid (199 ms)
puis agent tiède (251 ms). Total imports comparable ; le splash s’intercale
(10 ms Ink + dump).

## Pourquoi prefetch avant paint échoue

Run proche de first-paint 725 ms :

```
  181  prefetch-start                 ← agent + ChatInterface lancés
  412  renderers-mod-done             ← +231 ms : renderers affamé
  671  lazy:react (257ms)             ← React seul est déjà > 250 ms
  678  lazy:CodeBuddyAgent (497ms)
  716  lazy:ChatInterface (378ms)
  716  ui-first-render                ← splash aussi tard que ChatInterface
  769  ui-render
```

Node évalue les modules ESM **sur le thread principal**. `import()` sans
`await` n’est pas du recouvrement CPU : ça *vole* le temps de React/Ink.
First-paint passe de 465 → 725 ms ; agent-ready reste ~783 ms (pas de gain).

Un essai intermédiaire « light + prefetch agent pendant React » a donné
first-paint **850 ms** (`lazy:ink (307ms)` pendant l’agent). Même leçon.

## Variante `light` (gagnante)

Run proche de first-paint 270,5 ms (app 264, agent-ready 816) :

```
  189  renderers-mod-done / variant:light
  192  ui-load-start
  264  ui-first-render                ← StartupScreen, PAS ChatInterface
  273  splash-render-done / prefetch-after-splash
  741  lazy:CodeBuddyAgent (468ms)    ← à froid, après le splash
  770  agent-create-done
  799  lazy:ChatInterface (371ms)     ← en parallèle de l’agent
  816  chat-import-join-done (0 ms d’attente)
  816  renderers-await (0ms)
  816  ui-render
```

Wall : first-paint 342 ms, bannière 905 ms.

React+Ink non contestés : `ui-load-start` 192 → first-paint 264 = **72 ms**
(souvent < 50 ms, donc absents du dump `lazy:*`). HEAD payait 199 ms
ChatInterface pour le même écran.

L’agent est plus froid (468 vs 251 ms) parce que ChatInterface n’a pas
préchauffé le graphe. ChatInterface tourne **pendant** l’agent : le join
après le constructeur est 0 ms. Net : agent-ready ≈ serial ≈ mieux que main.

## Tableau n=12 entrelacé

Médiane (p10 / p90). First-paint main = `ui-render` (pas de splash).
Agent-ready = `ui-render` app / bannière ASCII wall (métrique ST3b).

### Time-to-first-paint

| Côté | Définition | médiane (ms) | p10 / p90 | min / max |
|---|---|---:|---|---|
| main | UI agent (`ui-render` app) | **831,5** | 751 / 984 | 747 / 1088 |
| serial (HEAD) | splash ChatInterface (`ui-first-render`) | **464,5** | 435 / 541 | 433 / 569 |
| prefetch | splash ChatInterface, imports lancés trop tôt | **725,0** | 688 / 858 | 674 / 865 |
| **light** | splash `StartupScreen` | **270,5** | 249 / 382 | 238 / 398 |

Wall jusqu’à la ligne `ui-first-render` : serial 544 ms, light **342 ms**,
prefetch 812 ms. Main n’a pas cette ligne.

### Time-to-agent-ready

| Côté | Définition | médiane (ms) | p10 / p90 | min / max |
|---|---|---:|---|---|
| main | `ui-render` app | **831,5** | 751 / 984 | 747 / 1088 |
| serial | `ui-render` app | **785,5** | 739 / 890 | 733 / 893 |
| prefetch | `ui-render` app | **782,5** | 741 / 914 | 723 / 915 |
| **light** | `ui-render` app | **801,0** | 735 / 932 | 727 / 982 |
| main | bannière ASCII wall | **921,4** | 828 / 1119 | 810 / 1174 |
| serial | bannière ASCII wall | **871,2** | 808 / 990 | 806 / 1002 |
| prefetch | bannière ASCII wall | **865,9** | 821 / 991 | 801 / 998 |
| **light** | bannière ASCII wall | **883,6** | 804 / 1034 | 796 / 1109 |

Cible : agent-ready ≤ main. **serial, prefetch et light y sont** (app et
bannière). prefetch sacrifie le first-paint. light le **améliore**
(270 vs 465 HEAD vs 832 main) sans casser agent-ready.

Δ bannière light vs main : **−38 ms (−4 %)**. Δ first-paint light vs main :
**−561 ms (−67 %)**. Δ first-paint light vs serial : **−194 ms (−42 %)**.

## Les +87 ms de ST3b

ST3b (séquentiel HEAD puis main) :

| | HEAD | main | Δ |
|---|---:|---:|---:|
| first-paint app | 528,5 | 770,5 | −31 % |
| bannière wall | 947,4 | 859,9 | **+10 %** |

ST3c (entrelacé, même machine, même PTY) :

| | serial (= HEAD) | main | Δ |
|---|---:|---:|---:|
| first-paint app | 464,5 | 831,5 | −44 % |
| bannière wall | 871,2 | 921,4 | **−5 %** |

La régression agent-ready ST3b **ne se reproduit pas** à protocole égal.
Cause : HEAD tournait sur une machine plus froide ; main bénéficiait du
cache OS / thermique. Les ~10 ms Ink + dump PERF au splash existent mais
sont noyés dans le bruit (sd bannière main 110 ms, serial 71 ms).

Les « 88 ms » après le splash sur HEAD **serial** sont le **chargement
légitime de `CodeBuddyAgent`** (≈ 250 ms), pas un second montage Ink ni
`await renderersReady`. Main fait ce travail *avant* le premier pixel.

## Recommandation pour PR #142

1. **Ne pas abandonner le splash.** First-paint 270–465 ms vs 832 ms sur
   main est le seul gain perçu. Agent-ready n’est plus une régression dès
   qu’on mesure équitablement.
2. **Remplacer le splash `ChatInterface { loading: true }` par
   `StartupScreen` seul** (variante `light`, défaut de cette branche).
   Ne pas importer ChatInterface avant le premier cadre.
3. **Ne pas lancer `CodeBuddyAgent` / `ChatInterface` avant ce cadre.**
   Prefetch = first-paint 725 ms, gain agent-ready nul.
4. Après le splash : lancer agent + ChatInterface **sans les attendre
   l’un l’autre** ; joindre ChatInterface après le constructeur.
5. Garder `await renderersReady` (sémantique : registre complet au
   `rerender`) — coût mesuré 0 ms.
6. Garder `--no-loading-screen` / `CODEBUDDY_NO_LOADING_SCREEN` (CI).

Cette branche implémente (2)+(4) par défaut. PR #142 (`perf/cold-start-2026-08-23`)
n’est **pas** mise à jour : à cherry-picker après revue.

## Preuves (sorties)

`npx tsc --pretty false` : exit 0.

Probe (1 run / cible, ordre main→…→light — **ne pas** en tirer de
médianes, seulement la forme des phases) : first-paint light 246 ms /
serial 509 / prefetch 821 ; `renderers-await: 0`.

Résumé n=12 entrelacé (sortie de `_bench-st3c.mjs tui`) :

```
=== main ===
TUI app ui-render (agent-ready): n=12 median=831.50 p10=751.40 p90=983.60
TUI wall to ASCII banner:        n=12 median=921.44 p10=827.87 p90=1119.36

=== serial ===
TUI app ui-first-render:         n=12 median=464.50 p10=434.60 p90=541.40
TUI app ui-render (agent-ready): n=12 median=785.50 p10=738.50 p90=890.40
TUI wall to ASCII banner:        n=12 median=871.18 p10=808.46 p90=990.06

=== prefetch ===
TUI app ui-first-render:         n=12 median=725.00 p10=688.30 p90=858.20
TUI app ui-render (agent-ready): n=12 median=782.50 p10=741.10 p90=913.70
TUI wall to ASCII banner:        n=12 median=865.87 p10=821.40 p90=991.48

=== light ===
TUI app ui-first-render:         n=12 median=270.50 p10=248.80 p90=382.40
TUI app ui-render (agent-ready): n=12 median=801.00 p10=735.10 p90=931.60
TUI wall to ASCII banner:        n=12 median=883.56 p10=803.70 p90=1033.81
```

Splash Ink (`splash-render-done − ui-first-render`) : médiane 10 ms
(serial, 12× 9–11 ms) / 9 ms (light).

Tests : `tests/ui/loading-screen.test.ts` + `tests/renderers/startup.test.ts`
— 7/7 pass.

## Reste ouvert

- Pas de n=50 CLI `--help`/`--version` ici (ST3b a déjà tranché : bruit,
  pas `lazyImport`).
- `origin/main` a avancé (`#139` mcp serve) depuis le `dist-main-bench`
  `aaa4224c` ; rejouer contre HEAD main si on rattache la PR.
- `CODEBUDDY_COLD_START_VARIANT` est un échappatoire d’analyse : à retirer
  au squash dans #142 si `light` est retenu.
