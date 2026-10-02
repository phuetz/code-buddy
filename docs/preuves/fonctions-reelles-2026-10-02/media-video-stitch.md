# media-video-stitch — recette du 2 octobre 2026

État : **Testée localement**. Décision : **c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

Le même moteur fonctionne ici pour les transitions testées ; les clips originaux ne sont pas fournis.

Appel direct de l’outil exporté du paquet et inspection ffprobe ; aucun correctif sans reproduction.

[Protocole, validation et limites](README.md).

## Avant

### tools-stitch-fade

```text
[2026-10-02T14:06:47.683Z]  INFO  [film-assemble] 2 clip(s), engine=xfade, 320x240@25, ~3.5s
{"success":true,"output":"{\n  \"kind\": \"film_assemble_result\",\n  \"success\": true,\n  \"outputPath\": \"<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-fade-1790950007680-33244e06-ee32-4ec0-b466-09fb196c6465.mp4\",\n  \"mediaPath\": \"MEDIA:<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-fade-1790950007680-33244e06-ee32-4ec0-b466-09fb196c6465.mp4\",\n  \"engine\": \"xfade\",\n  \"clipCount\": 2,\n  \"transitionCount\": 1,\n  \"targetWidth\": 320,\n  \"targetHeight\": 240,\n  \"fps\": 25,\n  \"estimatedDuration\": 3.5,\n  \"probedDuration\": 3.52,\n  \"hasAudio\": true,\n  \"transitions\": [\n    {\n      \"type\": \"fade\",\n      \"duration\": 0.5\n    }\n  ],\n  \"warnings\": []\n}","data":{"kind":"film_assemble_result","success":true,"outputPath":"<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-fade-1790950007680-33244e06-ee32-4ec0-b466-09fb196c6465.mp4","mediaPath":"MEDIA:<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-fade-1790950007680-33244e06-ee32-4ec0-b466-09fb196c6465.mp4","engine":"xfade","clipCount":2,"transitionCount":1,"targetWidth":320,"targetHeight":240,"fps":25,"estimatedDuration":3.5,"probedDuration":3.52,"hasAudio":true,"transitions":[{"type":"fade","duration":0.5}],"warnings":[]}}

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### tools-stitch-fade

```text
$ node tools.mjs stitch fade
[2026-10-02T14:35:17.612Z]  INFO  [film-assemble] 2 clip(s), engine=xfade, 320x240@25, ~3.5s
{"success":true,"output":"{\n  \"kind\": \"film_assemble_result\",\n  \"success\": true,\n  \"outputPath\": \"<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-fade-1790951717607-47a865cb-7f01-4b8e-87c7-9075b00c22e5.mp4\",\n  \"mediaPath\": \"MEDIA:<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-fade-1790951717607-47a865cb-7f01-4b8e-87c7-9075b00c22e5.mp4\",\n  \"engine\": \"xfade\",\n  \"clipCount\": 2,\n  \"transitionCount\": 1,\n  \"targetWidth\": 320,\n  \"targetHeight\": 240,\n  \"fps\": 25,\n  \"estimatedDuration\": 3.5,\n  \"probedDuration\": 3.52,\n  \"hasAudio\": true,\n  \"transitions\": [\n    {\n      \"type\": \"fade\",\n      \"duration\": 0.5\n    }\n  ],\n  \"warnings\": []\n}","data":{"kind":"film_assemble_result","success":true,"outputPath":"<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-fade-1790951717607-47a865cb-7f01-4b8e-87c7-9075b00c22e5.mp4","mediaPath":"MEDIA:<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-fade-1790951717607-47a865cb-7f01-4b8e-87c7-9075b00c22e5.mp4","engine":"xfade","clipCount":2,"transitionCount":1,"targetWidth":320,"targetHeight":240,"fps":25,"estimatedDuration":3.5,"probedDuration":3.52,"hasAudio":true,"transitions":[{"type":"fade","duration":0.5}],"warnings":[]}}

