# RAPPORT IMG1 — Grok Imagine / SuperGrok Heavy

Date : 2026-09-03 (Europe/Paris)

## Périmètre et garde-fous

- Clone : `/home/patrice/DEV/cb-verif-repar-c-2026-09-02`
- Branche : `feat/img1-broll-grok-imagine-2026-09-03`
- HEAD initial : `ac8dbe474`
- Service payant autorisé : API xAI déjà câblée dans `scripts/influencer/grok_imagine.py`, exclusivement.
- Secrets et identifiants de compte : interdits dans ce rapport et dans les journaux.
- Arrêt immédiat et propre au premier `403 personal-team-blocked:spending-limit`.
- Aucun push, aucune publication et aucun service local touché.
- Idempotence : ne jamais régénérer un fichier existant de plus de 50 Ko.
- Direction caméra : mouvements minimaux ; priorité i2v ; pas de survol de ville.

## Journal chronologique

| Horodatage | Étape/job | Résultat | Durée | Coût/quota exposé par l’API |
|---|---|---|---:|---|
| 2026-09-03 | Initialisation | Rapport créé avant inspection des scripts et avant tout appel API. | — | Aucun appel API |
| 2026-09-03 | `GET /v1/models` | HTTP 200 ; 5 modèles média filtrés. Aucun en-tête quota/rate-limit/remaining exposé. | 0,5 s | Aucun coût/quota exposé |
| 2026-09-03 | `GET /v1/models/{id}` × 5 | HTTP 200 ; alias, contexte et prix image exposés ci-dessous. Aucun en-tête quota/rate-limit/remaining exposé. | 1,6 s | Valeurs brutes `image_price`/`pricing`, sans conversion inventée |
| 2026-09-03 | `GET /openapi.json`, `/v1/openapi.json` | HTTP 404 pour les deux routes. | 0,5 s | Aucun coût/quota exposé |
| 2026-09-03 | Validation vide images/vidéos | HTTP 400 propre : prompt requis. | 0,7 s | Aucun coût/quota exposé |
| 2026-09-03 | `OPTIONS` images/vidéos | HTTP 200, `Allow: POST`, aucun schéma dans le corps. | 0,5 s | Aucun coût/quota exposé |
| 2026-09-03 | Inventaire disque | Les destinations demandées n’existaient pas. 2 images Lisa réutilisables et 16 photos Ambre (segments 04–19) trouvées ; aucun média source modifié. | <1 s | Aucun appel API |
| 2026-09-03 | Garde-fous pilote/manifeste | Premier test rouge sur l’interdiction explicite de visage, puis correction et `4 passed`. 32 jobs i2v de 6 s construits, 18 références adaptées sans étirement. | 6,7 s | Aucun appel API |
| 2026-09-03 | Lot Lisa | 16/16 terminés, 0 échec, 0 retry d’authentification, 0 arrêt quota. | 823,172 s cumulés | Soumission de chaque job : rate-limit `60/60`; solde forfait et coût non exposés |
| 2026-09-03 | Lot Ambre | 16/16 terminés, 0 échec, 0 retry d’authentification, 0 arrêt quota. | 634,847 s cumulés | Soumission de chaque job : rate-limit `60/60`; solde forfait et coût non exposés |
| 2026-09-03 | Captures | 32/32 captures médianes créées sous `_qa/img1/`, toutes >50 Ko ; deux planches contact inspectées. | 14,4 s | Aucun appel API |
| 2026-09-03 | Contrôle optique supplémentaire | Tentative OpenCV premier/dernier plan interrompue par une faute mémoire du runtime GPU avant toute mesure. Aucun service n’a été touché ; ce contrôle bonus est déclaré non vérifié. | 1,6 s | Aucun appel API |
| 2026-09-03 | ffprobe + décodage intégral | 32/32 : durée, résolution, capture et décodage conformes ; 0 échec ; 32 pistes AAC présentes. | 19,4 s | Aucun appel API |
| 2026-09-03 | Rejeu idempotent | 32/32 fichiers >50 Ko sautés ; compteurs d’événements API inchangés (`162/127` avant et après). | 3,7 s | Zéro nouvel appel API |
| 2026-09-03 | Régression scripts influencer | `python3 -m pytest -q tests/scripts/influencer/` : `178 passed, 1 skipped`. | 12,27 s | Aucun appel API |
| 2026-09-03 | Hygiène du diff | `git diff --check` sans sortie ; scan ciblé : aucun secret, identifiant de compte ou identifiant concret de requête/vidéo. | <1 s | Aucun appel API |

## Contrainte de destination à résoudre

Le brief demande les sorties sous `~/.codebuddy/personas/...`, tandis que le garde-fou non négociable interdit toute écriture hors du dépôt. Jusqu’à clarification, les lectures de ces dossiers sont autorisées, mais toute nouvelle sortie sera conservée dans une zone de staging interne au clone et aucune écriture externe ne sera effectuée.

