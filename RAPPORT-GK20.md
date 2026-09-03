# RAPPORT GK20 — Le moteur de règles sensorielles (`buddy rules`, panneau Automations de Cowork) en vrai

Date : 2026-09-03
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-repar-gemini-2026-09-02`
Branche : `fix/gk20-rules-reel-2026-09-03`
HEAD au démarrage : `98b0a77e1`
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du moteur, des commandes et du panneau Automations.

## Mission

Éprouver le moteur de règles sensorielles de bout en bout : `buddy rules` + pont loopback + actions (webhook local, shell sûr, alerte) + journal `runs` + rechargement à chaud + refus destructif + bornage des boucles + tenue sous 200 perceptions/s. Pont réel 8129 jamais utilisé.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Aucun service systemd. ComfyUI 8188/8189 intact.
- HOME / règles / runs : `_qa/gk20/` dans le clone. Ports 18010/18011/18012.
- `package-lock.json` retouché par `npm install` (clone sans `node_modules`) — **non commité**.

## Journal

| Heure (Europe/Paris) | Action |
|---|---|
| 12:08 | Rapport créé avant inspection. Coordination réservée. |
| 12:08–12:18 | Lecture CLAUDE.md, `sensory-rules-engine.ts`, `sensory-action-executor.ts`, CLI `buddy rules` (`src/index.ts`), Cowork Automations, tests existants. |
| 12:18 | Tests GK20 **4 rouges / 4 verts** : loopback rejeté, localhost validate≠upsert, boucle 40, 200 exécutions. |
| 12:20 | Correctifs loopback + plafonds. 30 tests ciblés verts. |
| 12:24 | Parcours live 10/11 : la boucle échoue car `saveSensoryRules` refuse tout le fichier dès qu’un `rm -rf` y a été collé à la main. |
| 12:25 | Rouge collé (`does not block adding`). Correctif : save mixte droppe l’unsafe. |
| 12:26 | Parcours live **11/11 PASS**. Pont `ws://127.0.0.1:18011`. 8129 réel toujours occupé, pas le nôtre. |

## Fichiers lus

- `CLAUDE.md` (§ `CODEBUDDY_SENSORY_RULES_FILE`, `validateRule` / `isDestructive`, hot-reload)
- `src/sensory/sensory-rules-engine.ts`, `sensory-action-executor.ts`, `sensory-bridge.ts`, `reactions.ts`, `alert.ts`
- `src/index.ts` (`buddy rules`), `src/server/index.ts` (câblage `CODEBUDDY_SENSORY_RULES=true` + token)
- `src/security/ssrf-guard.ts`, `safe-fetch.ts`, `dangerous-patterns.ts`, `dev-origins.ts`
- `cowork/src/renderer/components/settings/SettingsAutomations.tsx`, `SettingsPanel.tsx`, `cowork/src/main/ipc/automations-ipc.ts`, preload
- `tests/sensory/sensory-rules*.test.ts`, `webhook-ssrf.test.ts`, `buddy-vision/sensory-rules.example.json`

## Écarts

### E1 — webhook loopback refusé (exemple Home Assistant impossible en local) — FERMÉ

`validateRule` / `assertSafeUrl` bloquaient `127.0.0.1`. `localhost` passait le check **sync** (pas de DNS) puis échouait à l’upsert (DNS → loopback). L’exemple officiel pointe `homeassistant.local`.

- Rouge : `gk20-rules-contracts` 2 failed (`127.0.0.1` validate false ; `localhost` upsert false)
- Correctif : `isLoopbackHttpUrl()` (réutilise `isLoopbackHost`). Autorisé à l’écriture et à l’exécution, **sans** follow de redirect. RFC1918 / 169.254 inchangés.
- Vert : POST réel → HTTP 204. Live : `✅ Saved rule gk20-hook` puis hit JSONL.

### E2 — `rm -rf` / `curl \| sh` à l’ajout — déjà conforme, re-prouvé — RAS

`isDestructive` via `DANGEROUS_COMMANDS` (`rm`) + motif `curl.*\| sh`. `upsert` ne persistait rien. Hot-reload : `rejected 1 unsafe sensory rule(s) during reload`.

### E3 — règle qui se réémet + 200/s non bornés — FERMÉ

Sans plafond, un `execute` qui re-émettait partait à 40 (cap du test) ; 200 events → 200 executes concurrents.

- Correctif : `CODEBUDDY_RULE_MAX_IN_FLIGHT` / `CODEBUDDY_RULE_MAX_FIRES_PER_SEC` (défaut 8), latch in-flight par règle.
- Live : boucle webhook→WS → **2 hits** (pas une fuite). 200 frames en 101 ms, health 200, ΔRSS 0 kB.

