# Recette des 24 fonctionnalités — 2026-10-02

Base `70bcab004`, branche `fix/fonctions-reelles-2026-10-02`. Linux, Node 24.14.1, npm 11.17.0, ffmpeg 6.1.1. Les fichiers de preuve sont des extraits expurgés des captures conservées avec le rapport externe ; les chemins locaux sont remplacés par des noms symboliques.

## Protocole

`npm ci`, puis `npm run build`, `npm pack --ignore-scripts --pack-destination <DIR>`, puis `npm install --prefix <INSTALL> <ARCHIVE>`. L’option du pack évite seulement de répéter la compilation déjà terminée ; l’installation est exécutée normalement, sans suppression volontaire des dépendances optionnelles. L’entrée exécutée est `node <INSTALL>/node_modules/@phuetz/code-buddy/dist/cli-boot.js`, jamais le TypeScript du checkout. Les archives avant, intermédiaire et finale sont conservées séparément.

Chaque campagne part d’un HOME neuf `_qa/fonctions/home` et d’un dépôt jouet avec `README` contenant `Hello World!` et un `package.json` privé de version `1.0.0`. Les anciennes campagnes sont archivées, pas effacées. Environnement du processus construit par liste blanche : HOME, USERPROFILE, XDG_CONFIG_HOME, XDG_CACHE_HOME, PATH, LANG, TERM et NO_COLOR. Aucune clé de fournisseur, aucun profil du compte courant. PATH limité à un répertoire contenant seulement Node et aux binaires système. Un secret JWT jetable, uniquement pour l’authentification du serveur de test, est ajouté pour la flotte ; il ne configure aucun fournisseur LLM.

Le rapport initial donne plusieurs commandes abrégées, sans JSON, nom de session, port ou clips. Les arguments manquants ont été reconstruits : ils figurent dans chaque trace, et les fixtures ci-dessous ne sont pas présentées comme des résultats de modèle.

- Contrat autonome : objectif d’ajouter une ligne à README, `allowedPaths:["README"]`, vérification `node -e "console.log(123)"`, risque low. Dans le dépôt courant, le garde-fou d’auto-modification bloque faute de canal d’approbation. Avec le même contrat visant un second dépôt jouet propre, on atteint le fournisseur manquant. Aucun garde-fou contourné.
- CKG : `research fact add localhealth is online --category tool`, puis rappel structuré et hybride. Le binaire sharp du paquet est temporairement renommé puis restauré. La campagne finale retire aussi le binaire better-sqlite3 pendant les essais de repli.
- Sélection : `getRelevantTools("Read package.json and search for the version string", {maxTools:12})` importé depuis le paquet. Lecture directe : `ViewFileTool.execute({path:"README"}, {cwd:<WORKSPACE>})`.
- Session : fixture de deux messages persistée avec le vrai SessionStore (`QA_SESSION_MARKER`), puis list/search/resume. Aucune inférence simulée présentée comme réelle.
- Curator : une ligne synthétique du ledger council avec `costUsd:0.125` et la date du jour, puis scan ; ce montant n’a pas été dépensé.
- Evolve : fiche usage valide, preuve `audit-report`, hypothèse mesurable, budget financier zéro ; arrêt `PROVIDER_MISSING` avant toute expérience.
- Serveurs temporaires loopback : proxy 39110, serveur 39111 ; GET `/v1/models`, POST `/v1/chat/completions` et `/api/chat` avec `messages:[{role:"user",content:"Reply OK"}]`. A2A : carte puis `tasks/send` avec `agent:"codebuddy"` et message texte. Flotte : authentification, `peer.chat`, start/continue avec `prompt:"Reply OK"`/list/end. Tous les processus sont arrêtés. Le port 39109 laissé libre sert à éprouver le refus fleet status.
- Vidéo : deux clips de 2 s, 320×240, 25 i/s, rouge puis bleu, H.264/yuv420p et AAC (sinusoïdes 440/880 Hz), générés par ffmpeg lavfi. Manifeste FilmProject avec deux scènes ready, transition de 0,5 s. Appels `film assemble`, `film status` et `VideoStitchTool.execute` avec cut/fade/wipeleft. FFprobe vérifie les six résultats.
- Déclencheur : CRUD CLI `file_change:README notify:cli`, puis injection d’un événement synthétique dans le gestionnaire chargé depuis le registre persisté. Cela prouve l’évaluation du déclencheur, pas un observateur actif ni une réponse de modèle.
- Démon : start sur 39103, attente du point de santé HTTP, status JSON, stop. Les premiers essais sans attente sont conservés mais ne servent pas de preuve de santé.
- Runs : list/show/replay d’un vrai run autonome bloqué, sans événement d’outil. La preuve conclut explicitement à l’absence de rejeu possible.

