# Le vestiaire complet d’Ambre

> **Décision de conception — 28 juillet 2026**
>
> **Un lieu. Une tenue. Une émotion.**
>
> La tenue est choisie **pour** le lieu : son climat, sa lumière, son heure et
> son usage. Elle n’est jamais un costume destiné à « faire local ».

**Statut :** plan directeur prêt à produire, sans génération d’image ni de
vidéo.

**Périmètre :** 16 tenues validées, inventaire des décors
`ambre-automne`, portefeuille de 22 destinations, 10 tenues nouvelles,
20 packs de décors et calendrier d’août 2026 à juillet 2027.

---

## Décision en une page

La garde-robe existante est forte mais déséquilibrée : **8 silhouettes
automne-hiver et 8 silhouettes de plage**. Elle couvre déjà très bien le
chalet alpin, Kyoto sous les cerisiers, les rivages méditerranéens et
l’Atlantique estival. Elle couvre mal la ville chaude, la pluie élégante, le
grand froid, les tropiques hors plage et les saisons australes.

La stratégie retenue est donc :

1. conserver les 16 tenues comme premier vocabulaire reconnaissable ;
2. créer **10 tenues complémentaires**, soit un vestiaire cible de
   **26 silhouettes** ;
3. commencer par **4 tenues indispensables** : tropiques couvrants, pluie
   sauge, laine d’automne mousse et grand froid ivoire ;
4. ne produire que les décors nécessaires aux quatre prochains mois, soit un
   **premier lot de 24 motifs** ;
5. exploiter chaque destination en un couple cohérent : **un Film habillé +
   un Carnet**, plutôt que multiplier les publications.

### Règle culturelle non négociable

Sont formellement exclus :

- les vêtements cérémoniels ou religieux utilisés comme accessoires ;
- les silhouettes ethniquement marquées choisies pour leur seul exotisme ;
- les motifs autochtones copiés sans connaissance, collaboration ni contexte ;
- les raccourcis « un pays = un costume ».

En cas de doute, Ambre porte une silhouette contemporaine adaptée au climat.
L’abstention est une décision créative valable.

**Exception 1 — kimono à Kyoto :** le port d’un kimono loué par les visiteurs
pour une promenade ou une séance photo est une pratique touristique courante
au Japon ; la scène doit néanmoins être située, sobre et dissociée de toute
cérémonie religieuse.

**Exception 2 — yukata en ryokan, si un look est créé plus tard :** ce
vêtement d’intérieur et de bain est normalement mis à disposition des clients
dans les ryokan ; il ne doit apparaître que dans cet usage explicite.

Le « kimono-manteau moderne » existant est une pièce contemporaine
d’inspiration vestimentaire, pas un costume traditionnel : il ne relève pas
de l’exception.

---

## 1. Inventaire de l’existant

### 1.1 Les 16 tenues validées

Les scores viennent des deux fichiers locaux `arcface-report.json`. Le score
de la chemise en lin est **0,701796**, inférieur à la plage 0,83–0,88 annoncée
dans le brief mais largement supérieur au seuil de validation 0,55. Les quinze
autres scores vont de 0,828960 à 0,844349.

| ID | Tenue validée | Fichier exact | Matières et palette | ArcFace |
|---|---|---|---|---:|
| T01 | Gros pull torsadé crème | `wardrobe-automne/ambre-pull-torsade-creme.png` | laine Aran, grosse torsade, col roulé, crème | 0,835957 |
| T02 | Doudoune élégante sapin | `wardrobe-automne/ambre-doudoune-sapin.png` | duvet mat, matelassage fin, taille ceinturée, vert sapin | 0,835010 |
| T03 | Manteau de voyage bordeaux | `wardrobe-automne/ambre-manteau-voyage-bordeaux.png` | laine double-face, portefeuille, bordeaux, écharpe oatmeal | 0,839608 |
| T04 | Trench camel de voyage | `wardrobe-automne/ambre-trench-camel.png` | gabardine déperlante, double boutonnage, camel, col roulé sapin | 0,837080 |
| T05 | Kimono traditionnel sakura | `wardrobe-automne/ambre-kimono-traditionnel-sakura.png` | soie ivoire, sakura rose pâle, obi vert sapin | 0,837199 |
| T06 | Kimono-manteau moderne | `wardrobe-automne/ambre-kimono-manteau-rouille.png` | jacquard soie-laine, rouille et indigo, motif botanique | 0,835601 |
| T07 | Cocooning flanelle sapin | `wardrobe-automne/ambre-cocooning-flanelle-sapin.png` | flanelle tartan, peignoir oatmeal, plaid tricoté | 0,840032 |
| T08 | Velours cognac + écharpe | `wardrobe-automne/ambre-velours-cognac-echarpe.png` | velours côtelé, cognac, écharpe olive | 0,836735 |
| T09 | Une-pièce corail | `wardrobe-plage/ambre-maillot-une-piece-corail.png` | une-pièce corail | 0,828960 |
| T10 | Une-pièce blanc + paréo imprimé | `wardrobe-plage/ambre-une-piece-blanc-pareo-imprime.png` | blanc, paréo imprimé | 0,844349 |
| T11 | Robe de plage crochet écru | `wardrobe-plage/ambre-robe-plage-crochet-ecru.png` | crochet écru ajouré | 0,841313 |
| T12 | Kimono azur + une-pièce | `wardrobe-plage/ambre-kimono-azur-une-piece.png` | voile azur, une-pièce | 0,842299 |
| T13 | Combishort en lin sable | `wardrobe-plage/ambre-combishort-lin-sable.png` | lin sable, coupe courte pratique | 0,842823 |
| T14 | Robe longue fluide dos nu | `wardrobe-plage/ambre-robe-longue-fluide-dos-nu.png` | étoffe fluide, silhouette longue | 0,841068 |
| T15 | Jupe paréo + bandeau | `wardrobe-plage/ambre-jupe-pareo-bandeau.png` | paréo sauge, bandeau | 0,841448 |
| T16 | Chemise lin + chapeau de paille | `wardrobe-plage/ambre-chemise-lin-chapeau.png` | chemise en lin clair, chapeau de paille | 0,701796 |

Chemins racines :

- `~/.codebuddy/personas/ambre/wardrobe-automne/`
- `~/.codebuddy/personas/ambre/wardrobe-plage/`

### 1.2 Comment lire l’inventaire des décors

