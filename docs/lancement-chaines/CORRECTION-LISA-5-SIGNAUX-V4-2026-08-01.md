# Correction LISA IA « 5 signaux » v4 — 1er août 2026

## Résultat

Le défaut de sous-titres du v3 est corrigé dans :

`/home/patrice/Videos/publication-2026-07-30/lisa-vision-ia/lisa-vision-ia-5-signaux-v4.mp4`

Le v4 passe le contrôle technique. Le v3 reste refusé et doit être conservé
comme ancienne version, pas publié.

| Contrôle | Résultat v4 |
|---|---:|
| SHA-256 | `888dc692477ebcb03799b2ac51ea6031b6aa62dced2365b14a3945ffffc0d9c6` |
| Durée | 542,466667 s |
| Images | 16 274 · 1920×1080 · 30 i/s |
| Encodage | H.264 High · yuv420p |
| Audio | AAC stéréo · 48 kHz · copié au bit près du v3 |
| Loudness | −14,01 LUFS |
| True peak | −1,40 dBTP |
| LRA | 2,60 LU |
| Écart audio/vidéo en fin | 66,7 ms |
| Noir accidentel | 0 |
| Silence | 4,063 s, carton final volontaire |

Le fichier SRT de livraison est voisin du master :
`lisa-vision-ia-5-signaux-v4.fr.srt`. Il est identique au SRT du v2, donc garde
le calage des 168 repères effectivement utilisé avec la piste audio livrée.

## Méthode de correction

La réparation ne repart pas du v3 endommagé. Le script
`~/Videos/publication-2026-07-30/lisa-vision-ia/work/produire-v4.py` utilise
`work/render/video.mp4`, le montage propre avant sous-titres, puis applique les
filtres dans cet ordre :

1. plaques combinées `LISA IA | Source` ;
2. pieds de page remontés et trois titres longs remis dans leur cadre ;
3. sous-titres ASS et mention de transparence, **en dernière passe** ;
4. carton final de quatre secondes.

L'ASS provient de `revision-20260731/lisa-vision-ia-5-signaux-v2.fr.ass`. Le
fichier plus récent `work/sous-titres-fr.ass` n'a pas été utilisé : il avait été
régénéré avec des durées de sections légèrement différentes et pouvait décaler
certaines cartes de plus d'une demi-seconde.

Le carton final n'existe pas dans le montage propre. Ses quatre secondes sont
reprises du v3 ; elles ne contiennent aucun dialogue et leur habillage était
déjà correct.

## Contrôles du composite final

- Les **12 cartons** ont été extraits du v4 et relus sur la planche
  `work/v4/qc-final/12-cartons-v4.jpg` : titres, sources, pieds et sous-titres
  sont entièrement visibles.
- Les **52 intersections** entre repères SRT et cartons ont été échantillonnées.
  Chacune contient des pixels de glyphes dans la bande y=890→999 que le v3
  avait effacée ; minimum mesuré : 417 pixels clairs.
- Les **24 zones d'habillage** (12 plaques source et 12 cartes) passent le
  contrôle de contraste et de géométrie sur le MP4 final.
- Les 168 événements `Sub` et les deux événements de transparence `Virtual`
  sont présents. Les anciennes puces ASS `Source` sont retirées afin de ne pas
  doubler les nouvelles plaques combinées.
- Le flux complet se décode sans erreur. La durée, les 16 274 images et la
  synchronisation sont conservées.
- Le MD5 du flux AAC est identique à celui du v3 :
  `b7fed2008b63b8ee8610c80e013fecb2`.

Les preuves machine sont enregistrées dans :

- `work/v4/production-v4.json` ;
- `work/v4/qc-final/visibilite-sous-titres.json` ;
- `lisa-vision-ia-5-signaux-v4.mp4.delivery-qc.json`.

## Verdict

**Bon techniquement pour validation humaine.** Avant publication, il reste le
visionnage et l'écoute continus par la propriétaire de la chaîne, ainsi que les
validations éditoriales, de sources et de déclaration de contenu synthétique.
