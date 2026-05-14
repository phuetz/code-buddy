# Fleet minimal

Ce rail valide uniquement le noyau de collaboration Code Buddy vers Code Buddy.
OpenClaw et les canaux externes ne sont pas requis pour ce test.

## But

Prouver qu'une instance Code Buddy peut:

- observer une autre instance via `/fleet listen`;
- appeler `peer.ping` et `peer.describe`;
- appeler un LLM distant via `peer.chat`;
- invoquer les outils read-only `view_file`, `list_directory` et `search`;
- stopper proprement la connexion.

## Preflight serveur

Terminal 1:

```bash
npm run build
$env:GOOGLE_API_KEY="..."
$env:CODEBUDDY_FLEET_API_KEY=(node dist/index.js api-key create --name "Fleet smoke" --scope fleet:listen --scope peer:invoke --json | ConvertFrom-Json).key
node dist/index.js server --port 3000
```

La commande `api-key create` imprime la cle brute une seule fois et stocke
seulement son hash dans `~/.codebuddy/server-api-keys.json`. Le serveur recharge
ce store quand il change, donc il est possible de creer une nouvelle cle sans
redemarrer le serveur.

Depuis Cowork, le panneau Fleet expose aussi un bouton de creation de cle locale.
Il passe par le meme store serveur et affiche la cle complete une seule fois
pour la copier vers l'autre peer.

Le meme panneau peut lancer la decouverte Tailscale / `fleet-peers.yaml`.
Une entree YAML avec `apiKey` peut etre ajoutee directement; sinon Cowork
prefill le formulaire et attend la cle du peer.

## Test loopback

Terminal 2:

```bash
$env:CODEBUDDY_FLEET_API_KEY="cb_sk_..."
node dist/index.js
```

Dans la session:

```text
> /fleet listen ws://localhost:3000/ws --api-key cb_sk_... --name self --auto-reconnect
> /fleet status
> /fleet send self peer.ping
> /fleet send self peer.describe
> /fleet send self peer.chat {"prompt":"Say hi briefly"}
> /fleet tool self list_directory {"path":"docs","limit":20}
> /fleet tool self view_file {"file_path":"README.md","limit":2000}
> /fleet tool self search {"query":"Fleet","path":"docs"}
> /fleet history 20 --peer self
> /fleet stop self
```

## Test deux machines

Sur la machine serveur, exposer uniquement sur reseau prive ou Tailscale:

```bash
$env:GOOGLE_API_KEY="..."
$env:CODEBUDDY_FLEET_API_KEY=(node dist/index.js api-key create --name "Tailscale peer" --scope fleet:listen --scope peer:invoke --json | ConvertFrom-Json).key
node dist/index.js server --host 0.0.0.0 --port 3000
```

Sur la machine cliente:

```text
> /fleet listen ws://100.x.y.z:3000/ws --api-key cb_sk_... --name ministar-linux --auto-reconnect
> /fleet send ministar-linux peer.ping
> /fleet send ministar-linux peer.describe
> /fleet tool ministar-linux view_file {"file_path":"README.md","limit":2000}
```

## Criteres de passage

- `peer.ping` repond vite et sans erreur d'authentification.
- `peer.describe` liste les methodes attendues, dont `peer.chat` et
  `peer.tool.invoke`.
- `peer.chat` renvoie une vraie reponse LLM.
- Les outils read-only restent confines au workspace autorise.
- Une cle `admin` peut invoquer `peer.ping` et les outils read-only Fleet.
- Une cle sans scope `peer:invoke` ni `admin` recoit une erreur `FORBIDDEN`
  correlee a la requete, sans timeout silencieux.
- Une grande arborescence est tronquee proprement au lieu de saturer le client.
- Les sorties de `/fleet tool` ne peuvent pas injecter de sequences de controle
  terminal dans l'affichage.
- `/fleet stop` ferme la connexion et `/fleet status` revient a un etat clair.

Le chemin WebSocket reel est couvert par
`tests/server/peer-websocket-smoke.test.ts` pour `peer.ping`, `peer.tool.invoke`
et le refus de scope correle.

Depuis un build local, le meme rail peut etre rejoue sans session interactive:

```bash
npm run build
node scripts/fleet-loopback-smoke.mjs
node scripts/fleet-loopback-smoke.mjs --chat
```

Le mode `--chat` consomme le provider detecte pour `peer.chat`; sur cette
reprise il valide l'abonnement ChatGPT Pro via `gpt-5.5`.

Si ce rail passe en loopback puis sur Tailscale, Fleet minimal est pret pour une
beta controlee. Les workflows autonomes, OpenClaw et Cowork Fleet peuvent alors
etre durcis au-dessus de ce socle.
