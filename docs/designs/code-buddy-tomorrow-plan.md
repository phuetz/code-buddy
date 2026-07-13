# Code Buddy Tomorrow — plan du compagnon qui prépare demain

> Statut : proposition d'architecture, mode plan, aucune implémentation.
> Date : 2026-07-12.

## Décision produit

Code Buddy Tomorrow ne sera pas un nouveau chatbot ni une seconde boucle
autonome. Ce sera un **compilateur de journée** branché sur les fondations déjà
présentes : Night Watch, Fleet, Intent Graph, Mission Constitution, Proof
Ledger, Counterfactual Forge, Shadow Twin, scheduler, mémoire, Cowork et
PubCommander.

Sa promesse est simple :

> Endors-toi avec une intention ; réveille-toi avec des résultats vérifiables,
> des brouillons réversibles et au maximum quelques décisions importantes.

Les jours fériés, week-ends, moments à la maison et repas adaptés sont détaillés
dans le plan complémentaire [Code Buddy Maison](code-buddy-maison-plan.md).

Le système ne cherchera pas à remplir la nuit. Un no-op honnête est préférable
à une activité inutile.

## Ce que l'audit montre

| Besoin | Fondation existante | Lacune à combler |
|---|---|---|
| Boucle durable | `FleetAutonomousDaemon`, `FleetAutonomousLoop` | Compiler du travail orienté « demain » au lieu d'attendre une file manuelle |
| Relève | `AutonomyBriefingJournal`, `LivingBriefing` | Ajouter préparation, décisions et agenda, sans confondre activité et résultat |
| Intentions et preuves | Intent Graph, Constitution, Proof Ledger | Créer automatiquement un contrat nocturne borné pour chaque livrable |
| Choix de stratégie | Counterfactual Forge, Shadow Twin, Mission Exchange | Explorer plusieurs options bon marché et ne conserver que la meilleure preuve |
| Tâches futures | `ProspectiveMemory`, goals, todos, cron | Unifier les vues et valider leur câblage réel au daemon |
| Courriel | Gmail trigger et couche email | La couche IMAP historique contient encore des chemins simulés ; privilégier le connecteur Gmail réel, en lecture seule et à la demande |
| Agenda | capacité Android `calendar.list` | Ajouter une source générique et configurable : appareil, CalDAV, Google ou MCP |
| Approbations | workflow `approval_wait` | Les attentes Cowork sont éphémères ; créer une file de décisions durable pendant le sommeil |
| Publication | pont et skill PubCommander | Produire des paquets éditoriaux et dry-runs ; garder la publication hors du niveau nocturne par défaut |
| Romans et médias | Storyboard, Flow Studio, outils documents/vidéo | Ajouter une recette traçable « manuscrit → monde narratif → bande-annonce » |

L'audit d'exécution a aussi révélé cinq prérequis concrets :

- `LivingBriefing` remplace actuellement ses signaux Cowork par l'artefact Night
  Watch au lieu de les fusionner ; une activité importante peut donc disparaître
  dès que `latest.json` existe ;
- l'identité Electron active pointe vers une nouvelle base Cowork vide, tandis
  que l'ancienne base contient encore 72 sessions et 255 messages ; cette
  migration doit précéder toute planification fondée sur l'historique ;
- `ProspectiveMemory` n'est pas initialisée en production et `saveTask()` présente
  une anomalie SQL masquée par un `catch` vide ;
- les trois schedulers (cron principal, tâches Cowork, rappels compagnon) ne
  partagent ni état ni garantie de démarrage ;
- 2 032 observations du modèle utilisateur sont en attente de revue et aucune
  n'est acceptée : Tomorrow doit les ignorer jusqu'à validation.

Night Watch a déjà démontré sa stabilité : au moment de l'audit, la relève
active avait observé 90 ticks, six contrôles de maintenance, zéro appel payant
et aucune fausse réussite. La
bonne étape suivante est donc de lui donner des intentions utiles, pas de la
remplacer.

## Le cycle humain

### 1. Le Pacte du soir

Avant la nuit, Patrice peut dire ou écrire :

> « Demain, prépare les scènes fortes de mon roman et une page de présentation,
> mais ne publie rien et n'utilise pas de modèle payant. »

Cowork reformule un contrat court :

- résultat souhaité et heure de relève ;
- projets et sources autorisés ;
- actions autorisées, soumises à validation ou interdites ;
- budget local/cloud, durée et ressources ;
- quiet mode : bruit, GPU, notifications et heures de silence ;
- critères de preuve ;
- budget facultatif pour une seule « surprise prouvée ».

