# RAPPORT-GK27 — Le conseil de modèles en vrai (`buddy council`, `CODEBUDDY_COUNCIL_ROUTING`, `/fleet route`, `route_peer`)

Mission : exercer **pour de vrai** le conseil de modèles avec deux LLM Ollama locaux, le routage principal derrière `CODEBUDDY_COUNCIL_ROUTING`, et le lint de vie privée de `/fleet route` / `route_peer`.

- Clone autorisé : `~/DEV/cb-repar-jumeaux-2026-09-02` uniquement
- Branche : `fix/gk27-council-reel-2026-09-03`
- HEAD au départ : `5e7639b426a7f22679b9db7fa118d7f41e9bebe4`
- Date : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection (réservation `83faaf1d8`)
- Buddy : `node node_modules/tsx/dist/cli.mjs src/index.ts` depuis le clone
- HOME temporaire : `_qa/gk27/home` (timeout), `_qa/gk27/home-2` (full+registry), `_qa/gk27/home-3` / `home-4` (membre mort)
- Journaux réels **intacts** (sha256 inchangés du début à la fin) :
  - `~/.codebuddy/fleet-model-performance.jsonl` — 8465 octets, `ab2cec017f025f7dc41cf3a662733e704cc1c05e9c1b9c62fd391ee6688a64a5`
  - `~/.codebuddy/council-deliberation-health.jsonl` — 2323 octets, `d45f79547b888300a1b63fd38fb436dbc28727cf5307be12eabd0a33e59c9e62`

## Garde-fous (rappel)

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. Ollama local uniquement (`CODEBUDDY_PROVIDER=ollama`). `--models` pour ne pas fanner vers `agy-cli` / Gemini.
- Aucun service systemd. ComfyUI 8188/8189 non touché.
- Original `~/code-buddy` interdit.

## Journal

### 2026-09-03 — création du rapport (avant inspection)

HEAD `5e7639b42`. Arbre propre. Réservation `83faaf1d8`.

### 2026-09-03 — inspection (après réservation)

Surface réelle :

- Pipeline : `src/council/council-engine.ts` (8 étapes), juge `judge.ts` (abstention si non-JSON), synthèse `signals.ts` (citation minoritaire si écart > 0,3), DHI `deliberation-health.ts`.
- CLI : `src/commands/council.ts` + `buddy council` (`src/index.ts`). Pool `CODEBUDDY_COUNCIL_POOL=full|registry`.
- Routage : `ModelRoutingFacade.applyScoreboardTieBreak` derrière `CODEBUDDY_COUNCIL_ROUTING=true` ; scoreboard vide ⇒ pas de bascule.
- Flotte : `executeRoutePeer` (`route_peer`) + `handleFleet(['route', …])` (`/fleet route`) ; lint IBAN dans `privacy-lint.ts`.
- Forces : `getModelStrengths()` dans `src/config/model-tools.ts`.

Pool live (HOME temp, `CODEBUDDY_PROVIDER=ollama`) : **42** modèles en `full` (dont `agy-cli` Gemini et `omniroute`) ; **4** en `registry` (agy-cli, ollama=`gemma4-moe-rag:latest`, lemonade, omniroute). D’où `--models` obligatoire pour rester local / $0.

### 2026-09-03 — parcours réel

Question vérifiable : `Combien font 17 × 19 ? Donne le produit entier exact. Vérifie par distributivité : 17×20 − 17.` (323).

**Pool `full`, 2 sièges** (`qwen3:4b-instruct` + `qwen2.5:3b-instruct`, juge visé `qwen2.5:1.5b-instruct`, HOME `home-2`, 13:03–13:06) :

- Membres : Strategist `qwen3:4b-instruct` (86 s, score 1.00) · Skeptic `qwen2.5:3b-instruct` (54 s, score 0.00).
- Contrat : synthèse structurée DECISION / FRICTION POINTS / RETAINED MINORITY OPINION / REVERSAL CONDITIONS / UNRESOLVED QUESTIONS.
- Juge : `qwen3:4b-instruct` (membre du panel — le 1.5b off-panel n’a pas répondu) ; **vérifie** 17×20−17=323 ; apprentissage ignoré (juge non neutre).
- Minorité citée (écart 1.00 > 0,3) : floating-point `322.999…`, réfutée explicitement.
- Santé : ligne dans `_qa/gk27/home-2/.codebuddy/council-deliberation-health.jsonl` (`dhi: 0` car `judgeAlive: 0` — juge non neutre). DHI nul **n’empêche pas** l’écriture du journal.

**Pool `registry`, `--models ollama`** (13:06–13:07) : 1 siège `gemma4-moe-rag:latest` (57 s), note « Conseil à 1 membre », 323 vérifié, 2ᵉ ligne DHI.

**Premier essai `full` avec `qwen3.8-ctx32k` + `qwen3:4b-instruct`** (GPU saturé par un `qwen3.8:27b` d’une autre mission) : timeout 300 s × 2 → `❌ Toutes les IA ont échoué` **exit 0** (défaut D3). Scoreboard temp : `failed: true` pour les deux.

