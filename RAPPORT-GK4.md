# RAPPORT GK4 — Video Studio en vrai : short 9:16 à 0 €

Date : 2026-09-03
Clone : `/home/patrice/DEV/cb-never-slash-2026-09-02`
Branche visée : `fix/gk4-video-studio-reel-2026-09-03`
Règles : aucun push ; aucune API payante ; aucun systemd ; aucune écriture hors clone / `~/.codebuddy` (HOME temporaire dans le clone) ; original `~/code-buddy` interdit ; pas de `DISPLAY=:10` ; ports libres seulement.

GK4a a produit le short et s’est arrêté à « (à coller) » en § 4.3. GK4b reprend les artefacts, juge, répare, rejoue.

---

## 0. Journal (fil de l’eau)

| Heure (approx.) | Action | Statut |
|---|---|---|
| T0 | Création de ce rapport | fait (GK4a) |
| T0+ | Lecture coordination Fable 5 + réserve chantier | fait |
| T0+ | `buddy film from-prompt --short` (Ollama `qwen3.8:27b` + Piper) | fait — 3 scènes, 11,43 s, PASS affiché |
| GK4b | ffprobe / volumedetect / blackdetect / silencedetect + 3 captures | fait |
| GK4b | Défauts : audio tronqué 0,6 s, porte laxiste, titre sur diagramme | 4 commits |
| GK4b | Rejeu `from-prompt --short` → `gk4-nuit-b` | 3 scènes, 13,60 s, A=V, PASS |
| GK4b | `film generate --assemble-only` + `film assemble` sur 2 clips | PASS après correctif audio |

---

## 1. Coordination Fable 5

- Document lu : `docs/FABLE5-CODEX-COORDINATION.md`
- Chantier : ligne P0 « Mission GK4 » — **Grok 4.6 — FAIT le 03/09/2026** (suite GK4b)
- Zones : `src/agent/film/`, `src/tools/video/`, tests associés, `_qa/gk4/`, `RAPPORT-GK4.md`. Original `~/code-buddy` non touché. ComfyUI 8188/8189 non touché. `DISPLAY=:10` jamais transmis.

---

## 2. Git

HEAD de départ : `3fcf5a97d docs(voice): consigner les preuves DARK3`

Lanceur PATH `buddy` (`~/.local/bin/buddy`) → `/home/patrice/code-buddy` **interdit**. Invocation : `./node_modules/.bin/tsx src/index.ts` depuis le clone.

`package-lock.json` : GK4a avait changé `license` MIT → BUSL-1.1 (écho de `package.json` après `npm install`). **Restauré** — inutile au Video Studio.

`docs/FABLE5-CODEX-COORDINATION.md` : **gardé** (réservation + clôture du chantier).

---

## 3. Prérequis locaux

Voir le tableau GK4a (ffmpeg 6.1.1, ImageMagick, Piper `fr_FR-siwis-medium` copié dans `_qa/gk4/voices/`, mmdc, Chromium Playwright, Ollama `qwen3.8:27b`). HOME isolé : `_qa/gk4/home`.

---

## 4. Lot 1 — `buddy film from-prompt --short`

### 4.1 Commande exacte

```bash
env -u DISPLAY -u GROK_API_KEY -u OPENAI_API_KEY -u ANTHROPIC_API_KEY \
  -u GEMINI_API_KEY -u ELEVENLABS_API_KEY -u XAI_API_KEY \
  HOME="$ROOT/_qa/gk4/home" \
  CODEBUDDY_PROVIDER=ollama \
  OLLAMA_HOST=127.0.0.1:11434 \
  GROK_MODEL=qwen3.8:27b \
  OLLAMA_MODEL=qwen3.8:27b \
  CODEBUDDY_TTS_VOICE="$ROOT/_qa/gk4/voices/fr_FR-siwis-medium.onnx" \
  CODEBUDDY_TTS_ENGINE=piper \
  CODEBUDDY_CHROMIUM_PATH=/home/patrice/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
  LOG_LEVEL=info \
  ./node_modules/.bin/tsx src/index.ts film from-prompt \
    "Pourquoi un robot compagnon doit se taire la nuit" \
    --short --model qwen3.8:27b --name gk4-nuit
```

