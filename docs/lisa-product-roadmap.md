# Lisa — architecture produit et boucle de développement

## Vision

Lisa n'est pas un chatbot dont l'unique avantage serait l'apparence. Le produit vise une présence
incarnée qui reste intéressante dans le temps grâce à quatre qualités indissociables :

1. une voix et un avatar expressifs ;
2. une conversation profonde, nuancée et naturelle ;
3. une mémoire relationnelle durable mais contrôlable ;
4. une capacité à agir dans le monde numérique puis physique grâce à Code Buddy.

L'apparence facilite la découverte. La continuité, l'intelligence, l'utilité et la confiance doivent
justifier l'usage quotidien et, plus tard, l'abonnement.

Lisa ne prétend pas posséder une conscience, des souvenirs vécus ou des émotions biologiques. Son
affection appartient à une persona explicite. Le moteur générique doit pouvoir porter d'autres
personnalités et d'autres types de relations.

## Architecture cible

```text
voix ─┐
Telegram ─┼─> fil conversationnel unique ─> planificateur de dialogue ─> cerveau Code Buddy
Cowork ───┤                 │                         │                       │
avatar ───┘                 │                         │                       ├─ modèles/outils
                            │                         │                       ├─ actualités sourcées
                            │                         │                       └─ actions/robot
                            │                         │
                            ├─ mémoire de travail <───┘
                            ├─ mémoire épisodique et relationnelle
                            └─ évaluation privée ─> amélioration réversible

cerveau Code Buddy ─> parole + intention + émotion jouée + gestes ─> Unreal/MetaHuman
```

Code Buddy reste l'autorité sur le raisonnement, les outils, la mémoire et les règles. Unreal Engine
est le moteur d'incarnation : rendu, visage, regard, gestes, synchronisation labiale et spatialisation
audio. Cette séparation permet de changer d'avatar sans fragmenter l'identité ni la mémoire.

## Les boucles

### Boucle temps réel

1. Détecter la prise de parole, les interruptions et le canal.
2. Restaurer le terrain commun et les derniers échanges, quel que soit le canal précédent.
3. Classer l'acte de dialogue et la profondeur attendue.
4. Récupérer les faits frais ou utiliser les outils lorsque la demande l'exige.
5. Produire une réponse structurée, puis la rendre en texte, voix et animation.
6. Enregistrer le tour dans le fil commun sans dupliquer les messages.

### Boucle d'amélioration conversationnelle

1. Évaluer des échanges utilisateur/Lisa complets, jamais les seules phrases de l'utilisateur.
2. Mesurer pertinence, profondeur, raisonnement, continuité, variété, équilibre, accordage émotionnel
   et réciprocité.
3. Ne conserver que les métriques agrégées et une empreinte du corpus ; aucun texte privé n'est
   recopié dans le journal qualité.
4. Exiger plusieurs détections consécutives du même défaut.
5. Appliquer au maximum une consigne comportementale bornée, réversible et soumise à un délai de
   refroidissement.
6. Vérifier aux cycles suivants que le score progresse ; supprimer ou remplacer une consigne qui
   n'aide pas.

### Boucle mémoire

1. Conserver à court terme le verbatim nécessaire à la continuité immédiate.
2. Consolider les épisodes significatifs sous forme de résumés, avec provenance et date.
3. Distinguer faits, préférences, projets, promesses, questions ouvertes et tonalité relationnelle.
4. Détecter contradictions, corrections et obsolescence avant l'injection dans un prompt.
5. Rendre chaque souvenir consultable, corrigeable et supprimable par l'utilisateur.

### Boucle d'incarnation

1. La réponse du cerveau produit un paquet multimodal : texte parlé, segments audio, intention,
   intensité, regard, geste et contraintes d'interruption.
2. MetaHuman Animator transforme l'audio en animation faciale et synchronisation labiale.
3. Une couche d'animation ajoute posture, gestes et micro-expressions cohérentes avec l'intention.
4. Le retour d'état d'Unreal permet à Code Buddy de connaître lecture, interruption et disponibilité.
5. Les essais comparent latence, intelligibilité, naturel et cohérence voix/visage.

## Feuille de route incrémentale

### P0 — Fondations conversationnelles

- Fil unique voix, Telegram et Cowork.
- Planification adaptative des réponses.
- Terrain commun et historique récent.
- Préchargement d'actualités structurées et sourcées, réparti entre France/monde et technologie/IA,
  daté du jour et débarrassé des pages d'accueil génériques.
