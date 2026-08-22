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
| `lisa-presentatrice.py inventaire\|plan\|produire` | Pipeline long format « journaliste face caméra » : répartit présentation et plans de coupe, réutilise les voix ElevenLabs en cache, génère les blocs parlés dans HeyGen sous plafond dur, puis assemble sous-titres, musique et habillage LISA IA. |
| `wrap-short.py <brut> <out> --hook … --cut …` | Habillage Short standard Ninon : sous-titres karaoké mot à mot (mot actif agrandi/coloré, `--subs cards` pour les cartes statiques), layout `split` B-roll haut / Lisa bas, cutaways déclenchés par mot. Un `--cut` image (capture `collect-evidence`) est bouclé et son attribution (`.meta.json` voisin) est incrustée automatiquement. |
| `flow-veo-mission.py <catégorie> [--limit N]` | Pilote idempotent des campagnes Flow/Veo Quality (Brave CDP) : plafond + réserve dure lus sur le compteur live, journal de reprise, téléchargement immédiat, sidecars Cowork et planche-contact. Refuse de tourner si un batch HeyGen/Flow est déjà actif. |
| `en-narrations-all.py [livres…]` | Narrations anglaises (voix natives ElevenLabs) pour les trailers EN. |
| `cdp-lib.py` | Mini client Chrome DevTools Protocol (WebSocket brut) : `get_tab(match)`, `CDP.ev/cmd`. |

## Lisa présentatrice — long format avec lipsync

Le pipeline lit un `*.script.md` et préfère automatiquement le
`work/plan.json` voisin lorsqu’il existe. La règle éditoriale intégrée est :
accroche, annonce du plan, transitions numérotées et conclusion face caméra ;
faits détaillés en plans de coupe pendant que la même voix continue.

Il ne synthétise jamais une voix implicitement. Chaque section doit déjà avoir
son fichier `work/voice/<id>.mp3` ou `.wav`. Avant de les utiliser, le script lit
`~/.codebuddy/elevenlabs-voice-usage.json` et reporte le compteur dans le plan
et le manifeste. Les images sous
`~/Videos/personas/lisa-scenes/reportage-japon/` sont uniquement lues.

```bash
# Inventaire non facturé : groupes, looks, voix privées et quota du plan
python3 scripts/influencer/lisa-presentatrice.py inventaire \
  --sortie /tmp/heygen-inventory.json

# Plan de tournage sans appel HeyGen
python3 scripts/influencer/lisa-presentatrice.py plan \
  /chemin/video.script.md --sortie /tmp/lisa-plan

# Production ; plafond dur de 100 crédits par défaut
python3 scripts/influencer/lisa-presentatrice.py produire \
  /chemin/video.script.md --sortie /chemin/master
```

Le backend `ui`, utilisé par défaut, exige Brave connecté à HeyGen avec CDP sur
le port 9222. Avant de dépenser, il vérifie le fragment stable de la vignette du
look sélectionné et le format paysage. `--avatar-id` sert au backend API ;
`--ui-avatar-preview-token` verrouille le look du backend UI.

Chaque requête et chaque génération sont inscrites dans
`heygen-credits.json`. Une réserve configurable (`--reserve-par-appel`, 20 par
défaut) est contrôlée avant soumission, puis remplacée par la consommation
réelle mesurée sur le quota. Le script refuse l’appel qui dépasserait
`--plafond-credits` (100 par défaut). Les segments HeyGen existants sont
réutilisés. `--force-local` reconstruit seulement le montage, sans nouvel appel
HeyGen.

Les livrables comprennent :

- `shot-plan.json` et `production-manifest.json` ;
- `heygen-credits.json` ;
- `sous-titres.fr.srt` et `.ass` ;
- les segments bruts dans `avatar/` ;
- le master 1920×1080 dans `lisa-presentatrice-demo.mp4`.

Le contrôle recommandé avant publication est : transcription Whisper, ArcFace
sur le segment brut face à la source et à la référence canonique, planche
contact autour des raccords, détection d’images noires, puis écoute du master.

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
- `montage /tmp/*.jpg` trie **par nom**, pas par temps : `14, 26, 38, 4, 50…`.
  Une planche-contact lue dans l'ordre supposé fait attribuer chaque mesure au
  mauvais plan. Toujours `-label '%f'`.

