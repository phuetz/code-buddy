# Démarrage à froid — 2026-08-23

Rebenchmark ST3b (juge : ne pas opposer *time-to-first-paint* à
*time-to-agent-ready*). Mesure sur Linux 6.17, AMD Ryzen AI 9 HX 470,
Node `v24.14.1`. `hyperfine` n’est **pas** installé (`command -v hyperfine`
vide) : les CLI courts sont 50 processus `spawnSync` + 3 warm-up ;
le TUI est 12 runs dans un PTY (`script -qec`).

Les deux arbres compilés comparés :

- `origin/main` = `aaa4224c` (`feat(models): entrée de registre qwen3.8-27b…`)
- `HEAD` = `a59d04ea` (`perf(cli): defer cold-start UI dependencies`)

`npx tsc --pretty false` avant chaque série. Aucun `npm install`.

## Deux métriques distinctes

| Nom | Quoi | Marqueur `origin/main` | Marqueur `HEAD` |
|---|---|---|---|
| **time-to-first-paint** | Premier cadre TUI visible | Il n’y a pas d’écran intermédiaire : le premier cadre **est** l’UI agent (`ui-render`) | Écran « Starting Code Buddy… » (`ui-first-render`) |
| **time-to-agent-ready** | Agent construit + UI complète (bannière ASCII) | `ui-render` (dump `PERF_TIMING` juste avant `render()`) | Wall-clock jusqu’à la bannière. `agent-ready-render` est enregistré mais **n’était pas dumpé** par `logStartupMetrics()` (appelé trop tôt) |

Comparer `HEAD ui-first-render` à `main ui-render` (le « −41 % » de la
première rédaction) mélange les deux. Les tableaux ci-dessous les
séparent.

## CLI courts — 50 runs `spawnSync`

`node dist/index.js --version` et `--help` ne passent **pas** par le
bootstrap interactif modifié (`lazyImport.renderers` reste lazy). `-p`
charge l’agent complet (chemin headless) : ce n’est pas un CLI court.

### Série séquentielle (HEAD puis `origin/main`, machine pas au même régime)

| Parcours | origin/main médiane (ms) | HEAD médiane (ms) | Δ médiane | p10 / p90 HEAD | Cible |
|---|---:|---:|---:|---|---:|
| `--version` | 61,04 | 82,18 | +35 % | 68,09 / 137,25 | < 150 — OK |
| `--help` | 64,54 | 81,44 | +26 % | 71,65 / 127,17 | < 400 — OK |
| `-p "dis bonjour"` (API `127.0.0.1:1`, fail-fast) | 3038,96 | 3201,41 | +5 % | 3004,92 / 3950,62 | n/a (agent + 1 tour) |

Cette série **ne tranche pas** `--help` : HEAD a tourné juste après des
probes TUI (sd `--help` 34 ms vs 11 ms sur main ; max HEAD 267 ms).

### Confirmation entrelacée (même session, `dist` figés, 50 paires main/HEAD)

Les deux `dist/index.js` ne diffèrent que de 357 octets (151 167 →
151 524). Pour chaque run : un spawn `origin/main`, un spawn `HEAD`,
ordre inversé à chaque paire.

| Parcours | origin/main médiane (ms) | HEAD médiane (ms) | Δ médiane | p10 main / HEAD |
|---|---:|---:|---:|---|
| `--version` | 55,13 | 56,79 | **+3,0 % (+1,67 ms)** | 47,09 / 47,25 |
| `--help` | 64,71 | 61,16 | **−5,5 % (−3,55 ms)** | 50,95 / 51,42 |

`--version` : n=50 main mean=56,75 sd=9,72 ; HEAD mean=58,87 sd=10,60.
`--help` : n=50 main mean=64,76 sd=11,59 ; HEAD mean=62,67 sd=9,73.

### Tranche `--help` : bruit, pas une régression

Le +56 % de la première rédaction (88,70 → 138,25 ms, **n=10**) n’est
pas reproductible. Sur n=50 entrelacé, les planchers p10 sont identiques
à 0,5 ms près et HEAD est même légèrement plus rapide en médiane. Le
chemin `--help` n’importe pas `startup.ts` ni `ChatInterface`. Cause
du chiffre initial : variance de lancement + n trop petit, pas
`lazyImport`.

`-p "dis bonjour"` n’est pas un gain revendiqué (+5 % séquentiel, sd
HEAD 450 ms) : le tour headless charge `CodeBuddyAgent` + prompt système.

## TUI — first-paint ≠ agent-ready

12 runs, PTY, `PERF_TIMING=true CODEBUDDY_PROVIDER=chatgpt node dist/index.js --no-alt-screen --ephemeral`,
arrêt dès la bannière ASCII (timeout 8 s). Série HEAD puis main.

### Time-to-first-paint