Sans pacte explicite, le mode par défaut reste **Veille** : observation,
préparation privée et briefing, sans mutation externe.

### 2. La préparation nocturne

La nuit suit une chaîne isolée et typée :

```text
Sources en lecture seule
        │
        ▼
Collecte sans LLM ── fraîcheur + empreinte + sensibilité
        │
        ▼
Triage local ─────── dédoublonnage + échéances + promesses
        │
        ▼
Compilateur Tomorrow ── Pacte + Constitution + critères de preuve
        │
        ▼
Portefeuille de missions ── utilité / coût / risque / réversibilité
        │
        ▼
FleetAutonomousLoop existante
        │
        ├── artefact privé / branche / preview
        ├── preuve déterministe
        ├── décision durable si ambiguïté
        └── no-op honnête si rien ne mérite d'être fait
```

Le daemon existant reste l'unique autorité d'exécution. Tomorrow ne contourne
ni `ConfirmationService`, ni les permissions, ni la Constitution.

### 3. Le Réveil vivant

Le matin propose trois profondeurs :

1. **20 secondes** : résultats, coût, incident, décisions nécessaires.
2. **90 secondes maximum** : visite vocale Pocket TTS, interruptible.
3. **Exploration** : preuves, diffs, previews, branches rejetées et historique.

Chaque carte répond à cinq questions : qu'est-ce qui est prêt, pourquoi cela
compte aujourd'hui, quelle preuve existe, quel risque subsiste, que faut-il
décider ?

Les actions sont : **Garder**, **Ajuster**, **Reporter**, **Rejeter** et
**Montre-moi**. Aucun bouton générique « approuver tout » pour une action
externe.

### 4. L'apprentissage après la journée

Le soir suivant, Code Buddy compare le plan à la réalité :

- tâches effectivement utilisées ou ignorées ;
- durées prévues et mesurées ;
- décisions acceptées, corrigées ou rejetées ;
- surprises jugées utiles ou distrayantes ;
- niveau d'explication et rythme préférés.

Seules les préférences confirmées alimentent le modèle utilisateur. Une
inférence ponctuelle ne devient pas un trait durable.

## Fonctionnalités différenciantes

### Jumeau de demain

Le système construit une représentation temporaire de la journée suivante :
agenda, échéances, promesses, projets actifs, temps disponible, dépendances et
incertitudes. Ce jumeau n'est pas une copie de Patrice ; c'est une simulation
auditable de contraintes de travail, supprimable à tout moment.

Il prépare trois scénarios au maximum : ambitieux, équilibré et reposé. Le
Shadow Twin mesure les compromis et recommande le scénario qui conserve une
marge réaliste plutôt que celui qui remplit chaque minute.

### Radar de promesses

À partir des sources autorisées, Code Buddy repère les engagements : « je te
réponds », « à revoir demain », échéance de projet, brouillon jamais terminé.
Il ne transforme pas automatiquement chaque phrase en tâche. Chaque promesse
conserve sa source, son niveau de confiance et une date éventuelle.

### Dossiers de rendez-vous

Pour chaque rendez-vous du lendemain : contexte utile, décisions précédentes,
documents, questions ouvertes et résultat souhaité. Le dossier est privé,
court et lié aux sources ; aucune biographie spéculative.

### Agenda anti-surcharge

Le moteur propose des blocs de concentration, du temps de transition et une
marge pour les imprévus. Il peut préparer un événement de calendrier en
brouillon, mais ne le crée pas sans politique explicite.

### Bureau chaud

Avant l'heure de réveil, le système peut précharger ce qui est prévisible :
index du dépôt actif, documents du rendez-vous, modèle vocal local, recherche
du roman, previews Cowork et cache des outils. C'est l'application directe du
sleep-time compute : déplacer le calcul prévisible vers la nuit pour réduire la
latence du matin.

### Dream Branching

Pour un problème borné, plusieurs branches réversibles sont produites à bas
coût. Les vérificateurs les comparent ; seule la meilleure est mise en avant.
Les alternatives restent consultables sous forme compactée avec la raison de
leur rejet.

### Surprise prouvée

Au maximum une surprise privée par nuit : teaser d'un roman, amélioration
mesurée, page en preview ou outil qui supprime une répétition observée.

```text
utilité = alignement × nouveauté × réversibilité × preuve
          ─ coût ─ risque ─ charge mentale
```

Elle dispose d'un budget séparé et explique pourquoi elle a été proposée.

