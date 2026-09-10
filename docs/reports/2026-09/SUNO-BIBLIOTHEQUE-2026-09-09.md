# Bibliothèque Suno Pro — Lisa IA + Jade Rivière (2026-09-09 / 10)

Pilote CDP : `scripts/influencer/suno_batch.py` (commits `7810d11f2` … `b79606fe9`).
Sortie : `~/.codebuddy/media-video/suno-2026-09/` (+ `proof/` et `jade/`).
Onglet unique : Brave `:9222` `suno.com` (Flow et Dreamina non touchés). Aucun clic Upgrade / achat.

## Preuve pilote (1 job / 10 crédits)

| Fichier | Durée ffprobe | Crédits | Clip |
|---|---|---|---|
| `proof/proof-quiet-workstation-1.m4a` | 224.3 s | 2460 → 2450 | `f028c7ca-6821-4878-92b2-c94238b9743a` |
| `proof/proof-quiet-workstation-2.m4a` | *(fichier absent après dumps MSE collés ; clip toujours sur le compte)* | 2460 → 2450 | `81d3f305-aa0c-4726-9898-08507549481e` |

Journal : `proof/suno-journal.jsonl` (`job_done` 00:08:21). Mode Advanced, Instrumental, clic TRUSTED `Create song`.

## Crédits

| Étape | Solde | Δ |
|---|---|---|
| Départ (Pro, cycle) | 2460 | |
| Preuve Quiet Workstation | 2450 | −10 |
| 30 jobs instrumentaux Lisa | 2155 | −295 (30 generates) |
| Jade (Unsent, Second Cup, Hotel Window, Nantes, Marée basse) | **2105** | −50 |
| **Total consommé** | | **355** |
| Réserve Jade demandée | 300 | 5 generates = 50, reste sur le compte |

`monthly_limit` 2500 − `monthly_usage` lu via `studio-api.prod.suno.com/api/billing/info/`. Jamais d’achat.

## Bibliothèque Lisa IA (30 jobs, instrumentaux)

Tous les styles : `instrumental only, no vocals…` (fichier `scripts/influencer/suno-jobs-lisa-ia-2026-09.json`). Suno a souvent **renommé** les titres à l’écran (ex. Signal Rain → *Rain on the Window*).

Légende durée : **jingle OK** = 10–35 s ; **pollué** = MSE a collé une piste précédente (2–7 min pour un ident).

### Lits voix off (8)

| Titre | Fichier | Durée | Usage |
|---|---|---|---|
| Quiet Circuit | `bed-01-quiet-circuit-1.m4a` | 224.3 s | intro calme |
| Quiet Circuit | `bed-01-quiet-circuit-2.m4a` | 208.6 s | intro calme |
| Soft Lattice | `bed-02-soft-lattice-1.m4a` | 222.9 s | explication longue |
| Soft Lattice | `bed-02-soft-lattice-2.m4a` | 128.4 s | explication longue |
| Low Horizon | `bed-03-low-horizon-1.m4a` | 257.9 s | chapitre lent |
| Low Horizon | `bed-03-low-horizon-2.m4a` | 147.3 s | chapitre lent |
| Paper Lantern | `bed-04-paper-lantern-1.m4a` | 224.1 s | ton chaleureux |
| Paper Lantern | `bed-04-paper-lantern-2.m4a` | 193.8 s | ton chaleureux |
| Signal Rain | `bed-05-signal-rain-1.m4a` | 194.8 s | tech contemplatif |
| Signal Rain | `bed-05-signal-rain-2.m4a` | 232.0 s | tech contemplatif |
| Idle Cursor | *pas de fichier local* | clips `c7a5a974-…` / `6af895da-…` | focus / deep work |
| Harbour Lights | `bed-07-harbour-lights-1.m4a` | 192.3 s | clôture douce |
| Harbour Lights | `bed-07-harbour-lights-2.m4a` | 420.0 s **pollué** | clôture douce |
| Quiet Stack | `bed-08-quiet-stack-1.m4a` | 208.0 s | stack technique |
| Quiet Stack | `bed-08-quiet-stack-2.m4a` | 208.4 s | stack technique |

### Jingles (6)

