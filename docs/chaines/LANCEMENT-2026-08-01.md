# Archive — lancement des deux chaînes au matin du 1er août 2026

> **Document historique remplacé.** Il évalue Meta AI v1 et un état AMBRE
> antérieur aux corrections et contrôles du 1er août. Ses injonctions de
> publication et son ordre de lancement ne sont plus opérationnels. La source
> canonique est [`../lancement-chaines/ETAT-2026-08-01.md`](../lancement-chaines/ETAT-2026-08-01.md) :
> Meta v2 et « 5 signaux » v4 passent techniquement, le chalet v02 a son kit,
> les Shorts ont été contrôlés, et aucune publication n'est autorisée sans les
> décisions et gestes humains qui y sont listés.

Rédigé pendant que tu dors, pour que le lancement annoncé sous deux jours ne
bute sur rien d'imprévu. Tout ce qui suit est vérifié dans les fichiers, pas
déduit.

---

## 1. Ce que tu as à faire, et personne d'autre

| Geste | Durée | Ce qu'il débloque |
|---|---|---|
| Créer la chaîne **LISA IA** | 10 min | Tout le reste |
| Créer la chaîne **AMBRE** | 10 min | Tout le reste |
| Coller les deux URL de chaîne dans la description de la 1re vidéo | 2 min | La publication de la vidéo longue |
| Déclarer le **contenu synthétique** sur les deux chaînes | 5 min | Obligation YouTube, et notre engagement d'intégrité |

Les visuels sont prêts : `~/.codebuddy/media-video/identite-chaines/`
— avatar 800×800 et bannière 2560×1440 pour chacune, texte contraint dans la
zone 1546×423 visible sur mobile.

---

## 2. LISA IA — la première vidéo est prête

`~/.codebuddy/longform/meta-ai-agit-a-votre-place/`

**« Meta AI ne répond plus : il agit à votre place »** — 11 min 15, 7 chapitres.

Ce qui a été **mesuré**, pas supposé :

- MP4 H.264, 1920×1080, 30 i/s constants, 20 259 images ;
- **−14,05 LUFS** intégrés, **−1,38 dBTP** de pic vrai — la cible YouTube est
  −14 LUFS, on est dessus ;
- durée 675,300 s ; la somme des 13 sections moins les 12 fondus donne
  675,270 s, soit **30 millisecondes d'écart** ;
- décodage intégral ffmpeg sans une erreur ;
- 4 alertes de détection de noir, **les 4 inspectées** : animation du logo Meta
  sur fond sombre et B-roll spatial. Aucun plan noir accidentel ;
- 7 chapitres conformes aux trois règles YouTube (premier à 00:00, ordre
  croissant, minimum 10 s — le plus court fait 17 s).

Le kit est complet : 3 miniatures 1280×720, titres, description, 15 mots-clés,
sous-titres SRT.

**Le seul blocage** : `description.txt` contient `[[URL_CHAINE_LISA]]` et
`[[URL_AUTRES_VIDEOS_LISA]]`. Ces URL n'existent pas tant que la chaîne n'existe
pas — elles n'ont donc **pas été inventées**, elles attendent. Cherche `[[` avant
de publier.

Miniature recommandée : `miniature-01-promesse.jpg` (visage extrait du master à
00:14, regard assuré, bouche fermée). À revoir une dernière fois à taille
téléphone dans `planche-comparaison-miniatures.jpg`.

---

## 3. AMBRE — le stock existe, la validation identité est en cours

102 vidéos dans `~/.codebuddy/media-video/ambre-automne/`, alimentées par les
composites de décors.

⚠️ **Ne rien publier avant la fin du travail en cours.** Sur les 38 composites
qui nourrissent ces vidéos, **14 sont en rejet**, dont 12 pour dérive
d'identité — le visage n'est plus celui d'Ambre. Le pire descend à **0,105**
là où le seuil est 0,55.

La cause est identifiée et se répare : la chaîne qui préserve l'identité est
celle qui ne laisse jamais le modèle re-rendre le visage. Les réparations de
garde-robe, qui masquent et recomposent, tiennent **0,91 à 0,92**. darkstar y
travaille, ses deux GPU sont à 98 %.

Deux images de plus, `ambre-037` et `ambre-038`, ne sont **pas évaluées** : le
juge visuel était indisponible. Ce n'est pas un défaut d'image, c'est un contrôle
absent — elles restent hors publication tant qu'elles n'ont pas été jugées.

---

## 4. Les bandes-annonces — ce qui est interdit, avec la preuve

37 dossiers de trailers existent. Le compte réel des chapitres écrits, par
roman, tranche la question :