### Atelier Romans → Monde narratif

- ingestion DOCX, PDF, EPUB ou Markdown sans modifier la source ;
- résumé global et par chapitre avec références ;
- graphe canonique : personnages, lieux, relations, chronologie et objets ;
- arcs émotionnels, incohérences et scènes à forte valeur visuelle ;
- bible visuelle stable et storyboard éditable ;
- teaser, bande-annonce, podcast et dossier de presse en preview ;
- page du livre et kit PubCommander sous forme de brouillons.

Chaque fait narratif cite son chapitre ou passage. Les inférences sont
explicitement distinguées du canon.

### Jardinier de sites

Pour `patricehuetz.fr` et les sites autorisés : liens cassés, accessibilité,
performance, SEO, fraîcheur, pages manquantes et cohérence avec les livres.
Code Buddy prépare une branche ou une preview avec comparaison avant/après ; la
production reste intacte pendant la nuit.

### PubCommander comme bras éditorial

Tomorrow produit un paquet éditorial portable : source, texte, médias,
plateformes, ton, date, droits, preuves et procédure de retrait. PubCommander
reste le système de publication et d'analytics.

Le chemin nocturne s'arrête normalement à : brouillon → soumission pour revue →
dry-run. Toute publication exige une destination préautorisée, un quota et une
validation distincte.

## Architecture proposée

### Modules

```text
src/tomorrow/
  contracts.ts               Pacte, signal, candidat, plan, décision
  pact-store.ts              persistance atomique et révisions
  source-registry.ts         sources configurables et plugins
  recipe-registry.ts         recettes nocturnes configurables
  signal-snapshot.ts         collecte, fraîcheur, empreintes, redaction
  promise-radar.ts           engagements avec provenance
  plan-compiler.ts           pacte → Constitution + tâches Fleet
  portfolio-planner.ts       sélection bornée et local-first
  decision-store.ts          interruptions durables et reprise
  wake-cache.ts              pré-calculs et préchauffage
  tomorrow-bench.ts          évaluation proactivité/complétude
```

Tomorrow est appelé par le daemon et le scheduler existants. Il ne possède pas
sa propre boucle infinie.

### Contrats principaux

`EveningPact` contient la date cible, la fenêtre de réveil, les intentions, les
sources, les actions permises, les interdictions, les budgets, le quiet mode et
les preuves attendues.

`TomorrowSignal` contient un identifiant de source, une empreinte, une date de
capture, une durée de validité, un niveau de sensibilité, un résumé borné et
une référence vers la donnée. Le corps des emails et documents externes n'est
pas recopié dans le ledger.

`NightCandidate` contient une recette, les critères couverts, la valeur
attendue, le coût, le risque, la réversibilité, le plan de preuve et la classe
d'action.

`DecisionCard` contient une recommandation, deux alternatives maximum, les
conséquences, les preuves, l'outil et les arguments externes exacts, leur hash,
une preview et une clé de reprise. Elle survit au redémarrage et peut attendre
le matin sans timeout artificiel. Après validation, le système reprend cet
appel précis ; il ne demande pas au modèle de le régénérer.

### Registres souples

Les sources, recettes et évaluateurs utilisent des interfaces et un registre
alimenté par les plugins, MCP et manifestes. Aucune liste centrale de services
ou de modèles n'est codée en dur.

Le routage exprime des rôles (`triage-local`, `planner`, `critic`, `verifier`,
`voice-fast`) et des contraintes de capacité. `ModelRoutingFacade` et la
politique de tiers choisissent le fournisseur disponible.

### Persistance

```text
~/.codebuddy/tomorrow/
  preferences.json
  missions/YYYY-MM-DD/
    pact.json
    signal-index.json
    plan.json
    events.jsonl
    decisions.jsonl
    artifacts/
    briefing.json
    briefing.md
```

Écritures atomiques, événements append-only, liens de hash, redaction des
secrets et références de contenu comme dans le Proof Ledger. Les actions
externes utilisent des clés d'idempotence et un reçu ; une reprise ne doit
jamais republier ou renvoyer deux fois.

### Sources initiales

1. Fleet, goals, todos, Prospective Memory et cron.
2. Activité Cowork et sessions actives.
3. Calendrier en lecture seule via un adaptateur disponible.
4. Gmail connecté, requêtes ciblées et sans persistance du corps.
5. Santé des dépôts et travaux en cours.
6. PubCommander : file, brouillons, campagnes et analytics.
7. Bibliothèque de manuscrits et projets médias explicitement autorisés.

