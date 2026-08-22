# AMBRE — kit de publication du chalet d’automne v02

**Date : 1er août 2026.** Rien n’a été publié et aucun compte n’a été créé.

## Résultat

Le kit est construit dans :

```text
/home/patrice/.codebuddy/media-video/ambre-chalet-automne/kit-publication/
```

Il contient cinq propositions de titre, la description, quinze tags, trois
miniatures, leur planche à largeur téléphone, les mesures d’habillage, l’avatar,
la bannière, une checklist humaine et un manifeste SHA-256.

Le titre recommandé est :

> **Un chalet d’automne, entre pluie et feu | AMBRE**

Il promet exactement le lieu, la saison et les deux matières du film. Il ne
transforme pas la persona en témoin d’un voyage qu’elle n’a pas vécu.

## Source verrouillée

Le fabricant refuse tout master dont l’empreinte diffère de :

```text
d6bc37510e4118e71640c2a71a3042f71a0345227298406ab7dfe4b9e32b6ca5
```

C’est le SHA-256 déjà consigné dans le rapport v02. Cette garde est nécessaire :
les timecodes des portraits cesseraient d’être vrais dès qu’un plan change.

Le master dure 76,2 secondes. Je n’ai pas ajouté de chapitres : sur un film
muet aussi court, trois segments de dix secondes ou plus fragmenteraient la
lecture au lieu d’aider à la navigation. Cette décision est écrite dans
`manifest.json`, elle n’est pas implicite.

## Images regardées de nouveau

Je n’ai pas repris la planche existante. J’ai extrait une image toutes les
2,4 secondes depuis le MP4 et construit une nouvelle planche de 32 images,
étiquetées par nom de fichier. Elle montre une continuité marché → chalet →
pluie → retour au marché → portrait final. Je n’y vois ni marque de tiers, ni
carton, ni texte, ni sujet France Travail.

Les miniatures viennent de trois extractions directes du même master :

| plan | temps | choix |
|---:|---:|---|
| 16 | 00:38,20 | portrait intérieur, chaleur du salon |
| 22 | 00:52,75 | portrait face à la baie pluvieuse |
| 31 | 01:14,60 | portrait final, le plus rapproché |

## Trois miniatures opposables

La fabrication réutilise
`scripts/influencer/longform/miniature-youtube.py`, le même moteur qui refuse
désormais les débordements, contrastes faibles et chevauchements de LISA IA.

Le premier rendu a réellement échoué : la pastille AMBRE obtenait **4,44:1**
pour **4,5:1** exigé. La couleur a été assombrie ; aucun seuil n’a été abaissé.

Après correction :

| miniature | contraste pastille | ligne la plus faible | dimensions |
|---|---:|---:|---:|
| `01-automne-chalet` | 6,82:1 | 8,33:1 | 1280×720 |
| `02-pluie-feu` | 6,82:1 | 9,76:1 | 1280×720 |
| `03-76-secondes` | 6,82:1 | 8,27:1 | 1280×720 |

Les trois sont réunies à **320 px de large chacune** dans
`planche-comparaison-320px.jpg`. Le texte reste lisible à cette taille et ne
recouvre pas le visage.

## Transparence et ligne éditoriale

La première phrase de `description.txt`, avant toute promesse, est :

> Cette vidéo met en scène une créatrice virtuelle et des décors générés ou
> composés avec l’IA. Elle ne relate pas un voyage réel.

La description répète qu’Ambre est une persona synthétique et que le film
n’est ni un témoignage ni le récit d’un séjour réellement vécu. Le test
`test_ambre_chalet_kit.py` verrouille la présence de ces trois éléments dans
le premier paragraphe.

La phrase ne remplace pas le geste YouTube : Patrice doit encore régler
**« contenu modifié ou synthétique » sur Oui** dans Studio.

## Musique : tracée, mais droit externe non prouvé

Le sidecar du master et les métadonnées du MP4 concordent :

- titre : **It Could Be Sweet** (Instrumental Version) ;
- artiste : **Ludlów** ;
- bibliothèque : **Epidemic Sound** ;
- fichier source : `ES_It Could Be Sweet (Instrumental Version) - Ludlow.mp3` ;
- SHA-256 source déclaré :
  `571e2dbc4bf1a39415152df56dd8dd0844ace36639ecec2a49e144a294033272`.

Mais le sidecar porte `licenseVerifiedExternally: false`. Je n’ai trouvé ni
reçu ni attestation sur le disque. La piste est donc identifiée, pas couverte
de façon démontrée. Avant publication, il faut rattacher la chaîne au bon
abonnement Epidemic et archiver la preuve correspondante.

## Habillage de chaîne

Le kit copie les visuels déjà fabriqués par `build-channel-art.py` : avatar
800×800 et bannière 2560×1440. La bannière part d’un portrait de définition
inférieure et l’agrandit pour le canevas YouTube ; le texte reste vectorisé par
Pillow, mais le portrait ne gagne aucun détail réel. Le coût en netteté n’est
donc pas caché.

## Reproduction

```bash
python3 scripts/influencer/build-ambre-chalet-kit.py
python3 -m pytest -q \
  tests/scripts/influencer/test_ambre_chalet_kit.py \
  tests/scripts/influencer/test_habillage.py
```

Résultat vérifié : **14 tests passent**. Le kit est idempotent : une relance
écrase uniquement ses livrables nommés et refuse un master inattendu.

## Ce qui n’est pas garanti

- aucune preuve externe de licence Epidemic Sound n’a été trouvée ;
- la bannière agrandit un portrait existant et doit être jugée sur téléviseur ;
- les URL de chaîne n’existent pas encore : deux marqueurs `[[...]]` restent
  volontairement dans la description ;
- une planche d’images ne remplace pas la lecture humaine du master avec son.

## Question que je ne peux pas trancher

Quelle promesse doit ouvrir la chaîne : la destination (**« Un automne au
chalet »**), la matière (**« Pluie, feu, bois chaud »**) ou la brièveté
(**« 76 secondes hors du temps »**) ? Les trois miniatures gardent ce choix
visible au lieu de le prendre à la place du propriétaire.
