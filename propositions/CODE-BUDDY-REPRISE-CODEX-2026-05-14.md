# Code Buddy - reprise Codex du chantier

Date: 2026-05-14
Auteur: Codex
Contexte: Patrice a suivi les premiers tests CLI et quelques essais Cowork, puis la suite des travaux Claude est devenue difficile a lire. Cette note remet les couches dans l'ordre et fixe la suite.

## Objectif produit

Le projet vise trois surfaces qui doivent rester coherentes:

1. **CLI operationnel type Gemini CLI / Codex / Claude Code**
   - boucle agentique autonome;
   - outils fichier/shell/recherche/web/MCP;
   - providers multiples;
   - memoire, contexte, sessions, permissions;
   - experience terminal stable et comprehensible.

2. **Application desktop Cowork**
   - interface graphique pour utiliser Code Buddy;
   - chat avec differents LLM;
   - outils, approvals, workflows, traces, settings;
   - doit utiliser le meme moteur que le CLI, pas un moteur parallele opaque.

3. **Collaboration multi-LLM / multi-Code Buddy**
   - plusieurs instances Code Buddy peuvent se connecter;
   - un Code Buddy peut parler a un autre;
   - un Code Buddy peut deleguer une tache ou demander une inspection read-only;
   - integration d'idees OpenClaw pour la topologie et les gateways, mais Code Buddy reste le cerveau.

## Ce que Patrice a vu fonctionner

Les captures dans `docs/screenshots/` racontent la partie que Patrice a bien suivie:

- Cowork a d'abord eu des bugs de boot React/Electron, puis a demarre.
- Un premier chat "bonjour" a fonctionne dans Cowork.
- Le demarrage local Ollama etait lent, puis la reduction du prompt systeme a aide.
- Le CLI Code Buddy a fonctionne avec ChatGPT/Codex OAuth.
- Le CLI a execute des tools en parallele.
- Le CLI a ensuite audite son propre code et trouve de vrais bugs.

Conclusion: la base CLI est reelle, pas seulement theorique.

## Ce que Claude a fait ensuite

### 1. Cowork a ete rapproche du moteur Code Buddy

Avant, Cowork pouvait fonctionner avec un runner herite de pi-coding-agent.
Claude a pousse Cowork vers un modele plus sain:

```text
Cowork UI
  -> Electron main/preload
  -> CodeBuddyEngineRunner
  -> CodeBuddyAgent core
  -> memes tools/middleware/session que le CLI
```

Donc Cowork devient progressivement l'interface graphique du meme agent que le CLI.

### 2. Des bridges Cowork ont ete ajoutes

Claude a ajoute ou renforce plusieurs ponts:

- `ServerBridge`: demarrer/arreter le serveur Code Buddy depuis Cowork.
- `WorkflowBridge`: workflows visuels Cowork vers orchestrateur core.
- `HooksBridge`: tester des hooks command/http/prompt/agent.
- `SubAgentBridge` et `TeamBridge`: exposer les agents internes dans l'UI.
- `FleetBridge`: connecter Cowork au systeme multi-peer.

Ces ponts sont utiles, mais ils rendent le projet difficile a comprendre parce qu'il y en a beaucoup.

### 3. Le Fleet a pris la direction OpenClaw

Claude a surtout construit la couche "plusieurs Code Buddy collaborent".

Etat actuel simplifie:

```text
Code Buddy A
  -- WebSocket / peer RPC -->
Code Buddy B

A peut:
  - ecouter les events de B
  - demander peer.describe
  - discuter avec peer.chat
  - ouvrir une session peer.chat-session
  - invoquer certains outils read-only via peer.tool.invoke
```

La partie poussee recemment, Phase d.23, ajoute:

- `peer.tool.invoke`
- `peer.tool.invoke.stream`
- `/fleet tool <peer> <tool> <args>`
- outils read-only autorises: `view_file`, `list_directory`, `search`
- garde-fous: allowlist, `fleetSafe`, workspace root, refus des chemins hors workspace.

En clair: un Code Buddy peut maintenant demander a un autre Code Buddy de lire/rechercher dans son workspace, prudemment.

### 4. OpenClaw n'est pas le moteur principal

Point important:

- **Code Buddy Gateway** = bus IA <-> IA, delegation, sagas, peers, LLM.
- **OpenClaw Gateway** = bus canaux humains externes: Telegram, WhatsApp, Discord, iMessage, skills ClawHub.

La bonne vision est:

```text
Code Buddy = cerveau agentique + fleet multi-LLM
OpenClaw = canaux externes optionnels
Cowork = cockpit graphique
CLI = interface terminal robuste
```

