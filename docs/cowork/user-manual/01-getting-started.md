# 1. Démarrage

Ce chapitre vous mène de zéro à votre première tâche réalisée.

## 1.1 Installation

Cowork est disponible pour **Windows, macOS et Linux**.

### Paquets publiés

La release 2.2.0 contient uniquement le paquet CLI npm. Aucun installateur
Cowork `.exe`, `.app` ou `AppImage` n’est publié dans cette release. Utilisez
les sources ci-dessous ; installer le CLI avec npm ne fournit pas Cowork.

### Option B — Depuis les sources (développeurs)
Nécessite **Node.js ≥ 22**.

```bash
git clone https://github.com/phuetz/code-buddy
cd code-buddy
npm install
npm run build
node dist/index.js install-gui  # installe les dépendances Cowork et construit le bundle
node dist/index.js gui             # lance l'application (alias : buddy desktop)

# Boucle de dev (hot reload) :
cd cowork && npx vite build
xvfb-run -a env NODE_ENV=production ./node_modules/electron/dist/electron --no-sandbox --disable-gpu ./dist-electron/main/index.js
```

> _[capture : premier lancement de l'app]_

## 1.2 Assistant de configuration

Au premier lancement, un **assistant en 5 étapes** vous guide. Utilisez les flèches (← →) ou les
boutons à l'écran pour naviguer.

1. **Langue & thème** — choisissez votre langue (**English**, **Français** ou **中文**) et un thème
   (Clair, Sombre, Open Cowork, ou Système). Vous choisissez aussi un parcours : *Démarrage rapide*,
   *Contrôle total*, ou *Configurer plus tard*.
2. **Provider IA** — ouvrez les réglages API et connectez un modèle (voir §1.3). L'assistant peut
   tester la connexion pour éviter de découvrir une mauvaise clé trop tard.
3. **Dossier de travail** — choisissez le dossier par défaut où l'agent pourra lire et écrire. Tout
   ce que fait l'agent est limité à ce dossier.
4. **Capacités companion** *(optionnel)* — activez ou ignorez la voix, la caméra, les notifications
   et les fonctions fleet. Modifiable ensuite dans les Réglages.
5. **Première tâche** — tapez votre première instruction.

Tout est modifiable plus tard depuis les **Réglages** (`Cmd/Ctrl+,`).

> _[capture : assistant — étape langue & thème]_

## 1.3 Connecter un provider IA

Ouvrez **Réglages → API** (ou l'étape provider de l'assistant). Cowork prend en charge de nombreux
providers :

- **Cloud (clé API) :** Anthropic, OpenAI, Gemini, Grok, Groq, Mistral, Together, Fireworks,
  OpenRouter.
- **Connexion par abonnement :** ChatGPT (connectez-vous avec votre compte ChatGPT — aucune clé API).
- **Local :** Ollama, LM Studio, vLLM (pointez Cowork vers le serveur local ; aucune clé requise).

Étapes :

1. Choisissez un **provider**.
2. Collez votre **clé API** (ou cliquez **Login** pour ChatGPT, ou laissez vide pour un provider
   local).
3. Renseignez une **Base URL** seulement si vous utilisez un endpoint personnalisé/auto-hébergé.
4. Choisissez un **modèle**.
5. Cliquez **Test** pour vérifier la connexion, puis enregistrez.

> **Astuce.** Vous pouvez enregistrer plusieurs configurations de provider et basculer entre elles,
> et changer de modèle en cours de session depuis l'en-tête du chat (voir
> [Travailler avec l'agent](03-working-with-the-agent.md)).

> _[capture : Réglages → API]_

## 1.4 Votre première session

1. Depuis l'écran d'**accueil**, **sélectionnez un dossier de travail** (glissez un dossier sur la
   fenêtre, ou utilisez le sélecteur). C'est obligatoire avant de démarrer.
2. Tapez une tâche dans le composer. Bonnes premières tâches :
   - *« Résume ce que fait ce projet et liste ses modules principaux. »*
   - *« Lis data.csv et génère une présentation PowerPoint de 5 slides. »*
   - *« Trouve et corrige le test qui échoue dans ce dossier. »*
3. Optionnel : **joignez des fichiers ou images** (bouton **+**, ou glisser-déposer).
4. Appuyez sur **Entrée** (ou **Ctrl+Entrée**) pour envoyer.
5. Regardez l'agent travailler : il diffuse son raisonnement, appelle des outils, et **demande votre
   accord** avant toute action sensible (écrire des fichiers, lancer des commandes). Approuvez ou
   refusez chaque demande.
6. Les résultats — fichiers générés, diffs, artifacts — apparaissent dans le chat et dans le
   **panneau de contexte** à droite.

C'est une boucle complète. Les chapitres suivants détaillent l'interface et le pilotage de l'agent.

> _[capture : première session — agent qui répond avec une demande d'approbation]_
