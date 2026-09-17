# ElevenLabs hosted MCP (OAuth) — installation, connexion, quotas, statut

Dernière vérification : 2026-09-17 (câblage Code Buddy + mock local). Lecture seule des endpoints publics ElevenLabs le 2026-09-16. Aucun compte engagé, aucune génération.

## Ce qui existe côté ElevenLabs (vérifié en lecture seule)
- Présentation : https://elevenlabs.io/mcp — « One time OAuth, no API keys, revocable anytime » ; commandes citées pour d'autres clients : `claude mcp add --transport http elevenlabs https://api.elevenlabs.io/v1/mcp`, `hermes mcp add elevenlabs --url https://api.us.elevenlabs.io/v1/mcp --auth oauth`. Le serveur couvre agents (ElevenAgents) et création (voix, musique, images, vidéo, « 50+ modèles »).
- Endpoint : `POST https://api.elevenlabs.io/v1/mcp` (Streamable HTTP). `GET` → 405. Sans jeton : **401** `{"detail":"OAuth bearer token required for the hosted MCP."}` avec `WWW-Authenticate: Bearer resource_metadata="https://api.us.elevenlabs.io/.well-known/oauth-protected-resource"` (RFC 9728).
- Métadonnées de ressource : `resource = https://api.us.elevenlabs.io/v1/mcp`, `authorization_servers = [https://api.us.elevenlabs.io]`, `bearer_methods_supported = [header]`, scopes : `convai_read convai_write text_to_speech speech_history_read flows image_video_generation voice_generation`.
- Serveur d'autorisation (`/.well-known/oauth-authorization-server`) : `authorization_endpoint = https://elevenlabs.io/app/oauth/authorize`, `token_endpoint = https://api.us.elevenlabs.io/v1/oauth/token`, révocation `/v1/oauth/revoke`, `code` + PKCE **S256**, grants `authorization_code`/`refresh_token`, auth client `none | client_secret_post | private_key_jwt`, **`client_id_metadata_document_supported: true`**, **aucun `registration_endpoint`** (pas d'enregistrement dynamique).
- Documentation officielle du serveur hébergé : https://elevenlabs.io/docs/eleven-agents/operate/hosted-mcp (version texte : même URL + `.md`). Elle décrit ce que l'assistant peut faire une fois connecté : créer/mettre à jour/lister/dupliquer/supprimer des agents, lire conversations et transcriptions, explorer les sujets, estimer l'usage LLM d'un agent, récupérer widget et lien partageable, taille de la base de connaissances, **générer de la parole depuis un texte (lien de téléchargement éphémère)**. « No client registration is needed for clients that support hosted client metadata (CIMD) ». URL régionales (EU `api.eu.residency.elevenlabs.io/v1/mcp`, IN, SG) pour les espaces isolés.
- Ancien serveur local : dépôt GitHub `elevenlabs/elevenlabs-mcp` **archivé** (dernier push 2026-08-20), README : « This local MCP server is deprecated in favor of the ElevenLabs hosted MCP server ». C'était la voie stdio à clé API (`ELEVENLABS_API_KEY`). Ce document ne couvre que le serveur hébergé.