Les métadonnées ne décrivent pas autant de décors différents que de fichiers.
Elles décrivent **24 motifs éditoriaux**, chacun décliné en plusieurs prises.
Le bon niveau de comptage pour le vestiaire est donc le motif, pas la prise.

Codes employés ci-dessous :

- **CH** : chalet suisse, 6 motifs ;
- **SA** : sakura et jardins japonais, 6 motifs ;
- **CO** : intérieurs cocooning génériques, 6 motifs ;
- **EU** : automne européen générique, 6 motifs.

Tous les fichiers sont des décors vides, avec axe central dégagé pour
incrustation. Un décor générique ne doit jamais être présenté comme la copie
fidèle d’un établissement, d’une rue ou d’un monument réel.

### 1.3 Les 24 motifs de décor inventoriés via `.meta.json`

| Code | `promptId` sans prise | Motif exact | Format | Lumière du décor |
|---|---|---|---|---|
| CH01 | `ambre-chalet-01` | façade de chalet suisse en bois sombre sous neige fraîche | 16:9 | aube hivernale pâle, 7000–8000 K, ciel diffus face/haut, fenêtres 2800 K |
| CH02 | `ambre-chalet-02` | salon de chalet, pierre, cheminée, bois miel | 16:9 | nuit, feu et lampes 2400–2800 K latéraux, ombres chaudes |
| CH03 | `ambre-chalet-03` | givre sur fenêtre, Alpes enneigées au-delà | 16:9 | heure bleue 7500–9000 K arrière, reflet feu 2600 K en rive |
| CH04 | `ambre-chalet-04` | terrasse couverte, neige, plaid crème, tasse fumante | 16:9 | après-midi couvert 6000–6800 K, grande source latérale douce |
| CH05 | `ambre-chalet-05` | chemin enneigé vers chalet et lanternes | 9:16 | après-coucher 7000 K ambiant, lanternes 2700 K en contrepoints |
| CH06 | `ambre-chalet-06` | petit coin près du feu, fenêtre givrée, thé | 9:16 | avant lever 7000 K fenêtre arrière + braises 2300 K côté bas |
| SA01 | `ambre-sakura-01` | avenue symétrique de cerisiers en fleurs | 16:9 | lever de soleil 4300–5000 K, contre-jour doux axial |
| SA02 | `ambre-sakura-02` | jardin de temple, sakura, gravier et mousse | 16:9 | matin lumineux 5200–5800 K, ciel diffus haut-gauche |
| SA03 | `ambre-sakura-03` | jardin japonais sous pluie fine, pas japonais | 16:9 | couvert pluvieux 6200–7000 K, lumière enveloppante sans ombre dure |
| SA04 | `ambre-sakura-04` | pétales sur pierre mouillée près d’un ruisseau | 16:9 | fin d’après-midi 4500–5200 K, bois chaud flou en arrière |
| SA05 | `ambre-sakura-05` | allée verticale sous arche de fleurs | 9:16 | première lumière 4800–5500 K, face douce et légère rive arrière |
| SA06 | `ambre-sakura-06` | allée pluvieuse au crépuscule, lanternes papier | 9:16 | crépuscule 7000 K + lanternes 2700 K latérales |
| CO01 | `ambre-cocoon-01` | salon lin et chêne, plaid rouille, pluie aux fenêtres | 16:9 | heure dorée tardive 3500–4300 K, fenêtre latérale |
| CO02 | `ambre-cocoon-02` | coin lecture, pluie, livres, thé, fauteuil bouclé | 16:9 | jour pluvieux 6000–6800 K, fenêtre latérale diffuse |
| CO03 | `ambre-cocoon-03` | thé, livres reliés et plaid en détail | 16:9 | fin de journée 3200–4000 K, source latérale chaude |
| CO04 | `ambre-cocoon-04` | salon mansardé, poutres, pluie, fauteuil | 16:9 | heure bleue 7000 K aux fenêtres + lampes 2800 K |
| CO05 | `ambre-cocoon-05` | coin petit-déjeuner scandinave, brume | 16:9 | matin brumeux 6000–6500 K, grande fenêtre face-côté |
| CO06 | `ambre-cocoon-06` | alcôve verticale, pluie, lampe ambre, bokeh urbain | 9:16 | soir, ambiant 6500–7500 K + lampe 2700 K au-dessus |
| EU01 | `ambre-europe-01` | hêtraie cuivrée dans la brume | 16:9 | lever brumeux 4500–5200 K, rayons arrière-gauche |
| EU02 | `ambre-europe-02` | village alpin après première neige | 16:9 | crépuscule violet 7000–8000 K, fenêtres 2800 K |
| EU03 | `ambre-europe-03` | marché européen d’automne avant ouverture | 16:9 | aube couverte 5800–6500 K, frontal diffus |
| EU04 | `ambre-europe-04` | ruelle pavée après pluie, façades ocre | 16:9 | soir 4300–5000 K, fenêtres chaudes réfléchies au sol |
| EU05 | `ambre-europe-05` | terrasse de café de village de montagne | 16:9 | après-midi pâle 5200–5800 K, soleil latéral adouci |
| EU06 | `ambre-europe-06` | sentier vertical en forêt rousse après pluie | 9:16 | matin brumeux 5200–6000 K, fuite lumineuse arrière |

L’annexe A donne la liste physique exacte des fichiers pour chaque motif. Elle
doit être lue comme un **instantané daté**, car la campagne Flow
`ambre-automne` tournait encore en parallèle au début de cette étude.

### 1.4 Les sept règles de registre à préserver

Reprises de `2026-07-28-douceur-et-retention.md` :

1. promesse visuelle murmurée dans les trois premières secondes ;
2. arrivée → découverte → apogée → apaisement → plan final fort ;
3. plans de 2,5 à 3 secondes, mouvement interne lent ;
4. aucun montage brutal, zoom d’accentuation ou bruitage agressif ;
5. musique porteuse du rythme ;
6. une tenue par destination ;
7. titres et miniatures sobres.

La douceur n’interdit donc ni la structure ni la variation. Elle interdit la
sur-stimulation.

---

## 2. Tableau de correspondance des 16 tenues

Le décor est noté **exact** lorsqu’il peut honnêtement porter la destination,
**partiel** lorsqu’il couvre seulement une ambiance ou un chapitre intérieur,
et **absent** lorsqu’aucun plan existant ne convient.