**Membre mort live** (`qwen3:4b-instruct-ghost` 404 + `qwen3:4b-instruct` + spare `qwen2.5:3b-instruct`) :

- Avant correctif D5 : panel ghost+4b, 404, remplacement 3b, **juge = ghost**, verdict `abstained`.
- Après `5e3ccf9e6` : mêmes 2 vivants, juge = `qwen3:4b-instruct`, verdict `judged`. Ghost `failed: true` une seule fois.

**`CODEBUDDY_COUNCIL_ROUTING=true`** (script `_qa/gk27/live-routing.ts`, vrai `ModelRoutingFacade`) :

- Scoreboard vide → `grok-3-mini` inchangé (`switched: false`).
- Historique 6 victoires `grok-3` → bascule `council-routing: grok-3 historically stronger`.
- Drapeau off → `grok-3-mini`.

**`/fleet route` + `route_peer`** IBAN `FR76 3000 6000 0112 3456 7890 189` :

- Avant : `No fleet peers connected` **sans** lint.
- Après `fc319c3ec` : `Privacy lint flagged: pii-iban`, `privacyTag: sensitive`, `matchKinds: ["pii-iban"]`.

## Défauts, rouge → vert

**D1 — lint IBAN invisible sans pair.** Tests rouges : `route-peer-privacy` + `fleet-handler` (`pii-iban` absent). Correctif : `scanForSecrets` avant la découverte des pairs. Live : `Privacy lint flagged: pii-iban`. Commit `fc319c3ec`.

**D2 — membre mort non remplacé.** Test rouge : answers `['coder-b']` au lieu de `['coder-b','coder-c']`. Correctif : spare du pool classé reprend le rôle du siège 404. Live : ghost 404 → answers 4b+3b. Commit `4adb620d2`.

**D3 — conseil « réussi » sans membre vivant.** Live : timeout total, message d’échec, **exit 0**. Test rouge : `process.exitCode` restait 0. Correctif : `process.exitCode = 1` sur `CouncilError`. Commit `447cecb0e`.

**D4 — `--models` sans match rouvre tout le pool (agy-cli Gemini).** Observé au probe (42 modèles). Test rouge : `--models qwen3:4b-instruct` sur un registre sans qwen ne doit pas appeler Gemini. Correctif : `CouncilError('no-candidates')` si filtre vide. Commit `2bb352a2d`.

**D5 — le siège 404 juge encore les remplaçants.** Live : `judge: qwen3:4b-instruct-ghost`, verdict `abstained`. Test rouge : `judgeModel === 'coder-dead'`. Correctif : exclure les `failures` du juge, repli sur un answerer vivant. Live rejeu : `judge: qwen3:4b-instruct`, `verdict: judged`. Commit `5e3ccf9e6`.

## Tableau final

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| `buddy council` pool `full`, 2 Ollama, 17×19 | Membres, VERDICT/CLAIMS, juge, synthèse + minorité si écart > 0,3, ligne DHI | 2 sièges 4b/3b, 323 vérifié, minorité `322.999` citée, DHI jsonl écrit | — | — |
| `buddy council` pool `registry` `--models ollama` | Panel registry (1 modèle / provider) | 1 siège `gemma4-moe-rag:latest`, 323, note 1 membre, DHI jsonl | — | — |
| Scoreboard vide + `CODEBUDDY_COUNCIL_ROUTING=true` | Aucune bascule | `grok-3-mini` inchangé | déjà conforme | — |
| Scoreboard avec historique réel | Bascule conservative | `grok-3` + raison `council-routing` | déjà conforme | — |
| `/fleet route` / `route_peer` + IBAN, 0 pair | Lint `pii-iban` | Erreur pairs **sans** lint | scan avant découverte | `fc319c3ec` |
| Membre 404 | Pénalisé **et** remplacé | Pénalisé, siège perdu | spare intra-run | `4adb620d2` |
| Conseil 0 vivant | Échec (pas succès) | Message d’échec, **exit 0** | `exitCode=1` | `447cecb0e` |
| `--models` sans match | Fail-closed local | Pool 42 dont Gemini | no-candidates | `2bb352a2d` |
| Juge après remplacement | Modèle vivant | Juge = ghost 404 | exclure les dead | `5e3ccf9e6` |

## Vérifications

- Union ciblée : 8 fichiers / **149** tests verts.
- ESLint ciblé `--max-warnings=0` : 0.
- Journaux réels : sha256 identiques à l’empreinte de départ.
- Aucun push, aucune API payante, ComfyUI non touché.

## Reste ouvert

- DHI = 0 dès que le juge est un membre du panel (aucun modèle local ne matche `STRONG_JUDGE_PATTERN` gpt-5/opus/gemini/grok). Le journal est quand même écrit.
- `qwen3.8*` déclare `contextWindow: 262144` : un siège 27b/ctx32k en parallèle timeout si le GPU est déjà pris (première passe 300 s).
- `/fleet route` sans pair **signale** l’IBAN mais ne route pas (pas de pair). Le veto cloud+IBAN unitaire était déjà vert.