## Ce que fait Code Buddy
- `transport.auth = { type: 'oauth', … }` n'est honoré que sur `streamable_http`. Sur `stdio` / `sse` / `http` / `legacy_rpc`, `createTransport` **refuse** (pas d'auth silencieuse). Le SDK MCP (`src/mcp/mcp-oauth-provider.ts`) fait la découverte RFC 9728, PKCE, échange de code et rafraîchissement ; les jetons sont persistés chiffrés AES-GCM dans `.codebuddy/mcp-tokens.json` (`src/mcp/mcp-oauth.ts`). Rappel loopback : `http://localhost:19836/callback` par défaut.
- Première connexion : le SDK répond `UnauthorizedError` après l'échange du code ; `MCPManager` reconnecte une fois avec le jeton stocké (`src/mcp/client.ts`).
- `interactive: false` → refus fermé **avant** toute découverte ou enregistrement client (aucun navigateur, aucun appel `/register` ni `/token`) tant qu'aucun jeton n'est stocké. Aucune clé API, aucun secret dans la config : ni `xi-api-key`, ni jeton.
- `redirectUri` : URL `http` loopback (`127.0.0.1` ou `localhost`). Le serveur de rappel **écoute seulement `127.0.0.1`**. `localhost` est accepté pour pouvoir coller un document CIMD, mais un navigateur qui résout `localhost` en `[::1]` n'atteint pas le callback. Utiliser `http://127.0.0.1:19836/callback` si les `redirect_uris` du document CIMD disent cela. `[::1]` est rejeté.
- Recette isolée : `tests/mcp/mcp-oauth-provider.test.ts` (mock local 401 → découverte → enregistrement ou CIMD → token → `tools/list`). **Ce mock n'est pas le service ElevenLabs.** `tools/list` n'a jamais été exécuté contre l'API réelle.

### Magasin chiffré (pas un coffre fort par défaut)
Sans `CODEBUDDY_VAULT_KEY` ni `CODEBUDDY_MCP_KEY`, la phrase est `mcp-oauth-<USER>-<plateforme>` : **dérivable** par quiconque a un shell sur le même compte. AES-GCM + mode 0600 s'exécutent quand même, mais ce n'est **pas** un coffre fort. Poser une clé explicite pour une confidentialité réelle.

### `enabled: false` vs `buddy mcp test` / `audit`
`MCPManager.addServer` retourne immédiatement si `enabled === false` (aucun transport, aucun OAuth). Le démarrage de l'agent (`ensureServersInitialized`) ignore aussi ces serveurs.

Les handlers CLI actuels appellent le même `addServer` :
- `buddy mcp test <name>` : **no-op silencieux** si l'entrée est `enabled: false` (succès apparent, 0 outil, pas de navigateur).
- `buddy mcp audit <name>` : charge la config y compris désactivée, puis `addServer` → même no-op (rapport 0 outil, pas d'erreur OAuth). `audit` sans nom n'inclut les désactivés qu'avec `--all`, et le no-op reste.

Pour un vrai probe OAuth : passer `enabled: true` le temps du test, puis le remettre à `false` si le serveur ne doit pas entrer dans l'agent. Le template reste `enabled: false` pour ne pas charger ElevenLabs au démarrage.

## Identifiant client : le point bloquant réel
ElevenLabs n'offre pas d'enregistrement dynamique ; il accepte un **client id sous forme d'URL HTTPS d'un document de métadonnées client** (SEP-991). Code Buddy n'héberge pas ce document. Options :
1. Publier un `client-metadata.json` (nom, `redirect_uris` identiques au `redirectUri` configuré, `token_endpoint_auth_method: "none"`, grants, scopes) sur un domaine HTTPS contrôlé, puis renseigner `clientMetadataUrl`. Ce chemin (CIMD) est exercé sur le mock local (`tests/mcp/mcp-oauth-provider.test.ts`, serveur sans `registration_endpoint`), **pas encore sur ElevenLabs**.
2. Utiliser un `clientId` fourni par ElevenLabs (si un enregistrement manuel existe côté compte), via `auth.clientId`.
Sans l'un des deux, l'autorisation ne peut pas aboutir : **aucun `tools/list` réel n'a été exécuté**. Ne pas inventer d'URL CIMD hébergée.

## Procédure d'activation

Prérequis : un **client id** — document CIMD HTTPS (`client-metadata.json` publié sur un domaine contrôlé) **ou** un `clientId` fourni par ElevenLabs. Sans l'un des deux, l'autorisation échoue avant tout `tools/list` réel.

1. Copier l'entrée `elevenlabs` de `docs/templates/mcp-elevenlabs-hosted.json` dans `~/.codebuddy/mcp.json` sous `mcpServers`. Le template est **`enabled: false`**.
2. Remplacer `https://REMPLACER-PAR-UN-DOCUMENT-HTTPS/client-metadata.json` par l'URL HTTPS réelle du document (chemin non racine) **ou** retirer `clientMetadataUrl` et poser `clientId`. Aligner `redirectUri` sur les `redirect_uris` du document.
3. Pour le probe : passer `enabled: true`, terminal interactif (DISPLAY / navigateur), `buddy mcp test elevenlabs`. Le navigateur s'ouvre sur `https://elevenlabs.io/app/oauth/authorize` (révocable dans l'espace ElevenLabs). Rappeler `enabled: false` ensuite si le serveur ne doit pas charger au prochain démarrage.
4. `buddy mcp audit elevenlabs --json` (avec `enabled: true`) : inventorier les **noms réels** d'outils. Ajuster `toolFilter` **après** cette liste. Les motifs génériques du template (`*generate*`, `*create*`, `*clone*`, `*delete*`) sont une **commodité** : ils ne rendent pas le serveur en lecture seule. Un outil dont le nom n'est pas connu (ou ne matche pas) reste appelable.
5. `enabled: true` de façon durable uniquement si l'agent doit exposer ces outils. Relancer `buddy` / `buddy server`.
6. Révocation : depuis le compte ElevenLabs (`/v1/oauth/revoke` côté serveur). Côté client, supprimer seulement l'entrée `elevenlabs` du magasin chiffré — `.codebuddy/mcp-tokens.json` contient les jetons de **tous** les serveurs MCP ; le supprimer entièrement déconnecte aussi les autres.