| ID | Destination(s) juste(s) | Saison et moment | Émotion | Décors existants correspondants | Passeport lumière du portrait |
|---|---|---|---|---|---|
| T01 | chalet des Alpes suisses ; Engadine intérieure | hiver, aube / après-midi neigeux / heure bleue | refuge, silence, chaleur retrouvée | CH01, CH03, CH04, CH06 ; exact | extérieur : key douce 6500–7500 K côté ciel ; intérieur : fenêtre froide arrière + rive feu 2600 K |
| T02 | Engadine, Suisse ; Laponie seulement si grand froid modéré | hiver, matin couvert / crépuscule | netteté, air froid, élan calme | CH01, CH04, CH05, EU02 ; exact Suisse, partiel Laponie | key 6200–7200 K large et haute ; faible rebond neige sous le visage ; rim ambre seulement près du chalet |
| T03 | ligne de l’Albula ; villages des Grisons | hiver, quai à l’aube / village au crépuscule | départ, attente, fil rouge | EU02, CH05 ; partiel, aucun train | ambiant violet 7000–8000 K face-côté, source chaude 2800 K opposée ; manteau sous-exposé de 1/3 IL pour garder le bordeaux |
| T04 | Édimbourg ; forêt rousse alpine ; petite ville européenne | automne, aube humide / fin d’après-midi | promenade, curiosité feutrée | EU01, EU03, EU04, EU05, EU06 ; partiel pour Édimbourg | pluie : 5800–6500 K enveloppant ; forêt : 4800–5400 K arrière-gauche ; ajouter reflet ocre faible au bas du trench |
| T05 | Kyoto sous les cerisiers ; ryokan en contexte documenté | fin mars–début avril, première lumière / pluie / crépuscule | grâce éphémère, attention | SA01 à SA06 ; exact | décliner trois masters : matin 5000 K contre-jour, pluie 6500 K diffuse, crépuscule 7000 K + lanternes 2700 K ; ne pas réutiliser un seul portrait partout |
| T06 | Kanazawa et Kenroku-en en automne | mi-octobre–fin novembre, matin / fin de jour | profondeur, artisanat, maturité | aucun : les plans sakura sont printaniers ; **orpheline** | futur décor : key 4800–5400 K filtrée par érables, rebond rouille côté sol, ombre froide douce |
| T07 | soir au chalet suisse ; refuge de montagne | automne tardif / hiver, soirée / avant lever | intimité, soin, apaisement | CH02, CH06, CO01 à CO06 ; exact ou intérieur générique | feu 2400–2800 K à 45° + fenêtre 6500–7500 K opposée ; conserver un ratio chaud/froid stable sur toute la séquence |
| T08 | Édimbourg ; café ou bibliothèque d’Europe du Nord | automne, matin humide / soir | intelligence chaleureuse, nostalgie | EU03, EU04, EU05, CO02, CO04, CO06 ; partiel | key fenêtre 5500–6500 K côté visage + practical 2800–3200 K arrière ; réduire saturation cognac sous lumière ambre |
| T09 | Algarve | mai–juin ou septembre, matin / couchant | énergie solaire contenue | aucun décor côtier ; **orpheline** | futur décor : 4800–5600 K rasant, key côté océan, rebond ocre chaud côté falaise ; éviter midi |
| T10 | Seychelles, criques granitiques | avril–mai ou octobre, matin | pureté, respiration | aucun décor côtier ; **orpheline** | futur décor : 5200–5800 K, key large côté mer, rebond sable neutre, hautes lumières contrôlées sur le blanc |
| T11 | Formentera ; architecture blanche et plage calme | juin ou septembre, fin de matinée / fin de jour | simplicité tactile | aucun décor côtier ; **orpheline** | futur décor : 5000–5600 K latéral doux, rebond sable crème ; surveiller les franges du crochet ajouré |
| T12 | Santorin ; terrasse égéenne, jamais site religieux traité comme accessoire | mai–juin ou septembre, matin / heure bleue | clarté graphique | aucun décor égéen ; **orpheline** | matin 5200 K avec rebond blanc important ; soir 7000 K ambiant + practical 3000 K ; protéger le détail azur |
| T13 | Minorque, Camí de Cavalls et criques minérales | mai–juin ou septembre, matin | liberté pratique, douceur sèche | aucun décor méditerranéen ; **orpheline** | futur décor : 5000–5600 K côté mer, fill pierre 4200–4800 K ; ombre courte mais jamais lumière verticale de midi |
| T14 | côte amalfitaine | mai ou septembre, coucher | ampleur, romance tranquille | aucun décor italien ; **orpheline** | futur décor : key 3800–4500 K arrière-côté, rim dorée, fill mer 6000 K très faible ; tissu et cheveux dans la même direction de vent |
| T15 | Martinique, jardin et lagon ; plage uniquement | février–avril, matin / fin de jour | fraîcheur végétale, abandon | aucun décor tropical ; **orpheline** | futur décor : 5200–5800 K diffus par végétation, léger cast vert à neutraliser sur peau, rebond sable chaud |
| T16 | Île de Ré, marais salants et vélo ; Algarve hors baignade | juin ou septembre, matin / fin d’après-midi | air salin, élégance simple | aucun décor atlantique ; **orpheline** | futur décor : 5200–6000 K latéral, fill ciel froid, rebond blanc des façades ; ombre du chapeau cohérente et présente |

### 2.1 Orphelins

**Tenues orphelines : 9 sur 16**

- T06, kimono-manteau rouille : aucun automne japonais existant ;
- T09 à T16 : aucun décor plage, littoral méditerranéen, tropical ou
  atlantique dans `ambre-automne`.

T03 et T08 ne sont pas orphelines, mais leurs correspondances sont seulement
partielles : il manque respectivement le train de l’Albula et une Édimbourg
géographiquement crédible.

**Décors orphelins : 0 motif sur 24 au sens vestimentaire.** Tous les motifs
peuvent servir au moins une tenue existante. Cette couverture ne signifie pas
qu’ils sont tous géographiquement spécifiques : CO01–CO06 restent des
intérieurs génériques et EU03–EU05 ne doivent pas être nommés « Édimbourg » ou
« Suisse » sans signes vérifiables.

---

## 3. Les 22 destinations prioritaires

### 3.1 Méthode de saisonnalité

Deux calendriers sont croisés :

- **saison du phénomène** : dates publiées par les offices de tourisme
  nationaux ou régionaux ;
