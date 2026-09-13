# Salons Fleet, agents et observations système

État : lot assemblé et validé, 14 septembre 2026. Commit source : `a5e95402a`.

## Objectif et provenance

Patrice a autorisé l'intégration des idées utiles de [block/buzz](https://github.com/block/buzz)
pour permettre aux membres de la flotte de communiquer, y compris les instances
associées au système sensoriel et au robot. Claude Opus a étudié l'upstream
`4cd82f513214aad11c2b742ce7cc7c681e8e32a0` et implémenté un premier lot dans
une branche isolée. Codex assemble les raccords et les corrections après revue.

Les idées adaptées sont les identités de membres, événements signés, salons avec
droits d'accès, fils de réponse, mentions, filtres et reprise d'abonnement.
Le transport reste le WebSocket `/ws` de Code Buddy. Il ne s'agit pas d'un
client universel compatible avec tous les relais Nostr, ni d'un déploiement de
Buzz Desktop, Postgres ou Redis. Voir également `INTEGRATION-BUZZ-OPUS.md`.

## Utilisation dans le système

- Les commandes `buddy fleet rooms` servent à créer une identité, publier et
  consulter les messages depuis le terminal.
- L'outil `fleet_room` donne aux agents accès à un salon fixé par configuration :
  `status`, `history`, `send`. Le modèle ne choisit pas les identifiants ou le hub.
  L'outil passe par la politique de confirmation existante et n'est pas exposé
  comme outil distant `fleetSafe`.
- Le pont d'observations publie des instantanés numériques locaux, avec
  `missionId`, UUID, provenance et horodatages. Il utilise une session signée
  normale et revérifie les droits lors de la publication. Il regroupe les
  changements et ne prétend pas journaliser chaque transition physique.

Les textes reçus restent des données externes. Le lot ne transforme pas un
message en exécution d'outil, ordre moteur, déclenchement de perception ou
validation automatique d'une étape WorkflowBuilder. L'exécution distribuée
utilise les mécanismes Fleet existants ; la messagerie apporte un espace de
communication et de reprise. Le déploiement automatique d'instances et le
raccord d'événements structurés à WorkflowBuilder restent des travaux distincts.

## Raccord des observations

En plus de l'activation et de la politique des salons :

```text
CODEBUDDY_FLEET_ROOMS_OBSERVATIONS=true
CODEBUDDY_FLEET_ROOMS_ROOM=robot-status
CODEBUDDY_FLEET_ROOMS_MISSION=robot:inspection-1
CODEBUDDY_FLEET_ROOMS_IDENTITY=<fichier-identite-local>
CODEBUDDY_FLEET_ROOMS_OBSERVATION_INTERVAL_MS=5000
```

Le membre doit être autorisé à écrire dans le salon. Si sa politique restreint
les `principals`, inclure `local:fleet-room-observations`. Le pont n'active pas
les producteurs sensoriels : `buddy-sense` ou les producteurs système doivent
déjà être configurés. Images, transcriptions, coordonnées et commandes ne font
pas partie des champs transmis. Les événements venant des pairs et du pont de
domaine sont exclus pour éviter les boucles.

## Revue et preuves

Corrections après la passation Opus, avec régressions testées :

- Le store vérifie lui-même identifiant et signature avant tout append. Toute
  ligne complète invalide stoppe le chargement ; seule une queue sans newline
  est mise en quarantaine. Le refus d'une signature falsifiée et la perte
  silencieuse d'une ligne avaient été reproduits sur le snapshot initial.
- Un mutex de récupération empêche deux processus de remplacer simultanément
  le verrou d'un écrivain mort. Un résidu de récupération reste fermé et doit
  être examiné manuellement. Le premier ledger est créé avec synchronisation du
  répertoire ; sa disparition provoque une nouvelle génération de curseurs.
- Les watermarks sont appliqués à la lecture après crash de compaction.
  Une maintenance échouée après append durable ne transforme pas l'acceptation
  de cet événement en refus ; les écritures suivantes sont bloquées.
