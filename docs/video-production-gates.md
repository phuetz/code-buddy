# Portes systémiques du pipeline vidéo

Date de mise en place : 30 juillet 2026.

Ces portes s’appliquent aux prochains rendus. Elles ne modifient, ne
suppriment et ne republient aucune vidéo existante.

## Ordre bloquant

1. **Porte commerciale** : le nombre de chapitres présents doit être supérieur
   ou égal au nombre attendu. Le statut doit être `approved`, le SHA-256 du
   manuscrit doit être celui qui a été approuvé, et le CTA ainsi que son URL
   HTTPS doivent être renseignés. Un échec intervient avant le planning et
   avant toute dépense Flow.
2. **Porte éditoriale** : les textes visibles ne peuvent contenir aucun
   marqueur de production (`Accroche`, `Conclusion`, `Hook`, `Hook de fin`,
   `TODO`, `FIXME`, `TBD`, placeholder ou libellé tronqué).
3. **Porte visuelle** : chaque plan porte le type `persona`, `broll` ou
   `slide`. ArcFace ne s’exécute que sur `persona`. Les dix SHA-256 déjà
   approuvés par Patrice conservent leur plafond positif : un rejet automatique
   ne peut pas annuler cette autorité.
4. **Porte d’inventaire** : les plans sont indexés par SHA-256 et dHash de
   frames. Une réutilisation perceptuelle entre deux titres est refusée sans
   justification explicite. Un `alternate`/`directorscut` identique à son
   master est refusé.
5. **Porte de rendu** : carton final complet et mobile-safe, puis mastering
   deux passes à −14 LUFS avec plafond de traitement −1,5 dBTP.
6. **Porte de livraison** : le MP4 après son dernier encodage AAC est remesuré.
   La livraison échoue hors de la fenêtre −14 LUFS ±1 LU ou au-dessus de
   −1 dBTP.

## Complétude commerciale

Le catalogue source se trouve dans
`scripts/trailers/catalog-manifest.json`. La règle est fail-closed :

```json
{
  "expectedChapters": 40,
  "presentChapters": 40,
  "manuscriptStatus": "approved",
  "approvedContentSha256": "<sha256>",
  "cta": "Lire le roman",
  "url": "https://…"
}
```

Un titre absent du catalogue doit fournir un fichier
`.trailer-manuscript.json` dans son dossier. Un statut `incomplete` ou
`major_revision` ne permet ni génération ni rendu, même si des rushes existent.

Les 32 fichiers de l’audit qui promeuvent les huit manuscrits à 1/40 sont
répertoriés, sans suppression, dans
`scripts/trailers/blocked-trailers-2026-07-30.json` avec le statut `blocked` et
la raison `manuscrit incomplet`.

## Cartons

Le carton trailer dure au moins 4 secondes et exige cinq zones : titre,
auteur, statut, CTA et URL. Les marges de sécurité valent 10 % de chaque axe.
Tous les textes ont un contraste supérieur ou égal à 4,5:1.

Le Short 1080×1920 réserve désormais :

- titre : `(x=108, y=614, largeur=864, hauteur=346)` ;
- auteur : `(x=108, y=1114, largeur=864, hauteur=154)`.

Les deux rectangles ont 154 pixels de séparation verticale. Le test de
non-régression échoue si leurs bounding boxes se croisent. Le dernier segment
est prolongé à 4 secondes, y compris lorsque la voix est plus courte.

## Versioning physique

Tout nouveau fichier suit :

```text
<title-id>--<language>--<role>--r<revision>--<master-id>.mp4
```

Rôles autorisés :

- `master` : source de publication ;
- `delivery` : dérivé de transfert, jamais présenté comme master ;
- `alternate` : montage réellement distinct, avec justification ;
- `shot` : plan élémentaire indexé.

`v2` et `directorscut` ne sont pas des rôles implicites. Une révision est un
entier positif et un alternate doit porter une justification. Un hash identique
au master est toujours bloquant.

## Preuve témoin du 30 juillet 2026

Le témoin a été généré entièrement sous
`/tmp/code-buddy-video-witness-nEmux7/`; aucune vidéo de `~/Videos` n’a été
écrite.

| Mesure sur le MP4 final | Ancien témoin | Nouveau `short-assemble.py` |
|---|---:|---:|
| Durée du carton final | non garantie | 4,0 s |
| Durée du fichier | 8,0 s | 8,0 s |
| Loudness intégré | −32,06 LUFS | −13,03 LUFS (conforme −14 ±1) |
| True peak | −24,27 dBTP | −4,82 dBTP (conforme ≤ −1) |
| Zones titre/auteur | aucune réservation vérifiée | disjointes, safe area 10 % |
| Sidecar de QC final | absent | `short-temoin.mp4.delivery-qc.json` |

Le témoin « avant » reproduit l’ancien placement absolu et un mix non
normalisé. Le témoin « après » est produit par le vrai renderer modifié, pas
par un mock. Les captures de contrôle de cette exécution sont `before.png` et
`after.png` dans le même dossier temporaire.

La porte commerciale a également été rejouée sur
`La_Chair_des_Machines` : refus déterministe
`manuscript incomplete: 1/40 chapters`. Le scanner visible a trouvé exactement
`Accroche` et `Conclusion` dans chacun des quatre plans de `reserve-lisa`, ce
qui provoque maintenant un refus avant rendu.

## Commandes de non-régression

```bash
npm run typecheck
npm test -- \
  tests/scripts/produce-book-trailer.test.ts \
  tests/scripts/run-flow-generation.test.ts \
  tests/scripts/trailer-commercial-gate.test.ts \
  tests/scripts/trailer-end-card.test.ts \
  tests/scripts/video-asset-gate.test.ts \
  tests/tools/video/film-assemble.test.ts
python3 -m unittest discover -s tests/scripts/influencer -p 'test_*.py'
python3 -m unittest tests/scripts/test_measure_visual_gates.py
```