Script : `_qa/gk4/run-from-prompt.sh`.

### 4.2 Sortie collée

```
🎬  Production vidéo depuis le prompt : « Pourquoi un robot compagnon doit se taire la nuit »
   planning — Pourquoi un robot compagnon doit se taire la nuit
[scene-planner] 3 scène(s) planifiée(s) pour « Pourquoi un robot compagnon doit se taire la nuit »
   [1/3] narration — Silence Nuit
   [1/3] render — Silence Nuit
   [2/3] narration — Mode Repos
   [2/3] visual — diagramme
   [2/3] render — Mode Repos
   [3/3] render — Toujours Présent
   assemble — 3 scène(s)
[film-assemble] 3 clip(s), engine=xfade, 1080x1920@30, ~11.45s
[film-quality] PASS — 11.43s, audio=-20.2dB, black=0.2s
✓ 3 scène(s) · 11.43s · qualité PASS
   film: .codebuddy/media-generation/films/gk4-nuit-1788427282572-fb60bfa7-88c3-4125-9833-7f8644260808.mp4
EXIT:0
```

### 4.3 Fichier produit + ffprobe / volumedetect / blackdetect / silencedetect

Fichier : `.codebuddy/media-generation/films/gk4-nuit-1788427282572-fb60bfa7-88c3-4125-9833-7f8644260808.mp4` (1,9 Mo)

```
Duration: 00:00:11.43, bitrate: 1335 kb/s
Stream #0:0: Video: h264 (High), yuv420p, 1080x1920 [SAR 1:1 DAR 9:16], 1189 kb/s, 30 fps, 343 frames
Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, 144 kb/s, duration=10.832 s   ← 0,601 s plus court que la vidéo
```

volumedetect (film) : **mean −20,2 dB, max −3,0 dB** (narration Piper audible ; nappe seule −36,8 dB).
WAV Piper : nar-1/2/3 mean −15,6 / −15,4 / −16,2 dB, max 0,0 dB.

blackdetect `d=0.1:pix_th=0.10` : **black_start:0 black_end:0.2 black_duration:0.2** (fade-in 0,4 s du renderer).
La porte interne utilise `pic_th=0.98` (presque noir pur) → 0,2 s, ratio 1,7 % < 15 %.

silencedetect `n=-40dB:d=0.5` :
- 0,00–0,78 s (lead avant la voix)
- 2,55–4,00 s (jointure xfade 1)
- 6,12–7,67 s (jointure xfade 2)
- 10,13–10,84 s (fin de piste audio — et c’est là que l’audio s’arrête, 0,6 s avant la vidéo)

Clips : scene-1 3,91 s, scene-2 4,17 s, scene-3 4,57 s (il y a **3** clips, pas 2). Σ − 2×0,6 = 11,45 s. Cohérent avec `--short` (~3 scènes, Reels 7–15 s).

Plan JSON du modèle local (reconstruit depuis titres brûlés + ASS, le planner ne persistait pas le JSON) :

| # | Titre | Sous-titre | Narration | Visual |
|---|---|---|---|---|
| 1 | Silence Nuit | Respect du sommeil | Le vrai compagnon écoute avant de parler. | text |
| 2 | Mode Repos | Détection de sommeil | Il détecte ton repos et se coupe. | diagramme Mermaid LR |
| 3 | Toujours Présent | Présence discrète | Présent sans envahir, voilà la confiance. | text |

Texte local **propre** (pas de `<think>`, pas de JSON brut). Karaoké ASS présent, brûlé (mots en cyan).

**Jugement honnête de la porte PASS :** audio moyen −20 dB = audible, durée vs estimé 11,45 s OK, noir 0,2 s OK. **Mais** la durée du *conteneur* suit le flux le plus long : 11,43 s vidéo / **10,83 s audio** passait encore. PASS était **trop généreux** sur cet axe.

### 4.4 Captures `_qa/gk4/`

- début (`debut.png`, t=0,2 s) : carte « Silence Nuit » encore dans le fade — karaoké pas encore (lead 0,6 s).
- karaoké t=0,6 s : `_qa/gk4/karaoke-t0.6.png` — « Le **vrai compagnon écoute** ».
- milieu (`milieu.png`) : diagramme LR + karaoké « et se **coupe**. » ; le sous-titre « Détection de sommeil » **recouvre** le losange Mermaid.
- fin (`fin.png`) : « Toujours Présent / Présence discrète », trail sans karaoké (normal).