### E4 — une règle unsafe collée à la main coincait tout `buddy rules add` — FERMÉ

`saveSensoryRules` validait **tout** le fichier. Après le test « destructif à chaud », `add` de la règle-boucle lançait `Invalid sensory rule: rm -rf /`.

- Rouge : `does not block adding a new valid rule`
- Correctif : mixte → on persiste les valides et on droppe les unsafe (warn). Un fichier *uniquement* unsafe échoue toujours (test SSRF intact).
- Live 2 : `[rules] dropped 1 unsafe rule(s) while saving` puis `✅ Saved rule gk20-loop`.

### E5 — panneau Automations Cowork sans test — FERMÉ

Client mince déjà correct (IPC → le même moteur que `buddy rules`). Test de câblage `tests/cowork-automations-surface.test.ts` 4/4.

## Tableau scénario → attendu → obtenu → correctif → commit

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| `buddy server` + pont loopback | health 200, WS ≠ 8129 | `ws://127.0.0.1:18011`, 8129 réel intact | — | `f59127ea9` |
| `rules add` webhook local | Saved + POST reçu | HTTP 204, body `person_entered` | E1 loopback | `81c82ac4d` |
| `rules add` shell sûr | fichier écrit | `gk20-shell person_entered` | — | `f59127ea9` |
| `rules add` alerte | run `ok` | `gk20-alert` ok:true (Telegram no-op sans token) | — | `f59127ea9` |
| perception → action | requête + fichier | hits=true shell=true | E1 | `81c82ac4d` |
| `buddy rules runs` | hook + shell | 3 runs ok (hook/shell/alert) | — | `f59127ea9` |
| hot-reload fichier | drowsy sans restart | `hot-reload` dans shell-proof | déjà là (throttle 2 s) | — |
| destructif à l’ajout | rejeté | `rm -rf /` et `curl \| sh` rejected | déjà là | — |
| destructif à chaud | ignoré, serveur vivant | reload `rejected 1 unsafe`, health 200 | déjà là | — |
| add après leftover unsafe | Saved | coincé puis drop+Saved | E4 | `81c82ac4d` |
| boucle webhook→perception | bornée | 2 hits (≤ 16) | E3 | `81c82ac4d` |
| 200 perceptions/s | pas de blocage / fuite | 101 ms, health 200, ΔRSS 0 | E3 | `81c82ac4d` |
| Automations Cowork | IPC = même moteur | 4/4 surface | E5 | `51433e88f` |

## Preuves live (2ᵉ passage, 11/11)

```
[sensory] bridge listening on ws://127.0.0.1:18011
[rules] gk20-hook (webhook) → ok: HTTP 204
[rules] gk20-shell (shell) → ok
[rules] rejected 1 unsafe sensory rule(s) during reload
[rules] dropped 1 unsafe rule(s) while saving
```

`_qa/gk20/work/shell-proof.txt` : `gk20-shell person_entered` + `hot-reload`.
`_qa/gk20/runs.jsonl` : hook/shell/alert + hot + loop×2.
Pont 8129 : toujours `busy` (processus réel, jamais contacté).

## Condition d’activation réelle

Le pont démarre avec `CODEBUDDY_SENSORY=true`. **Le moteur de règles** ne se câble que si `CODEBUDDY_SENSORY_RULES=true` **et** `CODEBUDDY_SENSORY_TOKEN` est posé. Consigné dans CLAUDE.md.

## Reste ouvert

- `http://homeassistant.local:8123/...` (LAN / mDNS) reste bloqué par le SSRF ; seul le loopback est rouvert. Un reverse-proxy `127.0.0.1` ou une URL publique reste nécessaire.
- L’alerte Telegram sans `CODEBUDDY_SENSORY_ALERT_TOKEN`/`_CHAT` est un no-op (`ok: true`).
- Le panneau Cowork n’a pas été cliqué dans Electron (pas de `node_modules` Cowork, pas de GUI). Le câblage source est testé.

## Bilan

Moteur éprouvé en vrai sur ports libres, HOME dans le clone, 8129 réel intact. Trois défauts fermés (loopback, plafonds anti-boucle, save coincé par leftover unsafe) ; le refus destructif et le hot-reload tenaient déjà. 11/11 scénarios live ; tests ciblés verts ; `tsc` 0 ; ESLint ciblé 0. Aucun push, aucune API payante, aucun service touché.