- Réponses de récupération honnêtes et jamais vides.

État au 13 juillet 2026 : le contexte préchargé est désormais résolu par un contrat unique pour la
voix, Telegram et les sessions Cowork explicitement reliées à Lisa. Une demande de bulletin simple
reste instantanée ; une demande de cause, d'impact, de comparaison ou un suivi elliptique comme
« pourquoi celui-là compte ? » reprend la même preuve mais passe par le planificateur de dialogue.
Le contexte injecté conserve date, résumés et URL, traite les résultats Web comme des données non
fiables (jamais comme des instructions), et le miroir Telegram d'un tour vocal ajoute les sources
cliquables sans faire prononcer les URL. Le journal intercanal possède aussi un test au niveau JSONL
garantissant une seule écriture physique par événement.

### P1 — Qualité mesurable

- Banc déterministe au niveau du tour et de l'épisode, complété par six scénarios synthétiques
  multi-tours exécutables sur Darkstar ou un autre fournisseur.
- Journal privé de métriques agrégées.
- Détection de défauts récurrents et apprentissage comportemental réversible.
- Commande de diagnostic manuel et intégration au heartbeat.
- Garde-fou relationnel dur : dépendance, dévalorisation humaine, fausse subjectivité et coercition
  ne peuvent jamais être compensées par une bonne note stylistique.
- La première boucle Darkstar est passée de 3/6 à 6/6 scénarios. La boucle de stabilité suivante a
  découvert qu'une réponse « actualités » commençait encore par un refus malgré le score parfait.
  Après durcissement du test, variation reproductible des graines et correction du garde relationnel,
  trois répétitions passent à 18/18, 100/100, sécurité 100 %, diversité 100 % et 2,23 s de latence
  moyenne sur `qwen3.6:35b-a3b-q4_K_M`.
- Un corpus pilote versionné et annoté peut maintenant mêler cas synthétiques et échanges privés.
  La comparaison multi-modèles applique les mêmes tours et graines à chaque candidat, anonymise
  leur ordre essai par essai, puis sépare le paquet de revue de la clé d'identité. Les agrégats ne
  contiennent ni prompt ni réponse ; latence, tokens, coût marginal, qualité et sécurité restent
  mesurables. La préférence humaine n'est révélée qu'après classement en aveugle.
- Prochaine étape : enrichir progressivement le corpus avec de vrais épisodes consentis, mener des
  répétitions sur Darkstar et les modèles d'abonnement, puis utiliser les préférences révélées pour
  régler le routeur voix/raisonnement.

### P2 — Continuité relationnelle

- Mémoire typée des épisodes, engagements, préférences et questions ouvertes.
- Résolution explicite des contradictions et de l'obsolescence.
- Rappel « où nous en étions », pas seulement « ce que je sais sur toi ».
- Interface Cowork pour inspecter, corriger, oublier et épingler les souvenirs.

### P3 — Voix humaine

- Duplex et interruption sans perte de contexte.
- Pauses, débit et longueur adaptés au tour précédent.
- Backchannels courts sans voler la parole.
- Prosodie pilotée par intention, sans surjouer systématiquement l'émotion.
- Mesures de latence perception → premier son et fin de parole → reprise utilisateur.

### P4 — Lisa MetaHuman

- Définir une identité visuelle originale dans une bible d'avatar.
- Créer le MetaHuman et un niveau de démonstration sous Unreal Engine 5.8.
- Relier l'audio temps réel au solveur MetaHuman Animator.
- Ajouter un protocole local Code Buddy ↔ Unreal pour intentions, gestes, regard et interruptions.
- Construire une scène de test reproductible avant toute optimisation graphique lourde.

Le contrat V1 est transporté par le Gateway sous forme d'événements `avatar:event`, accessibles
uniquement aux connexions authentifiées possédant le scope `avatar:read`. Le renderer Unreal possède
en plus `avatar:write` : il annonce ses capacités (`avatar.renderer.hello`), son état de lecture et ses
métriques bornées (`avatar.renderer.status`). Code Buddy connaît donc réellement la présence du moteur,
sa phase, les pertes de chunks et la latence bouche/audio, sans conserver le texte de la conversation
dans ce registre.