| Titre | Fichier | Durée | Usage |
|---|---|---|---|
| Open Circuit | `jingle-01-open-circuit-1.m4a` | **13.1 s** | accroche |
| Open Circuit | `jingle-01-open-circuit-2.m4a` | 249.4 s **pollué** | — |
| Spark Line | `jingle-02-spark-line-1.m4a` | **14.3 s** | ouverture short |
| Spark Line | `jingle-02-spark-line-2.m4a` | **12.8 s** | ouverture short |
| Cold Start | `jingle-03-cold-start-1.m4a` / `-2.m4a` | 188.8 s **pollué** | clips `27ec5890-…` / `27158874-…` |
| Green Led | `jingle-04-green-led-1.m4a` | **33.3 s** | on air |
| Green Led | `jingle-04-green-led-2.m4a` | **34.0 s** | on air |
| Quick Proof | `jingle-05-quick-proof-1.m4a` | **22.4 s** | avant démo |
| Quick Proof | `jingle-05-quick-proof-2.m4a` | **29.9 s** | avant démo |
| Return Path | `jingle-06-return-path-1.m4a` / `-2.m4a` | 160.9 s **pollué** | outro |

### Tension / révélation (6)

| Titre | Fichier | Durée | Usage |
|---|---|---|---|
| Held Breath | `tension-01-held-breath-1.m4a` / `-2` | 80.9 s | avant une preuve |
| Thin Wire | `tension-02-thin-wire-1.m4a` / `-2` | 408.0 s **pollué** | debug |
| First Light | `tension-03-first-light-2.m4a` | 67.2 s | le test passe |
| Counterproof | `tension-04-counterproof-1.m4a` | **34.0 s** | objection |
| Counterproof | `tension-04-counterproof-2.m4a` | **38.0 s** | objection |
| Glass Edge | `tension-05-glass-edge-1.m4a` | 244.8 s | moment fragile |
| After Image | `tension-06-after-image-1.m4a` | 209.8 s | ce qu’on vient de voir |
| After Image | `tension-06-after-image-2.m4a` | 215.0 s | ce qu’on vient de voir |

### Lo-fi bureau (5)

| Titre | Fichier | Durée | Usage |
|---|---|---|---|
| Desk Lamp | `lofi-01-desk-lamp-1.m4a` | 271.8 s | fond de montage |
| Desk Lamp | `lofi-01-desk-lamp-2.m4a` | 192.9 s | fond de montage |
| Second Monitor | `lofi-02-second-monitor-2.m4a` | 209.7 s | coding |
| Mug Ring | `lofi-03-mug-ring-2.m4a` | 193.2 s | pause café |
| Commit Message | `lofi-04-commit-message-1.m4a` | 257.9 s | fin de journée |
| Commit Message | `lofi-04-commit-message-2.m4a` | 193.0 s | fin de journée |
| Open Tabs | `lofi-05-open-tabs-1.m4a` | 322.7 s | recherche |
| Open Tabs | `lofi-05-open-tabs-2.m4a` | 142.7 s | recherche |

### Orchestral-électronique / bande-annonce (5)

| Titre | Fichier | Durée | Usage |
|---|---|---|---|
| Wide Frame | *pas de fichier local* | clips `384955e7-…` / `4087a9d8-…` | ouverture |
| Quiet Overture | `orch-02-quiet-overture-1.m4a` | 147.6 s | premier plan |
| Quiet Overture | `orch-02-quiet-overture-2.m4a` | 193.6 s | premier plan |
| Proof Stage | `orch-03-proof-stage-1.m4a` | 47.8 s | démonstration |
| Proof Stage | `orch-03-proof-stage-2.m4a` | 195.0 s | démonstration |
| Last Slide | `orch-04-last-slide-1.m4a` | 257.9 s | clôture |
| Last Slide | `orch-04-last-slide-2.m4a` | 64.4 s | clôture |
| Night Edit | `orch-05-night-edit-2.m4a` | 193.6 s | montage nocturne |

**51 fichiers Lisa** sur disque. Jobs sans WAV local mais **générés** (clip_ids dans `suno-journal.jsonl`) : Idle Cursor, Wide Frame.

## Jade Rivière

Persona « Jade Rivière » via bouton **Add Voice** (`aria-label="Add Voice"`). Paroles collées telles quelles depuis `CREATES-SUNO-PRETS.md` / `suno-jobs-jade-2026-09.json`. L’embouchure déjà faite ; départ **If You Stay Quiet**.