- Le client valide les filtres complets, leurs copies, les ACK et les EOSE,
  sérialise les connexions et ignore les anciens sockets. Le changement de
  génération réinitialise le curseur. Les alertes de perte et de changement
  de génération restent visibles jusqu'à la fin d'un rejeu sur plusieurs pages.
- `fetch` rend une page bornée avec `truncated` et un curseur exploitable.
  Le suivi CLI conserve le curseur initial et termine sans attendre un signal
  lors d'un refus terminal. Les callbacks et les ressources sont nettoyés.
- Le catalogue de référence et la justification de l'effet réseau de
  `fleet_room` sont mis à jour sans affaiblir les contrôles de surface des outils.

La déduplication du hub est limitée aux événements encore retenus (2 000 par
salon par défaut), pas à un index historique infini. Après éviction, republier
un ancien événement peut créer une nouvelle séquence. Les clés sont déclarées
manuellement ; les observations préalables à l'acceptation restent une file
volatile et regroupée. Aucun test sur plusieurs machines physiques ou sur un
robot réel n'est revendiqué.

Premières preuves du lot assemblé :

- Build et typecheck du noyau verts ; typecheck supplémentaire des nouveaux
  tests vert, sans diminuer la rigueur TypeScript.
- Environnement utilisateur isolé : 18 fichiers, 142 tests verts avant le dernier
  complément de conservation des alertes de pagination.
- Parcours réel `buddy server` : publication/lecture sur son port éphémère,
  observation système signée reçue, fermeture et réouverture du journal.
- Parcours réel de l'outil : fabrique standard, `/ws` authentifié, identité
  temporaire, refus d'écriture du lecteur, aucune perception réémise.
- Première `npm run validate` : lint/typecheck/pack verts ; 38 536 tests verts,
  15 rouges. Deux gates du nouvel outil ont été actualisées ; les deux timeouts
  shell sont verts en reprise isolée. Reprise des quatre fichiers concernés :
  196/196. Les onze autres échecs sont ceux reproduits avant ce lot sur la base
  (configuration locale du serveur, appareils et modèle).

Validation finale :

- `npm run validate` avec `HOME`/`CODEBUDDY_HOME` temporaires et quatre workers :
  **exit 0**, lint sans erreur, typechecks noyau/paquets verts, contrôle pack 10/10 ;
  **2 150 fichiers verts, 9 ignorés ; 38 534 tests verts, 37 ignorés, 1 todo**.
  L'absence du cache Chromium dans ce HOME ajoute 19 tests navigateur ignorés
  par leurs gardes existantes ; ils ne sont pas présentés comme exécutés dans
  cette passe. Les onze échecs de configuration locale disparaissent avec
  l'environnement vierge. Log de travail : `/tmp/cb-rooms-final-isolated-validate.log`.
- Node **20.20.2** réel, HOME isolé : **15 fichiers / 133 tests verts**, incluant
  salons, observations, outil agent, surface du catalogue et taxonomie des effets.
- Build de distribution vert et vérification indépendante du paquet installé
  sans dépendances de développement : CLI, identité privée 0600, imports, store
  et outil verts sous Node 20.20.2 et 24.14.1. Serveur compilé réel en loopback,
  JWT et deux identités : publication et lecture cohérentes, arrêt propre.
  Aucun lien hors du préfixe d'installation ni module de distribution manquant.
- Tarball `phuetz-code-buddy-2.0.0.tgz`, SHA-1
  `b1a5978891e193bb7c601ff6ac34a2bdcdc51c63`, 5 133 entrées.
  Installation avec `--ignore-scripts` : SQLite optionnel indisponible dans
  cette sonde, sans blocage des salons. Le contrôle de dépendances signale
  également du bruit préexistant de pairs Zod et react-devtools-core.
  Preuves : `/tmp/cb-rooms-package-validation-summary.log` et
  `/tmp/cb-rooms-package-validation-server.log`. Aucun paquet publié ni
  remplacement du lanceur installé de Patrice.
