# Observation directe de Patrice — format Ninon AI

Notée le 2026-07-28, à croiser avec l'analyse mesurée
(`2026-07-28-analyse-chaine-ninon-ai.md`, en cours).

> « En général elle est **de face**, il y a souvent des **illustrations**. »

## Ce que ça implique

**Deux couches distinctes** :
1. **le visage de face** — porte la parole, l'énergie, l'incarnation ;
2. **les illustrations** — portent l'explication, ce que la parole seule
   ne montre pas.

C'est un format « présentateur + appui visuel », pas un simple plan de
parole. La personne ne décrit pas : elle **commente** ce qu'on voit.

## Conséquences de production

- **L'avatar doit être frontal** (HeyGen le fait bien) — cohérent avec la
  directive de Patrice du 25/07 : *visage de Lisa de face*.
- **Il faut produire des illustrations par sujet.** C'est le vrai coût
  récurrent du format, et ce qui manque aujourd'hui dans le pipeline. Les
  décors Flow ne conviennent pas : ce sont des ambiances, pas des schémas.
- **Deux mises en page possibles** en 9:16 :
  - **écran partagé** (visage / illustration simultanés) — ce que Patrice a
    demandé, et ce que sait déjà faire `wrap-short.py --layout split`
    avec `--face-crop` ;
  - **alternance** (visage, puis illustration plein cadre) — plus dynamique,
    mais on perd l'incarnation pendant l'illustration.
- L'analyse en cours doit **mesurer laquelle des deux domine chez Ninon AI**,
  et dans quelle proportion de temps.

## Question ouverte pour l'analyse

Les illustrations sont-elles des **captures d'écran réelles** (démos de
produits, interfaces), des **schémas**, ou des **images générées** ? La
réponse change complètement le pipeline : une capture demande d'aller
chercher la source, un schéma se fabrique, une image générée se prompte.
