# Fonctionnalités de Code Buddy

Ce catalogue couvre **91 capacités visibles par l’utilisateur** dans le code source actuel. « Raccordée » signifie que les fichiers et les maillons déclarés du point d’entrée existent. « Testée localement » exige une vraie commande ou un tour agent sous HOME isolé avec trace. Aucune entrée n’est présentée comme déployée depuis ce checkout. Le bénéfice décrit la capacité visée par le raccordement ; la preuve d’exécution ne couvre que le scénario nommé dans sa trace.

La [recette du 2 octobre 2026](preuves/fonctions-reelles-2026-10-02/README.md) distingue aussi **Prérequis vérifiés** (refus explicite éprouvé, succès non démontré) et **Partiellement vérifiée** (seules les opérations indiquées sont prouvées).

Preuves : [audit statique des raccordements](preuves/verification-statique.md) · [trace de la commande catalogue](preuves/p5-catalog-status-2026-09-29.log).

## Agent et outils

| Fonctionnalité | Bénéfice utilisateur | État | Preuve |
|---|---|---|---|
| `resource-catalog-tool` — Outil de sélection des ressources | Trouvez les ressources disponibles pour une tâche d’agent. | **Testée localement** | [Trace réelle](preuves/p5-resource-catalog-tool-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#resource-catalog-tool) |
| `cli-code-explorer` — Code Explorer integration | Inspectez les relations du code et la synchronisation de session. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#cli-code-explorer) |
| `cli-tools` — Tool availability | Inspectez les outils disponibles et leurs profils. | **Testée localement** | [Trace réelle](preuves/p5-cli-tools-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-tools) |
| `cli-autonomous-code` — Guarded coding cell | Exécutez un contrat encadré avec les autorisations et le fournisseur requis ; un blocage ou une vérification échouée retourne un code non nul. | **Prérequis vérifiés** | [Recette du 02/10](preuves/fonctions-reelles-2026-10-02/cli-autonomous-code.md) ; [Raccordement](preuves/verification-statique.md#cli-autonomous-code) |
| `cli-dev` — Developer workflows | Planifiez et expliquez un dépôt avec un fournisseur configuré ; sans fournisseur, refus explicite et aucun PLAN.md. | **Prérequis vérifiés** | [Recette du 02/10](preuves/fonctions-reelles-2026-10-02/cli-dev.md) ; [Raccordement](preuves/verification-statique.md#cli-dev) |
| `cli-skills` — Installed skills | Listez les packs de skills installés et leur origine. | **Testée localement** | [Trace réelle](preuves/p5-cli-skills-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-skills) |
| `cli-bundles` — Skill bundles | Regroupez des skills sous une commande nommée. | **Testée localement** | [Trace réelle](preuves/p5-cli-bundles-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-bundles) |
| `cli-lsp` — LSP diagnostics | Inspectez les diagnostics du serveur de langage. | **Échec constaté** | [Trace de l’échec](preuves/p5-cli-lsp-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-lsp) |
| `tool-web-search` — Web search | Obtenez des résultats web pour une tâche de l’agent. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#tool-web-search) |
| `tool-browser` — Browser automation | Parcourez des pages avec l’outil navigateur de l’agent. | **Testée localement** | [Trace réelle](preuves/p7-tool-browser.log); [Maillons vérifiés](preuves/verification-statique.md#tool-browser) |
| `tool-deep-research` — Deep research | Préparez un rapport de recherche étayé en plusieurs étapes. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#tool-deep-research) |
| `tool-verify` — Verification tool | Demandez à l’agent de vérifier un résultat concret. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#tool-verify) |
| `agent-loop` — Agent tool loop | Poursuivez une demande sur plusieurs réponses du modèle et résultats d’outils. | **Testée localement** | [Trace réelle](preuves/p5-agent-loop-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#agent-loop) |
| `tool-read-file` — File reading | Laissez l’agent lire un fichier du projet avant de répondre. | **Testée localement** | [Trace réelle](preuves/p5-tool-read-file-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#tool-read-file) |
| `context-tool-selection` — Tool selection | Sélectionnez les outils pertinents en conservant tool_search dans la sélection par défaut lorsqu’il est disponible. | **Testée localement** | [Recette du 02/10](preuves/fonctions-reelles-2026-10-02/context-tool-selection.md) ; [Raccordement](preuves/verification-statique.md#context-tool-selection) |

## Fournisseurs et bascule

| Fonctionnalité | Bénéfice utilisateur | État | Preuve |
|---|---|---|---|
| `cli-auth-profile` — Authentication profiles | Gérez les profils d’authentification des fournisseurs. | **Échec constaté** | [Trace de l’échec](preuves/p7-cli-auth-profile.log); [Maillons vérifiés](preuves/verification-statique.md#cli-auth-profile) |
| `provider-ollama` — Local Ollama provider | Utilisez un modèle servi localement sans clé API payante. | **Testée localement** | [Trace réelle](preuves/p5-provider-ollama-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#provider-ollama) |
| `provider-failover` — Provider failover | Basculez vers un fournisseur configuré après un échec admissible. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#provider-failover) |
| `provider-chatgpt-oauth` — ChatGPT OAuth provider | Utilisez un backend Responses authentifié par ChatGPT. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#provider-chatgpt-oauth) |
| `provider-gemini-cli` — Gemini CLI provider | Utilisez le sous-processus Gemini CLI comme voie vers le modèle. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#provider-gemini-cli) |
| `provider-agy-cli` — AGY CLI provider | Utilisez le sous-processus AGY CLI comme voie vers le modèle. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#provider-agy-cli) |

## Contexte et mémoire

| Fonctionnalité | Bénéfice utilisateur | État | Preuve |
|---|---|---|---|
| `cli-curator` — Local curator | Examinez des propositions d’entretien de la mémoire, des skills et des coûts. | **Testée localement** | [Trace réelle](preuves/p6-cli-curator.log); [Maillons vérifiés](preuves/verification-statique.md#cli-curator) |
| `cli-identity` — Agent identity files | Gérez les fichiers locaux d’identité de l’agent et de l’utilisateur. | **Testée localement** | [Trace réelle](preuves/p5-cli-identity-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-identity) |
| `cli-session` — Saved sessions | Gérez les conversations enregistrées et leur reprise. | **Testée localement** | [Trace réelle](preuves/p5-cli-session-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-session) |
| `cli-user-model` — User preference model | Examinez un modèle structuré des préférences de travail. | **Testée localement** | [Trace réelle](preuves/p6-cli-user-model.log); [Maillons vérifiés](preuves/verification-statique.md#cli-user-model) |
| `context-compaction` — Context compaction | Maintenez les longues conversations dans le budget de contexte du modèle. | **Testée localement** | [Trace réelle](preuves/p6-context-compaction.log); [Maillons vérifiés](preuves/verification-statique.md#context-compaction) |
| `memory-ckg` — Collective knowledge graph | Rappelez des connaissances partagées par le graphe CKG. | **Testée localement** | [Trace réelle](preuves/p6-memory-ckg.log); [Maillons vérifiés](preuves/verification-statique.md#memory-ckg) |
| `context-checkpoints` — Session checkpoints | Créez des points de contrôle et revenez sur les modifications de l’agent. | **Testée localement** | [Trace réelle](preuves/p7-context-checkpoints.log); [Maillons vérifiés](preuves/verification-statique.md#context-checkpoints) |

## Flotte

| Fonctionnalité | Bénéfice utilisateur | État | Preuve |
|---|---|---|---|
| `fleet-cli` — Commandes de la flotte | Inspectez et pilotez la flotte multi-agents dans le terminal. | **Testée localement** | [Trace réelle](preuves/p6-fleet-cli.log); [Maillons vérifiés](preuves/verification-statique.md#fleet-cli) |
| `cli-ruche` — Signed coordination | Échangez des messages de coordination signés. | **Testée localement** | [Trace réelle](preuves/p7-cli-ruche.log); [Maillons vérifiés](preuves/verification-statique.md#cli-ruche) |
| `cli-device` — Remote device nodes | Gérez des nœuds SSH, ADB et locaux. | **Testée localement** | [Trace réelle](preuves/p5-cli-device-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-device) |
| `cli-nodes` — Companion app nodes | Gérez les nœuds de l’application compagnon sur ordinateur et mobile. | **Échec constaté** | [Trace de l’échec](preuves/p7-cli-nodes.log); [Maillons vérifiés](preuves/verification-statique.md#cli-nodes) |
| `fleet-peer-chat` — Peer chat | Envoyez une requête au modèle d’un pair connecté de la flotte. | **Testée localement** | [Trace réelle](preuves/p6-fleet-peer-chat.log); [Maillons vérifiés](preuves/verification-statique.md#fleet-peer-chat) |
| `fleet-peer-tools` — Peer read-only tools | Demandez un outil autorisé en lecture seule à un pair. | **Testée localement** | [Trace réelle](preuves/p6-fleet-peer-tools.log); [Maillons vérifiés](preuves/verification-statique.md#fleet-peer-tools) |
| `fleet-peer-sessions` — Multi-turn peer sessions | Poursuivez une conversation avec un pair de la flotte sur plusieurs tours. | **Testée localement** | [Trace réelle](preuves/p6-fleet-peer-sessions.log); [Maillons vérifiés](preuves/verification-statique.md#fleet-peer-sessions) |

## Serveur et API

| Fonctionnalité | Bénéfice utilisateur | État | Preuve |
|---|---|---|---|
| `http-health` — Route HTTP de santé | Vérifiez la santé du serveur HTTP. | **Testée localement** | [Trace réelle](preuves/p5-http-health-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#http-health) |
| `cli-gateway-pairing` — Gateway pairing approval | Approuvez ou refusez l’association d’un appareil à la passerelle. | **Testée localement** | [Trace réelle](preuves/p7-cli-gateway-pairing.log); [Maillons vérifiés](preuves/verification-statique.md#cli-gateway-pairing) |
| `cli-acp` — Editor agent protocol | Reliez un éditeur à l’agent par ACP sur stdio. | **Testée localement** | [Trace réelle](preuves/p7-cli-acp.log); [Maillons vérifiés](preuves/verification-statique.md#cli-acp) |
| `cli-proxy` — OpenAI-compatible proxy | Exposez un proxy compatible OpenAI aux clients. | **Testée localement** | [Trace réelle](preuves/p7-cli-proxy.log); [Maillons vérifiés](preuves/verification-statique.md#cli-proxy) |
| `cli-token` — API token | Créez un jeton signé d’accès à l’API. | **Testée localement** | [Trace réelle](preuves/p5-cli-token-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-token) |
| `cli-pair` — Android pairing | Associez localement un authentificateur Android. | **Testée localement** | [Trace réelle](preuves/p7-cli-pair.log); [Maillons vérifiés](preuves/verification-statique.md#cli-pair) |
| `cli-devices` — Android devices | Listez et révoquez les authentificateurs associés. | **Testée localement** | [Trace réelle](preuves/p7-cli-devices.log); [Maillons vérifiés](preuves/verification-statique.md#cli-devices) |
| `http-chat` — Chat HTTP API | Envoyez une conversation HTTP avec un fournisseur configuré ; sinon HTTP 503 avec instructions de configuration. | **Prérequis vérifiés** | [Recette du 02/10](preuves/fonctions-reelles-2026-10-02/http-chat.md) ; [Raccordement](preuves/verification-statique.md#http-chat) |
| `http-sessions` — Sessions HTTP API | Inspectez et gérez les sessions enregistrées en HTTP. | **Testée localement** | [Trace réelle](preuves/p7-http-sessions.log); [Maillons vérifiés](preuves/verification-statique.md#http-sessions) |
| `http-memory` — Memory HTTP API | Lisez et mettez à jour la mémoire de l’agent en HTTP. | **Testée localement** | [Trace réelle](preuves/p7-http-memory.log); [Maillons vérifiés](preuves/verification-statique.md#http-memory) |
| `http-a2a` — A2A task API | Échangez des tâches d’agents sur le point d’entrée A2A. | **Testée localement** | [Trace réelle](preuves/p5-http-a2a-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#http-a2a) |

## Cowork

| Fonctionnalité | Bénéfice utilisateur | État | Preuve |
|---|---|---|---|
| `cowork-studio` — App Studio | Itérez sur une application dans le studio de bureau. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#cowork-studio) |
| `cowork-video-studio` — Video Studio | Organisez le travail vidéo dans une vue de bureau. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#cowork-video-studio) |
| `cowork-desktop-chat` — Desktop chat | Poursuivez une session dans l’espace de travail Cowork. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#cowork-desktop-chat) |
| `cowork-desktop-assistant` — Desktop assistant | Ouvrez la vue compagnon dans Cowork. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#cowork-desktop-assistant) |
| `cowork-desktop-settings` — Desktop settings | Réglez Cowork dans la fenêtre de bureau. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#cowork-desktop-settings) |

## Auto-amélioration et DGM

| Fonctionnalité | Bénéfice utilisateur | État | Preuve |
|---|---|---|---|
| `cli-improve` — Empirical improvement | Lancez des expériences d’apprentissage encadrées. | **Testée localement** | [Trace réelle](preuves/p6-cli-improve.log); [Maillons vérifiés](preuves/verification-statique.md#cli-improve) |
| `cli-evolve` — Evolution experiments | Proposez et examinez des variantes de code par commandes explicites. | **Testée localement** | [Trace réelle](preuves/p7-cli-evolve.log); [Maillons vérifiés](preuves/verification-statique.md#cli-evolve) |
| `dgm-learning-cycle` — Learning cycle | Essayez un cycle d’apprentissage borné depuis la commande improve. | **Testée localement** | [Trace réelle](preuves/p6-dgm-learning-cycle.log); [Maillons vérifiés](preuves/verification-statique.md#dgm-learning-cycle) |
| `dgm-authored-tools` — Authored tool experiments | Évaluez des outils proposés par l’agent avec la commande improve. | **Testée localement** | [Trace réelle](preuves/p6-dgm-authored-tools.log); [Maillons vérifiés](preuves/verification-statique.md#dgm-authored-tools) |
| `dgm-evolve-propose` — Evolution proposals | Inspectez une proposition d’expérience d’évolution du code. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#dgm-evolve-propose) |
| `dgm-capability-benchmark` — Capability benchmark | Mesurez un modèle sélectionné sur un scénario de capacité défini. | **Testée localement** | [Trace réelle](preuves/p7-dgm-capability-benchmark.log); [Maillons vérifiés](preuves/verification-statique.md#dgm-capability-benchmark) |

## Sensoriel et compagnon

| Fonctionnalité | Bénéfice utilisateur | État | Preuve |
|---|---|---|---|
| `telegram-channel` — Canal Telegram | Reliez les conversations à Telegram. | **Testée localement** | [Trace réelle](preuves/p7-telegram-channel.log); [Maillons vérifiés](preuves/verification-statique.md#telegram-channel) |
| `cli-speak` — Speech synthesis | Produisez une sortie vocale à partir de texte. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#cli-speak) |
| `cli-assistant` — Voice assistant | Configurez l’assistante vocale Lisa. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#cli-assistant) |
| `cli-heartbeat` — Heartbeat engine | Inspectez et configurez les réveils périodiques de l’agent. | **Échec constaté** | [Trace de l’échec](preuves/p7-cli-heartbeat.log); [Maillons vérifiés](preuves/verification-statique.md#cli-heartbeat) |
| `cli-screen` — Screen capture | Capturez ou surveillez l’activité du bureau. | **Testée localement** | [Trace réelle](preuves/p7-cli-screen.log); [Maillons vérifiés](preuves/verification-statique.md#cli-screen) |
| `cli-companion` — Companion settings | Configurez le comportement et la voix du compagnon. | **Testée localement** | [Trace réelle](preuves/p7-cli-companion.log); [Maillons vérifiés](preuves/verification-statique.md#cli-companion) |
| `sensory-voice-loop` — Voice conversation loop | Transformez la parole entendue en réponse vocale du compagnon. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#sensory-voice-loop) |

## Vidéo et médias

| Fonctionnalité | Bénéfice utilisateur | État | Preuve |
|---|---|---|---|
| `cli-film` — Film production | Assemblez des clips de scènes en film. | **Testée localement** | [Trace réelle](preuves/p6-cli-film.log); [Maillons vérifiés](preuves/verification-statique.md#cli-film) |
| `tool-image-generate` — Image generation | Demandez une image au fournisseur configuré. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#tool-image-generate) |
| `tool-video-generate` — Video generation | Demandez un clip vidéo au moteur configuré. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#tool-video-generate) |
| `tool-understand-video` — Video understanding | Extrayez des informations vidéo avec les outils médias configurés. | **Échec constaté** | [Trace de l’échec](preuves/p7-tool-understand-video.log); [Maillons vérifiés](preuves/verification-statique.md#tool-understand-video) |
| `media-film-assemble` — Film assembly | Assemblez des clips prêts avec transitions et audio. | **Testée localement** | [Trace réelle](preuves/p6-media-film-assemble.log); [Maillons vérifiés](preuves/verification-statique.md#media-film-assemble) |
| `media-video-stitch` — Video clip stitching | Combinez des clips prêts avec transitions. | **Testée localement** | [Trace réelle](preuves/p6-media-video-stitch.log); [Maillons vérifiés](preuves/verification-statique.md#media-video-stitch) |

## Sécurité

| Fonctionnalité | Bénéfice utilisateur | État | Preuve |
|---|---|---|---|
| `cli-security` — Security audit | Auditez la sécurité du projet et du profil local. | **Testée localement** | [Trace réelle](preuves/p6-cli-security.log); [Maillons vérifiés](preuves/verification-statique.md#cli-security) |
| `cli-groups` — Group chat security | Configurez les accès aux discussions de groupe. | **Échec constaté** | [Trace de l’échec](preuves/p5-cli-groups-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-groups) |
| `cli-policy` — Policy diagnostics | Inspectez et réparez les constats de politique par domaine. | **Testée localement** | [Trace réelle](preuves/p6-cli-policy.log); [Maillons vérifiés](preuves/verification-statique.md#cli-policy) |
| `cli-secrets` — Encrypted secrets vault | Gérez les identifiants dans le coffre local chiffré. | **Testée localement** | [Trace réelle](preuves/p7-cli-secrets.log); [Maillons vérifiés](preuves/verification-statique.md#cli-secrets) |
| `cli-approvals` — Action approvals | Examinez les approbations d’outils et d’actions en attente. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#cli-approvals) |
| `security-sandbox` — Native shell sandbox | Confinez les commandes shell lorsque le bac à sable natif est activé. | **Testée localement** | [Trace réelle](preuves/p6-security-sandbox.log); [Maillons vérifiés](preuves/verification-statique.md#security-sandbox) |
| `security-skill-firewall` — Skill firewall | Analysez les skills à la recherche de capacités risquées avant usage. | **Testée localement** | [Trace réelle](preuves/p5-security-skill-firewall-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#security-skill-firewall) |

## CLI et parcours

| Fonctionnalité | Bénéfice utilisateur | État | Preuve |
|---|---|---|---|
| `catalog-status` — Catalogue des états et preuves | Consultez le niveau de preuve des fonctionnalités avant de les présenter. | **Testée localement** | [Trace réelle](preuves/p5-catalog-status-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#catalog-status) |
| `cli-daemon` — Background daemon | Exécutez Code Buddy comme processus de fond administré. | **Testée localement** | [Trace réelle](preuves/p7-cli-daemon.log); [Maillons vérifiés](preuves/verification-statique.md#cli-daemon) |
| `cli-trigger` — Event triggers | Configurez des réponses de l’agent déclenchées par événement. | **Testée localement** | [Trace réelle](preuves/p5-cli-trigger-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-trigger) |
| `cli-widgets` — Conversation widgets | Gérez les widgets intégrés aux conversations. | **Testée localement** | [Trace réelle](preuves/p5-cli-widgets-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-widgets) |
| `cli-hub` — Skills marketplace | Recherchez et gérez des skills partagés. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#cli-hub) |
| `cli-triage` — Support bundle | Créez un dossier de diagnostic local expurgé. | **Testée localement** | [Trace réelle](preuves/p5-cli-triage-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-triage) |
| `cli-hermes` — Hermes profile | Inspectez le profil agent natif de type Hermes. | **Testée localement** | [Trace réelle](preuves/p5-cli-hermes-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-hermes) |
| `cli-config` — Configuration | Inspectez la configuration effective et les réglages manquants. | **Testée localement** | [Trace réelle](preuves/p7-cli-config.log); [Maillons vérifiés](preuves/verification-statique.md#cli-config) |
| `cli-run` — Run observability | Inspectez les traces et rejouez les exécutions de l’agent. | **Testée localement** | [Trace réelle](preuves/p5-cli-run-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-run) |
| `cli-cron` — Scheduled jobs | Créez et gérez des tâches planifiées. | **Testée localement** | [Trace réelle](preuves/p7-cli-cron.log); [Maillons vérifiés](preuves/verification-statique.md#cli-cron) |
| `cli-insights` — Usage insights | Consultez les mesures de jetons, de coût et d’activité. | **Testée localement** | [Trace réelle](preuves/p7-cli-insights.log); [Maillons vérifiés](preuves/verification-statique.md#cli-insights) |
| `cli-deploy` — Web deployment workflow | Préparez un déploiement web par un parcours CLI. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#cli-deploy) |
| `cli-provision` — Project provisioning | Préparez base de données et authentification d’un projet généré. | **Testée localement** | [Trace réelle](preuves/p5-cli-provision-2026-09-29.log); [Maillons vérifiés](preuves/verification-statique.md#cli-provision) |
| `cli-update` — Update channels | Inspectez les canaux de mise à jour. | **Raccordée** | [Maillons vérifiés](preuves/verification-statique.md#cli-update) |

## Limites

La plupart des capacités demandent un service, un second pair, des médias, du matériel, des identifiants ou une session Electron avant de pouvoir être validées en situation. La raison figure pour chaque entrée dans l’[audit statique](preuves/verification-statique.md) et dans le [rapport de mission](reports/2026-09/RAPPORT-INVENTAIRE-FONCTIONNALITES-2026-09-27.md). La découverte automatique ajoute d’autres noms CLI/outils à implémentation **inconnue** ; ils ne font pas partie de ces 91 affirmations.