- **saison de recherche et de préparation** : les données Expedia publiées
  en 2025 montrent au T1 une hausse de près de 50 % de la part des recherches
  à 91–180 jours et de 20 % au-delà de 180 jours. Un Carnet pratique doit donc
  précéder la fenêtre de voyage de 3 à 6 mois ; le Film habillé peut paraître
  au début de la fenêtre visuelle.

Une tentative d’export automatique de Google Trends France sur cinq ans a été
faite le 28 juillet 2026. L’endpoint a répondu HTTP 429 et le navigateur
d’automatisation local n’était pas installé. **Aucun indice ou pic Google
Trends par destination n’est donc inventé.** Les fenêtres ci-dessous
s’appuient sur des données de recherche agrégées datées et sur les calendriers
officiels des destinations. Elles devront être recontrôlées chaque année,
notamment pour les floraisons.

### 3.2 Portefeuille équilibré

Répartition : **Europe 8, Asie 4, Afrique 4, Amériques 4, Océanie 2**. La
proportion européenne reste un peu supérieure parce qu’elle valorise
immédiatement le vestiaire existant, sans forcer une symétrie artificielle.

Dans la colonne « publication », **Film** désigne la mise en ligne proche du
phénomène ; **Carnet** désigne la fenêtre de préparation.

| # | Continent — destination | Saison idéale réelle | Fenêtre de publication | Palette | Matières et silhouette | Émotion |
|---:|---|---|---|---|---|---|
| 1 | Europe — Alpes suisses / Engadine | janvier–mars, altitude à confirmer | Film janv.–févr. ; Carnet oct.–nov. | neige, sapin, bois miel | T01 pull crème, T02 doudoune ou T03 manteau bordeaux | refuge |
| 2 | Europe — Laponie finlandaise | févr.–mars pour neige et lumière croissante ; aurores fin août–début avril | Film févr. ; Carnet sept.–nov. | ivoire, graphite, vert nocturne | N03 manteau grand froid, couches techniques | silence habité |
| 3 | Europe — Édimbourg | septembre–octobre | Film sept. ; Carnet mai–juin | pierre, cognac, mousse, pluie bleue | T08 velours ; N02 trench sauge si pluie | intelligence chaleureuse |
| 4 | Europe — Algarve | mai–juin ou septembre | Film mai ou sept. ; Carnet janv.–mars | ocre, Atlantique, corail | T09 une-pièce corail ; T16 hors plage | élan solaire |
| 5 | Europe — Minorque | mai–juin ou septembre | Film juin ; Carnet févr.–mars | sable, calcaire, pin, sauge | T13 combishort lin | liberté calme |
| 6 | Europe — côte amalfitaine | mai ou septembre | Film mai/sept. ; Carnet janv.–mars | citron, terracotta, mer cobalt | T14 robe longue fluide | romance ample |
| 7 | Europe — Île de Ré | juin ou septembre | Film juin ; Carnet févr.–avr. | blanc salin, bleu grisé, paille | T16 chemise lin et chapeau | respiration |
| 8 | Europe — Provence, Vaucluse | mi-juin–mi-juillet selon altitude et récolte | Film fin juin ; Carnet févr.–mars | lavande, blé, pierre blonde | N05 robe midi + cardigan fin | douceur parfumée |
| 9 | Asie — Kyoto, sakura | fin mars–début avril, à reconfirmer chaque année | Film fin mars ; Carnet déc.–janv. | ivoire, rose pâle, mousse | T05 kimono dans contexte justifié | grâce éphémère |
| 10 | Asie — Kanazawa, feuillages | mi-octobre–fin novembre | Film nov. ; Carnet juin–août | rouille, indigo, érable, bois noir | T06 kimono-manteau moderne | profondeur |
| 11 | Asie — Hokkaidō, Furano | début–20 juillet, pic lavande mi-juillet | Film début juil. ; Carnet janv.–mars | lavande, sauge, ciel laiteux | N08 ensemble estival couvrant et souple | fraîcheur lumineuse |
| 12 | Asie — Jeju, colza et cerisiers | fin mars–début avril | Film fin mars ; Carnet déc.–janv. | jaune colza, rose, basalte | N02 trench sauge ou N05 robe midi, sans vêtement traditionnel | renouveau |
| 13 | Afrique — Marrakech | mars–avril ou octobre–novembre | Film mars/oct. ; Carnet nov.–janv. ou juin | argile, safran éteint, écru, vert jardin | N01 robe-chemise en lin couvrante | chaleur feutrée |
| 14 | Afrique — Seychelles | avril–mai ou octobre–novembre | Film avr./oct. ; Carnet déc.–janv. ou juin | granit, blanc, jade, turquoise | T10 plage ; N04 pour jardin/village | pureté |
| 15 | Afrique — Zanzibar | juin–octobre, saison sèche | Film août ; Carnet févr.–avr. | craie, indigo lavé, palmier, sable | N04 silhouette tropicale couvrante ; T10 seulement sur plage | lenteur saline |
| 16 | Afrique — vignobles du Cap | septembre–octobre, printemps austral | Film sept. ; Carnet mai–juin | vert tendre, terre cuite, crème | N09 ensemble lin terracotta | abondance tranquille |
| 17 | Amériques — Martinique | février–avril, carême | Film févr. ; Carnet oct.–nov. | sauge, mangrove, corail doux | T15 plage/jardin ; N04 en ville | fraîcheur végétale |
| 18 | Amériques — Charlevoix, Québec | dernière semaine de sept.–première d’oct. pour le pic moyen | Film fin sept. ; Carnet mai–juin | érable, bordeaux, fleuve acier | N06 manteau laine mousse ; T03 en alternative | nostalgie claire |
| 19 | Amériques — Cartagena de Indias | décembre–février, plus sec et un peu moins chaud | Film janv. ; Carnet août–sept. | chaux, corail fané, bougainvillier | N01 robe-chemise légère, couvrante et ventilée | chaleur colorée |
| 20 | Amériques — lacs de Patagonie argentine | décembre–mars | Film déc./janv. ; Carnet juin–août | lac acier, pierre, mousse, neige lointaine | N07 coupe-vent marin et maille | souffle intérieur |
| 21 | Océanie — Tasmanie | mars–mai ; fagus fin avril–mai | Film avr. ; Carnet nov.–janv. | cuivre, fougère, brume, charbon | N07 ciré technique ; N06 par temps sec | calme profond |
| 22 | Océanie — île du Sud, Nouvelle-Zélande | printemps sept.–nov. ; fleurs fin nov.–début déc. | Film nov. ; Carnet mai–juil. | turquoise froid, lupin, herbe, neige | N07 couches coupe-vent, sans motifs autochtones | recommencement |