## Inventaire API

### Modèles réellement renvoyés le 03/09/2026

| Modèle | Champs supplémentaires renvoyés par `GET /v1/models/{id}` |
|---|---|
| `grok-imagine-image` | alias `grok-imagine-image-2026-03-02`, `context_length=8000`, `image_price=200000000` |
| `grok-imagine-image-2.0` | `context_length=8000`, `image_price=600000000`; matrice `pricing`: 1k/low `400000000`, 2k/low `600000000`, 1k/medium `600000000`, 2k/medium `800000000` |
| `grok-imagine-image-quality` | alias daté et alias `latest`/`pro`, `context_length=8000`, `image_price=500000000` |
| `grok-imagine-video` | aucun champ de capacité ou de prix supplémentaire |
| `grok-imagine-video-1.5` | alias `preview` et alias daté `2026-05-30`; aucun champ de capacité ou de prix supplémentaire |

Les nombres de prix sont recopiés tels que l’API les renvoie : l’unité n’est pas décrite dans la réponse, donc aucune conversion monétaire n’est affirmée ici.

### Paramètres documentés par la surface API xAI

- Vidéo : `duration` 1–15 s ; `aspect_ratio` parmi `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`; `resolution` `480p`, `720p`, `1080p`.
- `1080p` est annoncé pour `grok-imagine-video-1.5` en t2v et i2v. Le mode `reference_images` multi-références est plafonné à `720p`, distinct du champ `image` i2v.
- i2v : une image peut être fournie par URL HTTPS, URI `data:` base64 ou `file_id`; le ratio de l’image est conservé par défaut, sauf surcharge `aspect_ratio` qui l’étire.
- Audio : `reference_audios` avec voix prédéfinies `voice_id` sur `grok-imagine-video-1.5`; jusqu’à 3 voix documentées en reference-to-video. Une référence audio personnelle n’est pas un droit général : réservée aux partenaires approuvés.
- Image 2.0 : `resolution` `1k`/`2k`, `quality` `low`/`medium`, format de réponse URL ou base64.

Ces paramètres proviennent de la documentation de la même API xAI ; ils seront distingués des capacités effectivement exercées par les jobs ci-dessous. Les réponses de catalogue seules ne publient pas cette matrice.

