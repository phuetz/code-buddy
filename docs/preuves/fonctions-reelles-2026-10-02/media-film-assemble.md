# media-film-assemble — recette du 2 octobre 2026

État : **Testée localement**. Décision : **c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

L’échec ffmpeg du rapport n’est pas reproduit avec les clips synthétiques de cette recette.

Conserver le moteur : coupes et transitions passent. Ne pas généraliser aux médias, codecs et version ffmpeg du rapport non fournis.

[Protocole, validation et limites](README.md).

## Avant

### media-film-cut

```text
$ buddy film assemble lot3-film-cut
[2026-10-02T14:06:48.462Z]  INFO  [film-assemble] 2 clip(s), engine=xfade, 320x240@25, ~4s
[2026-10-02T14:06:49.056Z]  INFO  [film-quality] PASS — 4s, audio=-24.1dB, black=0s
[2026-10-02T14:06:49.057Z]  INFO  [film-producer] 'lot3-film-cut' → <WORKSPACE>/.codebuddy/media-generation/films/lot3-film-cut-1790950008460-ece3a619-a6fa-464d-b402-c67ad9a6ed46.mp4 (2 scene(s))

🎬  lot3-film-cut — 2/2 scene(s) ready
   ✓ scene-1    ready
   ✓ scene-2    ready

   film: <WORKSPACE>/.codebuddy/media-generation/films/lot3-film-cut-1790950008460-ece3a619-a6fa-464d-b402-c67ad9a6ed46.mp4
   quality: PASS — 4s, audio -24.1dB

EXIT=0
```

### media-film-fade

```text
$ buddy film assemble lot3-film-fade
[2026-10-02T14:06:49.357Z]  INFO  [film-assemble] 2 clip(s), engine=xfade, 320x240@25, ~3.5s
[2026-10-02T14:06:50.164Z]  INFO  [film-quality] PASS — 3.52s, audio=-24.3dB, black=0s
[2026-10-02T14:06:50.166Z]  INFO  [film-producer] 'lot3-film-fade' → <WORKSPACE>/.codebuddy/media-generation/films/lot3-film-fade-1790950009352-2fa31a57-0496-4f70-89b1-59e1f836fccf.mp4 (2 scene(s))

🎬  lot3-film-fade — 2/2 scene(s) ready
   ✓ scene-1    ready
   ✓ scene-2    ready

   film: <WORKSPACE>/.codebuddy/media-generation/films/lot3-film-fade-1790950009352-2fa31a57-0496-4f70-89b1-59e1f836fccf.mp4
   quality: PASS — 3.52s, audio -24.3dB

EXIT=0
```

### media-film-wipeleft

```text
$ buddy film assemble lot3-film-wipeleft
[2026-10-02T14:06:50.541Z]  INFO  [film-assemble] 2 clip(s), engine=xfade, 320x240@25, ~3.5s
[2026-10-02T14:06:51.127Z]  INFO  [film-quality] PASS — 3.52s, audio=-24.3dB, black=0s
[2026-10-02T14:06:51.131Z]  INFO  [film-producer] 'lot3-film-wipeleft' → <WORKSPACE>/.codebuddy/media-generation/films/lot3-film-wipeleft-1790950010537-21ed27a3-d692-4593-8cdf-0fa09db919fc.mp4 (2 scene(s))

🎬  lot3-film-wipeleft — 2/2 scene(s) ready
   ✓ scene-1    ready
   ✓ scene-2    ready

   film: <WORKSPACE>/.codebuddy/media-generation/films/lot3-film-wipeleft-1790950010537-21ed27a3-d692-4593-8cdf-0fa09db919fc.mp4
   quality: PASS — 3.52s, audio -24.3dB

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### media-film-cut

```text
$ buddy film assemble lot3-film-cut
[2026-10-02T14:35:16.458Z]  INFO  [film-assemble] 2 clip(s), engine=xfade, 320x240@25, ~4s
[2026-10-02T14:35:17.094Z]  INFO  [film-quality] PASS — 4s, audio=-24.1dB, black=0s
[2026-10-02T14:35:17.096Z]  INFO  [film-producer] 'lot3-film-cut' → <WORKSPACE>/.codebuddy/media-generation/films/lot3-film-cut-1790951716455-0719b9ec-9aaa-426e-b4d6-1a271f43c7cf.mp4 (2 scene(s))

