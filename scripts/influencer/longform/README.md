# Pipeline vidéo longue Lisa

Pipeline autonome et résumable pour les vidéos YouTube 16:9 de 10 à 15 minutes.
Le format suit le gabarit éditorial validé : sept phases, environ 130 mots/min,
25–30 % d'avatar au maximum, voix off sur visuels et changements de plan toutes
les 8 à 10 secondes.

## Flux complet

```bash
WORK=~/.codebuddy/longform/mon-sujet

python3 scripts/influencer/longform/longform-script.py \
  --sujet "Le sujet à décrypter" --duree 12 --out "$WORK"

# Étape obligatoire : relire et valider plan.json + script.md.

python3 scripts/influencer/longform/longform-voice.py --workdir "$WORK"

# Pour chaque section mode=avatar (3 à 4 clips seulement) :
python3 scripts/influencer/heygen-batch.py \
  submit "$WORK/voice/01-hook-avatar.mp3" 01-hook-avatar
# Collecter, contrôler par transcription, puis ranger le bon clip sous :
# "$WORK/avatar/01-hook-avatar.mp4"

# Ajouter les captures, images et B-rolls des sections voiceover.

python3 scripts/influencer/longform/longform-assemble.py \
  --workdir "$WORK" --out "$WORK/final.mp4"
```

`longform-script.py` appelle uniquement le LLM avec
`agy --model gemini-3.6-flash-high -p`. ElevenLabs n'intervient qu'à l'étape
voix. Le plan est refusé s'il ne respecte pas l'ordre des sept phases, les
segments avatar de 15 à 45 secondes, les 70 % minimum de voix off, le débit
global ou la promesse explicite des démos dans le hook.

Le passage HeyGen est volontairement séparé. `heygen-batch.py` peut être utilisé
tel quel, une soumission par MP3 avatar. Après collecte, il faut toujours
identifier les clips par transcription avant de les renommer : l'ordre de fin
HeyGen n'est pas l'ordre de soumission.

## Convention du workdir

```text
workdir/
├── plan.json
├── script.md
├── chapters.txt
├── voice/
│   └── <id>.mp3
├── avatar/
│   └── <id>.mp4
├── visuals/
│   └── <id>/
│       ├── 01-image.png
│       ├── 02-capture.jpg
│       └── 03-broll.mp4
└── render/
    ├── slots/<id>/*.mp4
    ├── sections/<id>.mp4
    ├── video.mp4
    ├── narration.wav
    ├── mix.wav
    └── mastered.wav
```

- `<id>` doit correspondre exactement à `sections[].id` dans `plan.json`.
- `voice/<id>.mp3` est créé par `longform-voice.py`.
- `avatar/<id>.mp4` contient un rendu HeyGen déjà contrôlé. S'il manque,
  l'assembleur produit une carte « AVATAR À FOURNIR » nette et conserve la voix
  de la section ; un montage complet reste donc testable sans HeyGen.
- `visuals/<id>/` accepte JPG, PNG, WebP et formats courants d'image/vidéo.
  Les noms sont triés : les préfixes `01-`, `02-`, etc. fixent l'ordre.
- Les images reçoivent un Ken Burns lent. Les vidéos sont bouclées si nécessaire,
  recadrées en cover 16:9 et rendues muettes.
- Sans visuel, une carte de chapitre élégante est utilisée.

Tous les scripts sautent les assets déjà présents. Les intermédiaires dans
`render/` permettent de reprendre après une interruption sans nouvelle synthèse
ni nouveau rendu. Pour forcer une reconstruction après une modification
validée, supprimer seulement l'asset ou l'intermédiaire explicitement concerné.

## Audio et sortie

Par défaut, l'assembleur choisit de façon déterministe le premier morceau de
`~/.codebuddy/media-audio/music/elegant/`. Utiliser `--mood warm` pour un autre
dossier ou `--music /chemin/morceau.mp3` pour imposer une piste. La musique est
bouclée et duckée sous la narration avec `sidechaincompress`, puis le mix reçoit
un loudnorm EBU R128 en deux passes vers −14 LUFS.

La sortie est un MP4 H.264 + AAC, 1920×1080, 30 fps, avec `faststart`.
`chapters.txt` contient les chapitres YouTube au format `00:00 Titre`.