Références officielles consultées : [génération vidéo](https://docs.x.ai/developers/model-capabilities/video/generation), [références vidéo](https://docs.x.ai/developers/model-capabilities/video/reference-to-video), [fichiers Imagine](https://docs.x.ai/developers/model-capabilities/imagine/files/inputs), [génération image](https://docs.x.ai/developers/model-capabilities/images/generation).

### Limites/quota observés

- Aucune des sondes réussies ou erreurs 400 n’a renvoyé d’en-tête contenant `rate`, `limit`, `quota`, `remaining` ou `retry-after`.
- Les réponses de soumission des 32 générations ont ensuite renvoyé `x-ratelimit-limit-requests: 60` et `x-ratelimit-remaining-requests: 60`. Ce compteur est explicitement un rate-limit de requêtes ; il ne prouve pas le solde du forfait.
- Aucun coût de job ni solde SuperGrok n’a été exposé. La seule borne opérationnelle donnée par le brief reste le premier `403 personal-team-blocked:spending-limit`; il n’est pas survenu pendant les 32 jobs.

## Comparaison avec le script existant

- Le script impose `grok-imagine-video-1.5`, `duration=6`, `resolution=1080p` et `aspect_ratio=16:9` par défaut ; il accepte déjà une image distante unique via `image.url`.
- Il n’expose pas la durée API jusqu’à 15 s, les six autres ratios, les résolutions 480p/720p, les images locales base64/Files API, `reference_images`, les voix prédéfinies, ni les réglages image 2.0 `resolution`/`quality`.
- Il ne capture ni en-têtes ni quota/coût par requête, actualise le jeton sur tout 403 et continue le lot après erreur : cela ne respecte pas encore l’arrêt demandé sur `personal-team-blocked:spending-limit`.
- Il écrit automatiquement sous `~/.codebuddy` à l’import et synchronise vers `/data`, incompatibles avec le garde-fou de cette mission.
- `build_jobs.py`, explicitement demandé en lecture, est absent du clone, de son historique visible et de `~/.codebuddy` au contrôle du 03/09.
- « Heavy débloque davantage » n’est **pas encore prouvé** : le catalogue et les métadonnées de modèles ne comportent aucun champ d’abonnement/tier. Les capacités ci-dessus sont celles exposées à l’identité API courante, sans attribution causale au forfait Heavy.
- Preuve live supplémentaire : la même identité a accepté 32/32 requêtes i2v base64 avec `grok-imagine-video-1.5`, 6 s, `1080p`, en `9:16` et `16:9`. Cela prouve l’accès effectif, toujours pas que cet accès provient spécifiquement de Heavy.

## Production et emplacement

- Lisa : 16 clips pour les shorts 01–08, deux plans par short, sous `_img1/personas/lisa/broll-grok-2026-09-03/`.
- Ambre : 16 clips pour les segments sans avatar 04–19, un plan par pays, sous `_img1/personas/ambre/broll-grok-2026-09-03/`.
- Volume vidéo total : 200 020 936 octets. Chaque clip contient une vidéo H.264 24 i/s et une piste AAC ; la présence de la piste est prouvée par ffprobe, son contenu éditorial n’a pas été évalué à l’écoute.
- Les références portrait Ambre sont placées au centre d’un canevas 16:9 avec prolongement flouté. Cela évite l’étirement explicitement produit par une surcharge directe du ratio API et maintient l’architecture source intacte.
- Les captures montrent 16/16 plans Lisa sans visage réaliste ni texte et 16/16 plans Ambre rattachables à leur photo pays. La mesure automatique de mouvement global OpenCV a échoué ; la conformité « mouvement caméra minimal » repose donc sur les prompts verrouillés et l’inspection des captures, pas sur une métrique optique validée.
- Les destinations externes `~/.codebuddy/personas/{lisa,ambre}/broll-grok-2026-09-03/` restent absentes et intactes, conformément au garde-fou final interdisant toute écriture hors du dépôt.

## Jobs et contrôles

| Job | Fichier | Durée ffprobe | Résolution | Capture QA | Quota restant exposé |
|---|---|---:|---|---|---|
| lisa-01-echo-a | `lisa-01-echo-a.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-01-echo-a.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-01-echo-b | `lisa-01-echo-b.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-01-echo-b.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-02-self-evolution-a | `lisa-02-self-evolution-a.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-02-self-evolution-a.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-02-self-evolution-b | `lisa-02-self-evolution-b.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-02-self-evolution-b.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-03-short-first-a | `lisa-03-short-first-a.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-03-short-first-a.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-03-short-first-b | `lisa-03-short-first-b.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-03-short-first-b.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-04-pardon-a | `lisa-04-pardon-a.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-04-pardon-a.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-04-pardon-b | `lisa-04-pardon-b.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-04-pardon-b.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-05-night-silence-a | `lisa-05-night-silence-a.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-05-night-silence-a.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-05-night-silence-b | `lisa-05-night-silence-b.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-05-night-silence-b.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-06-reminder-a | `lisa-06-reminder-a.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-06-reminder-a.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-06-reminder-b | `lisa-06-reminder-b.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-06-reminder-b.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-07-local-vision-a | `lisa-07-local-vision-a.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-07-local-vision-a.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-07-local-vision-b | `lisa-07-local-vision-b.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-07-local-vision-b.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-08-barge-in-a | `lisa-08-barge-in-a.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-08-barge-in-a.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| lisa-08-barge-in-b | `lisa-08-barge-in-b.mp4` | 6,041667 s | 1088×1920 | `_qa/img1/lisa/lisa-08-barge-in-b.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-04-spain | `ambre-04-spain.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-04-spain.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-05-cyprus | `ambre-05-cyprus.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-05-cyprus.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-06-malta | `ambre-06-malta.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-06-malta.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-07-portugal | `ambre-07-portugal.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-07-portugal.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-08-dubai | `ambre-08-dubai.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-08-dubai.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-09-thailand | `ambre-09-thailand.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-09-thailand.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-10-malaysia | `ambre-10-malaysia.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-10-malaysia.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-11-mauritius | `ambre-11-mauritius.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-11-mauritius.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-12-panama | `ambre-12-panama.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-12-panama.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-13-costa-rica | `ambre-13-costa-rica.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-13-costa-rica.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-14-morocco | `ambre-14-morocco.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-14-morocco.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-15-tunisia | `ambre-15-tunisia.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-15-tunisia.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-16-georgia | `ambre-16-georgia.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-16-georgia.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-17-croatia | `ambre-17-croatia.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-17-croatia.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-18-montenegro | `ambre-18-montenegro.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-18-montenegro.jpg` | 60 req (rate-limit ; solde forfait non exposé) |
| ambre-19-uruguay | `ambre-19-uruguay.mp4` | 6,041667 s | 1920×1088 | `_qa/img1/ambre/ambre-19-uruguay.jpg` | 60 req (rate-limit ; solde forfait non exposé) |

## Échecs et arrêts

- Aucun job API en échec ; aucun `403` d’épuisement reçu.
- Échec non bloquant du contrôle optique bonus OpenCV : faute mémoire GPU avant résultat. Le contrôle demandé ffprobe/capture est vert.
- Limite ouverte : aucune preuve API ne relie les capacités observées au tier « SuperGrok Heavy », et aucun solde de ce forfait n’est exposé.
- Limite de livraison : les fichiers restent dans le clone, pas aux destinations `~/.codebuddy`, à cause du garde-fou contradictoire mais explicitement non négociable.
