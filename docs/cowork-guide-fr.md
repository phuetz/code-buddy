# Guide utilisateur Cowork

Cowork est le cockpit desktop de Code Buddy. Il regroupe le chat, les outils, les traces, les workflows, les réglages, les permissions, les connecteurs MCP, Fleet, le compagnon Buddy et la fenêtre **Tests & executions** dans une application Electron.

Chaque capture ci-dessous est un PNG local au dépôt. Les documents publics et les captures sont vérifiés par `tests/docs/public-screenshot-privacy.test.ts` pour éviter de publier des comptes, tokens ou chemins locaux privés.

## 1. Préparer Code Buddy

Depuis le dépôt source :

```bash
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy
npm install
npm run build
```

Pour utiliser un abonnement ChatGPT Plus / Pro comme route modèle :

```bash
buddy login
buddy whoami
```

Pour les flux Cowork appuyés par le serveur local :

```bash
buddy server --port 3000
```

Cowork peut aussi utiliser les providers configurés par clé API dans Settings.

## 2. Lancer Cowork

Depuis le dépôt source :

```bash
npm run dev:gui
```

Le premier écran affiche la surface de travail. Sélectionne un workspace, puis démarre un chat ou ouvre les panneaux depuis la barre latérale.

![Surface de travail Cowork](./qa/code-buddy-studio/screenshots/01-home-work-surface.png)

## 3. Configurer la route agent

Ouvre **Settings** pour choisir le provider, le modèle, le mode du moteur embarqué, l'URL backend, le comportement des permissions, les connecteurs MCP, les plugins et les quick prompts.

![Réglages Cowork](./qa/code-buddy-studio/screenshots/22-settings.png)

Pour la route ChatGPT OAuth, lance d'abord `buddy login`, puis choisis le profil ou modèle ChatGPT dans Cowork. Le run Electron réel ci-dessous force le profil ChatGPT et rend le marqueur `REAL-GPT55-COWORK-GUI`.

![Cowork ChatGPT gpt-5.5 réel](./qa/code-buddy-studio/screenshots/29-real-gpt55-cowork-gui.png)

## 4. Utiliser chat, fichiers et contexte workspace

Flux typique :

1. Sélectionner un dossier workspace.
2. Joindre des fichiers ou les déposer dans le champ de chat.
3. Demander une sortie concrète : rapport, changement de code, tableur, suite de tests.
4. Relire les appels d'outils et la trace avant d'accepter une action risquée.
5. Sauvegarder ou exporter les artefacts produits.

Cowork garde les opérations de fichiers dans le workspace sélectionné. Le moteur applique les mêmes protections que le CLI : réparation de transcript, sanitizer de sortie, routage MCP et changement de modèle à chaud.

## 5. Relire les permissions avant les actions risquées

Quand l'agent demande une opération sensible, Cowork affiche un dialogue de permission. Le flux E2E réel injecte une demande Bash, clique **Allow**, persiste une règle d'écriture à portée limitée, puis prouve que la fenêtre de tests peut rejouer ce scénario depuis l'application desktop.

![Flux de permission réel](./qa/code-buddy-studio/screenshots/55-test-runner-permission-real-flow.png)

Bonnes pratiques :

- Approuver une seule commande pour une action ponctuelle.
- Persister une règle de chemin seulement si le scope est volontaire.
- Garder l'automatisation desktop destructive en opt-in.
- Relancer les tests sûrs avant de publier un résultat.

## 6. Exécuter les vérifications réelles depuis le desktop

La fenêtre **Tests & executions** lance les bundles locaux sûrs et les checks réels opt-in. Elle affiche le statut, les compteurs, les badges d'environnement et l'historique d'exécution.

![Fenêtre Tests & executions](./qa/code-buddy-studio/screenshots/30-test-runner-window.png)

Lignes utiles :

| Ligne | Preuve |
| --- | --- |
| `Cowork / real GPT-5.5 chat` | Chat Electron réel via ChatGPT OAuth |
| `Server / real GPT-5.5 chat API` | Routes HTTP locales avec ChatGPT OAuth |
| `Cowork / permission real flow` | Prompt de permission réel et règle persistée |
| `MCP / real transport suite` | Fixtures MCP stdio/HTTP et garde fail-closed |
| `Computer Use / real desktop suite` | WinForms, dialogue, Notepad et Excel COM en opt-in |
| `Hermes / built CLI real smoke` | Rebuild Code Buddy, vérifie tools/doctor Hermes, prouve le garde-fou lifecycle et documente l'attach Vercel Sandbox |

Le runner expose aussi le suivi des exécutions :

![Suivi des exécutions](./qa/code-buddy-studio/screenshots/31-test-runner-executions.png)

La ligne Hermes reste manuelle car elle reconstruit le CLI compilé avant de l'exécuter. Elle prouve `hermes tools`, `hermes doctor safe`, le plan Daytona attach, le blocage Daytona et Vercel Sandbox de `--execute` sans allow flags et le mapping Vercel Sandbox attach.

![Guard lifecycle Hermes built CLI](./qa/code-buddy-studio/screenshots/109-test-runner-hermes-built-cli-real.png)

Quand un job Hermes research-script propose un candidat SKILL.md réutilisable, inspecte le candidat avant installation :

```bash
buddy tools skill-candidate inspect .codebuddy/skill-candidates/<candidate-dir>
```

La preuve de run réussi doit montrer un artefact local écrit : `outputStatus: written` et `outputVerified: true`. Un process qui sort proprement avec `outputStatus: placeholder` ou `outputStatus: missing` signifie que le run distant ou sandbox n'a pas encore rendu de preuve exploitable ; Cowork et le CLI refusent donc de le compter comme preuve répétable pour une promotion.

## 7. Étendre Cowork avec MCP, Fleet et Skills

Utilise **MCP Connectors** pour ajouter des outils externes et des transports locaux.

![Connecteurs MCP](./qa/code-buddy-studio/screenshots/24-mcp-connectors.png)

Utilise **Fleet Command Center** et les surfaces d'équipe quand plusieurs peers ou workflows doivent coopérer.

![Fleet Command Center](./qa/code-buddy-studio/screenshots/07-fleet-command-center.png)

Utilise les surfaces **Skills** et plugins pour les documents, tableurs, présentations, automatisations navigateur et opérations métier réutilisables.

![Plugins](./qa/code-buddy-studio/screenshots/26-plugins.png)

## 8. Activer prudemment l'automatisation desktop

Les checks Computer Use sont opt-in car ils manipulent de vraies applications desktop. La suite validée pilote des contrôles Windows Forms, des dialogues, Notepad et Excel COM, puis affiche `1 ok / 0 ko` depuis le runner.

![Suite desktop Computer Use réelle](./qa/code-buddy-studio/screenshots/108-test-runner-computer-use-real-suite.png)

Avant d'utiliser Computer Use :

- Fermer les documents privés et onglets sensibles.
- Garder le workspace aussi étroit que possible.
- Préférer les lignes sûres du runner pour commencer.
- Ne publier que des captures caviardées ou sans information privée.

## 9. Publier des preuves sans fuite privée

Avant de publier de la documentation ou des captures :

```bash
npm run test:docs-public
```

Le dossier QA public commence dans [`qa/code-buddy-studio/`](./qa/code-buddy-studio/README.md). Son rapport complet conserve les preuves de commandes réelles pour ChatGPT OAuth, Cowork/Electron, routes serveur, MCP, Fleet, permissions, Docker, Computer Use, Hermes et compagnon Buddy.