| Côté | Définition | n | médiane (ms) | p10 / p90 | min / max |
|---|---|---:|---:|---|---|
| origin/main | Premier cadre = UI agent (`ui-render` app) | 12 | **770,5** | 738 / 851 | 734 / 919 |
| HEAD | Écran « Starting Code Buddy… » (`ui-first-render` app) | 12 | **528,5** | 456 / 572 | 431 / 786 |
| HEAD | Idem, wall-clock jusqu’à la ligne `ui-first-render` | 12 | 617,6 | 521 / 649 | 485 / 875 |

Sur le **premier cadre visible**, HEAD est plus tôt : 528 vs 770 ms
app-reported (−31 %). C’est le seul gain de perçue. Ce n’est **pas**
un agent prêt.

### Time-to-agent-ready

| Côté | Définition | n | médiane (ms) | p10 / p90 | min / max |
|---|---|---:|---:|---|---|
| origin/main | `ui-render` (app) | 12 | **770,5** | 738 / 851 | 734 / 919 |
| origin/main | Wall-clock jusqu’à la bannière ASCII | 12 | **859,9** | 824 / 939 | 816 / 1018 |
| HEAD | Wall-clock jusqu’à « Starting Code Buddy Conversational Assistant » | 12 | 925,4 | 832 / 1076 | 764 / 1271 |
| HEAD | Wall-clock jusqu’à la bannière ASCII (UI agent) | 12 | **947,4** | 852 / 1117 | 786 / 1302 |

À métrique égale (bannière ASCII), HEAD est **légèrement plus lent**
(+10 %, 947 vs 860 ms). Attendu : un `render()` d’écran de chargement
s’intercale avant l’import de l’agent, puis un `rerender`. L’agent n’est
pas initialisé plus vite ; l’utilisateur voit un cadre plus tôt.

Le −41 % (494 vs 838 ms) de la première rédaction opposait HEAD
`ui-first-render` à main `ui-render`. Chiffres ST3b, mêmes métriques :
first-paint **−31 %** ; agent-ready **+10 %**.

Cible first-paint < 1 200 ms : OK (528 ms).

## Méthode

1. `npx tsc --pretty false` (exit 0) avant chaque arbre. Pas de `npm install`.
2. CLI : `spawnSync(process.execPath, ['dist/index.js', …])`,
   `process.hrtime.bigint()`, 3 warm-up + 50 runs. `FORCE_COLOR` retiré
   (sinon warning Node à chaque spawn). Confirmation `--help`/`--version` :
   `dist-main-bench/` vs `dist-head-bench/`, 50 paires entrelacées.
3. `-p "dis bonjour"` : `GROK_BASE_URL=http://127.0.0.1:1`,
   `CODEBUDDY_PROVIDER=grok`, `GROK_API_KEY=bench-st3b` — le process
   charge l’agent puis échoue en `Connection error` (aucun appel réseau
   payant). 50 runs séquentiels.
4. TUI :

   ```bash
   PERF_TIMING=true CODEBUDDY_PROVIDER=chatgpt \
     node dist/index.js --no-alt-screen --ephemeral
   ```

   dans `script -qec` (PTY pour `isTTY`). `--ephemeral` évite la
   persistance de session. Arrêt à la bannière.

## Profil et changement

Le profil `PERF_TIMING=true` sur `origin/main` montre encore le graphe
`CodeBuddyAgent` (≈ 360–530 ms) **avant** le premier `render()`. Sur
HEAD, `ui-load-start` / `lazy:ChatInterface` précèdent `ui-first-render` ;
l’agent se charge derrière l’écran de démarrage.

Le correctif :

- `src/renderers/startup.ts` ne charge d’abord que `RenderManager` ; les
  six renderers spécialisés sont importés dynamiquement et enregistrés
  en arrière-plan. Le barrel public `src/renderers/index.ts` reste
  inchangé.
- `ChatHistory` et `StructuredOutput` importent directement le manager
  et les types légers, sans réveiller le barrel pendant le premier paint.
- Le CLI affiche un shell TUI minimal, puis `rerender` avec l’agent
  après son import dynamique.

## Preuves brutes (sorties)

`command -v hyperfine` : vide.

`--help` entrelacé (extrait) :

```
PARCOURS --help
  origin/main  n=50 median=64.71 mean=64.76 p10=50.95 p90=73.67 min=45.80 max=104.84 sd=11.59
  HEAD         n=50 median=61.16 mean=62.67 p10=51.42 p90=72.82 min=42.60 max=91.64 sd=9.73
  delta median HEAD/main = -5.5%  (-3.55 ms)
```

TUI HEAD `ui-first-render` médiane 528,5 ms ; TUI main `ui-render`
médiane 770,5 ms ; bannière ASCII 947,4 vs 859,9 ms.
