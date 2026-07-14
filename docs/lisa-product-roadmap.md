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

- Banc déterministe au niveau du tour et de l'épisode, complété par sept scénarios synthétiques
  exécutables sur Darkstar ou un autre fournisseur. Le septième est réellement séquentiel : trois
  réponses du modèle sont générées et réinjectées successivement au lieu de fournir une histoire
  d'assistant écrite à l'avance.
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
- La boucle mesure → décision → production est maintenant fermée : la catégorie et le risque sont
  scellés dans la clé de comparaison, une couverture relationnelle automatisée et relue est requise,
  puis le gagnant peut piloter les mêmes tours substantiels en voix, Telegram et Cowork. Les pins
  manuels, l'identité d'authentification OAuth/API, l'expiration, le repli et le rollback restent
  explicites et réversibles; la télémétrie ne conserve aucun verbatim.
- Le fil de délibération représente désormais localement le sujet, les positions provisoires, la
  raison déjà avancée, l'objection, la correction, la question ouverte et la phase du raisonnement.
  Un suivi elliptique comme « Continue » ou « Et la réciprocité ? » conserve donc la profondeur et
  le cerveau `deep` sur voix, Telegram et Cowork; une demande de brièveté, une action, une clôture ou
  un vrai changement de sujet annule cet héritage. L'évaluateur mesure aussi la nouveauté des
  propositions et la progression entre réponses : répéter une thèse avec davantage de connecteurs
  est maintenant un échec, pas une preuve de raisonnement.
- Prochaine étape : enrichir progressivement le corpus avec de vrais épisodes consentis, exécuter
  le pilote v2 sur Darkstar et les modèles d'abonnement, activer le gagnant observé, puis mesurer en
  usage réel les ruptures de continuité, la latence au premier son et les corrections humaines.

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

La boucle mesure désormais le début de réponse humaine par rapport au dernier intervalle de lecture :
pendant la parole (barge-in), pendant la traîne anti-écho ou après réouverture normale. Une empreinte
en mémoire vive des segments prononcés permet de supprimer un écho correspondant tout en acceptant
une réponse distincte avant la fin des 1,2 seconde de garde. Les percepts conservent les durées et le
type de reprise ; les statistiques compagnon publient p50/p95 et compteurs agrégés sans verbatim.

Le tour vocal transporte maintenant sa durée acoustique jusqu'au cerveau et au renderer. Lisa estime
un débit seulement à partir d'au moins trois mots et d'une durée plausible, rejette les mesures
extrêmes, puis se rapproche partiellement du rythme humain dans une plage de 105 à 195 mots/minute.
Le profil distingue débit, pauses et longueur relative ; une règle explicite interdit de sacrifier
analyse, preuves, nuances ou argumentation philosophique pour imiter un tour bref. Voicebox reçoit
la consigne acoustique par tour, tandis que les autres moteurs suivent la ponctuation et la structure
du texte. Les percepts et Cowork affichent uniquement les agrégats `humanWpm`, `targetWpm`, rythme et
forme appliquée, sans recopier la phrase.

La vision ponctuelle suit maintenant une vraie paire adjacente de conversation. Si l'objet demandé
n'est pas dans l'allowlist de consentement direct, Lisa demande simplement si elle peut ouvrir la
caméra pour une image ; « oui, vas-y » reprend la cible du tour précédent au lieu d'analyser cette
seule confirmation. La demande reste en mémoire vive au maximum 45 secondes et un seul tour : un
refus, un changement de sujet ou l'expiration la détruit. Seuls la question et le résultat textuel
rejoignent le fil voix/Telegram/Cowork ; ni chemin local ni image brute n'y est ajouté.

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

Le profil vocal borné accompagne désormais l'intention de jeu dans le champ additif `cue.delivery` :
débit cible, style de pause, forme de réponse, confiance et durée de stabilisation entre phrases.
Un ancien renderer V1 peut ignorer ce champ. Le plugin Unreal le valide avant de l'exposer aux
Blueprints ; il sert à synchroniser l'énergie corporelle et les gestes, jamais à étirer l'audio ni à
affaiblir une réponse délibérative. Aucun verbatim ni débit humain brut ne quitte le cerveau.

Le bundle Runtime Win64 Split A v6 est désormais versionné dans
`integrations/unreal/CodeBuddyAvatar` avec un manifeste SHA-256 et un script séparant strictement
préparation, validation Unreal et promotion. Ce jalon fournit le transport authentifié, la file WAV
multi-segment, l'interruption et les événements Blueprint. Il ne vaut pas encore validation du rendu
MetaHuman : le build UE 5.8, les tests Automation et le branchement Audio Live Link doivent être
exécutés sur Darkstar avant d'activer `audioDrivenAnimation`.

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