EXIT=0
```

### tools-stitch-cut

```text
$ node tools.mjs stitch cut
[2026-10-02T14:35:15.589Z]  INFO  [film-assemble] 2 clip(s), engine=xfade, 320x240@25, ~4s
{"success":true,"output":"{\n  \"kind\": \"film_assemble_result\",\n  \"success\": true,\n  \"outputPath\": \"<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-cut-1790951715586-4ad81a77-9d87-4e13-bedf-bcdc74e8ddb4.mp4\",\n  \"mediaPath\": \"MEDIA:<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-cut-1790951715586-4ad81a77-9d87-4e13-bedf-bcdc74e8ddb4.mp4\",\n  \"engine\": \"xfade\",\n  \"clipCount\": 2,\n  \"transitionCount\": 1,\n  \"targetWidth\": 320,\n  \"targetHeight\": 240,\n  \"fps\": 25,\n  \"estimatedDuration\": 4,\n  \"probedDuration\": 4,\n  \"hasAudio\": true,\n  \"transitions\": [\n    {\n      \"type\": \"cut\",\n      \"duration\": 0\n    }\n  ],\n  \"warnings\": []\n}","data":{"kind":"film_assemble_result","success":true,"outputPath":"<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-cut-1790951715586-4ad81a77-9d87-4e13-bedf-bcdc74e8ddb4.mp4","mediaPath":"MEDIA:<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-cut-1790951715586-4ad81a77-9d87-4e13-bedf-bcdc74e8ddb4.mp4","engine":"xfade","clipCount":2,"transitionCount":1,"targetWidth":320,"targetHeight":240,"fps":25,"estimatedDuration":4,"probedDuration":4,"hasAudio":true,"transitions":[{"type":"cut","duration":0}],"warnings":[]}}

EXIT=0
```

### tools-stitch-wipeleft

```text
$ node tools.mjs stitch wipeleft
[2026-10-02T14:35:19.920Z]  INFO  [film-assemble] 2 clip(s), engine=xfade, 320x240@25, ~3.5s
{"success":true,"output":"{\n  \"kind\": \"film_assemble_result\",\n  \"success\": true,\n  \"outputPath\": \"<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-wipeleft-1790951719915-ccffa4bb-6890-4e55-b190-28caceb1468e.mp4\",\n  \"mediaPath\": \"MEDIA:<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-wipeleft-1790951719915-ccffa4bb-6890-4e55-b190-28caceb1468e.mp4\",\n  \"engine\": \"xfade\",\n  \"clipCount\": 2,\n  \"transitionCount\": 1,\n  \"targetWidth\": 320,\n  \"targetHeight\": 240,\n  \"fps\": 25,\n  \"estimatedDuration\": 3.5,\n  \"probedDuration\": 3.52,\n  \"hasAudio\": true,\n  \"transitions\": [\n    {\n      \"type\": \"wipeleft\",\n      \"duration\": 0.5\n    }\n  ],\n  \"warnings\": []\n}","data":{"kind":"film_assemble_result","success":true,"outputPath":"<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-wipeleft-1790951719915-ccffa4bb-6890-4e55-b190-28caceb1468e.mp4","mediaPath":"MEDIA:<WORKSPACE>/.codebuddy/media-generation/films/qa-stitch-wipeleft-1790951719915-ccffa4bb-6890-4e55-b190-28caceb1468e.mp4","engine":"xfade","clipCount":2,"transitionCount":1,"targetWidth":320,"targetHeight":240,"fps":25,"estimatedDuration":3.5,"probedDuration":3.52,"hasAudio":true,"transitions":[{"type":"wipeleft","duration":0.5}],"warnings":[]}}

EXIT=0
```

## Fichiers produits

FFprobe confirme une piste audio et une durée supérieure à 3 s pour chacun des six fichiers. Les deux coupes durent 4 s ; les quatre transitions durent 3,52 s. La première recette a également mesuré la couleur moyenne à 1,74 s : cut `(255,0,0)`, fade `(137,0,118)`, wipeleft `(142,0,113)`. La transition modifie donc réellement les images.

- `qa-stitch-cut-1790951715586-4ad81a77-9d87-4e13-bedf-bcdc74e8ddb4.mp4` : 4.000000 s ; vidéo et audio.
- `qa-stitch-fade-1790951717607-47a865cb-7f01-4b8e-87c7-9075b00c22e5.mp4` : 3.520000 s ; vidéo et audio.
- `qa-stitch-wipeleft-1790951719915-ccffa4bb-6890-4e55-b190-28caceb1468e.mp4` : 3.520000 s ; vidéo et audio.

Ces résultats portent sur ffmpeg 6.1.1 et les fixtures décrites dans le protocole. Ils ne reproduisent pas les clips ni la version de ffmpeg du rapport initial, non fournis.