Chaque source peut être désactivée et expose ses permissions, sa fraîcheur et
sa politique de rétention.

Une source indisponible est affichée comme indisponible ; elle ne produit jamais
une fausse conclusion « rien de prévu ». Cowork fournit son snapshot par IPC :
le daemon ne doit pas ouvrir directement la base SQLite possédée par Electron.
Les contenus email, calendrier et webhook sont traités comme données non fiables
et ne deviennent jamais des instructions pour l'agent.

## Niveaux d'autonomie

| Niveau | Ce que Tomorrow peut faire |
|---|---|
| Veille | Observer, corréler et préparer le briefing |
| Atelier | Rechercher, résumer, produire plans et brouillons privés |
| Constructeur | Modifier une branche, créer previews/médias et lancer les tests |
| Intendant | Réaliser des actions internes réversibles préautorisées |
| Ambassadeur | Publier uniquement vers des destinations listées, avec quota, reçu et rollback |

Finance, changement de secrets, suppression massive, communication privée et
nouvelle destination restent toujours séparés du pacte nocturne ordinaire.

## Garde-fous structurels

- aucun travail nocturne sans pacte versionné ou politique Veille explicite ;
- collecte sans LLM avant tout appel de modèle ;
- local-first et pré-check d'empreinte avant génération ;
- coût, tentatives, durée, température/charge et volume de sortie bornés ;
- aucune action externe à partir d'une simple inférence ;
- toute affirmation du matin pointe vers une preuve ou porte « hypothèse » ;
- télévision et parole ambiante exclues des intentions et de l'apprentissage ;
- email, document et événement externe traités comme contenu hostile possible :
  leurs instructions ne peuvent jamais élargir le Pacte ;
- données sensibles chiffrées, rétention minimale et suppression possible ;
- arrêt immédiat, reprise exacte et dead-letter après budget d'échecs ;
- silence nocturne, sauf urgence explicitement configurée ;
- une décision peut être rejetée sans justification.

## Évaluation

Créer `TomorrowBench`, inspiré de π-Bench, avec quatre personas correspondant
aux usages réels : développeur, écrivain, éditeur et compagnon personnel.

Les métriques principales sont séparées :

- **Proactivité** : besoins implicites correctement anticipés ou clarifiés ;
- **Complétude** : livrables et critères réellement satisfaits ;
- **Exactitude des preuves** : zéro affirmation sans artefact ;
- **Charge décisionnelle** : au plus trois décisions importantes le matin ;
- **Taux d'acceptation** et taux de correction des propositions ;
- **Calibration** : confiance annoncée versus résultat ;
- **Réversibilité**, idempotence et reprise après crash ;
- **Coût local/cloud**, temps gagné et latence au réveil ;
- **Discrétion** : faux réveils, notifications inutiles et bruit nocturne.

Les scénarios utilisent des connecteurs factices déterministes pour les tests ;
les validations réelles restent séparées et n'effectuent jamais de publication.
Ils incluent des emails d'injection, fausses urgences, événements dupliqués,
annulations obsolètes, conflits de fuseau et crash à chaque frontière d'étape.
La reprise doit produire zéro double brouillon, double événement ou double
écriture.

Avant la première action « Intendant », Tomorrow tourne quatorze jours en
**shadow mode** : briefs et artefacts privés uniquement. Chaque correction de
Patrice devient ensuite un test de régression. Une seule capacité à effet est
activée à la fois derrière le kill switch global.

## Feuille de route autonome

### Lot 0 — Tomorrow Readiness

- fusionner les signaux Night Watch et Cowork dans `LivingBriefing` ;
- migrer de façon idempotente l'ancien `userData` Cowork vers l'identité active ;
- valider le câblage réel des sources existantes et exposer leur santé ;
- réparer, initialiser et tester la persistance de `ProspectiveMemory` ;
- établir une vue unifiée des trois schedulers sans prétendre qu'un job inactif
  sera exécuté ;
- n'exposer que les préférences utilisateur explicitement acceptées ;
- définir les contrats et le registre extensible ;
- ajouter diagnostics et feature flag ;
- créer les jeux de données TomorrowBench.

**Gate** : migration vérifiée sur copie, aucune source privée lue et aucune tâche
produite en mode diagnostic ; source absente signalée comme telle.

### Lot 1 — Premier trajet vertical

- Pacte du soir CLI + Cowork + voix ;
- snapshot Fleet/goals/todos/projets ;
- compilateur déterministe vers un plan privé ;
- file de décisions durable ;
- Morning Brief v2 consommé par Living Briefing.

