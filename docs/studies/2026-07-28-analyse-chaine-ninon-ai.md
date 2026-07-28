# Analyse transversale de la chaîne Ninon AI

Date d’observation : **28 juillet 2026**. Corpus : **61 Shorts** publiés du
15 septembre 2025 au 27 juillet 2026, inventoriés sans API YouTube payante avec
`yt-dlp 2026.06.09`. Les vues sont un instantané de collecte : elles comparent
des ordres de grandeur, mais ne neutralisent ni l’ancienneté, ni la distribution
algorithmique, ni la taille de l’audience au moment de la publication.

Cette étude est le pendant court de
[`2026-07-28-analyse-chaine-vision-ia.md`](2026-07-28-analyse-chaine-vision-ia.md).
Vision IA fournit à Lisa la grammaire des formats longs ; Ninon fournit la
grammaire des formats courts.

## Résultat en une phrase

Ninon ne construit pas d’abord ses Shorts autour d’un titre YouTube. Elle
construit une **preuve visible commentée par un visage qui ne quitte presque
jamais l’écran** : une affirmation de rupture dans les trois premières
secondes, du B-roll qui change pendant que Ninon explique, des sous-titres
karaoké mot à mot, une conséquence plus large, puis une signature ou une
question.

Pour Lisa, le format à retenir est donc bien l’**écran partagé avec Lisa de
face**, mais avec une correction importante : le visage ne doit pas simplement
occuper la moitié basse en plein cadre. Chez Ninon, il est souvent posé dans une
carte verticale arrondie, sur fond noir, pendant que la preuve occupe la partie
haute.

## Identité de la chaîne

La chaîne analysée est sans ambiguïté :

