# Pipeline influenceuse IA & trailers — scripts de production

Scripts Python prouvés en production (2026-07-23 : 36 trailers romans FR+EN, 7 trailers
tech, 2 compilations YouTube, 49 plans B-roll Veo Quality, 12 Shorts influenceuse).

## Règle éditoriale Lisa/Ambre

Les chaînes Lisa et Ambre ne doivent **jamais** traiter un sujet où Patrice est
personnellement partie prenante. Sont notamment exclus France Travail, Pôle
emploi, l'assurance chômage, le contrôle ou la radiation des demandeurs
d'emploi, l'ARE, la CCAS et l'action sociale, ainsi que les clients et
partenaires commerciaux de Patrice.

`find-subjects.py` applique ce filtre à **tous** les titres collectés (Google
News comme flux français) **avant** leur ranking par le LLM et écrit sur stderr
chaque exclusion, sa source, son mot-clé déclencheur et sa raison. La liste
canonique est `EXCLUDED_TOPICS` dans `editorial_policy.py`.
Pour ajouter sans modifier le dépôt des noms de clients ou partenaires :

```bash
export INFLUENCER_EXCLUDED_TOPICS='Entreprise Exemple;Marque Partenaire'
python3 scripts/influencer/find-subjects.py
```

La configuration est additive ; les valeurs sont séparées par une virgule, un
point-virgule ou un retour à la ligne. Ce filtre ne remplace pas la validation
éditoriale humaine quand le conflit d'intérêts n'est pas déductible du titre.

## Découverte de sujets et flux RSS

La collecte combine Google News avec neuf flux tech français, dans cet ordre :
Korben, Numerama, Frandroid, Next, Journal du Geek, Clubic, 01net, Usbek &
Rica et ZDNet.fr. Les doublons de titre ou d'URL sont fusionnés et toutes leurs
provenances restent affichées dans la sortie.

```bash
# 8 sujets publiés dans les 7 derniers jours, toutes sources
python3 scripts/influencer/find-subjects.py

# Uniquement Korben, sur les dernières 48 heures
python3 scripts/influencer/find-subjects.py 8 --source korben --days 2

# Alias disponibles, par exemple Next/NextINpact
python3 scripts/influencer/find-subjects.py --source nextinpact --days 3
```

`INFLUENCER_RSS_FEEDS` peut remplacer la liste française par un tableau JSON
ordonné d'objets `slug`, `label`, `url` :

```bash
export INFLUENCER_RSS_FEEDS='[
  {"slug":"korben","label":"Korben","url":"https://korben.info/feed"},
  {"slug":"local","label":"Veille locale","url":"https://example.test/feed"}
]'
```

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
| `find-subjects.py [nombre] [--source nom] [--days N]` | Collecte Google News et les flux tech français, dédoublonne, exclut les domaines sensibles avant ranking, puis propose des sujets avec leur provenance. |
| [`collect-evidence.py`](README-collect-evidence.md) | Capture des preuves réelles sourcées, masque les cookies, produit le plein cadre + le recadrage split 1080×960 et applique les règles juridiques. |
| `make-influencer-batch.py [sujets…]` | Sujet → Short 9:16 « Lisa présente » : voix off persona (ElevenLabs FR), captions TikTok, musique duckée, master −14 LUFS. Ajouter un sujet = 3 lignes dans `SUBJECTS`. |
| `short-assemble.py <book> <musique> [TITRE]` | Assembleur vertical générique : `short-<book>-shots/v0N.mp4` + `short-<book>-vo/*.mp3` → Short 1080×1920. |
| `presenter-assemble.py` | Variante « présentatrice » (captions hautes, box). |
| `compile-collection.py` / `-en.py` | Compilations YouTube 8 min+ : chaîne les trailers `~/Videos/<x>-trailer/` avec cartons d'intro/livre (monétisation mid-roll). Préfère les fichiers `v2`. |
| `broll-batch.py` | Banque B-roll premium via Flow/Veo (CDP) → `~/.codebuddy/media-video/broll/`. Idempotent (relancer = retenter les manquants). |
| `lisa-clip-batch.py` | Clips persona Lisa via personnage Flow attaché (identité verrouillée). |
| `hero-batch.py` | Régénère des plans hero de trailers en Veo Quality (écrase `shot-<id>.mp4`, backup `.omni.mp4`). |
| `flow-daily.py` | Brûle au plus 50 crédits/jour via le mode Agent Flow (15 crédits/plan), traite `~/.codebuddy/media-video/flow-queue.md`, reprend les échecs et produit une planche-contact. |
| `heygen-batch.py submit\|collect\|status` | Soumet et collecte les vidéos lipsync HeyGen via Brave CDP sur le port 9222. Prérequis : Brave lancé avec `--remote-debugging-port=9222` et session HeyGen déjà connectée. ⚠️ L’ordre de fin diffère de l’ordre de soumission : après collecte, QC obligatoire par transcription Whisper avant tout renommage. |
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
- `flow-daily.py` nomme donc les résultats `capture-NNN.mp4` et marque le mapping
  prompt↔capture comme `unverified` dans `catalogue.json`. La planche-contact est
  l'autorité de catalogage. Le service quotidien épingle le projet Flow qui
  contient `Lisa Officielle`, au lieu de dépendre du dernier projet ouvert.
- ElevenLabs : lire la clé ligne à ligne (`media.env` est multi-lignes).
- Cartons drawtext : échapper `\n` littéralement (pas de heredoc).

## Automatisation quotidienne Flow

La file persistante est `~/.codebuddy/media-video/flow-queue.md` (format dans
`flow-queue.example.md`). Une file vide déclenche la rotation B-roll intégrée.
Le timer utilisateur tourne vers 20 h, avec un décalage aléatoire de 0 à 10 min :

```bash
install -Dm644 scripts/influencer/systemd/codebuddy-flow-daily.service \
  ~/.config/systemd/user/codebuddy-flow-daily.service
install -Dm644 scripts/influencer/systemd/codebuddy-flow-daily.timer \
  ~/.config/systemd/user/codebuddy-flow-daily.timer
systemctl --user daemon-reload
systemctl --user enable --now codebuddy-flow-daily.timer
```

Vérification sans consommer de crédits :

```bash
python3 scripts/influencer/flow-daily.py --status
systemctl --user list-timers codebuddy-flow-daily.timer
journalctl --user -u codebuddy-flow-daily.service -n 30 --no-pager
```
