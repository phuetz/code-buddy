# Décors à la demande de Lisa

`lisa-decor-a-la-demande.py` fabrique un habillage lié au lieu d’une actualité,
contrôle l’identité de Lisa, puis mémorise la talking photo HeyGen. Un décor
validé est réutilisable indéfiniment : le SHA-256 de l’image relie le catalogue
local à `~/.codebuddy/personas/lisa/talking-photos.json`.

## Règle éditoriale : jamais de faux vécu

Le décor est un **habillage**, pas une preuve de présence. Lisa commente et
décrypte des faits sourcés ; elle ne prétend jamais les avoir vécus.

- Autorisé : « Lisa décrypte le salon de Paris », « ce qu’il faut retenir de
  VivaTech ».
- Interdit : « en direct de », « sur place », « j’étais », « nous étions »,
  « Lisa était… », « elle a rencontré… » et les formulations équivalentes de
  témoignage direct.
- Obligatoire dans chaque description : « Lisa est une créatrice virtuelle. »

Le script vérifie le titre et la description **avant** la génération. Il refuse
les formulations interdites et ajoute la mention de créatrice virtuelle si elle
manque.

## Chaîne de production

1. Deux ou trois variantes `identity-preserve` sont demandées à GPT Image via
   l’outil intégré de Codex et la référence
   `~/.codebuddy/personas/lisa/identity-kit/lisa-hotel-2.png`.
2. Les clés `OPENAI_API_KEY`, `XAI_API_KEY` et les configurations image directes
   sont retirées du sous-processus. La voie a donc un coût API marginal de
   0 USD.
3. Chaque sortie passe `visual-gate.py --gate` et doit atteindre ArcFace ≥ 0,75.
   Une sortie sous le seuil est régénérée une seule fois, puis abandonnée.
4. La meilleure sortie admissible est copiée dans
   `~/.codebuddy/personas/lisa/decors-a-la-demande/<decor>/`.
5. Les opérations média HeyGen v3, non débitées lors du test, uploadent l’image
   et créent la talking photo, puis son identifiant est écrit dans
   `talking-photos.json`. Avant l’appel, le script vérifie que le portefeuille
   facturé à l’usage est nul et que le mode `usage_based` est inactif. La
   création est idempotente par SHA-256.
6. Une animation de test optionnelle passe par l’interface Avatar Shots déjà
   connectée dans Brave (CDP 9222), et non par le portefeuille API vidéo. Le
   solde mensuel est mesuré avant/après et un plafond ferme arrête le run si une
   autre génération HeyGen consomme des crédits en parallèle.

Le simple upload d’une talking photo ne lance aucune vidéo. L’animation
journalise séparément les crédits mensuels HeyGen réellement débités. Le budget
de sécurité reste fondé sur la plage historique de 10 à 16 crédits ; le test
court de cette mission a réellement coûté 5 crédits.

## Utilisation

```bash
python3 scripts/influencer/lisa-decor-a-la-demande.py \
  --lieu "Paris, salon technologique" \
  --tenue "blazer velours sapin" \
  --moment "matin" \
  --titre "Lisa décrypte le salon de Paris" \
  --description "Les annonces à retenir. Lisa est une créatrice virtuelle." \
  --visual-gate-python /chemin/du/venv/bin/python
```

Test réel de 15 secondes avec un audio déjà en cache, plafond total 16 crédits :

```bash
python3 scripts/influencer/lisa-decor-a-la-demande.py \
  --lieu "Paris, salon technologique" \
  --tenue "blazer velours sapin" \
  --moment "matin" \
  --animer-15s \
  --plafond-credits 16 \
  --visual-gate-python /chemin/du/venv/bin/python
```

Si l’interface a confirmé le lancement mais que le processus local a été
interrompu, la reprise télécharge le projet existant sans créer une deuxième
vidéo. Le nombre de crédits est celui observé sur le solde avant l’interruption :

```bash
python3 scripts/influencer/lisa-decor-a-la-demande.py \
  --lieu "Paris, salon technologique" \
  --tenue "blazer velours sapin" \
  --moment "matin" \
  --animer-15s \
  --reprendre-video-id <video-id> \
  --credits-video-repris 5
```

Pour préparer l’image sans toucher à HeyGen :

```bash
python3 scripts/influencer/lisa-decor-a-la-demande.py \
  --lieu "Paris, salon technologique" \
  --sans-heygen
```

`decors-catalogue.json` prépare Paris/VivaTech, Las Vegas/CES,
Barcelone/MWC, Berlin/IFA et San Francisco. Après validation, `--forcer` est
nécessaire pour régénérer une combinaison lieu/tenue/moment déjà cataloguée.

## Journaux et reprise

- `run.json` : variantes, scores, sélection, identifiant HeyGen et coût du run ;
- `journal.jsonl` : historique append-only des sélections et réutilisations ;
- `visual-gate.jsonl` : rapports du gate local ;
- `*.png.qc.json` : sidecar de chaque image, laissé intact.

Aucune publication n’est effectuée par ce script.

## Résultat témoin Paris

Trois variantes intégrées ont obtenu respectivement 0,847049, 0,856390 et
0,861052 avec ArcFace. Elles ont toutes quitté `visual-gate.py --gate` avec le
code 0 ; la troisième a été retenue. Sa talking photo réutilisable est
`506583eca9f4461fb95da770151da149`. Le test Avatar Shots dure 14,999 s en
1080 × 1920 et a débité 5 crédits mensuels, sans débit du portefeuille à
l’usage. Le coût image réel est de 0 USD.

Le contrôle vidéo local supplémentaire a signalé une dérive ArcFace sur
certaines expressions (minimum observé 0,674) : le MP4 est donc un test
technique, pas un actif validé pour publication. L’image source et sa talking
photo restent validées et réutilisables.
