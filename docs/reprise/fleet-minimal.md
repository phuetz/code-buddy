# Fleet minimal — scenario comprehensible

Objectif: un seul scenario multi-Code Buddy que Patrice peut expliquer
et relancer. On garde OpenClaw hors du chemin critique: Code Buddy
Gateway reste le bus IA a IA, OpenClaw viendra plus tard pour les
canaux externes.

## Topologie

```text
Machine A                              Machine B
buddy server                           buddy
CODEBUDDY_FLEET_API_KEY=your_fleet_api_key -> /fleet listen ws://A:3000/ws
CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT     /fleet status
                                      /fleet route ...
                                      /fleet chat ...
                                      /fleet tool ...
```

La cle utilisee par Machine B doit avoir:

- `fleet:listen` pour observer les evenements Fleet.
- `peer:invoke` pour appeler `peer.describe`, `peer.chat` et
  `peer.tool.invoke`.

## 1. Demarrer le serveur pair

Sur Machine A:

```bash
set CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT=<workspace-path>
set CODEBUDDY_FLEET_HOSTNAME=ministar-linux
node dist/index.js server --host 0.0.0.0 --port 3000
```

Resultat attendu:

- `/api/health` repond.
- Le WebSocket `/ws` accepte une cle avec scopes Fleet.
- Sans `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT`, les outils distants
  read-only refusent volontairement les chemins.

## 2. Connecter l'operateur

Sur Machine B:

```bash
set CODEBUDDY_FLEET_API_KEY=your_fleet_api_key
node dist/index.js
```

Dans la session:

```text
/fleet listen ws://<machine-a-ip>:3000/ws --name ministar-linux --auto-reconnect
/fleet status
```

Resultat attendu:

- `/fleet listen` annonce la connexion.
- `/fleet status` montre le pair, l'uptime, le dernier heartbeat et
  l'etat de reconnexion.

## 3. Decrire les capacites

```text
/fleet describe ministar-linux
```

Resultat attendu:

- `methods` contient au minimum `peer.describe`, `peer.ping`,
  `peer.chat` si un provider est cable, et `peer.tool.invoke`.
- `capabilities.models` liste les providers disponibles
  (`chatgpt-oauth`, `ollama`, `gemini-cli`, etc.).
- `Peer chat` indique le provider effectivement cable pour
  `peer.chat`, ou `null` si aucun LLM n'est disponible.

## 4. Router une tache

```text
/fleet route "think deeply about the Code Buddy fleet architecture" --privacy public
```

Resultat attendu:

- Le CLI affiche `Fleet route recommendation`.
- Une ligne `Primary` donne le pair et le modele.
- La sortie contient un appel `peer_delegate` pret a rejouer.

Pour une tache privee:

```text
/fleet route "audit this private source tree" --privacy sensitive
```

Resultat attendu:

- Les pairs `egress: cloud` sont vetoes.
- Un pair local gagne si ses capacites suffisent.
- Si aucun pair local ne convient, l'erreur explique pourquoi.

## 5. Deleguer une question

```text
/fleet route "summarize the current git status and next safe action" --delegate --delegate-timeout 120000
```

Resultat attendu:

- Code Buddy route d'abord avec `peer.describe`.
- Il appelle ensuite `peer.chat` sur le pair/modele choisi.
- La reponse revient dans la session de l'operateur.

Alternative multi-tour:

```text
/fleet chat start ministar-linux --model gpt-5.1-codex --name audit
/fleet chat say resume les risques du dernier diff
/fleet chat end audit
```

## 6. Lire un fichier distant autorise

```text
/fleet tool ministar-linux view_file {"file_path":"README.md"} --timeout 30000
/fleet tool ministar-linux search {"query":"route_peer","path":"src"} --stream
```

Resultat attendu:

- `view_file` renvoie le contenu borne du fichier.
- `search --stream` affiche les chunks sanitises.
- Un chemin hors workspace est refuse avec
  `PATH_OUTSIDE_PEER_WORKSPACE`.

## 7. Fermer proprement

```text
/fleet stop ministar-linux
/fleet status
```

Resultat attendu:

- La connexion est fermee.
- Les sessions chat liees au pair sont purgees localement.

## Smoke local sans deux machines

Le test automatisé equivalent lance un vrai serveur WebSocket local,
connecte un vrai `FleetListener`, puis exerce `/fleet tool` et
`/fleet route`, `peer_delegate`, et `peer_chain`:

```bash
npm test -- tests/fleet/fleet-loopback-smoke.test.ts
```

Ce smoke ne consomme pas d'API externe. Il utilise un fichier OAuth
ChatGPT temporaire uniquement pour publier des capacites routables via
`peer.describe`; les reponses `peer.chat` sont bouclees par un client
mocke afin de valider la chaine multi-agent sans dependre du reseau.

## Checklist de sortie

- `npm test -- tests/fleet/fleet-loopback-smoke.test.ts` passe.
- `npm test -- tests/fleet tests/tools/route-peer-tool.test.ts tests/tools/list-peers-tool.test.ts tests/tools/peer-delegate-tool.test.ts tests/agent/execution/fleet-tool-hooks.test.ts` passe.
- `npm run typecheck` passe.
- `npm run build` passe.
- Le test live multi-machine reste a faire seulement quand
  `CODEBUDDY_FLEET_API_KEY` est disponible localement.