## État de la recette (2026-09-17)

| Élément | Statut exact |
|---|---|
| Recette exécutée | **mock local uniquement** (`tests/mcp/mcp-oauth-provider.test.ts` + lifecycle loopback) : 401 → RFC 9728 → PKCE → token → `tools/list` |
| `tools/list` réel ElevenLabs | **non exécuté** — aucun appel authentifié vers `api.elevenlabs.io` |
| Blocage | **client id CIMD** : ElevenLabs n'a pas de `registration_endpoint` ; il faut une URL HTTPS de métadonnées client (SEP-991) ou un `clientId` fourni. Code Buddy n'héberge pas ce document |
| Génération audio / quota | aucune (interdit dans ce lot) |
| Réseau externe dans les tests | aucun : le mock écoute `127.0.0.1` |

## Quotas, exports, outils
- Les **noms** d'outils ne sont pas publiés (la doc liste des capacités, pas des identifiants) ; ils ne sont connus que par `tools/list` **authentifié**. Ne pas inventer de nom.
- `toolFilter.exclude` du template **n'est pas une garantie de lecture seule** : sans noms réels, un motif générique ne peut pas filtrer ce qu'il ne connaît pas. Les scopes `speech_history_read` et `convai_read` expriment l'intention lecture côté serveur d'autorisation **s'ils sont honorés** ; `text_to_speech`, `voice_generation`, `image_video_generation`, `flows`, `convai_write` peuvent consommer le quota.
- Le solde de caractères se lit hors MCP par l'API `GET /v1/user/subscription` (clé API) ou l'interface ; via MCP, seulement si un outil authentifié l'expose (à constater après `tools/list`).
- Exports audio : la doc officielle indique une génération TTS « returned as a short-lived download link » — appel **consommateur** (scope `text_to_speech`).

## Statut exact (2026-09-17)
| Élément | Statut |
|---|---|
| Endpoint et OAuth découverts | vérifiés en lecture seule (lot précédent, avant ce suivi) |
| Câblage OAuth transport HTTP Code Buddy | implémenté, testé sur mock loopback |
| Connexion réelle ElevenLabs / `tools/list` | **non fait** (client id HTTPS / CIMD manquant) |
| Génération audio de test | aucune (interdit dans ce lot) |