### 3.3 Prudences culturelles explicites

- **Laponie :** aucun `gákti` sámi, motif ou accessoire autochtone. Ambre porte
  une tenue technique contemporaine.
- **Marrakech :** pas de caftan cérémoniel, djellaba de fantaisie ou voile
  utilisé pour « faire marocain ». Lin couvrant et coupe moderne.
- **Zanzibar :** pas de kanga ou de kitenge réduit à un imprimé exotique.
  Silhouette contemporaine couvrant épaules et genoux en ville ; maillot
  réservé à la plage.
- **Martinique :** pas de madras ajouté comme code visuel automatique.
- **Hokkaidō :** aucun motif aïnou décoratif hors collaboration et sujet
  documenté.
- **Patagonie :** aucun motif mapuche emprunté.
- **Tasmanie et Nouvelle-Zélande :** aucun motif palawa ou māori utilisé comme
  ornement. Les récits culturels exigeraient des sources et des voix locales,
  pas un styling.

---

## 4. Ce qu’il manque

### 4.1 Dix tenues à créer

Objectif : **10 nouvelles tenues**, soit **26 silhouettes au total**. Les
descriptions sont prêtes à servir de brief de génération. Comme pour les
tenues validées, produire d’abord des portraits poitrine/visage ; les
accessoires bas et chaussures seront validés sur un second passage en plan
large.

#### Lot 1 — priorité absolue, 4 tenues

| ID | Usage ouvert | Description prête à générer |
|---|---|---|
| N01 | Marrakech, Cartagena, ville chaude | **Robe-chemise midi en lin lavé**, coupe droite légèrement ceinturée, manches longues retroussables, col souple, fentes de marche discrètes ; argile rosée, écru et petite touche olive ; sandales de cuir minimalistes et sac tressé non folklorique ; aucun motif culturel ; lumière attendue chaude et rasante 4200–5000 K, jamais soleil vertical. |
| N02 | Édimbourg pluvieux, Jeju, printemps frais | **Trench technique sauge grisée**, gabardine mate déperlante, longueur sous le genou, épaule naturelle, ceinture souple ; pull fin oatmeal et foulard bleu brume uni ; bottines simples ; lumière attendue couverte 6000–6800 K avec reflets mouillés froids. |
| N03 | Laponie et grand froid alpin | **Long manteau grand froid ivoire grisé**, matelassage fin non brillant sous une sur-couche laine-technique, capuche structurée amovible sans fourrure, col haut, gants graphite, bonnet oatmeal ; silhouette longue mais mobile ; lumière neige 6500–8000 K, rebond inférieur à prévoir sur le visage. |
| N04 | Zanzibar, Seychelles hors plage, Martinique en ville | **Ensemble tropical couvrant**, pantalon ample en lin-viscose sable clair, blouse aérienne à manches longues couleur sauge d’eau, débardeur ivoire opaque, foulard très léger uni porté librement au cou ou dans les cheveux — jamais comme signe religieux —, sandales plates ; lumière 5200–6000 K filtrée par végétation. |

**Commencer par ce lot de 4.** Il débloque les climats et usages que les
16 tenues ne savent pas traiter sans invraisemblance.

#### Lot 2 — expansion saisonnière, 4 tenues

| ID | Usage ouvert | Description prête à générer |
|---|---|---|
| N05 | Provence, Jeju sec, campagne printanière | **Robe midi structurée à micro-fleurs non culturelles**, fond crème, fleurs lavande et sauge très espacées, taille souple, manches au coude, cardigan fin oatmeal posé sur les épaules ; panier minimal sans cliché rustique ; lumière 4400–5200 K de matin ou fin de jour. |
| N06 | Charlevoix, Kanazawa alternatif, Tasmanie sèche | **Manteau de laine brossée vert mousse**, coupe portefeuille mi-longue, sous-pull crème, écharpe bordeaux sourd, boutons corne unis sans motif ; silhouette enveloppante ; lumière automnale 4600–5600 K, rebond cuivre du sol et ombres légèrement bleues. |
| N07 | Tasmanie, Nouvelle-Zélande, Patagonie | **Ciré premium bleu ardoise mat**, coupe longue et nette, coutures discrètes, maille fine crème, pantalon droit graphite, bonnet compact et bottines de marche sobres ; aucune esthétique d’expédition extrême ; lumière changeante 5600–7200 K, vent cohérent dans cheveux et tissu. |
| N08 | Hokkaidō estival, ville nordique en été | **Ensemble estival couvrant bleu grisé**, pantalon large taille haute en lin froid, blouse ivoire à col ouvert modéré, cardigan ultrafin lavande fumée, petit sac crème ; silhouette verticale et légère ; lumière de matin 5000–5800 K. |

#### Lot 3 — profondeur urbaine, 2 tenues

| ID | Usage ouvert | Description prête à générer |
|---|---|---|
| N09 | vignobles du Cap, terrasse automnale douce | **Ensemble lin terracotta pâle**, pantalon palazzo et veste souple non doublée sur top crème, ceinture cuir cognac fine, bijoux minimalistes non identitaires ; lumière printanière australe 4700–5400 K en arrière-côté. |
| N10 | Vienne, Prague, Édimbourg de nuit, futurs intérieurs culturels | **Robe midi bleu nuit couvrante**, crêpe de laine fluide, encolure bateau, manches longues, taille dessinée sans corset, boucles d’oreilles très simples ; lumière mixte heure bleue 7000 K et intérieur 2800–3200 K. |

### 4.2 Les décors manquants

Il manque **20 packs géographiquement spécifiques** sur les 22 destinations
prioritaires. Les Alpes suisses et Kyoto disposent déjà d’un pack exploitable.
Édimbourg dispose d’ambiances partielles mais a besoin de signes crédibles.

#### Gabarit reproductible d’un pack

Chaque pack contient **6 motifs uniques, une prise chacun avant QC** :

1. plan large de seuil ou d’arrivée, 16:9 ;
2. plan large iconique mais calme, 16:9 ;
3. plan moyen d’usage plausible, 16:9 ;
4. détail de matière répondant au vêtement, 16:9 ;
5. plan vertical de passage, 9:16 ;
6. plan vertical d’apaisement ou de lumière, 9:16.

