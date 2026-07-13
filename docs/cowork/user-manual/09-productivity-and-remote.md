# 9. Productivité & contrôle distant

Des fonctions qui accélèrent le quotidien, plus le pilotage de Cowork à distance.

## 9.1 Mémoire <a id="mémoire"></a>

Cowork retient des faits durables entre les sessions — vos préférences, les décisions de projet, les
pièges récurrents.

- Quand l'agent apprend quelque chose à garder, une **carte mémoire** inline vous laisse l'éditer ou
  l'accepter.
- L'onglet **Mémoire** (panneau de contexte) et l'**inspecteur de mémoire** permettent de parcourir
  les entrées par catégorie (préférence, motif, contexte, décision) et de les éditer ou supprimer.
- La mémoire peut être **par projet**, pour que chaque projet garde son propre contexte. Choisissez
  une stratégie de mémoire (auto-recall / manuelle / fenêtre glissante) et un backend dans
  **Réglages → General / Code Buddy**.

## 9.2 Voix

- **Entrée vocale** — le 🎤 du composer transcrit la parole en texte (en local).
- **Overlay de chat vocal** — un mode mains libres avec micro en direct, transcription éditable, et
  synthèse vocale (TTS) pour les réponses de l'agent. Activez la sortie TTS et réglez le débit dans
  **Réglages → Audio**.
- **Réunion** — l’entrée dédiée de la barre latérale capture le micro après confirmation du
  consentement des participants. Elle sauvegarde des checkpoints locaux toutes les dix secondes,
  permet de reprendre après une interruption et crée des notes Markdown/JSON avec Whisper local.
  Elle ne rejoint pas Zoom, Meet ou Teams et ne capture pas l’audio système.

> _[capture : overlay de chat vocal]_

## 9.3 Résumé du presse-papier

Le panneau **presse-papier** peut surveiller votre presse-papier système et, quand vous copiez
quelque chose de conséquent, le résumer — puis envoyer ce résumé dans le chat comme prompt prêt à
l'emploi. Activez/désactivez la surveillance depuis l'icône presse-papier.

## 9.4 Palette de commandes & question éclair

- **Palette de commandes** (`Cmd/Ctrl+K`) — cherchez et lancez des actions en fuzzy (nouvelle
  session, changer de thème, ouvrir n'importe quel panneau).
- **Question éclair** (`/btw`) — une question ponctuelle sans démarrer une session complète.

## 9.5 Companion (vision & ouïe) — optionnel

Le panneau **Companion** active la perception locale : caméra (vision) et micro (ouïe), avec un
self-state, de la mémoire et des suggestions. C'est optionnel et désactivé par défaut ; activer la
caméra requiert une permission OS (accessibilité/caméra). À utiliser pour une interaction
présence-aware ou voix d'abord.

> _[capture : panneau companion]_

## 9.6 Planification

**Réglages → Schedule** lance des prompts sur minuterie — quotidien, hebdomadaire, ou une expression
cron. Chaque job planifié suit son dernier run et ses erreurs. À combiner avec des modes de
permission élevés pour des tâches sans surveillance (prudemment).

## 9.7 Contrôle distant <a id="controle-distant"></a>

Pilotez Cowork depuis une plateforme de messagerie. **Réglages → Remote** prend en charge
**Feishu/Lark** et **Slack**.

La configuration est un court assistant :

1. **Config plateforme** — pour Feishu : App ID + App Secret ; pour Slack : bot token, app token,
   signing secret. Choisissez une politique de DM (pairing vs auto-approve).
2. **Connexion** — port de la gateway (défaut 18789), dossier de travail par défaut, « auto-approuver
   les outils sûrs », et l'usage d'une connexion WebSocket longue durée.
3. **Avancé** — exposez éventuellement la gateway via un tunnel **ngrok** (nécessite un token d'auth
   ngrok).

Gérez ensuite la **gateway** (on/off), approuvez les **demandes de pairing**, et passez en revue les
**utilisateurs autorisés**. Une fois appairé, écrivez au bot et Cowork exécute la tâche — en
appliquant vos règles de permission — et répond dans le canal.

> _[capture : Réglages → Remote]_

## 9.8 Notifications

Un **centre de notifications** (cloche) rassemble les demandes de permission, les fins de tâche et les
erreurs ; des toasts les font remonter en temps réel. La diffusion vers des canaux externes peut se
câbler via les hooks/connecteurs.