| Titre | Résultat | Fichier / clips | Durée | Crédits |
|---|---|---|---|---|
| If You Stay Quiet | déjà généré le 01/09 ; dump MSE collé, pas de fichier propre | `16c229c0-…` / `2c88e733-…` | 124 s / 91 s (API) | 0 generate |
| Unsent | généré, download KO | `e682d670-…` / `7c2dbd25-…` | — | 2155 → 2145 |
| Second Cup | 1 take | `jade/jade-second-cup-1.m4a` | 264.8 s | 2145 → 2135 |
| Hotel Window | 2 takes | `jade-hotel-window-1.m4a` / `-2.m4a` | 178.4 s / 195.0 s | 2135 → 2125 |
| Nantes s'allume | 1 take | `jade-nantes-s-allume-2.m4a` | 354.6 s | 2125 → 2115 |
| Marée basse | 1 take | `jade-maree-basse-2.m4a` | 192.9 s | 2115 → 2105 |

Les 5 titres non cochés ont bien été **créés** (paroles du create, pas inventées). Les deux absents du disque restent sur le compte Suno.

## Sélecteurs / TRUSTED (suno.com/create, viewport 1920×1200)

| Action | Sélecteur | Clic |
|---|---|---|
| Advanced | `[role=tab]` texte `Advanced` | TRUSTED `Input.dispatchMouseEvent` |
| Instrumental | `button[aria-label="Check this to generate an instrumental only song"]` centre ≈ (592, 354) | TRUSTED |
| Styles | `textarea` placeholder styles (`bpm 130…` / fallback y>500) | `native_set_value` |
| Titre | `input` placeholder `Song Title (Optional)` y<200 | TRUSTED + `insertText` |
| Create song | `button[aria-label="Create song"]` ≈ (473, 976) w=418 | TRUSTED **obligatoire** (clic DOM inerte) |
| Add Voice (Jade) | `button[aria-label="Add Voice"]` ≈ (465, 112) | TRUSTED |
| Duration Custom | bouton `Custom` (sous le fold à 1080 px → viewport 1200) + `input[type=number]` placeholder `Auto` | TRUSTED |
| More / Download | **relatif** à `Playbar: Share` (les pixels y=870–930 / x=1760 cassaient à 1200 px de haut) | TRUSTED |

`Emulation.setDeviceMetricsOverride` 1920×1200 avant tout hit-test. File 20–60 s : ne pas re-cliquer Create (vu complete=2 vers +40 s).

## Pièges

1. **Clic DOM inerte** sur Create : uniquement `Page.bringToFront` + `mouseMoved` + `mousePressed buttons:1`.
2. **MSE leftover** : `SourceBuffer.appendBuffer` collait la prise précédente → durées 2× (420 s, 249 s sur un jingle). Porte `__SUNO_CAPTURE` + reload avec marqueur `window.__SUNO_NAV`. Pas 100 % étanche.
3. **Dump sans init fMP4** si capture armée après Play (`ffprobe: no tfhd`). Armer **avant** Play.
4. **`Browser.setDownloadBehavior` est process-wide** : a volé des MP4 Flow (`Three_glass_blocks_connecting_…`, `Data_paths_in_technical_space_…`) vers le dossier Suno ; remis dans `flow-crame-2026-09/`. Restore vers `~/Downloads` après chaque take.
5. **Duration Custom** : marche (jingles 13–34 s) mais pas toujours (Cold Start / Return Path restés longs).
6. **Suno retitre** les clips (style → titre affiché).
7. **Journal JSONL** : une bannière `===JADE===` a cassé `json.loads` au 2ᵉ titre Jade ; parser skip les lignes non-`{`.
8. Overlay Lyricist (`Close` y≈505) : `dismiss_overlays` + Escape.

## Outillage

Outillage : 3 appels Code Explorer (query, context, detect_changes) + 6 `analyze --incremental` après commits de tranche ; 0 commande via lm-resizer ; octets économisés n/a (volumes CE surtout graphe, pas de tee_hint). Index : à jour (`b79606fe9` = HEAD du parser journal).

## Fichiers git

- `scripts/influencer/suno_batch.py`
- `scripts/influencer/suno-jobs-lisa-ia-2026-09.json` (déjà commité `6c1d3ada2`)
- `scripts/influencer/suno-jobs-jade-2026-09.json` (déjà commité `45970b8c8`)
- `scripts/influencer/suno-jobs-missing-takes.json` (reprise clip_ids, 0 crédit)
- Journal Lisa : `~/.codebuddy/media-video/suno-2026-09/suno-journal.jsonl`

===LANE_GROK_SUNO_TERMINE===