Contraintes communes prêtes à ajouter à chaque invite :

> Décor vide photoréaliste, aucun humain, silhouette, visage, main, reflet
> humain ni animal ; axe central et premier plan dégagés pour compositing ;
> mouvement lent, fluide et stable ; couleur naturelle contenue, grain fin ;
> aucun logo, marque, filigrane ou texte lisible ; un seul plan continu de
> huit secondes.

Total directeur : **20 × 6 = 120 motifs**, mais production roulante. Ne jamais
commander 120 plans d’un bloc.

| Priorité | Pack manquant — 6 ancrages prêts à développer | Lumière maîtresse |
|---|---|---|
| P0 | **Zanzibar** — plage de sable à l’aube ; porte sculptée de Stone Town sans texte ; ruelle de chaux tôt le matin ; terrasse ombragée ; détail de persienne et lin ; passage vertical entre murs clairs | 5000–5800 K matin, soleil latéral filtré ; aucune scène de ville en maillot |
| P0 | **Édimbourg** — ruelle de pierre mouillée ; bibliothèque de bois sombre ; parc aux feuilles rousses ; seuil de café ; détail pierre/laine ; passage vertical sous pluie fine | 5800–6800 K couvert, practicals 2800 K en rive |
| P0 | **Charlevoix** — route entre érables ; vue calme sur Saint-Laurent ; quai de village ; terrasse de bois ; détail feuille/laine ; chemin vertical dans brume | 4600–5400 K matin, direction arrière-gauche |
| P0 | **Kanazawa** — Kenroku-en suggéré sans copie fautive ; ruelle de bois sous érables ; atelier contemporain ; bassin et yukitsuri ; détail laque/jacquard ; passage vertical au crépuscule | 4800–5600 K filtré, rebond rouille ; soir 7000 K + 2800 K |
| P1 | **Laponie** — forêt chargée de neige ; cabine contemporaine ; plaine bleue ; fenêtre givrée ; détail neige/laine ; chemin vertical au crépuscule | 6500–8500 K, rebond neige ; intérieur 2700 K |
| P1 | **Martinique** — jardin tropical après averse ; lagon calme ; maison créole cadrée avec prudence ; sentier végétal ; détail feuille/lin ; verticale de plage au matin | 5200–6000 K diffus, légère contamination verte à mesurer |
| P1 | **Marrakech** — patio de riad documenté ; jardin d’agrumes ; mur d’argile au matin ; passage d’ombre ; détail zellige sans prétendre à un monument ; verticale de porte | 4200–5200 K, soleil découpé latéral + ombre ouverte |
| P1 | **Côte amalfitaine** — terrasse de Ravello ; escalier calme ; citronniers ; façade pastel ; détail céramique/tissu ; verticale au couchant | 3800–4800 K arrière-côté, fill mer froid |
| P1 | **Provence** — champ de lavande avant foule ; mas en pierre ; chemin de cyprès ; table de lin ; détail épi/tissu ; verticale au lever | 4300–5200 K rasant ; vérifier floraison avant titrage |
| P1 | **Hokkaidō** — rangs de lavande ; colline de Biei ; maison de bois claire ; matin brumeux ; détail fleur/lin ; verticale de chemin | 5000–6000 K, ciel large et ombres peu denses |
| P2 | **Algarve** — falaises ocre sûres ; crique vide ; passerelle de bois ; terrasse blanche ; détail roche/corail ; verticale à l’heure dorée | 4500–5600 K, rebond ocre contrôlé |
| P2 | **Minorque** — crique calcaire ; Camí de Cavalls ; pinède ; maison chaulée ; détail lin/pierre ; passage vertical | 5000–5800 K, soleil latéral doux |
| P2 | **Île de Ré** — marais salants ; piste cyclable vide ; façade blanche ; port calme ; détail sel/paille ; verticale sous ciel laiteux | 5200–6200 K, fill ciel froid |
| P2 | **Seychelles** — granit et lagon ; sous-bois côtier ; ponton discret ; matin après pluie ; détail pierre/paréo ; verticale de palmes | 5200–6000 K, rebond sable neutre |
| P2 | **Jeju** — colza et cerisiers ; muret basaltique ; sentier côtier ; théière et fenêtre ; détail pluie/trench ; verticale de chemin | 5400–6800 K selon pluie |
| P2 | **Vignobles du Cap** — rangs de vigne au printemps ; véranda ; montagne voilée ; table de bois ; détail feuille/lin ; verticale au couchant | 4500–5400 K arrière-côté |
| P2 | **Cartagena** — rue pastel à l’aube ; patio ventilé ; remparts au soir ; persiennes ; détail chaux/lin ; passage vertical ombragé | 4300–5400 K ; aucune prise à midi |
| P2 | **Lacs de Patagonie** — rive calme ; lodge de bois ; sentier de hêtres ; ponton ; détail eau/ciré ; verticale sous ciel changeant | 5600–7500 K, direction et vent documentés |
| P2 | **Tasmanie** — fagus d’automne ; route humide ; cabane sobre ; lac brumeux ; détail feuille/ciré ; verticale en sous-bois | 5200–6800 K, lumière douce et mobile |
| P2 | **Île du Sud** — lac Tekapo hors foule ; route alpine ; herbes au vent ; cabane ; détail lupin/maille ; verticale de rive | 5200–7000 K ; ne pas présenter le lupin invasif comme emblème écologique |

**Premier lot de décors : 24 motifs**, dans cet ordre : Zanzibar, Édimbourg,
Charlevoix, Kanazawa. Il couvre août à novembre 2026. Après QC, ne relancer que
les motifs réellement insuffisants.

---

## 5. Cohérence visuelle : méthode lumière et colorimétrie

La qualité qui rend Imma crédible n’est pas seulement le visage : c’est
l’accord de **direction, dureté, température, exposition, profondeur et grain**
entre le sujet et l’arrière-plan. Une découpe parfaite reste fausse si le
visage reçoit une lumière chaude à droite alors que le décor impose un ciel
froid à gauche.

### 5.1 Le passeport lumière

Créer pour chaque motif un sidecar `*.light.json` :