---

## 5. Défauts rencontrés (un commit par lot)

### Défaut 1 — nappe musicale tronque l’audio d’une transition (0,6 s)

- Observation : film 11,43 s vidéo / 10,83 s audio. Sans musique : A≈V. Avec musique, ducking ou non : −0,6 s. `amix duration=first` + acrossfade sans durée annoncée.
- Test rouge : `pads program audio and mixes music with duration=longest…` (graphe encore `duration=first`).
- Correctif : `duration=longest:dropout_transition=0` + ancrage `apad` du programme.
- Test vert : graphe unitaire + plus tard le test ffmpeg réel.
- Commit : `26e445b0f` `fix(film): empêcher la nappe musicale de tronquer l'audio`
- Rejeu partiel : **insuffisant** sur les vrais clips AAC + ducking (6,87 / 7,47). Voir défaut 1b.

### Défaut 1b — ducking `sidechaincompress` casse encore la durée

- Observation : graphe post-1 toujours 6,87 s audio. Sans ducking : 7,48 s. `apad=whole_dur` no-op si la durée d’entrée est inconnue ; `pad_dur` non plus si le mix ducké EOF tôt.
- Test rouge : assemble 2 clips GK4 → REVIEW 6,87/7,47 ; test lavfi « clip audio plus court que la vidéo ».
- Correctif : `[mix]apad=pad_dur=D[aoutp]` + `-shortest` (l’audio padde jusqu’à la vidéo).
- Test vert : 50/50 `film-assemble.test.ts` ; `gk4-deux` 7,466 s / 7,466 s, PASS.
- Commit : `664a9947b` `fix(film): caler l'audio mixé sur la vidéo avec apad et -shortest`

### Défaut 2 — porte qualité aveugle à A ≠ V

- Observation : PASS sur 10,83 s audio / 11,43 s vidéo (durée = max des flux).
- Test rouge : `fails when the audio stream is shorter than the video` (encore `pass: true`).
- Correctif : `reduceQuality` échoue si `video − audio > 0,25 s` ; ffprobe lit la durée du flux audio.
- Test vert : unitaire + spawn injecté. Premier `generate --assemble-only` → **REVIEW** (preuve que la porte voit maintenant le trou).
- Commit : `c68656385` `fix(film): REVIEW si la piste audio est plus courte que la vidéo`

### Défaut 3 — sous-titre 9:16 sur le diagramme Mermaid

- Observation : « Détection de sommeil » à 0,152×h, diagramme à 0,14×h (1920 : 292 vs 269). Invariant ancien : `fits: false`.
- Test rouge (arithmétique) : `subtitleY+subSize <= titleZone` → 346 ≰ 269.
- Correctif : `computeFramedLayout` bande titre 0,20×h s’il y a un sous-titre ; `orientMermaidForPortrait` LR/RL → TD.
- Test vert : layout + mermaid + video-studio 9:16. Rejeu : sous-titre **au-dessus** du schéma (`_qa/gk4/replay/scene1-diagram.png`).
- Commit : `4ebfb93b5` `fix(film): écarter le titre 9:16 du diagramme Mermaid`

### Non-défauts (jugés honnêtement)

| Suspicion | Verdict |
|---|---|
| Scène manquante | Non — 3/3 clips |
| Narration muette | Non — Piper −15 dB, mix −20 dB |
| Karaoké absent / faux | Non — ASS brûlé, texte = narration |
| Durée 11,4 s vs `--short` | Cohérent (~3 scènes, 7–15 s) |
| Texte modèle local sale | Non sur ces deux runs qwen3.8 |

### Rejeu `from-prompt --short` (après correctifs 1–3, pendant 1b)

`--name gk4-nuit-b`, même prompt / Ollama / Piper. 3 scènes, **13,60 s vidéo = 13,60 s audio**, mean −18,9 dB, black 0,1 s, **PASS**.

Plan rejeu :

