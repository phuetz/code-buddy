# Pipeline influenceuse IA & trailers — scripts de production

Scripts Python prouvés en production (2026-07-23 : 36 trailers romans FR+EN, 7 trailers
tech, 2 compilations YouTube, 49 plans B-roll Veo Quality, 12 Shorts influenceuse).

## Prérequis

- **ffmpeg / ffprobe** (+ ImageMagick `montage` pour les planches-contact)
- `~/.codebuddy/media.env` avec `ELEVENLABS_API_KEY=` (clé complète)
- Bibliothèque musicale `~/.codebuddy/media-audio/music/<mood>/*.mp3` (Epidemic Sound)
- Pour les scripts Flow (broll/lisa-clip/hero) : **Brave/Chrome** lancé avec
  `--remote-debugging-port=9222`, connecté au compte Google (Ultra) avec un onglet
  `labs.google/fx/.../flow` ouvert sur le projet
- `INFLUENCER_WORKDIR` (optionnel) : dossier de travail, défaut `~/.codebuddy/influencer-work`

## Scripts

| Script | Rôle |
|---|---|
| `make-influencer-batch.py [sujets…]` | Sujet → Short 9:16 « Lisa présente » : voix off persona (ElevenLabs FR), captions TikTok, musique duckée, master −14 LUFS. Ajouter un sujet = 3 lignes dans `SUBJECTS`. |
| `short-assemble.py <book> <musique> [TITRE]` | Assembleur vertical générique : `short-<book>-shots/v0N.mp4` + `short-<book>-vo/*.mp3` → Short 1080×1920. |
| `presenter-assemble.py` | Variante « présentatrice » (captions hautes, box). |
| `compile-collection.py` / `-en.py` | Compilations YouTube 8 min+ : chaîne les trailers `~/Videos/<x>-trailer/` avec cartons d'intro/livre (monétisation mid-roll). Préfère les fichiers `v2`. |
| `broll-batch.py` | Banque B-roll premium via Flow/Veo (CDP) → `~/.codebuddy/media-video/broll/`. Idempotent (relancer = retenter les manquants). |
| `lisa-clip-batch.py` | Clips persona Lisa via personnage Flow attaché (identité verrouillée). |
| `hero-batch.py` | Régénère des plans hero de trailers en Veo Quality (écrase `shot-<id>.mp4`, backup `.omni.mp4`). |
| `en-narrations-all.py [livres…]` | Narrations anglaises (voix natives ElevenLabs) pour les trailers EN. |
| `cdp-lib.py` | Mini client Chrome DevTools Protocol (WebSocket brut) : `get_tab(match)`, `CDP.ev/cmd`. |

## Avatar canonique Lisa

`~/.codebuddy/personas/lisa/` : `lisa-hotel-soiree.mp4` (référence choisie par Patrice)
+ `identity-kit/*.jpg` (5 frames pour verrouiller l'identité — création de personnage
Flow multi-frames ; une seule image ⇒ dérive d'identité prouvée).

## Pièges connus

- ~35-45 % d'échecs Veo transitoires par batch → relancer (idempotent), remapper les
  plans manquants dans les timelines avant assemblage.
- Veo rend en asynchrone : un batch peut capter le clip d'un prompt précédent
  (décalage ID↔contenu) → cataloguer par planche-contact, vérifier avant d'écraser.
- ElevenLabs : lire la clé ligne à ligne (`media.env` est multi-lignes).
- Cartons drawtext : échapper `\n` littéralement (pas de heredoc).