OpenClaw doit rester un add-on. Il ne faut pas laisser son integration rendre Code Buddy incomprehensible.

## Probleme actuel

Le projet avance vite, mais il manque une ligne de produit claire.

Risque principal:

- trop de phases;
- trop de bridges;
- trop de termes: Fleet, A2A, OpenClaw, Cowork, Gateway, Team, SubAgent, Orchestrator;
- beaucoup de choses semi-branchees;
- Patrice ne peut plus savoir ce qui est stable, experimental, ou juste documente.

Ce n'est pas un echec technique. C'est un probleme de lisibilite et de priorisation.

## Decision de reprise

Je reprends la suite en imposant une separation stricte:

### Niveau 1: Produit stable

Doit fonctionner tous les jours.

- CLI chat + tools + providers.
- Cowork chat via le moteur Code Buddy.
- Serveur local Code Buddy.
- Un peer Fleet loopback/local testable.

### Niveau 2: Beta controlee

Peut etre active manuellement.

- Fleet multi-machine via Tailscale.
- `peer.chat-session`.
- `peer.tool.invoke` read-only.
- workflows Cowork simples.

### Niveau 3: Laboratoire

Ne doit pas bloquer le produit stable.

- OpenClaw gateway.
- canaux Telegram/Discord/WhatsApp.
- sagas multi-peer complexes.
- autonomy fleet long-running.
- face memory / presence.

## Suite proposee

### Phase R1 - remettre le CLI au centre

Objectif: prouver que Code Buddy CLI est utilisable comme Gemini CLI/Codex/Claude Code.

Checklist:

- `buddy --help`
- `buddy whoami`
- chat simple;
- tool read file;
- tool search;
- tool shell safe;
- tool edit avec approval;
- session resume;
- provider switch;
- test avec modele cloud et modele local.

Livrable: un script ou guide `docs/reprise/cli-smoke.md` avec les commandes exactes et le resultat attendu.

### Phase R2 - Cowork comme cockpit du meme moteur

Objectif: Cowork ne doit pas etre "une autre app", mais l'UI du core.

Checklist:

- verifier runner actif: engine Code Buddy, pas pi fallback;
- chat simple;
- streaming thinking/text;
- approval tool;
- erreur lisible quand serveur/modele absent;
- model switch;
- health badge;
- bouton regenerate bloque pendant un tour actif.

Livrable: un test manuel et quelques tests automatiques autour de `CodeBuddyEngineRunner`.

### Phase R3 - Fleet minimal comprehensible

Objectif: un seul scenario multi-Code Buddy que Patrice peut expliquer.

Scenario cible:

```text
1. Lancer Code Buddy server sur une machine.
2. Depuis une autre instance, /fleet listen.
3. /fleet describe montre les capacites.
4. /fleet chat envoie une question.
5. /fleet tool view_file lit un fichier autorise.
6. /fleet stop ferme proprement.
```

Livrable: guide `docs/reprise/fleet-minimal.md` + script de test loopback.

### Phase R4 - securiser avant d'elargir

Avant d'ajouter plus d'OpenClaw ou de delegation:

- limiter `view_file` sans lire tout le fichier en memoire;
- limiter `list_directory`;
- sanitiser les chunks affiches par `/fleet tool --stream`;
- rendre les logs d'audit plus exploitables;
- documenter clairement les scopes `fleet:listen` et `peer:invoke`.

### Phase R5 - seulement ensuite: OpenClaw

OpenClaw doit etre integre quand les couches precedentes sont propres.

But:

```text
Telegram/Discord/etc.
  -> OpenClaw Gateway
  -> bridge Code Buddy
  -> Fleet/TaskRouter
  -> LLM ou autre Code Buddy
```

Pas avant que le CLI, Cowork et Fleet minimal soient stabilises.

## Ce que je prends maintenant

Je prends la suite sur trois axes:

1. **Clarification**: transformer les phases Claude en docs courtes et actionnables.
2. **Stabilisation**: corriger les risques detectes dans l'audit recent.
3. **Verification utilisateur**: fournir des commandes simples que Patrice peut lancer et comprendre.

Priorite immediate:

1. Fixer les points d'audit Fleet (`view_file`, `list_directory`, output ANSI).
2. Verifier Cowork runner engine et bloquer regenerate pendant un tour actif.
3. Creer le smoke test CLI + Fleet loopback.
4. Revenir ensuite a l'integration OpenClaw, mais seulement comme couche optionnelle.