1. Silence impératif / Le mode veille — « Un robot qui parle dans le noir est une erreur fatale. » + diagramme
2. Respect du sommeil / Priorité humaine — « Votre repos prime sur n'importe quelle notification. »
3. Discrétion totale / Vraie intelligence — « Le meilleur robot est celui que vous ne remarquez pas la nuit. »

---

## 6. Lot 2 — `buddy film generate|assemble` sur 2 clips

### 6.1 Origine des clips

Les clips `gk4-nuit/clips/scene-{1,2}.mp4` (9:16, narration Piper déjà muxée). Manifeste `.codebuddy/media-generation/films/gk4-deux/film.json` en `ready` (pas de `video_generate` : API potentiellement payante).

`generate` sans `--assemble-only` appellerait le backend vidéo → **non exécuté**.

### 6.2 generate --assemble-only (avant le pad final)

```
[film-assemble] 2 clip(s), engine=xfade, 1080x1920@30, ~7.48s
[film-quality] REVIEW — 7.47s, audio=-20.1dB, black=0.33s
   ⚠ Audio track is 6.87s but the video is 7.47s (truncated by 0.6s).
EXIT:0
```

La porte corrigée a refusé le mix tronqué.

### 6.3 assemble (après `664a9947b`)

```
[film-assemble] 2 clip(s), engine=xfade, 1080x1920@30, ~7.48s
[film-quality] PASS — 7.47s, audio=-20.4dB, black=0.33s
   film: .codebuddy/media-generation/films/gk4-deux-1788429013501-a9b45049-01f9-48e8-bcf4-cfffa1d53e7c.mp4
```

### 6.4 Contrôle qualité

```
video duration=7.466667
audio duration=7.466000
format duration=7.466667
1080x1920 @ 30, aac, mean −20,4 dB
```

|A−V| = 0,7 ms.

---

## 7. Typecheck / lint / tests ciblés

```
npx tsc --noEmit -p .          → exit 0
npx eslint --max-warnings=0    → silencieux (10 fichiers film + tests)
vitest film-assemble           → 50 passed
vitest film-project            → 23 passed (dont 2 ffmpeg réels)
vitest scene-render + mermaid-render + video-studio → 22 passed
```

---

## 8. Commits de ce chantier

| Hash | Message |
|---|---|
| `26e445b0f` | fix(film): empêcher la nappe musicale de tronquer l'audio |
| `c68656385` | fix(film): REVIEW si la piste audio est plus courte que la vidéo |
| `4ebfb93b5` | fix(film): écarter le titre 9:16 du diagramme Mermaid |
| `664a9947b` | fix(film): caler l'audio mixé sur la vidéo avec apad et -shortest |

---

## 8b. Tableau défaut → correctif → commit

| Défaut | Correctif | Commit |
|---|---|---|
| Mix musique : audio −0,6 s (`amix duration=first`) | `duration=longest` + pad programme | `26e445b0f` |
| Ducking AAC : encore −0,6 s | `apad=pad_dur` + `-shortest` | `664a9947b` |
| Porte PASS malgré A≪V | REVIEW si audio < vidéo − 0,25 s | `c68656385` |
| Sous-titre sur le Mermaid 9:16 | bande titre 0,20×h ; LR→TD | `4ebfb93b5` |

---

## 9. Bilan (≤ 10 lignes)

Le short GK4a existait déjà (1080×1920, 30 i/s, 3 scènes, Piper audible, karaoké brûlé, 11,43 s) mais l’audio s’arrêtait 0,6 s trop tôt et la porte disait PASS. Quatre commits : mix, porte A/V, layout 9:16, puis `apad`+`-shortest`. Preuve rejeu : `from-prompt --short` → `gk4-nuit-b` 13,60 s **A=V**, −18,9 dB, PASS. Preuve assemble : 2 clips → 7,466/7,466 s, PASS. `tsc` 0, eslint ciblé 0, 50+23+22 tests film verts. `package-lock.json` restauré ; FABLE5 gardé. Un utilisateur avec Ollama local + Piper + ffmpeg, en une commande `tsx src/index.ts film from-prompt "…" --short`, obtient aujourd’hui un Reels 9:16 narré, sous-titré karaoké, nappe duckée, audio calé sur la vidéo, et un REVIEW si le mix retombe court.
