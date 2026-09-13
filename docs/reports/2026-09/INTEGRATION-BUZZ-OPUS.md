# Intégration block/buzz dans Code Buddy — salons persistants de la flotte

> Rapport de passation du snapshot Opus, avant assemblage. Les corrections du
> §9 et les raccords ajoutés ensuite sont suivis dans
> [le rapport d'intégration final](INTEGRATION-FLEET-ROOMS-2026-09-14.md).
> Les limites « pas d'outil agent » et les vérifications non exécutées ci-dessous
> décrivent ce snapshot, pas l'état final du lot assemblé.

- **Dates :** ouverture 2026-09-13 23 h 35, livraison 2026-09-14 ~00 h 30 (Europe/Paris)
- **Agent :** Claude Opus 5, chantier piloté par Codex
- **Worktree :** `~/DEV/cb-buzz-integration-opus-2026-09-13`
- **Branche :** `feat/buzz-integration-opus-2026-09-13`, base `8f08fad72`
- **État :** LIVRÉ LOCAL, **non commité, non poussé**. Passation à Codex pour revue et répartition des corrections restantes (§9).
- **Contraintes respectées :** aucun commit, aucun push, aucun message vers un service ou relais distant, aucun compte créé, aucune installation de dépendance, aucun secret existant lu. Aucun fichier self-improvement, code-exec ou sensory modifié ; rien n'est émis sur `sensory:perception`. Aucune politique de confirmation, d'egress ou de workspace n'est modifiée.

## 1. Provenance upstream (lecture seule)

| Élément | Valeur vérifiée |
| --- | --- |
| Dépôt | `https://github.com/block/buzz.git` (remote `origin` du clone `/tmp/cb-buzz-upstream-2026-09-13`) |
| Branche / SHA | `main` @ **`4cd82f513214aad11c2b742ce7cc7c681e8e32a0`** (lu dans `.git/refs/heads/main`) |
| Licence | Apache-2.0 (`LICENSE`) |
| Exécution upstream | Aucune : ni `cargo`, ni `pnpm`, ni relais, ni hook git. Lecture de fichiers uniquement. |
| Code copié | **Aucun.** Sémantiques et formats de protocole ré-implémentés en TypeScript ; chaque module cite ses sources upstream en en-tête. |

Fichiers upstream lus : `README.md`, `ARCHITECTURE.md` (§1-§9), `crates/buzz-acp/README.md`, `crates/buzz-cli/README.md`,
`crates/buzz-acp/src/acp.rs` (initialize, session/new, session/prompt, permissions, spawn), `crates/buzz-acp/src/lib.rs`
(`build_mcp_servers`), `crates/buzz-acp/src/pool.rs` (transport du system prompt), `crates/buzz-acp/src/config.rs`,
`crates/buzz-acp/src/queue.rs` (file par canal, bornes), `crates/buzz-acp/src/relay.rs` (`TwoGenDedup`, `last_seen`,
`channel_since`), `crates/buzz-acp/src/base_prompt.md`, `crates/buzz-core/src/filter.rs`, `crates/buzz-core/src/nip10.rs`,
`crates/buzz-core/src/verification.rs`, `crates/buzz-sdk/src/builders.rs` (`build_message`, `thread_tags`, `mention_tags`),
`crates/buzz-sdk/src/mentions.rs`, `crates/buzz-relay/src/handlers/req.rs`, `crates/buzz-relay/src/handlers/event.rs`
(préfixes `OK`), `crates/buzz-relay/src/nip11.rs`, `desktop/src-tauri/src/managed_agents/discovery/presets.rs`.

## 2. Ce qu'est Buzz (faits vérifiés)

- Relais **Nostr** auto-hébergeable (Rust/Axum, Postgres, Redis, S3) : chaque message, réaction, étape de workflow ou
  événement git est un événement NIP-01 signé Schnorr/secp256k1 ; auth WebSocket NIP-42, HTTP NIP-98.
- Canaux (`h` tag), fils NIP-10 (`e` root/reply), mentions (`p`), REQ → événements stockés → `EOSE` → direct,
  accusés `["OK", id, bool, "prefix: message"]`, appartenance au canal comme seule porte (`ARCHITECTURE.md` §4, §5, §7).
- Surface agent : `buzz-acp` pilote un agent ACP stdio et **auto-approuve** chaque `session/request_permission` en
  `allow_once` (`acp.rs:1942-2026`) ; l'agent répond via le CLI `buzz`. Le sous-processus hérite de l'environnement
  (dont `BUZZ_PRIVATE_KEY`).

## 3. Décision d'architecture (réorientation demandée par Patrice)

Premier cadrage : raccorder Code Buddy comme agent ACP de `buzz-acp`. **Abandonné** pour ce lot : il ne sert pas la
communication entre membres de la flotte et l'auto-approbation ACP de `buzz-acp` imposerait un profil de confirmations
spécifique avant tout usage.

Constat Fleet (cartographie de `src/fleet` et `src/server/websocket`, 2026-09-13) : **aucune messagerie pair-à-pair hors
LLM**. `peer.chat` est un appel LLM ; `/fleet history` est un anneau de 50 événements en mémoire client ; `broadcast()`
diffuse sans filtre à tout porteur de `fleet:listen`, sans rejeu ; l'identité d'un pair est un principal hub ou un nom
auto-déclaré ; aucune signature par message.

**Décision :** intégrer les *parties éprouvées du protocole Buzz* (pas son relais Rust) sous forme de **salons de flotte**
hébergés par le hub `buddy server` existant, sur `/ws`, via `registerWebSocketExtension` (même point d'extension que le
bus cognitif). Opt-in `CODEBUDDY_FLEET_ROOMS=true`. Alternative plus légère écartée : un simple journal JSONL signé par le
principal hub — il ne prouve pas l'auteur d'un message (JWT à secret partagé, noms auto-déclarés) et ne permet pas de
vérifier l'historique hors du hub.

### Comparaison Buzz ↔ Fleet ↔ lot livré

| Besoin | Buzz | Fleet avant | Lot livré |
| --- | --- | --- | --- |
| Canal nommé | `h` = UUID de canal | aucun | `h` = slug de salon déclaré dans `rooms.json` |
| Fil | NIP-10 `e` root/reply | aucun | NIP-10 identique |
| Mention | `p` (50 max) | aucun | `p` (50 max), filtre `#p` = boîte de réception |
| Identité signée | clé secp256k1 par agent | principal hub / nom libre | clé par membre (fichier 0600) + preuve NIP-42 |
| Historique | Postgres, `since` | 50 événements en RAM client | registre JSONL `fsync`, rétention bornée |
| Reprise | `since` = `created_at` (horloge auteur) | aucune | curseur `seq` hub + `storeId` (indépendant des horloges) |
| Abonnement | REQ/EOSE/direct, 1024 subs | diffusion globale | REQ/EOSE/direct borné, `#h` obligatoire |
| Accusé | `OK` + préfixes | aucun pour les événements | `fleet.rooms.ok` après `fsync`, mêmes préfixes |
| Contrôle d'accès | appartenance canal | scopes WS | scope `fleet:listen` + clé prouvée + `rooms.json` fermé par défaut |
| Boucles | file par canal, porte d'auteur | profondeur RPC | **aucune réaction automatique** (messages = données) + débit par clé |

## 4. Matrice reprise / adaptation / exclusion

| Composant upstream (@ `4cd82f51`) | Verdict | Réalisation Code Buddy |
| --- | --- | --- |
| Forme d'événement NIP-01, id sha256, vérif Schnorr — `buzz-core/src/verification.rs` | **Repris (sémantique)** | `room-event.ts` : `computeRoomEventId` (`node:crypto`), `signRoomEvent`/`verifyRoomEvent` (`@noble/curves`, dépendance déjà déclarée) |
| Tags de message `h`/`e`/`p`, 64 KiB, 50 mentions — `buzz-sdk/src/builders.rs::build_message`, `thread_tags`, `mention_tags` | **Repris** | `buildRoomMessage` ; ajout de bornes globales (tags 16 KiB, événement 512 KiB, 64 tags, 256 car./partie) |
| Marqueurs NIP-10 — `buzz-core/src/nip10.rs` | **Repris** | `parseThreadMarkers`, `resolveThread` (mêmes cas de test) |
| Normalisation des mentions — `buzz-sdk/src/mentions.rs::normalize_mention_pubkeys` | **Repris** | `normalizeMentions` |
| Filtres NIP-01 (OU/ET, préfixe d'id, liste vide = rien) — `buzz-core/src/filter.rs` | **Adapté** | `room-filter.ts` : `#h` obligatoire, clés inconnues refusées, toutes listes et `limit` bornés |
| REQ : accès avant lecture, stockés → EOSE → direct, 500 max — `buzz-relay/src/handlers/req.rs`, `ARCHITECTURE.md` §5 | **Adapté** | `RoomSession.subscribe` : refus total si un salon n'est pas lisible (Buzz omet les branches), pagination `live:false` au-delà de 500 |
| Pipeline EVENT et préfixes `OK` — `buzz-relay/src/handlers/event.rs`, `ARCHITECTURE.md` §4 | **Adapté** | `RoomSession.publish` : auth → forme → pubkey = identité → kind → `h` unique → signature → droit d'écriture → doublon → dérive d'horloge → débit → append `fsync` → diffusion |
| NIP-42 challenge/réponse — `ARCHITECTURE.md` §3 | **Adapté et durci** | challenge 32 octets à usage unique, TTL 120 s, **audience canonique signée** (`relay`) vérifiée par le hub et dérivée côté client de l'URL composée, ±60 s, 5 tentatives |
| Reprise `last_seen`/`channel_since` + `TwoGenDedup` 12 000 — `buzz-acp/src/relay.rs` | **Adapté** | curseur `seq`+`storeId` (au lieu de `created_at`), déduplication à deux générations dans `room-client.ts` |
| Clôture des clients lents — `ARCHITECTURE.md` §3 étape 4 | **Adapté** | fermeture de l'abonnement avec `throughSeq` (pas de la connexion), reprise client bornée |
| Stockage Postgres/Redis/S3, multi-communauté, audit hash-chain | **Exclu** | registre JSONL local mono-écrivain ; pas de dépendance serveur |
| NIP-98 HTTP, Blossom, workflows YAML, huddles audio, git NIP-34, GIF, push | **Exclu** | hors besoin de messagerie entre membres |
| `buzz-acp` (harness ACP, auto-approbation des permissions) | **Exclu de ce lot** | incompatible tel quel avec les confirmations locales ; étude conservée ci-dessus |
| File par canal, porte d'auteur, `!cancel`/`!rotate` — `buzz-acp/src/queue.rs`, README | **Reporté** | prérequis documentés pour un futur lot « réaction d'agent aux mentions » ; aucune réaction automatique aujourd'hui |
| Chiffrement NIP-44 / DM NIP-17 | **Exclu** | pas de chiffrement dans ce lot (limite §9) |

## 5. Architecture livrée

```
membre (buddy fleet rooms / FleetRoomClient)
   │ ws://hub/ws  authenticate {apiKey|token}  (existant, scope fleet:listen)
   │ fleet.rooms.hello → challenge
   │ fleet.rooms.auth {kind 22242, tags challenge + relay=<URL composée>} ── signée par la clé membre
   │ fleet.rooms.publish {kind 9 signé} ──► RoomSession.publish ──► RoomStore.append (fsync) ──► ok {seq}
   │ fleet.rooms.subscribe {subId, filters, afterSeq?, storeId?} ──► event* → eose → direct
   ▼
buddy server ── registerWebSocketExtension ── room-ws-bridge ── RoomHub ── RoomAccessPolicy (rooms.json)
                                                                   └──── RoomStore (ledger.jsonl + meta.json + writer.lock)
```

| Module | Rôle |
| --- | --- |
| `src/fleet/rooms/room-event.ts` | Événement signé, bornes, `roomOf` strict (tous les tags `h` comptés), NIP-10, mentions, audience canonique |
| `src/fleet/rooms/room-filter.ts` | Filtres bornés et correspondance |
| `src/fleet/rooms/room-access.ts` | Politique `rooms.json` fermée par défaut, `principals` absent / liste / `[]`, membres gelés, rechargement mtime+ctime+taille+inode ≤ 1 s |
| `src/fleet/rooms/room-lock.ts` | Verrou exclusif `writer.lock` (`wx`), récupération seulement d'un PID mort sur le même hôte |
| `src/fleet/rooms/room-store.ts` | Registre `fsync`, queue sans saut de ligne quarantainée et tronquée avant réutilisation de `seq`, `seq` strictement croissant, signatures revérifiées au chargement, watermarks persistés avant compaction, inode+taille revérifiés avant chaque écriture, enregistrements gelés, bornes (2 000/salon, 1 024 salons, 128 MiB) |
| `src/fleet/rooms/room-hub.ts` | Sessions, preuve de clé, publication, abonnement, diffusion, révocation, contre-pression, débit 60/min par clé |
| `src/fleet/rooms/room-ws-bridge.ts` | Messages `fleet.rooms.*` sur `/ws` ; refuse client anonyme et absence de `fleet:listen`/`admin` |
| `src/fleet/rooms/room-client.ts` | Client : preuve pour l'URL composée, accusé, renvoi idempotent du même événement après coupure, reprise par curseur, vérif locale, texte via `sanitizePeerText` |
| `src/fleet/rooms/room-identity.ts` | Clé membre 0600, création explicite, refus si lisible par d'autres |
| `src/fleet/rooms/room-server.ts` | Démarrage opt-in, audiences = loopback du port écouté + `CODEBUDDY_FLEET_ROOMS_AUDIENCE` |
| `src/commands/cli/fleet-rooms-commands.ts` | `buddy fleet rooms identity init|show`, `post`, `read [--cursor]`, `tail [--cursor]` |
| `src/server/index.ts` | Câblage après `listen` (port réel) si `CODEBUDDY_FLEET_ROOMS=true` ; arrêt dans `stopServer` |

**Sécurité :** les messages ne déclenchent jamais prompt, outil ou tour d'agent (aucun code de réaction) ; aucune
modification de `ConfirmationService`, des modes de permission, de l'egress ou des racines de workspace ; le secret
membre n'est jamais journalisé ni affiché ; le hub ne contacte aucun service.

## 6. Validation réellement exécutée (2026-09-14, Node du poste, Vitest 4.1.9)

Outillage : `node_modules` lié par Codex vers les dépendances du worktree `cb-improvements-persistence` (non modifiées) ;
Vitest lancé via `_qa/fleet-rooms/vitest.config.ts` (config du dépôt + `cacheDir` dans `/tmp`), `_qa/fleet-rooms/`
ajouté au `.gitignore`.

| Commande | Résultat |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (après le dernier changement de `src/server/index.ts`) | exit 0 |
| `node node_modules/typescript/bin/tsc -p _qa/fleet-rooms/tsconfig.json` (types des 7 fichiers de test) | exit 0 |
| `node node_modules/eslint/bin/eslint.js src/fleet/rooms src/commands/cli/fleet-rooms-commands.ts src/commands/cli/fleet-commands.ts tests/fleet/rooms` puis `… src/server/index.ts` | exit 0, aucun avertissement |
| `node node_modules/vitest/vitest.mjs run --config _qa/fleet-rooms/vitest.config.ts tests/fleet/rooms` ×3 consécutifs (avant l'ajout du test serveur) | 6 fichiers, **44/44** à chaque passe |
| Passe finale : `tests/fleet/rooms` + `tests/commands/fleet-commands.test.ts` `tests/fleet/fleet-loopback-smoke.test.ts` `tests/server/cognition-websocket.test.ts` `tests/server/websocket-peer-multiplex.test.ts` `tests/server/websocket-peer-security.test.ts` | 12 fichiers, **71/71** (46 du lot + 25 existants) |

Couverture des tests du lot (46) :

- `room-event.test.ts` (9) : vecteur d'id NIP-01 calculé hors du code (`printf … | sha256sum` →
  `7506f410…8005`), BIP-340, altérations contenu/tags/sig/pubkey, `roomOf` strict (`['h']` compté, doublons, 3 parties,
  majuscules), bornes octets contenu/tags/événement/nombre de tags, NaN/Infinity, copie défensive, NIP-10, mentions, audience canonique.
- `room-filter-access.test.ts` (7) : OU/ET, préfixes, listes vides, `#h` obligatoire, clés inconnues, NaN/Infinity, `limit` borné ;
  `principals` absent / liste / `[]`, lecteurs vs rédacteurs, membre gelé, membre non déclaré, intervalle non fini, fichier absent / révocation / JSON invalide.
- `room-store.test.ts` (13) : idempotence, `seq` strict, redémarrage, rejeu/pagination/historique, verrou exclusif, verrou d'un PID vivant / autre hôte / illisible refusé,
  PID mort récupéré, **ligne JSON complète sans saut de ligne quarantainée puis `seq` réutilisé sans collision sur deux redémarrages**,
  ligne déchirée, écrivain étranger détecté, `seq` non croissant ignoré, **signature falsifiée rejetée au chargement par défaut**,
  **crash simulé entre meta et réécriture du registre → gap sur-déclaré, aucune perte**, immutabilité profonde avant/après compaction,
  bornes de taille/salons, options NaN/Infinity/0/-1/1.5, meta invalide → registre mis de côté.
- `room-hub.test.ts` (10) : admission, **preuve adressée à un autre hub refusée**, challenge à usage unique et horodatage, liaison principal, tentatives,
  pipeline de publication (usurpation, id altéré, deux `h`, futur, doublon même `seq`, débit, lecteur), accès avant lecture + EOSE + direct,
  curseur/pagination 502 événements/changement d'époque, contre-pression avec curseur, révocation par fichier, bornes d'abonnement.
- `fleet-rooms-websocket.test.ts` (4) — **vrai serveur HTTP + `/ws` authentifié sur port éphémère loopback, plusieurs clients** :
  publication/lecture, mention, fil, texte d'injection reçu intact en `event.content` et assaini en `text`, lecteur refusé en écriture,
  non-membre refusé, clé liée présentée sur la connexion d'un autre refusée, clé API sans `fleet:listen` refusée, audience d'un autre hub refusée ;
  **coupure de tous les sockets puis deux messages publiés pendant la coupure → reçus exactement une fois par rejeu à curseur**, publication
  émise pendant la déconnexion aboutit après reconnexion ; **redémarrage du hub** : même `storeId`, rejeu depuis curseur, republication du même événement signé → `duplicate` même `seq` ; pont non câblé → type inconnu.
- `fleet-rooms-cli.test.ts` (1) : `identity init` (0600, secret jamais affiché, refus d'écraser), `post`, `read --cursor` ×3 (nouveautés seulement, curseur mis à jour).
- `fleet-rooms-server.test.ts` (2) : `startServer` avec l'option → publication/lecture sur le port réellement écouté, verrou libéré par `stopServer` et message relu ; sans l'option → rien d'enregistré, aucun répertoire créé.

Un seul échec rencontré pendant le travail : la première version du test de reconnexion sondait `isReady` alors que les clients se
reconnectaient en 20 ms (défaut du test, pas du code). Corrigé en attendant l'événement `disconnected` puis en publiant de manière
synchrone après la coupure, ce qui rend la preuve de rattrapage déterministe.

**Non exécuté (permission refusée dans cette session, aucun contournement tenté) :** la même passe avec `HOME` isolé. Les tests du lot
n'écrivent que dans des répertoires temporaires explicites ; les suites `startServer` (existante et nouvelle) tournent avec le `HOME` réel
comme le smoke loopback existant. Commande à lancer par Codex :

```bash
mkdir -p _qa/fleet-rooms/home
HOME="$PWD/_qa/fleet-rooms/home" CODEBUDDY_HOME="$PWD/_qa/fleet-rooms/home/.codebuddy" \
  node node_modules/vitest/vitest.mjs run --config _qa/fleet-rooms/vitest.config.ts \
  tests/fleet/rooms tests/commands/fleet-commands.test.ts tests/fleet/fleet-loopback-smoke.test.ts \
  tests/server/cognition-websocket.test.ts tests/server/websocket-peer-multiplex.test.ts tests/server/websocket-peer-security.test.ts
```

Non exécutés : suite complète du dépôt (~27 K tests), CI Windows/macOS, test multi-machines réel (Tailscale), bench de chargement
de registre volumineux (vérification de signature au chargement : coût linéaire non mesuré).

## 7. Fichiers

Nouveaux : `src/fleet/rooms/{room-event,room-filter,room-access,room-lock,room-store,room-hub,room-ws-bridge,room-client,room-identity,room-server}.ts`,
`src/commands/cli/fleet-rooms-commands.ts`, `tests/fleet/rooms/{room-event,room-filter-access,room-store,room-hub,fleet-rooms-websocket,fleet-rooms-cli,fleet-rooms-server}.test.ts`,
`docs/fleet-rooms.md`, ce rapport.

Modifiés : `src/server/index.ts` (câblage opt-in après `listen` + arrêt), `src/commands/cli/fleet-commands.ts` (enregistrement du groupe `rooms`),
`docs/fleet-guide.md` (renvois), `CLAUDE.md` (variables `CODEBUDDY_FLEET_ROOMS*`), `.gitignore` (`_qa/fleet-rooms/`),
`docs/FABLE5-CODEX-COORDINATION.md` (ligne de ce chantier).

Hors dépôt suivi : `_qa/fleet-rooms/vitest.config.ts`, `_qa/fleet-rooms/tsconfig.json` (ignorés) ; lien `node_modules` créé par Codex.

## 8. Limites fonctionnelles du lot

- Un hub par ensemble de salons : pas de fédération entre hubs, pas de pont vers un relais Buzz (format compatible kind 9 / `h` / `p` / `e`, mais `h` est un slug et non un UUID).
- Kind 9 uniquement : ni réactions, éditions, suppressions, pièces jointes.
- Pas de chiffrement au repos ni de bout en bout : l'opérateur du hub lit le registre.
- Clés membres déclarées à la main dans `rooms.json` ; rotation = nouvelle clé + édition.
- Pas d'outil agent : les agents passent par le CLI ; aucune réaction automatique aux mentions (prérequis : file par salon à un seul tour en vol, porte d'auteur, bornes de boucle — cf. `buzz-acp/src/queue.rs`).
- Mono-écrivain : deux `buddy server` sur le même `CODEBUDDY_HOME` avec l'option activée → le second refuse les salons (fermé), il faut un `CODEBUDDY_FLEET_ROOMS_DIR` distinct.
- Vérification de signature au chargement : coût proportionnel au registre retenu (non mesuré).

## 9. Corrections restantes (relevées par les relecteurs de Codex, NON traitées dans ce lot)

Consignées à la demande de Codex, qui les répartit après livraison :

1. `RoomStore.append` ne vérifie pas lui-même la signature (seul le hub le fait avant l'appel).
2. Corruption complète du registre ignorée ligne à ligne : le `gap` peut être faux (sous-déclaré) si des lignes valides disparaissent.
3. Récupération d'un verrou mort : fenêtre de course entre le renommage du verrou périmé et la recréation (deux prétendants).
4. Watermark d'éviction non appliqué au chargement (des enregistrements ≤ watermark encore présents après crash sont servis ; gap sur-déclaré seulement).
5. Client : après changement d'époque, `maxSeenSeq` de l'ancienne génération peut relever le curseur de la nouvelle.
6. Client : pas de validation complète des filtres côté client ; filtres transmis mutables après `subscribe`.
7. Client : connexions concurrentes (`connect` appelé deux fois, reconnexion pendant `connect`) non sérialisées.
8. Client : bornes de `fetch` (accumulation de messages) et d'attente d'ACK à préciser.

Relevé personnel supplémentaire, non corrigé : `publish()` renvoie au plus une fois ; au-delà, l'appelant doit rappeler `publishSigned`
avec le même événement pour rester idempotent.