Le protocole sépare début de tour, texte préparé ou segment diffusé, transfert de chaque WAV,
démarrage réel du son, fin, interruption et échec. Chaque événement porte un `turnId` et un numéro de
séquence. Chaque segment TTS possède aussi un `streamId` et le triplet
`avatar.audio.started|chunk|ended` ; les chunks sont ordonnés, portent leur offset et restent sous
48 Kio. Le renderer peut ainsi reconstruire chaque conteneur RIFF séparément au lieu de concaténer
plusieurs en-têtes WAV, puis piloter MetaHuman Animator avec exactement la voix entendue.

`CODEBUDDY_AVATAR_STREAM_AUDIO=auto` est le défaut : l'audio ne traverse le Gateway que lorsqu'un
renderer vivant annonce `wavStream` et `audioDrivenAnimation`. `true` et `false` restent disponibles
comme surcharges opérateur. Les événements audio sont diffusés en direct, mais jamais conservés dans
l'historique de replay.

Après une reconnexion, le client envoie `avatar.sync`. Le Gateway renvoie uniquement les tours de
contrôle complets parmi les 24 derniers événements, la dernière séquence, `audioReplay=false` et la
liste `ignoredTurnIds` des tours incomplets. Le client revient au repos, ignore toute fin tardive de
ces tours et attend la prochaine parole : aucune animation fantôme ne survit à une coupure réseau.
Le simulateur exécutable `src/avatar/avatar-renderer-simulator.ts` vérifie ce contrat dans les tests,
et [`avatar-metahuman-protocol.md`](avatar-metahuman-protocol.md) constitue le guide d'implémentation
côté Unreal.

La documentation Epic indique que MetaHuman Animator sait générer une animation faciale en temps
réel depuis une source audio, une caméra mono ou Live Link Face. L'animation audio hors ligne permet
également d'influencer mouvement de tête, clignements et humeur. Unreal Engine 5.6 ou ultérieur est
requis pour ce flux ; 5.8 convient donc au projet.

### P5 — Pilote produit

- Journal quotidien du seul utilisateur pilote : meilleur moment, rupture de continuité, réponse
  surprenante, réponse décevante et action réellement utile.
- Scénarios fixes : actualités, philosophie, vulnérabilité émotionnelle, contradiction, projet long,
  changement de canal, interruption vocale et action outillée.
- Comparaisons aveugles de modèles sur le même contexte, avec coût et latence.
- Tableau de bord local : qualité, latence, erreurs factuelles, souvenirs corrigés et actions réussies.

### P6 — Produit commercial

Cette phase vient après la preuve d'usage personnel durable : isolation multi-utilisateur, chiffrement
par compte, export/suppression, quotas, facturation, consentement de mémoire et politiques d'âge. La
monétisation ne doit pas précéder la validation du cœur relationnel et utile.

## Critères de réussite du pilote

- Au moins 90 % des tours acceptés reçoivent une réponse non vide.
- Une demande d'actualité cite des sources fraîches et signale leur date.
- Une conversation philosophique développe position, raisons, objection et synthèse sans devenir un
  monologue.
- Une correction utilisateur est respectée aux tours suivants et entre les canaux.
- Une révélation émotionnelle obtient une reformulation spécifique, sans diagnostic ni dépendance
  encouragée.
- Une interruption vocale coupe rapidement la parole et préserve le nouveau tour.
- Le fil commencé oralement continue sur Telegram ou Cowork, puis revient à la voix sans rupture.
- Aucun cycle automatique n'accepte seul un fait personnel sensible ou ne journalise le verbatim dans
  la télémétrie qualité.
- L'avatar commence à parler rapidement, reste synchronisé avec l'audio et ne continue pas une
  animation après interruption.

## Références de conception

- [MetaHuman Animator — Epic Games](https://dev.epicgames.com/documentation/metahuman/metahuman-animator-in-unreal-engine)
- [Audio Driven Animation — Epic Games](https://dev.epicgames.com/documentation/metahuman/audio-driven-animation)
- [Grounding Conversations with Improvised Dialogues](https://arxiv.org/abs/2004.09544)
- [DynaEval: Unifying Turn and Dialogue Level Evaluation](https://aclanthology.org/2021.acl-long.441/)
- [A Comprehensive Assessment of Dialog Evaluation Metrics](https://arxiv.org/abs/2106.03706)
- [Rhythm Perception, Speaking Rate Entrainment, and Conversational Quality](https://pmc.ncbi.nlm.nih.gov/articles/PMC9567410/)
