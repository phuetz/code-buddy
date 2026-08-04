# Kit de publication LISA IA « 5 signaux » v4 — 1er août 2026

## Livraison

Le kit est prêt dans :

`/home/patrice/Videos/publication-2026-07-30/lisa-vision-ia/kit-publication-v4/`

Il cible exclusivement le master corrigé
`lisa-vision-ia-5-signaux-v4.mp4`, SHA-256
`888dc692477ebcb03799b2ac51ea6031b6aa62dced2365b14a3945ffffc0d9c6`.
Le v3 refusé n'est ni copié ni proposé.

## Choix recommandé

- **Titre :** « Krea, Qwen, Grok, Kimi : 5 signaux IA à retenir ».
- **Miniature :** `miniature-01-5-signaux.jpg` — message direct et fidèle au
  format éditorial.
- **Alternative plus générale :** `miniature-02-change-echelle.jpg`.
- **Variante à tester avec prudence :** `miniature-03-risque.jpg`, plus tendue
  et moins représentative des quatre premiers chapitres.

La description commence par la transparence sur Lisa et les visuels générés,
contient les douze chapitres, les onze liens de source, les deux emplacements
d'URL de chaîne et une question de commentaire.

## Contenu du kit

Le manifeste recense **18 livrables** :

- cinq propositions de titre, toutes sous 60 caractères ;
- une description prête à coller ;
- quinze tags uniques ;
- douze chapitres ;
- le SRT français de 168 repères ;
- trois miniatures 1280×720 et leur planche à 320 px ;
- les mesures de contraste et de géométrie ;
- le contrôle d'identité ArcFace ;
- le sidecar audio du master ;
- avatar, bannière et checklist ;
- la plaque visuelle source et sa provenance ImageGen.

## Miniatures

La plaque de fond a été créée avec l'outil ImageGen intégré à partir de
`lisa-avatar-800.png` comme référence stricte d'identité : Lisa à droite,
univers rédaction technologique bleu, espace typographique à gauche, aucun
texte généré dans l'image. La typographie française a ensuite été composée par
le contrôleur déterministe `miniature-youtube.py`.

| Variante | Contraste minimal | ArcFace minimal | Mobile 320 px |
|---|---:|---:|---|
| 1 — 5 signaux | 6,78:1 | 0,945 | passe |
| 2 — change d'échelle | 6,78:1 | 0,945 | passe |
| 3 — plus risqués ? | 6,78:1 | 0,945 | passe |

Les quatre images testées — plaque source et trois JPEG — sont toutes détectées.
La plage ArcFace complète est **0,9452 à 0,9488**, seuil 0,75.

Le premier rendu de la pastille « LISA IA » a été refusé à 4,06:1. Le fond a
été foncé et le rendu final remesuré à 6,78:1. Le garde-fou a donc empêché la
livraison du défaut au lieu de simplement le documenter.

## Reproductibilité

Commande :

```bash
python3 scripts/influencer/build-lisa-signaux-kit.py
```

Le constructeur vérifie les empreintes du master et de la plaque ImageGen,
recompose les trois miniatures, impose contraste et lisibilité mobile, exécute
ArcFace, copie les sidecars puis réécrit `manifest.json`.

Tests ciblés :

```text
17 passed
```

## Ce qui reste humain

- choisir définitivement le format inaugural de LISA IA : cette édition à cinq
  sujets ou le long format Meta AI centré sur un seul sujet ;
- créer et vérifier la chaîne ;
- remplacer les deux marqueurs `[[...]]` par les URL réelles ;
- régler « contenu modifié ou synthétique » sur **Oui** dans YouTube Studio ;
- publier d'abord en non répertorié, puis regarder et écouter la vidéo en
  continu sur téléphone avant passage en public.

Aucune publication et aucune opération de compte n'ont été réalisées.