## Mesure du détourage — et son cas de contrôle

`mesurer-detourage.py` compte la largeur de la bande de transition au sommet de
la chevelure : ≥ 4 px naturel, 2-4 px suspect, < 2 px découpe franche. Il exige
**un python muni de YOLO** (`~/vision_tests/venv/bin/python`) ; sans détecteur il
mesure quand même mais **le dit**, car il ne peut plus garantir qu'un sujet est
présent — sur un plan sans personne il mesurerait le décor.

**Avant de croire une porte, prouver qu'elle sait trouver.** Le couple ci-dessous
est le cas de contrôle : deux versions du même film, l'une que Patrice a rejetée
à l'œil, l'autre réparée.

```bash
# plans AVEC sujet : v01 (défectueux) → 2 et 3 px ; v02 (réparé) → 6, 6 et 8 px
~/vision_tests/venv/bin/python scripts/influencer/mesurer-detourage.py plan.png
```

Les plans sans personne des deux versions sortent « non applicable » : un B-roll
sain ne doit jamais faire échouer la porte.

## Seconde colonne : le liseré — et ce qu'elle ne prouve pas

Le 1er août 2026, Patrice a vu un **liseré pâle autour des cheveux longs** sur
des composites notés 4 à 8 px, donc « naturel ». Le piège est structurel : **un
liseré ÉLARGIT la bande de transition**, il pousse la première colonne dans le
bon sens. La porte n'était pas aveugle, elle était trompée.

La colonne `liseré` compte, le long du contour capillaire (masque
`yolov8n-seg`, du sommet du crâne à la ligne d'épaules), la part des traversées
où le bord est plus clair **à la fois que le fond et que le cheveu**. Elle exige
`~/vision_tests/yolov8n-seg.pt` ; sans lui, elle le dit au lieu de se taire.

**Trois limites, toutes mesurées, à connaître avant de s'en servir :**

1. elle **ne distingue pas un contre-jour d'un résidu de recomposition** — deux
   portraits d'Ambre sans aucun composite, pris à contre-jour, sortent à 54 % et
   84 %, plus haut que la plupart des composites ;
2. le test « des deux côtés ⇒ matting » **ne tranche pas non plus** sur ce
   matériel ;
3. contre un fond surexposé elle ne peut rien voir : elle rend alors
   **« — non mesurable »** plutôt qu'un zéro rassurant. C'est le cas de
   `ambre-024-face-protected-direct.png`, dont 98 % des traversées ont un fond
   au-dessus de 200.

Une note élevée **convoque l'œil**, elle ne rejette pas.

Pour lever le doute, `--mattes DIR` restreint la mesure à la bande
semi-transparente, avec des mattes BiRefNet `Matting-HR` :

```bash
~/vision_tests/venv/bin/python scripts/influencer/mesurer-detourage.py \
  --mattes /chemin/vers/alphas plan.png     # attend <nom>-alpha.png
```

## Réparer le liseré sans régénérer

`reparer-lisere-chevelure.py` ré-estime la **couleur de premier plan**
(Blur-Fusion) et recompose sur le fond réel de la scène. Il ne modifie que les
pixels d'alpha fractionnaire — un contre-jour, qui vit sur du cheveu opaque,
est recopié à l'identique, et le script **échoue** si un pixel d'alpha plein ou
nul a bougé.

```bash
~/vision_tests/venv/bin/python scripts/influencer/reparer-lisere-chevelure.py \
  --mattes DIR_ALPHAS --sortie DIR_SORTIE composite.png
```

Sur les six sources persona de la vidéo `ambre-chalet-automne-v02`, la part de
traversées à pic baisse de 24 à 39 % sans dégrader la largeur de transition.
**La réparation atténue, elle n'efface pas** : à l'œil le gain est discret.
Preuves (planches ×4 et ×8, mesures avant/après, mattes) sous
`~/Videos/personas/composites-cheveux-2026-08-01/preuve-lisere-2026-08-01/`.

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