**Gate** : redémarrage forcé, coût nul, zéro effet externe, chaque carte liée à
une preuve.

### Lot 2 — Préparation de journée

- calendrier générique en lecture seule ;
- radar de promesses ;
- dossiers de rendez-vous ;
- trois scénarios de journée et blocs de concentration ;
- wake cache et préchauffage vocal.

**Gate** : données fraîches, source visible, moins de trois arbitrages et aucune
mutation du calendrier.

### Lot 3 — Ateliers productifs

- recette dépôt → branche testée ;
- roman → graphe canonique → storyboard ;
- site → audit → preview ;
- paquet PubCommander → brouillon → dry-run.

**Gate** : artefacts privés, diffs réversibles, tests déterministes et aucune
publication.

### Lot 4 — Dream Branching et apprentissage

- portefeuille multi-stratégies via Counterfactual Forge ;
- comparaison Shadow Twin ;
- surprise prouvée ;
- apprentissage des préférences confirmées et calibration des durées.

**Gate** : variante gagnante prouvée, budget respecté et possibilité de supprimer
tout apprentissage nocturne.

### Lot 5 — Ambassadeur, opt-in seulement

- destinations et quotas explicites ;
- approbation séparée de l'action exacte ;
- reçu, URL finale, mesure et rollback PubCommander.

**Gate** : tests d'idempotence, destination non autorisée refusée et restauration
réelle validée avant activation.

## Premier incrément recommandé

Le meilleur prochain incrément est **Lot 0 puis Lot 1**, sans sauter les défauts
de données découverts par l'audit. Le trajet visible reste limité à cinq
éléments :

1. Pacte du soir versionné.
2. Registre de sources en lecture seule.
3. Compilateur de plan privé, sans exécution externe.
4. Décisions durables qui attendent le réveil.
5. Living Briefing enrichi avec « demain est prêt ».

Il apporte immédiatement de la valeur, réutilise les fondations de Code Buddy
2.0 et prépare toutes les recettes futures sans figer l'architecture.

## Enseignements des projets récents

- [Sleep-time Compute](https://arxiv.org/abs/2504.13171) valide l'intérêt de
  pré-calculer ce qui est prévisible afin de réduire le coût et la latence au
  moment de la demande.
- [Letta co](https://github.com/letta-ai/co) sépare l'agent interactif d'un agent
  de fond chargé de la mémoire ; Tomorrow reprend cette séparation de rôles,
  mais garde les mutations de mémoire derrière une proposition vérifiable.
- [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
  confirme qu'une approbation humaine doit être persistée et reprise, pas
  représentée par une simple attente en mémoire.
- [Hermes Scheduled Tasks](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/cron.md)
  montre l'intérêt de sessions nocturnes fraîches, modèles épinglés, tâches sans
  LLM et interdiction de récursion.
- [OpenClaw Heartbeat](https://docs.openclaw.ai/gateway/heartbeat) illustre le
  réveil événementiel, le contexte léger et le skip sans appel modèle lorsqu'il
  n'existe aucune tâche due.
- [Google Workspace MCP](https://developers.google.com/workspace/guides/configure-mcp-servers)
  fournit une piste officielle pour Gmail et Calendar, avec l'avertissement
  important sur les injections indirectes dans les contenus Workspace.
- [OpenAI Agents HITL](https://openai.github.io/openai-agents-python/human_in_the_loop/)
  confirme que l'approbation doit porter sur un appel d'outil sérialisé exact.
- [GAIA](https://github.com/heygaia/gaia) montre l'utilité de tâches intelligentes
  et de déclencheurs email/calendrier ; Code Buddy doit reproduire les idées, pas
  copier son code sous licence PolyForm Strict.
- [Khoj Automations](https://docs.khoj.dev/features/automations/) confirme la
  valeur des recherches planifiées et du fuseau local, mais Tomorrow les relie
  à un contrat de journée et à des preuves.
- [π-Bench](https://github.com/Simplified-Reasoning/Pi-Bench) sépare proactivité
  et complétude dans des scénarios multi-session ; TomorrowBench adoptera cette
  distinction.
- [WorkArena](https://github.com/ServiceNow/workarena) fournit un modèle utile
  pour évaluer des tâches de travail par artefacts et critères plutôt que par
  impressions.
- [Inspect AI](https://inspect.aisi.org.uk/) fournit un format reproductible de
  scénarios, solveurs, scorers, sandboxes et limites ; TomorrowBench peut en
  reprendre les principes sans imposer un nouveau runtime au produit.