| Roman | Chapitres écrits | Trailer existant | Verdict |
|---|---:|:---:|---|
| L'Algorithme de Babel | 82 fichiers | oui | Livre réel, **mais noté 4,0/10** |
| Le Royaume Latent | 54 | oui | Livre réel, **6,2/10** |
| Les Gardiens du Seuil | 48 | oui | Livre réel, **6,5/10 — le plus proche** |
| Les Échos de Kepler 442 | 26 | oui | Livre réel, **3,8/10** |
| **Mémoire Noire** | **1** | oui | ⛔ |
| **Les Seigneurs de l'Énergie** | **1** | oui | ⛔ |
| **Les Nomades du Néant** | **1** | oui | ⛔ |
| **Les Héritiers de la Singularité** | **1** | oui | ⛔ |
| **Le Dernier Prompt** | **1** | oui | ⛔ |
| **L'Éclipse Quantique** | **1** | oui | ⛔ |
| **La Chair des Machines** | **1** | oui | ⛔ |
| **Code Rouge** | **1** | oui | ⛔ |

**Huit bandes-annonces promeuvent des romans qui ont un chapitre sur quarante**,
et leur voix off dit « disponible prochainement ». Ce n'est pas une maladresse,
c'est une promesse qu'on ne peut pas tenir : il manque 39 chapitres à chacun.

**La règle qui en découle** : un trailer ne sort que si le roman est **terminé**
*et* **sur un chemin de publication réel**. Les relectures ultérieures ont
refusé trois romans ; le statut éditorial du quatrième doit être vérifié au lieu
d'être déduit d'une note. Aucun trailer n'est donc validé pour le lancement.

---

## 5. Les abonnements qui coulent pendant qu'on attend

| Abonnement | Ce qui se perd |
|---|---|
| **HeyGen Pro** | 1 500 crédits/mois **non reportables** — perdus au renouvellement |
| **Flow / Google AI Ultra** | 50 crédits offerts **par jour**, non cumulables, jusqu'à fin août |
| **ElevenLabs Pro** | 600 000 caractères/mois |
| **Epidemic Sound** | ⚠️ prélèvement annuel autour du 22/08 |

C'est un argument réel pour lancer vite. Ce n'en est pas un pour publier ce qui
n'est pas prêt : un mauvais départ sur une chaîne neuve coûte plus cher que des
crédits perdus.

---

## 6. L'ordre que je recommande

1. Tu crées les deux chaînes et tu déclares le contenu synthétique.
2. Tu colles les deux URL dans `description.txt`, tu cherches `[[`, tu publies
   **« Meta AI ne répond plus »** sur LISA IA. C'est la seule vidéo dont chaque
   contrôle a été exécuté et écrit.
3. AMBRE attend la fin des réparations d'identité. Publier un visage qui n'est
   pas le sien sur la deuxième vidéo d'une chaîne neuve, c'est casser la
   reconnaissance avant de l'avoir construite.
4. Les trailers de livres attendent qu'un roman soit réellement publiable.

---

## 7. Le contenu de la vidéo longue, passé au juge — et vérifié derrière lui

Un juge indépendant a relu le script en cherchant les affirmations fausses, les
promesses excessives et les risques juridiques. Il a rendu **cinq constats, dont
deux « bloquants »**. Je les ai tous vérifiés dans les fichiers avant de te les
transmettre, et le résultat compte :

| Constat du juge | Vérification | Verdict |
|---|---|---|
| « Dates futures présentées comme passées : 24 juillet 2026, avril 2026 — ne pas publier avant le 24 juillet » | Nous sommes le **1er août 2026**. Ces deux dates sont passées. | ❌ **Faux** — le juge ignorait la date du jour |
| « Le chiffre de 700 M d'utilisateurs n'est pas soutenu par la source » | Le script cite en clair le communiqué officiel Meta du 19 mars 2025, et écrit « revendiqués ». | ❌ **Faux** — il est sourcé et prudemment formulé |
| « Photo de Steve Jobs / montage Apple 1997 non licencié » | **Aucune image d'Apple ou de Jobs n'existe dans le projet.** La section 07 a été montée avec du B-roll générique. L'analogie ne subsiste qu'à l'oral, ce qui est du commentaire éditorial. | ✅ **Déjà résolu** |
| « Captures d'interface Meta sans licence, sur une vidéo monétisée » | Quatre fichiers, tous nommés `meta-officiel-*`, issus de la salle de presse Meta. Usage de courte citation pour une analyse critique. | ⚠️ **Risque résiduel réel**, mais défendable |
| « Verbes à l'indicatif sur des démos non déployées » | Le script dit explicitement « démonstrations officielles » et « sans les faire passer pour un test déjà disponible en France ». | ⚠️ **Partiellement juste** — durcir au conditionnel ne coûterait rien |

**Conclusion historique sur v1 :** aucun des deux « bloquants » factuels du
juge n'en était un. Cela ne constitue plus un verdict de livraison : le master
courant est v2 et reste soumis aux portes humaines du document canonique.

C'est aussi la troisième fois aujourd'hui qu'un juge produit un faux positif
faute de contexte. Un juge signale, il ne condamne pas — et **ce qu'il signale
se vérifie avant d'agir**.

---

## 8. Ce que je n'ai pas vérifié

- Les **102 vidéos Ambre** une par une : je me suis appuyé sur les verdicts QC
  des composites qui les alimentent.
- Les **91 B-roll** et les **31 plaques 9:16** : non audités.
- Le **fond** de l'analyse Meta AI : j'ai vérifié les sources citées et les
  risques juridiques, pas la pertinence du raisonnement éditorial.