```json
{
  "decorId": "ambre-sakura-03",
  "time": "matin couvert sous pluie fine",
  "keyKelvin": 6600,
  "keyAzimuthDeg": -35,
  "keyElevationDeg": 45,
  "keySoftness": "large_diffuse",
  "fillRatioStops": -1.0,
  "practicalKelvin": null,
  "backgroundExposureIre": 55,
  "shadowTint": "blue_green_low",
  "windDirection": "none",
  "cameraMotion": "slow_parallax_right",
  "depthOfField": "medium",
  "grain": "fine_35mm_subtle"
}
```

Les valeurs Kelvin de cette étude sont des **cibles de travail**, pas des
métadonnées de caméra : les vidéos générées n’en fournissent pas. Elles
doivent être validées à l’œil et par échantillonnage sur la keyframe choisie.

### 5.2 Procédure reproductible en huit étapes

1. **Choisir la prise avant le portrait.** Extraire la keyframe exacte du
   moment où Ambre sera incrustée.
2. **Mesurer le décor.** Relever blanc dominant, noirs, hautes lumières,
   teinte des ombres et direction des ombres portées ; remplir le passeport.
3. **Créer trois masters au maximum par tenue.** Exemple T05 : matin, pluie,
   crépuscule. Ne pas essayer de corriger un unique portrait sur six régimes
   lumineux incompatibles.
4. **Éclairer ou relighter Ambre avec la keyframe comme référence.** La source
   principale doit rester dans un cône de **±15°** par rapport au décor.
5. **Faire le compositing physique.** Spill de couleur très léger, ombre de
   contact, occlusion au sol, netteté et profondeur de champ conformes au
   plan ; aucun halo clair sur cheveux ou vêtement.
6. **Faire le match colorimétrique en deux passes.** D’abord exposition,
   contraste et balance ; ensuite seulement saturation sélective et
   harmonisation des ombres.
7. **Ajouter le défaut commun.** Même grain, compression, flou de mouvement
   et éventuelle aberration légère sur Ambre et le décor. Un sujet trop propre
   révèle le montage.
8. **Contrôler au mouvement.** Lecture à 100 %, 50 % et image par image sur
   cheveux, épaules, tissu ajouré, ombre de chapeau et reflets mouillés.

### 5.3 Seuils de QC proposés

- écart de direction de key : **≤ 15°** ;
- écart de température : **≤ 500 K** en jour, **≤ 300 K** en intérieur chaud ;
- différence de niveau des noirs sujet/décor : **≤ 5 IRE** ;
- liseré de détourage visible à 200 % : rejet ;
- ombre de contact absente sur un plan en pied : rejet ;
- cheveux ou vêtement bougeant à contre-vent : rejet ;
- peau contaminée par vert végétal ou orange de cheminée : corriger
  localement, sans neutraliser tout le décor.

### 5.4 Règle de montage

Une même apparition d’Ambre ne traverse pas deux lumières incompatibles. Si la
séquence passe de l’aube extérieure au feu intérieur, elle passe aussi d’un
master portrait à l’autre. Le raccord se masque avec un détail de matière ou
un plan de décor, ce qui transforme une contrainte technique en grammaire de
chaîne.

---

## 6. Grille de publication sur 12 mois

Période : **août 2026 → juillet 2027**. Cadence soutenable :

- **1 destination par mois** ;
- **1 Film habillé**, puis **1 Carnet** construit sur le même pack ;
- aucun troisième contenu obligatoire ; les extraits verticaux viennent des
  deux plans 9:16 du pack, sans nouvelle production lourde ;
- au lancement seulement, publier trois Films habillés avant le premier
  Carnet, conformément à la ligne éditoriale validée.

| Mois | Destination | Tenue canonique | Statut | Angle émotionnel et saisonnier |
|---|---|---|---|---|
| août 2026 | Zanzibar, saison sèche | N04 ensemble tropical couvrant | tenue + décor à créer P0 | « L’ombre blanche de Stone Town » — fraîcheur et lenteur, plage séparée de la ville |
| septembre 2026 | Édimbourg | T08 velours cognac | décor spécifique P0 | « La pierre garde la chaleur » — rentrée, livres, pluie et feuilles |
| octobre 2026 | Charlevoix | N06 manteau laine mousse | tenue + décor à créer | « Là où le fleuve devient cuivre » — pic moyen fin sept./début oct. |
| novembre 2026 | Kanazawa | T06 kimono-manteau rouille | décor à créer P0 | « Le jardin après l’érable » — feuillages mi-oct./fin nov. |
| décembre 2026 | Laponie | N03 manteau grand froid | tenue + décor à créer | « La lumière ne disparaît pas » — neige, bleu polaire, sans emprunt sámi |
| janvier 2027 | Alpes suisses | T01 pull torsadé crème | prêt, CH existants | « Le matin derrière le givre » — valorise immédiatement les actifs existants |
| février 2027 | Martinique | T15 paréo sauge, plage/jardin | décor à créer | « Le jardin avant la chaleur » — carême, pluie brève et lumière douce |
| mars 2027 | Marrakech | N01 robe-chemise argile | tenue + décor à créer | « L’ombre est une matière » — printemps, patio et agrumes |
| avril 2027 | Kyoto, sakura | T05 kimono traditionnel contextualisé | prêt, SA existants | « Ce que les fleurs ne gardent pas » — publier selon prévision annuelle réelle |
| mai 2027 | côte amalfitaine | T14 robe longue fluide | décor à créer | « Le soir descend les terrasses » — avant la saturation de juillet-août |
| juin 2027 | Provence | N05 robe midi lavande | tenue + décor à créer | « Une couleur avant la récolte » — confirmer floraison et altitude |
| juillet 2027 | Hokkaidō, Furano | N08 ensemble bleu grisé | tenue + décor à créer | « L’été qui reste frais » — lavande autour de la mi-juillet |

Cette cadence donne **24 publications principales par an** mais seulement
**12 unités créatives**. Le couple Film/Carnet partage recherche, décor,
tenue, miniature et étalonnage. C’est la régularité d’une collection, pas le
volume, qui construit l’attente.

---

## 7. Sources web et critères de révision

Consultation : **28 juillet 2026**.

### Comportement de recherche