## Validation

Les nouveaux oracles ont échoué avant leurs correctifs : 3 assertions dev/sélecteur, 1 prérequis HTTP, 5 assertions flotte/A2A/code de sortie autonome, 1 prérequis de vérification autonome, puis 1 entrée publique de sélection découverte lors du replay du paquet intermédiaire. Les suites ciblées passent après correction.

`npm run validate` avec les 12 fichiers ciblés : lint sans erreur (avertissements préexistants), typecheck principal et sous-projets, contrôle npm pack (11 tests), puis 252 tests. Build réussi. Les 2 tests d’intégration `dev-plan-native-modules.test.ts` passent aussi : aucun addon optionnel chargé et PLAN.md écrit malgré tous les chargements natifs forcés en échec. Ce dernier test utilise un serveur de modèle simulé sur loopback, pas une preuve d’inférence réelle.

## Portée des statuts

- **Testée localement** : le scénario précis annoncé est exécuté ; aucune généralisation aux autres médias, systèmes ou modes.
- **Prérequis vérifiés** : le refus et les instructions ont été éprouvés ; le succès avec fournisseur ou matériel n’est pas revendiqué.
- **Partiellement vérifiée** : les opérations locales indiquées sont prouvées, mais pas la chaîne complète.

Les 24 lignes correspondent à 5 scénarios testés localement, 9 contrôles de prérequis et 10 validations partielles. Les descriptions ont été restreintes en conséquence ; cela ne signifie pas 24 succès complets.

## Limites et écarts de protocole

Le crash natif initial du CKG et l’erreur ffmpeg 234 ne se reproduisent pas dans le paquet installé ici. Aucun correctif spéculatif ne leur est attribué. Les clips, version ffmpeg et certains arguments originaux ne sont pas fournis. Aucun test Windows/macOS, SSH/ADB, microphone/caméra réels, modèle authentifié, conversation prolongée ou évolution effective de code. Les zones ACP v2, harnais -p et porte de fiabilité restent inchangées.

Un premier essai avait conservé le PATH de l’hôte : un `peer.chat` a alors résolu `agy-cli` et répondu OK. Cette capture est exclue de la preuve sans fournisseur. Le PATH a été restreint, le profil final recréé et les essais rejoués. De même, un premier fleet status a trouvé un serveur existant sur 3000 : la preuve retenue utilise un port dédié absent. Aucun de ces services existants n’a été modifié.

## Archives npm — SHA-256

- `package` : `8958cae2f7ed8319c1a844eb14fa3dac06835cabd84098ca7d19406219e31c25`
- `package-after` : `cabcd8ace2821c19573d9ae8ed684754f6c0bcda20bfaaa903f6d9fcc2e8ae9f`
- `package-final` : `af8a33e2d0ead94e4e6f34794b8c3a321f0b231b6993925c7373b1a321ef41c8`

## Fiches

- [cli-dev](cli-dev.md) — Prérequis vérifiés
- [http-chat](http-chat.md) — Prérequis vérifiés
- [cli-autonomous-code](cli-autonomous-code.md) — Prérequis vérifiés
- [context-tool-selection](context-tool-selection.md) — Testée localement
- [fleet-peer-chat](fleet-peer-chat.md) — Prérequis vérifiés
- [fleet-peer-sessions](fleet-peer-sessions.md) — Partiellement vérifiée
- [http-a2a](http-a2a.md) — Prérequis vérifiés
- [tool-read-file](tool-read-file.md) — Partiellement vérifiée
- [cli-curator](cli-curator.md) — Testée localement
- [cli-session](cli-session.md) — Partiellement vérifiée
- [memory-ckg](memory-ckg.md) — Testée localement
- [fleet-cli](fleet-cli.md) — Prérequis vérifiés
- [cli-device](cli-device.md) — Partiellement vérifiée
- [cli-proxy](cli-proxy.md) — Prérequis vérifiés
- [cli-improve](cli-improve.md) — Partiellement vérifiée
- [cli-evolve](cli-evolve.md) — Prérequis vérifiés
- [dgm-authored-tools](dgm-authored-tools.md) — Partiellement vérifiée
- [cli-companion](cli-companion.md) — Prérequis vérifiés
- [media-film-assemble](media-film-assemble.md) — Testée localement
- [media-video-stitch](media-video-stitch.md) — Testée localement
- [cli-policy](cli-policy.md) — Partiellement vérifiée
- [cli-daemon](cli-daemon.md) — Partiellement vérifiée
- [cli-trigger](cli-trigger.md) — Partiellement vérifiée
- [cli-run](cli-run.md) — Partiellement vérifiée
