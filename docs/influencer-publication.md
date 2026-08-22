# Publication quasi automatique de Lisa et Ambre

## Garantie centrale : un seul verrou humain

La chaîne automatise la production et la programmation, mais aucune entrée ne
peut passer de `à_valider` à `approuvé` sans une décision humaine nominative
dans la revue par lot. Ce verrou est un invariant de sécurité, pas une étape
provisoire :

1. une cadence automatisée sur trois plateformes ressemble au profil d'un
   compte spam et peut entraîner une révocation sans recours ;
2. Patrice ne doit jamais publier sur France Travail, le chômage, l'ARE, la
   CCAS, l'action sociale ou un client configuré localement ;
3. l'API YouTube et les autres plateformes imposent des quotas et des audits.

Cette justification est aussi placée dans le module
`scripts/influencer/publish_queue.py`, au plus près du code qui interdit le
contournement. L'approbation est absente de la table des transitions génériques
et possède sa propre méthode, qui exige le nom de l'approbateur.

## Composants

- `production-pipeline.py` orchestre, sans les réécrire, `find-subjects.py`,
  `veille-youtube.py`, `collect-evidence.py`, `heygen-batch.py`,
  `wrap-short.py --layout split --face-crop` et `add-sound.py`.
- `publish-queue.py` gère la file SQLite et le journal.
- `review-batch.py` sert sur `127.0.0.1` une planche locale de dix vidéos :
  miniature, titre, deux lignes, durée, plateforme et extrait de trois secondes.
- `publish-worker.py` publie les échéances approuvées, avec trois heures
  d'espacement par plateforme par défaut.
- `publishers/` contient les connecteurs YouTube, TikTok et Instagram.

Les données d'exploitation sont hors dépôt :

```text
~/.codebuddy/influencer-publication/file.sqlite3
~/.codebuddy/influencer-publication/journal.jsonl
~/.codebuddy/influencer-oauth/youtube.json
~/.codebuddy/influencer-oauth/tiktok.json
~/.codebuddy/influencer-oauth/instagram.json
```

SQLite est l'autorité transactionnelle. Le JSONL est une copie lisible du
journal : sujet refusé, approbateur et heure, tentatives, erreurs, reprises,
plateforme, identifiant et URL de publication.

## Parcours hebdomadaire

Découvrir les sujets :

```bash
python3 scripts/influencer/production-pipeline.py découvrir \
  --nombre 8 --jours 7 --avec-veille-youtube
```

Copier et remplir `scripts/influencer/publication-manifest.example.json`.
Le manifeste Lisa doit contenir les quatre blocs `0-3`, `3-10`, `10-45` et
`45-60`. La vidéo finale est refusée hors de la plage validée de 50 à 65
secondes. Le manifeste Ambre doit porter `registre: "douceur"`,
`plan_duration_seconds` entre 2,5 et 3 et `no_hard_effects: true`.

Collecter les preuves puis soumettre l'enregistrement HeyGen :

```bash
python3 scripts/influencer/production-pipeline.py \
  soumettre-enregistrement mon-lot.json
```

Après collecte HeyGen, contrôler le mapping par transcription des huit
premières secondes, indiquer le fichier `presenter_video`, puis finaliser :

```bash
python3 scripts/influencer/production-pipeline.py finaliser mon-lot.json \
  --qc-heygen-confirme
```

La finalisation monte, sonorise, fabrique une miniature si elle manque, importe
les attributions de `collect-evidence.py` et crée une entrée `à_valider` par
plateforme.

La seule action hebdomadaire de Patrice :

```bash
python3 scripts/influencer/review-batch.py --approbateur Patrice
```

Les cases sont cochées par défaut pour accélérer la revue. Le bouton enregistre
en une transaction toutes les cochées comme `approuvé` et les autres comme
`rejeté`. Si une entrée a changé pendant que la page était ouverte, le lot
entier est refusé plutôt que partiellement écrit.

## OAuth et limites réelles des plateformes

Les fichiers suivants doivent appartenir à Patrice et être protégés :

```bash
install -d -m 700 ~/.codebuddy/influencer-oauth
chmod 600 ~/.codebuddy/influencer-oauth/*.json
```

### YouTube

Créer une application OAuth dans Google Cloud, activer YouTube Data API v3 et
autoriser le scope `https://www.googleapis.com/auth/youtube.upload`.
L'autorisation doit demander `access_type=offline` afin d'obtenir un
`refresh_token`.

`~/.codebuddy/influencer-oauth/youtube.json` :

```json
{
  "client_id": "...apps.googleusercontent.com",
  "client_secret": "...",
  "refresh_token": "...",
  "access_token": "...",
  "expires_at": "2026-08-01T12:00:00+00:00",
  "category_id": "22",
  "language": "fr"
}
```

Le connecteur utilise un envoi reprenable, conserve immédiatement l'ID distant,
pose `status.containsSyntheticMedia=true`, puis charge la miniature. Un projet
API non audité peut être limité aux vidéos privées par Google.

### TikTok

Créer une application TikTok Login Kit + Content Posting API, autoriser le
scope `video.publish` et obtenir un jeton utilisateur renouvelable.