- le [site officiel de Ninon](https://ninonia.fr/) renvoie directement vers
  la [chaîne `@ninon.ia_officiel`](https://www.youtube.com/@ninon.ia_officiel) ;
- `yt-dlp` résout ce handle en chaîne **Ninon**, ID stable
  `UC7YlZ_sxWH-Qco-pvpngYtg`, description « Décrypter le pouvoir derrière
  l’intelligence artificielle » ;
- [Lumni emploie le même handle](https://www.youtube.com/watch?v=H-rnD8QzdZw)
  dans ses titres avec Ninon ;
- les recherches « Ninon AI », « Ninon IA », « Ninon.ia » et « Ninon
  intelligence artificielle » ne font ressortir aucun homonyme crédible dans
  cette niche.

Au 28 juillet 2026, `yt-dlp` expose environ **14 400 abonnés YouTube**. Ce
nombre ne doit pas être confondu avec l’audience cumulée annoncée par Ninon sur
l’ensemble de ses réseaux.

## Méthode et limites

L’inventaire a interrogé séparément les onglets `/videos`, `/shorts` et
`/streams` de la chaîne. Seul `/shorts` existe : il contient 61 identifiants
uniques. Pour chaque entrée ont été relevés le titre, l’horodatage, la durée,
les vues, les likes, les commentaires et les caractéristiques du flux livré par
YouTube.

Commandes d’inventaire, sous leur forme reproductible :

```bash
yt-dlp --flat-playlist --dump-single-json \
  'https://www.youtube.com/channel/UC7YlZ_sxWH-Qco-pvpngYtg/shorts'
yt-dlp --ignore-errors --skip-download --dump-json \
  'https://www.youtube.com/channel/UC7YlZ_sxWH-Qco-pvpngYtg/shorts'
```

Dix Shorts ont ensuite été téléchargés en 1080 × 1920 avec leurs sous-titres
automatiques français. Les mesures techniques utilisent :

- `ffprobe 6.1.1` pour la durée, la définition, la cadence et les flux ;
- `ffmpeg 6.1.1` pour les planches-contact, le niveau sonore et la détection de
  changements visuels ;
- un seuil reproductible `scene > 0,20` pour les coupes franches ;
- une inspection image par image des trois premières secondes et dix images
  réparties sur chaque vidéo ;
- les sous-titres automatiques `json3`, avec horodatage des mots, pour la
  première phrase, la structure et la chute.

Le détecteur de scène compte un **nouvel état visuel**, donc une coupe de B-roll
dans la moitié haute peut compter comme un nouveau plan même si le visage reste
continu en bas. Les fondus ou recadrages très doux sous le seuil peuvent au
contraire lui échapper. C’est la définition la plus utile pour mesurer ce que
perçoit un spectateur de Short en écran partagé.

La police exacte des sous-titres est incrustée dans les pixels : sa famille ne
peut pas être certifiée. Les indications de taille et de famille ci-dessous
sont des mesures visuelles, pas des métadonnées de projet.

## 1. Le corpus

### Volume, période et cadence

| Fenêtre arrêtée au 28 juillet 2026 | Vidéos | Cadence |
|---|---:|---:|
| Corpus, 316 jours / 45,1 semaines | 61 | **1,35/semaine** |
| 365 derniers jours | 61 | **1,17/semaine** |
| 180 derniers jours | 11 | **0,43/semaine** |
| 90 derniers jours | 1 | **0,08/semaine** |
| Phase active, 15 sept. 2025–30 mars 2026 | 60 | **2,13/semaine** |

La moyenne globale masque deux régimes. Ninon publie 60 Shorts en 197 jours,
puis observe **119 jours sans publication** entre le 30 mars et le 27 juillet
2026. Le Short du 27 juillet est une collaboration commerciale avec Mammouth
AI. Il ne faut donc pas présenter la cadence actuelle comme deux vidéos par
semaine : c’était la cadence de la phase active, pas celle des 90 derniers
jours.

La production est aussi très groupée. Sur les 22 semaines comportant au moins
une publication, la médiane est de 2 Shorts, mais deux semaines montent à 10 et
11. Huit dates comportent deux ou trois publications le même jour. Cela
ressemble davantage à des vagues de republication sociale qu’à un rendez-vous
YouTube régulier.

### Shorts contre vidéos longues

- **61 Shorts, 100 % du corpus** ;
- **0 vidéo longue** et **0 live** dans les onglets publics de cette chaîne ;
- durée médiane : **53 s** ;
- durée moyenne : **55,9 s** ;
- extrêmes : **28 à 96 s** ;
- 42 vidéos durent au plus 60 s, 19 dépassent 60 s, dont 2 dépassent 90 s.

Le classement par format vient de l’onglet YouTube, pas d’une règle arbitraire
à 60 secondes. Une vidéo verticale de 92 ou 96 secondes reste ici un Short.

### Jours et heures de publication

Les horaires sont convertis en heure de Paris à partir du timestamp YouTube.

| Jour | Publications |
|---|---:|
| Lundi | 6 |
| Mardi | 8 |
| Mercredi | 6 |
| **Jeudi** | **14** |
| **Vendredi** | **11** |
| Samedi | 6 |
| Dimanche | 10 |

Jeudi et vendredi concentrent 25 publications sur 61, soit **41 %**, mais les
sept jours sont utilisés. Les horaires n’obéissent pas à un créneau unique :
19 publications entre 9 h et 10 h, 18 entre 12 h et 14 h, et 10 entre 21 h et
22 h. Les trois blocs matin, milieu de journée et soirée comptent chacun 18 ou
19 publications. La donnée ne justifie donc pas de décréter une « heure Ninon »
universelle.

## 2. La formule éditoriale

### Les titres

Sur les 61 titres exposés par YouTube :

- moyenne **61,5 caractères**, médiane **64** ;
- moyenne **10,6 mots**, médiane **11** ;
- 4 questions ;
- 11 titres avec un chiffre ;
- 12 contiennent le caractère deux-points, dont une URL et un émoticône ;
- 12 avec au moins un hashtag ;
- 24 avec au moins un mot entièrement en capitales, mais ce décompte est
  dominé par les acronymes IA, AI et LLM et ne prouve pas une capitalisation
  agressive ;
- 5 commencent ou reposent sur « comment » ;
- 10 contiennent une promesse pratique personnelle : « comment », « je vous
  explique », « à copier », « hacks », « t’aider » ;
- 4 formulent explicitement une opposition ;
- seulement 1 emploie « vient de » dans le titre.

La donnée la plus importante est l’**absence de discipline uniforme**. Trois
titres ne sont qu’une date, deux ne sont qu’un ou plusieurs hashtags, plusieurs
reprennent une légende Instagram et un titre atteint la limite de 100
caractères en étant coupé. `#gemini3` fait 60 299 vues ; « 12 novembre 2025 »
en fait 30 525. Pour un Short distribué dans le flux, la première seconde de
vidéo joue ici un rôle éditorial plus fort que le champ titre.

Les patrons utiles existent néanmoins :

```text
[Acteur] vient de [rupture] : [conséquence]
Comment [éviter un risque / accomplir une migration]
[Objet visible] est fake : je vous le prouve
Vous laisseriez [innovation concrète] chez vous pour [prix] ?
Pendant que certains [peur], d’autres [preuve spectaculaire]
On vient de passer un cap avec [outil]
[Technologie] est virale, je vous explique pourquoi
```

L’urgence, l’opposition et la promesse sont beaucoup plus systématiques dans la
**phrase prononcée** que dans le titre YouTube.

### Les 15 titres les plus vus

Vues relevées le 28 juillet 2026 :

| Rang | Titre | Vues |
|---:|---|---:|
| 1 | [OK google est clairement en train d’inonder le marché avec ses outils d’ia](https://www.youtube.com/shorts/coFbqbpC4DM) | **130 534** |
| 2 | [Attentions à ces vidéos fake ⚠️](https://www.youtube.com/shorts/4LuoKBkv7WY) | **105 750** |
| 3 | [On vient de passer un cap avec Kling Motion Control (vidéo non sponsorisée)](https://www.youtube.com/shorts/SwnzZBnQz1o) | **99 628** |
| 4 | [#gemini3](https://www.youtube.com/shorts/nbXhQLrBsqk) | **60 299** |
| 5 | [Moltbot est viral sur internet depuis sa jours et je vous explique pourquoi](https://www.youtube.com/shorts/NE2lIxjHekI) | **51 205** |
| 6 | [12 novembre 2025](https://www.youtube.com/shorts/3J2yAdndbYQ) | **30 525** |
| 7 | [Vous laisseriez un robot dans votre maison pour 500e/mois ? #neo](https://www.youtube.com/shorts/ZfK6o7Gn15g) | **27 907** |
| 8 | [Comment détecter une photo faite avec l’IA #gemini #nanobanana](https://www.youtube.com/shorts/xW6m37tab-8) | **25 226** |
| 9 | [La super intelligence](https://www.youtube.com/shorts/Tv_dyVyzKBQ) | **22 203** |
| 10 | [6 mars 2026](https://www.youtube.com/shorts/IzMgZo1q_N8) | **21 523** |
| 11 | [Perplexity AI : L’outil qui peut TUER Google ? Perplexity, c’est Google en version intelligente](https://www.youtube.com/shorts/qPkybDm0Fz0) | **21 396** |
| 12 | [La meilleure pub de l’année est là, et elle est française.](https://www.youtube.com/shorts/lg7vF9UjMEI) | **21 285** |
| 13 | [Les arnaques sur les réseaux sociaux…et l’IA !](https://www.youtube.com/shorts/Cva5Xn7KKlI) | **21 018** |
| 14 | [Dispatch de Claude !](https://www.youtube.com/shorts/k8qyNYRaHlQ) | **20 756** |
| 15 | [Pendant que certains craignent l’IA, d’autres la poussent à générer des films entiers en 1080p](https://www.youtube.com/shorts/8H4tphcyH78) | **19 495** |

La médiane du corpus est de 13 100 vues. Il est impossible d’attribuer
causalement les écarts au titre seul : le record est ancien, tandis que le
Short du 27 juillet n’avait qu’environ un jour d’exposition lors de la mesure.

### L’accroche : les trois premières secondes

Les dix cas ci-dessous ont été contrôlés à 0,10 s, 1,20 s et 2,80 s, puis
transcrits au mot près.

| Short | Première image à 0,10 s | Première phrase | Texte avant 3 s |
|---|---|---|---|
| Google/Jules/Stitch | Ninon plein cadre, regard caméra | « Google n’a pas simplement sorti des intelligences artificielles, il a tué des centaines de start-ups. » | Oui : titre haut « GOOGLE IA : LA MORT DES START-UPS » puis sous-titres |
| NEO | mains de robot en haut, Ninon face caméra en bas | « Ce qu’on ne voyait que dans les films vient officiellement de rentrer dans nos vies. » | Oui, mot à mot dès l’ouverture |
| Gemini 3 | archives Google en haut, carte visage en bas | « Google vient officiellement de lancer Gemini 3. […] c’est une dinguerie monumentale. » | Oui, « Google » apparaît vers 0,25 s puis la phrase se construit |
| Détection d’image IA | image trompeuse en haut, Ninon en bas | « Repérer une image faite avec une intelligence artificielle aujourd’hui, c’est presque devenu impossible. » | Oui |
| Superintelligence | tête cybernétique en haut, Ninon en bas | « Ça y est, l’intelligence artificielle supérieure arrive. Pas pour vos enfants, pour vous. » | Oui |
| Kling Motion Control | fausse vidéo d’une femme en fond, Ninon en médaillon | « Coucou mon amour, tu peux m’envoyer de l’argent sur Revolut ? » | Oui, texte de la fausse scène ; Ninon laisse d’abord parler la preuve |
| Moltbot | identité visuelle de Moltbot en haut, Ninon en bas | « Tout le monde parle de cette nouvelle intelligence artificielle. » | Oui |
| Fausse archive | enfant filmée façon années 1980 en haut, Ninon en bas | « Cette vidéo d’une enfant qui parle du futur dans les années 80 est 100 % fake. » | Oui, plus un tampon rouge « FAKE » avant 3 s |
| Claude Dispatch | zoom flou très bref puis Ninon plein cadre | « Claude vient de lancer quelque chose qui est en train de faire transpirer ChatGPT. » | Oui |
| Kimi K3 | Trump au bureau en haut, Ninon en carte basse | « OK, retenez bien la date d’aujourd’hui. » | Oui, dès le premier mot |

Le dispositif est constant : **une personne, une entité ou une preuve visuelle
est déjà là à la première image**, et la voix ouvre une boucle avant que le
spectateur ait eu le temps de balayer. Il n’y a ni générique, ni salut, ni
présentation préalable de Ninon.

La première phrase emploie quatre leviers :

1. une bascule accomplie : « vient de », « ça y est », « officiellement » ;
2. une conséquence personnelle : « pour vous », « dans nos vies » ;
3. une impossibilité ou un danger visible : fake, arnaque, image indétectable ;
4. une autorité ou un acteur connu : Google, Claude, États-Unis, Trump.

### La structure récurrente

Le schéma dominant n’est pas exactement « problème → démonstration → chute ».
Il s’agit plutôt de :

```text
rupture visible → mécanisme concret → preuves/exemples → conséquence →
question, promesse suivante ou signature
```

Sur les dix transcriptions :

1. **0:00–0:03 — rupture.** La thèse est compréhensible sans contexte.
2. **0:03–0:10 — boucle et enjeu.** Ninon nomme l’outil, le prix, le risque ou
   la promesse. Neuf vidéos entrent dans l’explication entre 5 et 11 secondes.
3. **0:10–0:40/0:70 — mécanisme et preuves.** Fonctionnalités, captures,
   mini-test, chiffres et limites s’enchaînent. Le B-roll montre presque
   toujours ce que la phrase nomme.
4. **Dernier tiers — élargissement.** Le produit devient une question de
   confiance, d’emploi numérique, de géopolitique ou de rapport au réel.
5. **Dernières 4 à 10 s — chute et signature.** Le temps médian réservé à
   « Je m’appelle Ninon… » est d’environ 5 à 6 secondes.

Deux variantes méritent d’être conservées :

- **preuve avant explication** : le Short Kling joue trois fausses vidéos
  pendant 26 secondes, puis révèle l’outil ; l’accroche est la démonstration
  elle-même ;
- **thèse spéculative** : « La super intelligence » empile d’abord les
  échéances attribuées à plusieurs figures, puis termine par le choix
  « allié ou successeur ? ».

### La chute

Dans l’échantillon :

- 9 vidéos sur 10 terminent par la signature complète « Je m’appelle Ninon, je
  décrypte l’intelligence artificielle… » ; la collaboration Kimi K3 se limite
  à « Je m’appelle Ninon » ;
- 4 demandent explicitement de suivre ou de s’abonner ;
- 3 finissent leur argument par une question ;
- 2 ouvrent une suite : « prochaine vidéo » ou « je vais le tester en
  profondeur » ;
- les collaborations ou non-collaborations sont signalées avant la signature,
  mais pas toujours dès l’ouverture.

La chute n’est généralement pas un gag. C’est une **conversion de la thèse en
relation éditoriale** : suivre Ninon pour comprendre la prochaine bascule. Le
risque est la répétition mécanique de la même signature sur chaque vidéo.

## 3. La facture technique

### Mesures des dix Shorts

`Plans` signifie ici changements détectés à `scene > 0,20`, plus le premier
plan. La moyenne est calculée sur la durée complète.

| Short | Durée `ffprobe` | Plans | Durée/plan | Niveau intégré |
|---|---:|---:|---:|---:|
| Google/Jules/Stitch | 43,4 s | 21 | 2,07 s | −14,5 LUFS |
| NEO | 58,8 s | 23 | 2,56 s | −14,9 LUFS |
| Gemini 3 | 80,1 s | 39 | 2,05 s | −17,9 LUFS |
| Détection d’image IA | 62,9 s | 22 | 2,86 s | −15,4 LUFS |
| Superintelligence | 68,6 s | 8 | 8,57 s | −13,9 LUFS |
| Kling Motion Control | 44,5 s | 12 | 3,71 s | −24,2 LUFS |
| Moltbot | 57,0 s | 13 | 4,39 s | −20,8 LUFS |
| Fausse archive | 57,0 s | 19 | 3,00 s | −19,9 LUFS |
| Claude Dispatch | 47,8 s | 19 | 2,52 s | −22,7 LUFS |
| Kimi K3 | 92,3 s | 38 | 2,43 s | −23,9 LUFS |

Total : **612,4 s, 214 plans, soit 2,86 s par plan**. La médiane des moyennes
par vidéo est **2,71 s**. « La super intelligence » est un vrai contre-exemple :
elle reste sombre et posée avec des plans longs, sans empêcher 22 203 vues.
Ninon pratique donc un rythme vif, pas une obligation de couper toutes les deux
secondes.

Les dix flux observés sont tous :

- verticaux **1080 × 1920**, ratio 9:16 ;
- à **29,97 ou 30 i/s** ;
- audio 48 kHz stéréo dans le flux YouTube ;
- livrés par YouTube en AV1/Opus. Ces codecs décrivent la livraison, pas
  nécessairement le master envoyé.

### Le visage et l’écran partagé

La personne est **à l’écran dans les dix vidéos**, presque en permanence.

- **7/10** : écran partagé persistant, B-roll en haut, Ninon de face en bas ;
- **1/10** : Ninon en médaillon ou carte superposée à une preuve plein écran ;
- **2/10** : Ninon plein cadre comme base, avec inserts et cutaways.

Dans la variante la plus fréquente, le visage n’est pas une petite bulle ronde.
C’est une carte verticale occupant approximativement 55 à 75 % de la largeur et
35 à 50 % de la hauteur, centrée dans la moitié basse, avec coins arrondis et
gouttières noires. Ninon est cadrée poitrine ou taille, **strictement de face**,
yeux proches du tiers supérieur de sa carte. Ses mains restent visibles et
animent la parole.

Le B-roll supérieur est continu : captures d’interface, archives, posts,
articles, démonstrations, robots, dirigeants. Il change sans retirer Ninon. La
hiérarchie est claire : **le haut prouve, le bas explique**.

Le record du corpus, Google/Jules/Stitch, utilise toutefois Ninon plein cadre
avec des inserts. L’écran partagé est une signature fréquente et adaptée à la
demande de Patrice, pas une loi causale de performance.

### Sous-titres incrustés

Les dix Shorts ont des sous-titres incrustés :

- sans-serif géométrique grasse, proche de Poppins/Montserrat ; famille exacte
  non vérifiable depuis le raster ;
- blanc, avec ombre ou fin contour sombre ;
- environ **70 à 100 px de haut** sur un master 1080 × 1920 selon le mot actif ;
- généralement une ou deux lignes et 2 à 6 mots visibles ;
- position centrale, proche de la frontière B-roll/visage ou dans le haut de la
  carte visage, jamais collée au bas de l’écran ;
- **animation mot à mot par accumulation** : le nouveau mot apparaît plus gros
  ou plus gras, puis rejoint la phrase ; ce n’est pas une carte statique de
  quatre mots ;
- accents ponctuels : soulignement, italique de contraste, tampon « FAKE »,
  titre haut ou mot en capitales.

Une séquence contrôlée à 4 images/seconde sur Gemini 3 montre successivement
« Google » → « Google vient » → « Google vient officiellement » → la phrase
complète. C’est le détail technique le plus éloigné de l’implémentation
actuelle de `wrap-short.py`.

### Voix, musique et niveau sonore

La voix est principalement celle du visage présent à l’écran, pas une voix off
désincarnée. Le Short Kling fait exception pendant son cold open : des fausses
scènes parlent tandis que Ninon reste visible en réaction, puis elle reprend
l’explication.

Les sous-titres automatiques détectent explicitement `[musique]` dans 4 vidéos
sur 10 : NEO, Gemini 3, détection d’image et superintelligence. Une musique
discrète peut exister sous d’autres voix sans être reconnue par l’ASR ; sa
présence n’est alors pas vérifiable depuis le mix final seul. Aucun des dix
Shorts ne repose sur la musique pour remplacer l’explication.

Le niveau intégré va de **−24,2 à −13,9 LUFS**, médiane **−18,9 LUFS**. C’est
une dispersion de plus de 10 dB, et plusieurs décodages présentent un true peak
positif. Ninon n’offre donc pas un standard de mastering à copier. Pour Lisa,
la cible existante de −14 LUFS avec true peak à −1,5 dBTP est techniquement
plus cohérente.

## 4. Les sujets et la réactivité

### Thèmes récurrents

Une lecture non exclusive par lexique des 61 titres donne les tendances
suivantes. Ces groupes se recouvrent ; ils servent à comparer des familles, pas
à établir une taxonomie parfaite.

| Famille | Nombre | Vues médianes | Lecture |
|---|---:|---:|---|
| Outils, modèles et usages | 24 | **14 136** | Cœur de chaîne ; Google, ChatGPT, Claude, Gemini, agents, prompts |
| Médias synthétiques et authenticité | 20 | **11 658** | Deux énormes pics à 105 750 et 99 628 vues tirent la moyenne vers le haut |
| Société, gouvernance et futur | 12 | **8 785** | Plus abstrait, moins performant dans cet échantillon |
| Robotique / IA incarnée | 2 | **22 984** | Très visuelle, mais effectif trop faible pour généraliser |

Ce qui performe le mieux combine **objet visible + conséquence immédiatement
personnelle** :

- une vidéo d’archive est fausse ;
- une image n’est plus une preuve ;
- un robot entre dans la maison pour 500 € par mois ;
- un outil remplace une tâche de développeur ou de designer ;
- une IA agit sur l’ordinateur.

Les thèmes macro deviennent plus forts lorsqu’ils prennent corps. « La Chine
a gagné la course » reste à 8 074 vues ; Kimi K3, publié la veille de la
collecte, n’est pas encore comparable. À l’inverse, le risque de deepfake se
voit avant même d’être expliqué.

### Délai entre annonce et Short

| Sujet | Source datée | Publication Ninon | Délai observé | Vues |
|---|---|---:|---:|---:|
| NEO domestique | [1X, 28 oct. 2025](https://www.1x.tech/discover/neo-home-robot) | 30 oct. | **2 j** | 27 907 |
| Gemini 3 | [Google, 18 nov. 2025](https://blog.google/products-and-platforms/products/gemini/gemini-3/) | 20 nov. | **2 j** | 60 299 |
| Nano Banana Pro | [Google, 20 nov. 2025](https://blog.google/intl/es-419/actualizaciones-de-producto/informacion/nano-banana-pro/) | 21 et 26 nov. | **1 j / 6 j** | 16 339 / 25 226 |
| Kling Video 2.6 / Motion Control | [Kuaishou, version sortie le 3 déc. 2025](https://ir.kuaishou.com/news-releases/news-release-details/kling-ai-launches-video-26-model-simultaneous-audio-visual) | 2 janv. 2026 | **30 j** | 99 628 |
| Clawdbot renommé Moltbot | [historique officiel OpenClaw, 27 janv. 2026](https://github.com/openclaw/openclaw/blob/main/docs/start/lore.md) | 28 janv. | **1 j** | 51 205 |
| Claude Dispatch | [documentation officielle](https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork) ; date primaire exacte non affichée | 19 mars | **≈1 j**, d’après « sorti hier » et les publications contemporaines du 18 mars | 20 756 |
| Poids Kimi K3 | [commit initial, 27 juil. 2026 à 15:04 UTC](https://github.com/MoonshotAI/Kimi-K3/commit/521359a5cae5e79d02e5a2102c2cea9ce3b9b79a) | 27 juil. à 17:56 UTC | **2 h 52** | 1 800 à J+1 |

La réactivité est bien une composante de la formule : cinq des sept cas sont
traités en deux jours ou moins. Elle n’explique cependant pas tout.

Le record Google/Jules/Stitch est publié le 20 septembre 2025, alors que Jules
était [accessible à tous depuis le 6 août](https://blog.google/innovation-and-ai/models-and-research/google-labs/jules-now-available/)
et Stitch avait été annoncé à Google I/O en mai. Le retard est donc d’au moins
45 jours pour Jules et d’environ quatre mois pour Stitch, mais le Short atteint
130 534 vues. Une **bonne synthèse tardive avec test et opposition** peut battre
une réaction immédiate. La fraîcheur ouvre la fenêtre ; la preuve et la
formulation déterminent si la vidéo la transforme.

## 5. Ce qu’on reprend, ce qu’on adapte

### Règles opérationnelles pour les Shorts de Lisa

1. **Durée cible : 50 à 65 secondes.** C’est autour de la médiane Ninon de
   53 secondes et cela suffit pour une thèse, deux preuves et une conséquence.
   Monter à 75–90 secondes seulement pour une démonstration réellement
   progressive ou une collaboration à divulguer.
2. **Accroche 0–3 s : preuve + bascule + conséquence.** Première image déjà
   utile ; première phrase de 12 à 18 mots, sans « bonjour » : « Ce test vient
   de rendre les deepfakes beaucoup plus difficiles à repérer. »
3. **Structure : 3 / 10 / 45 / 60.** Thèse avant 3 s ; enjeu avant 10 s ;
   mécanisme et deux preuves jusqu’à 45–50 s ; implication, question ou suite
   dans les 10 dernières secondes.
4. **Lisa visible 85 à 100 % du temps.** Par défaut, B-roll en haut et Lisa
   poitrine/face en bas, dans une carte arrondie centrée. Passer Lisa plein
   cadre pendant 1 à 3 secondes pour une opinion, une limite ou la chute.
5. **Rythme visuel : viser 2,3 à 3,2 s par état visuel.** Changer la preuve, le
   cadrage ou l’échelle ; ne pas couper le visage à chaque fois. Autoriser un
   plan de 5 à 8 secondes lorsque l’interface ou la démonstration exige une
   lecture.
6. **Sous-titres : véritable karaoké mot à mot.** Blanc gras, mot actif plus
   gros, une ou deux lignes, centrées autour de la séparation des deux zones.
   Garder 2 à 6 mots lisibles, corriger manuellement les noms propres IA.
7. **B-roll synchronisé au nom prononcé.** L’image du haut change sur
   « Gemini », « benchmark », « prix », « faille » ou « test », pas sur une
   minuterie aveugle.
8. **Fin utile avant signature.** Question seulement si elle appelle un vrai
   choix ; sinon annoncer le prochain test. Réduire la signature de Lisa à
   2–4 secondes pour éviter de perdre 10 % d’un Short en autopromotion.
9. **Titres sobres mais explicites.** Ne pas copier les légendes tronquées de
   Ninon. Modèle Lisa : `[preuve ou objet] + [conséquence concrète]`, 45 à 75
   caractères. Le flux peut tolérer `#gemini3`, la bibliothèque de Lisa
   bénéficiera d’un titre durable.
10. **Cadence réaliste : 2 Shorts fixes par semaine + 1 slot réactif.** La
    phase active de Ninon vaut 2,13/semaine. Pour Lisa, deux productions
    planifiées et une réaction sous 24 h lorsque le sujet le justifie sont plus
    soutenables que les vagues de 10 à 11 publications. Si aucune annonce
    forte n’arrive, le troisième slot reste vide ou devient un test evergreen.

### Croisement avec les sept règles Ambre

L’étude
[`2026-07-28-douceur-et-retention.md`](2026-07-28-douceur-et-retention.md)
sépare justement la mécanique de rétention du registre. Cette séparation se
transpose à Lisa ; la douceur intégrale, non.

| Règle Ambre | Pour Lisa |
|---|---|
| Promesse dans les 3 premières secondes | **Conserver**, mais elle peut être verbale et plus tranchante. Lisa doit nommer la rupture, pas seulement montrer une belle image. |
| Arrivée → découverte → apogée → apaisement | **Remplacer** par rupture → mécanisme → preuve → conséquence → choix. |
| Plans de 2,5 à 3 s, mouvement interne lent | **Conserver la cadence**, pas l’obligation de lenteur interne. Une capture peut zoomer ou surligner rapidement si cela clarifie. |
| Aucun effet brutal, zoom ou bruitage | **Ne pas transposer mécaniquement.** Un punch-in ou un tampon « FAKE » est légitime en tech, à condition de signaler une preuve et non de surstimuler. |
| La musique porte le rythme | **Secondaire pour Lisa.** La diction, les changements de B-roll et le mot actif portent le rythme ; la musique reste basse. |
| Une tenue par destination | **Remplacer** par une preuve maison par Short : test, capture, résultat, coût ou limite. C’est la boucle de retour propre à Lisa. |
| Titres et miniatures sobres | **Conserver la crédibilité**, mais accepter une tension factuelle plus vive qu’Ambre. « Ce test trompe déjà les détecteurs » convient ; « LA FIN DU MONDE » non. |

Ce qui se transpose intégralement est la chaîne **promesse → tension →
récompense**, la variation visuelle et le refus des plans répétitifs. Ce qui ne
se transpose pas est le murmure, l’apaisement final et l’interdiction générale
des coupes sèches. Lisa traite une actualité technique : elle peut être vive
sans devenir agressive.

## 6. L’outillage existant et l’écart à combler

Cette section est un inventaire, pas une demande de réécriture. Aucun script
n’a été modifié pendant l’étude.

| Script | Ce qu’il sait déjà faire | Écart précis avec Ninon |
|---|---|---|
| `wrap-short.py` | Transcrit par Whisper avec mots horodatés ; corrige quelques noms propres ; incruste des cartes de sous-titres ; ajoute des cutaways ; propose `--layout split`, `--face-crop`, musique duckée et master −14 LUFS. | Le mode split remplit deux moitiés 1080 × 960 bord à bord : pas de carte visage étroite arrondie, pas de gouttières noires, pas d’alternance split/plein cadre. Les sous-titres sont des cartes statiques jusqu’à 4 mots, positionnées bas (`MarginV=180`), sans mot actif agrandi. Aucun contrôle de cadence ou de densité de B-roll. |
| `short-assemble.py` | Assemble des plans verticaux et narrations, ajoute fondus, carton titre, musique duckée et master −14 LUFS en 1080 × 1920. | Assembleur de trailer à quatre plans, sans visage persistant, sans split, sans sous-titres de parole, sans alignement d’un cut sur un mot. Le fondu systématique ne correspond pas aux coupes franches Ninon. |
| `add-sound.py` | Ajoute musique et ambiance synthétique à un clip muet ; choix de mood ; loudnorm deux passes à −14 LUFS / −1,5 dBTP. | Il sonorise un clip muet et ne mixe pas une voix de présentatrice existante avec musique/ducking. Il ne détecte ni parole, ni musique déjà présente, ni conformité du mix final d’un Short parlant. |
| `find-subjects.py` | Agrège Google News et neuf flux tech français ; filtre par fraîcheur ; dédoublonne ; applique les exclusions éditoriales ; fait classer des sujets sourcés ; demande hook ≤15 mots, plan en 3 temps et pourquoi. | Les sources restent majoritairement journalistiques/RSS : pas de recherche de source primaire, pas d’horodatage de l’annonce, pas de calcul du délai ni de SLA « publier sous 24 h ». Le plan en trois temps ne produit pas encore script minuté, preuve visuelle, limite, chute et liste de B-roll. |
| `heygen-batch.py` | Envoie un audio à HeyGen Presenter, force 1080p, collecte les rendus et rappelle le QC Whisper indispensable. | Il dépend du look sélectionné manuellement ; ne garantit pas un cadrage poitrine/face exploitable dans une carte basse ; ne génère ni manifest de correspondance audio/rendu, ni timeline, ni split, ni captions. La collecte ne matche pas automatiquement le rendu au script. |

### Ce qui manque pour atteindre le standard mesuré

Sans préjuger de l’implémentation, l’écart fonctionnel est le suivant :

1. un **layout Ninon réel**, avec B-roll haut, fond noir, carte Lisa arrondie et
   recadrage du visage contrôlé, plus des passages ponctuels en plein cadre ;
2. un moteur de **karaoké mot à mot** avec mot actif, et non des cartes de quatre
   mots ;
3. une timeline qui associe chaque preuve à un mot ou une proposition et
   maintient une cadence cible de 2,3 à 3,2 s ;
4. un script éditorial minuté : hook 0–3 s, enjeu 3–10 s, deux preuves, limite,
   conséquence, chute ;
5. une collecte de **sources primaires datées** et un calcul automatique du
   délai annonce → sujet ;
6. un contrôle qualité automatique : durée, 1080 × 1920, visage dans la zone,
   sous-titres hors interfaces YouTube, nombre de plans, noms propres, LUFS et
   true peak ;
7. un manifest déterministe audio HeyGen → texte → clip, au lieu d’un
   rapprochement manuel après collecte ;
8. une politique de B-roll distinguant capture maison, source officielle,
   archive sous droit, contenu tiers crédité et média généré.

Les briques principales existent déjà. Ce qui manque n’est pas un nouvel outil
de génération payant, mais une **couche d’orchestration, de composition et de
QC** fidèle à la grammaire mesurée.

## Décision pour Lisa

Le standard court recommandé est :

```text
50–65 s · 1080×1920 · 30 i/s
B-roll haut 45–55 % · carte Lisa face caméra en bas 35–50 %
preuve visible dès l’image 1 · phrase de rupture avant 3 s
20–26 états visuels · 2,3–3,2 s par état en moyenne
sous-titres karaoké 1–2 lignes · mot actif agrandi
2 preuves + 1 limite + 1 conséquence
signature 2–4 s · −14 LUFS / −1,5 dBTP
2 Shorts fixes/semaine + 1 slot réactif sous 24 h
```

La promesse propre de Lisa ne doit pas être « Lisa répète plus vite l’annonce »,
mais **« Lisa montre ce que l’annonce change réellement »**. C’est la jonction
la plus solide entre le média de tension/résolution appris de Vision IA et la
preuve courte, incarnée et immédiatement lisible apprise de Ninon.