🎬  lot3-film-cut — 2/2 scene(s) ready
   ✓ scene-1    ready
   ✓ scene-2    ready

   film: <WORKSPACE>/.codebuddy/media-generation/films/lot3-film-cut-1790951716455-0719b9ec-9aaa-426e-b4d6-1a271f43c7cf.mp4
   quality: PASS — 4s, audio -24.1dB

EXIT=0
```

### media-film-fade

```text
$ buddy film assemble lot3-film-fade
[2026-10-02T14:35:18.498Z]  INFO  [film-assemble] 2 clip(s), engine=xfade, 320x240@25, ~3.5s
[2026-10-02T14:35:19.411Z]  INFO  [film-quality] PASS — 3.52s, audio=-24.3dB, black=0s
[2026-10-02T14:35:19.436Z]  INFO  [film-producer] 'lot3-film-fade' → <WORKSPACE>/.codebuddy/media-generation/films/lot3-film-fade-1790951718492-c2a78afa-d3c2-45ce-bb73-a600d10d9336.mp4 (2 scene(s))

🎬  lot3-film-fade — 2/2 scene(s) ready
   ✓ scene-1    ready
   ✓ scene-2    ready

   film: <WORKSPACE>/.codebuddy/media-generation/films/lot3-film-fade-1790951718492-c2a78afa-d3c2-45ce-bb73-a600d10d9336.mp4
   quality: PASS — 3.52s, audio -24.3dB

EXIT=0
```

### media-film-wipeleft

```text
$ buddy film assemble lot3-film-wipeleft
[2026-10-02T14:35:21.129Z]  INFO  [film-assemble] 2 clip(s), engine=xfade, 320x240@25, ~3.5s
[2026-10-02T14:35:22.061Z]  INFO  [film-quality] PASS — 3.52s, audio=-24.3dB, black=0s
[2026-10-02T14:35:22.064Z]  INFO  [film-producer] 'lot3-film-wipeleft' → <WORKSPACE>/.codebuddy/media-generation/films/lot3-film-wipeleft-1790951721126-220bb03b-9790-419b-89f0-e5871895a7fd.mp4 (2 scene(s))

🎬  lot3-film-wipeleft — 2/2 scene(s) ready
   ✓ scene-1    ready
   ✓ scene-2    ready

   film: <WORKSPACE>/.codebuddy/media-generation/films/lot3-film-wipeleft-1790951721126-220bb03b-9790-419b-89f0-e5871895a7fd.mp4
   quality: PASS — 3.52s, audio -24.3dB

EXIT=0
```

## Fichiers produits

FFprobe confirme une piste audio et une durée supérieure à 3 s pour chacun des six fichiers. Les deux coupes durent 4 s ; les quatre transitions durent 3,52 s. La première recette a également mesuré la couleur moyenne à 1,74 s : cut `(255,0,0)`, fade `(137,0,118)`, wipeleft `(142,0,113)`. La transition modifie donc réellement les images.

- `lot3-film-cut-1790951716455-0719b9ec-9aaa-426e-b4d6-1a271f43c7cf.mp4` : 4.000000 s ; vidéo et audio.
- `lot3-film-fade-1790951718492-c2a78afa-d3c2-45ce-bb73-a600d10d9336.mp4` : 3.520000 s ; vidéo et audio.
- `lot3-film-wipeleft-1790951721126-220bb03b-9790-419b-89f0-e5871895a7fd.mp4` : 3.520000 s ; vidéo et audio.

Ces résultats portent sur ffmpeg 6.1.1 et les fixtures décrites dans le protocole. Ils ne reproduisent pas les clips ni la version de ffmpeg du rapport initial, non fournis.