`~/.codebuddy/influencer-oauth/tiktok.json` :

```json
{
  "client_key": "...",
  "client_secret": "...",
  "refresh_token": "...",
  "access_token": "...",
  "expires_at": "2026-08-01T12:00:00+00:00",
  "privacy_level": "SELF_ONLY"
}
```

Le connecteur interroge les capacités du créateur, respecte sa durée et sa
confidentialité, transfère le fichier par blocs, pose toujours `is_aigc=true`
et suit le `publish_id`. Pour passer en public, `privacy_level` doit être une
valeur renvoyée par le compte.

Limite importante : TikTok réserve la publication publique aux clients audités
et indique qu'un simple outil interne de gestion de ses propres comptes n'est
pas un cas accepté pour cet audit. Un client non audité reste privé. Il faut
donc faire valider le cas d'usage par TikTok avant d'attendre une publication
publique automatique.

### Instagram

Le compte doit être professionnel et l'application doit disposer de
`instagram_business_basic` et `instagram_business_content_publish`.

`~/.codebuddy/influencer-oauth/instagram.json` :

```json
{
  "access_token": "...",
  "expires_at": "2026-09-01T12:00:00+00:00",
  "ig_user_id": "...",
  "api_version": "vXX.0",
  "share_to_feed": true,
  "video_urls": {
    "/chemin/absolu/video.mp4": "https://media.exemple.fr/video.mp4"
  }
}
```

`api_version` est volontairement obligatoire : renseigner la version active
affichée dans le tableau de bord Meta plutôt que de laisser le code vieillir
avec une valeur implicite.

L'API Reels officielle récupère la vidéo depuis une URL HTTPS publique. Cette
URL doit rester disponible pendant le traitement Meta.

Meta n'expose actuellement pas dans Content Publishing le commutateur natif
« contenu créé avec l'IA » de l'application Instagram. Le connecteur force donc
la première ligne `🤖 Contenu créé avec l’aide de l’IA.` dans chaque légende.
Il serait trompeur d'affirmer que le bouton natif est coché par API. Si Patrice
exige le badge natif plutôt qu'une déclaration visible, Instagram doit rester
manuel jusqu'à ce que Meta expose ce champ.

## Double garde contre un envoi de développement

Même avec des jetons valides, le travailleur ne peut contacter une plateforme
que si les deux conditions sont réunies :

1. option `--autoriser-envoi-reel` ;
2. variable exacte :

```bash
export INFLUENCER_REAL_PUBLISH=JE_COMPRENDS_ET_J_AUTORISE
```

La suite de tests n'active jamais cette garde et utilise
`publishers/simulated.py`.

## Premier envoi, réalisé par Patrice

1. Configurer **une seule plateforme**, de préférence YouTube, et laisser
   TikTok en `SELF_ONLY`.
2. Créer une vidéo test avec un horaire déjà venu, la soumettre à la revue,
   puis l'approuver soi-même dans `review-batch.py`.
3. Inspecter sans envoyer :

   ```bash
   python3 scripts/influencer/publish-queue.py lister --état approuvé --json
   ```

4. Dans un terminal dédié, lever les deux gardes pour un seul passage :

   ```bash
   INFLUENCER_REAL_PUBLISH=JE_COMPRENDS_ET_J_AUTORISE \
     python3 scripts/influencer/publish-worker.py \
       --une-fois --autoriser-envoi-reel
   ```

5. Vérifier l'ID distant et tout le journal :

   ```bash
   python3 scripts/influencer/publish-queue.py journal
   ```

6. Contrôler la vidéo dans le studio de la plateforme. Ne configurer le service
   systemd qu'après ce contrôle réel.

Le service fourni reste inoffensif sans
`~/.codebuddy/influencer-oauth/publication.env`. Après le premier envoi validé :

```bash
printf '%s\n' \
  'INFLUENCER_REAL_PUBLISH=JE_COMPRENDS_ET_J_AUTORISE' \
  > ~/.codebuddy/influencer-oauth/publication.env
chmod 600 ~/.codebuddy/influencer-oauth/publication.env
install -Dm644 \
  scripts/influencer/systemd/codebuddy-publish-worker.service \
  ~/.config/systemd/user/codebuddy-publish-worker.service
systemctl --user daemon-reload
systemctl --user enable --now codebuddy-publish-worker.service
```

Espacement différent, par exemple six heures :

```bash
systemctl --user edit codebuddy-publish-worker.service
```

Puis remplacer `ExecStart` dans la surcharge avec
`--espacement-minutes 360`.

## Vérifications

```bash
python3 -m unittest \
  tests/scripts/influencer/test_publish_queue.py \
  tests/scripts/influencer/test_publish_worker.py \
  tests/scripts/influencer/test_review_batch.py

python3 -m unittest discover \
  -s tests/scripts/influencer -p 'test_*.py'
```

Les tests couvrent les transitions, le refus et le journal d'un sujet exclu,
le refus réseau d'un non-approuvé, la reprise après panne, l'absence de jetons,
l'espacement et l'idempotence.