- [Expedia Group, Travel Trends Q2 2025 — fenêtres de recherche à 91–180 jours](https://partner.expediagroup.com/en-us/resources/blog/q2-2025-travel-trends-insights)
- [Expedia Group, Traveler Value Index 2025 — 11 000 répondants, 11 marchés](https://partner.expediagroup.com/en-us/resources/research-insights/2025-traveler-value-index)
- [Think with Google France — Destination Insights et saisonnalité de la demande](https://www.thinkwithgoogle.com/intl/fr-fr/insights/parcours-consommateur/voyage-tourisme-renouvellement-secteur/)

### Europe et Japon

- [Visit Finland, aurores — mis à jour en avril 2026](https://www.visitfinland.com/en/articles/the-best-times-to-see-northern-lights/)
- [VisitScotland, automne 2026](https://www.visitscotland.com/travel-planning/when-to-visit/autumn)
- [Provence Guide, saison de la lavande](https://www.provenceguide.co.uk/unmissable/lavender/)
- [Kyoto Prefecture, calendrier officiel des cerisiers 2026](https://www.kyototourism.org/en/cherryblossoms/)
- [Kyoto Tourist Information Center, liste 2025 des loueurs de kimono membres de l’association touristique](https://global.kyoto.travel/resource/global/download/8-pdf.pdf)
- [JNTO, guide des ryokan et usage du yukata par les clients](https://www.japan.travel/en/guide/japanese-ryokan/)
- [Visit Kanazawa, guide septembre–novembre](https://visitkanazawa.jp/en/know-before-you-go/detail_71.html)
- [Hokkaido Tourism, saison de la lavande — 2026](https://visit-hokkaido.org/planyourtrip/when-to-visit/)
- [Visit Korea, floraisons de Jeju — guide 2026](https://english.visitkorea.or.kr/svc/contents/contentsView.do?menuSn=219&vcontsId=1580801)
- [Amalfi Travel, quand visiter la côte](https://www.amalfi.travel/en/when-to-visit-amalfi-coast)
- [Portugal Tourism, climat de l’Algarve](https://www.visitportugal.com/en/content/best-algarve)

### Afrique et Amériques

- [Office national marocain du tourisme, climat et saisons](https://www.visitmorocco.com/en/travel-info/climate-and-seasons)
- [Seychelles Tourism, meilleures périodes](https://www.seychelles.com/travelinfo/travelinformation)
- [Zanzibar Commission for Tourism, saison sèche](https://zanzibartourism.go.tz/when-to-go)
- [Cape Town Tourism, septembre–octobre et début du printemps — 2026](https://www.capetown.travel/the-best-time-of-year-to-visit-cape-town/)
- [Martinique Tourisme, avril et fin du carême — 2025](https://www.martinique.org/en/blog/highlights/i-love-martinique-april)
- [Bonjour Québec, prévision des couleurs — 2025](https://www.bonjourquebec.com/en-ca/blog/tips/fall-colours-peak-forecasts)
- [Visit Argentina, lacs de Patagonie](https://www.argentina.travel/en/activities/patagonia-lakes)

### Océanie

- [Discover Tasmania, saisons](https://production.tourismtasmania.com.au/planning/seasons/)
- [Tourism New Zealand, printemps de septembre à novembre](https://www.newzealand.com/uk/feature/discover-spring-in-new-zealand/)

### Révision annuelle obligatoire

En janvier de chaque année :

1. relever à nouveau les fenêtres de recherche France si Google Trends est
   exportable ;
2. mettre à jour floraisons, feuillages, saisons sèches et enneigement ;
3. déplacer le Film si le phénomène avance ou recule ;
4. conserver le Carnet 3 à 6 mois avant la période de départ ;
5. ne jamais dater un décor généré comme preuve de conditions réelles.

---

## Annexe A — fichiers physiques des décors

**Instantané du 28 juillet 2026 à 14:16:15 CEST : 90 vidéos et
90 `.meta.json`.** La campagne Flow lancée dans un autre processus était
encore active ; ce nombre peut donc augmenter après cet instantané. Aucun
fichier n’a été généré, modifié ou interrompu pour la présente étude.

Chaque nom ci-dessous désigne le couple `ambre-NNN.mp4` +
`ambre-NNN.mp4.meta.json`.

- **ambre-chalet-01** : `ambre-001`, `ambre-023`, `ambre-047`, `ambre-070`
- **ambre-chalet-02** : `ambre-002`, `ambre-024`, `ambre-048`, `ambre-071`
- **ambre-chalet-03** : `ambre-003`, `ambre-025`, `ambre-049`, `ambre-072`
- **ambre-chalet-04** : `ambre-004`, `ambre-026`, `ambre-050`, `ambre-073`
- **ambre-chalet-05** : `ambre-005`, `ambre-027`, `ambre-051`, `ambre-074`
- **ambre-chalet-06** : `ambre-006`, `ambre-028`, `ambre-052`, `ambre-075`
- **ambre-sakura-01** : `ambre-007`, `ambre-029`, `ambre-076`
- **ambre-sakura-02** : `ambre-008`, `ambre-030`, `ambre-053`, `ambre-077`
- **ambre-sakura-03** : `ambre-009`, `ambre-031`, `ambre-054`, `ambre-078`
- **ambre-sakura-04** : `ambre-010`, `ambre-032`, `ambre-055`, `ambre-079`
- **ambre-sakura-05** : `ambre-011`, `ambre-033`, `ambre-056`, `ambre-080`
- **ambre-sakura-06** : `ambre-012`, `ambre-034`, `ambre-057`, `ambre-081`
- **ambre-cocoon-01** : `ambre-013`, `ambre-035`, `ambre-058`, `ambre-082`
- **ambre-cocoon-02** : `ambre-036`, `ambre-059`, `ambre-083`
- **ambre-cocoon-03** : `ambre-014`, `ambre-037`, `ambre-060`, `ambre-084`
- **ambre-cocoon-04** : `ambre-015`, `ambre-038`, `ambre-061`, `ambre-085`
- **ambre-cocoon-05** : `ambre-016`, `ambre-039`, `ambre-062`, `ambre-086`
- **ambre-cocoon-06** : `ambre-017`, `ambre-040`, `ambre-063`, `ambre-087`
- **ambre-europe-01** : `ambre-018`, `ambre-041`, `ambre-064`, `ambre-088`
- **ambre-europe-02** : `ambre-019`, `ambre-042`, `ambre-065`, `ambre-089`
- **ambre-europe-03** : `ambre-020`, `ambre-043`, `ambre-066`, `ambre-090`
- **ambre-europe-04** : `ambre-021`, `ambre-044`, `ambre-067`
- **ambre-europe-05** : `ambre-022`, `ambre-045`, `ambre-068`
- **ambre-europe-06** : `ambre-046`, `ambre-069`
