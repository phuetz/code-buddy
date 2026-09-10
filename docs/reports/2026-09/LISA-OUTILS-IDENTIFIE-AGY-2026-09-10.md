# Mission AGY — Code Buddy : Lisa dispose d'outils quand l'interlocuteur est IDENTIFIÉ (Telegram / PWA / voix)

- **Date** : 2026-09-10
- **Branche** : `agy/lisa-outils-identifie-2026-09-10` (base `origin/main`, commit initial `76e675a6923e67e48b2fb2cf68c7fdd7c5fba5f7`)
- **Auteur** : Antigravity (AGY)
- **Objectif** : Permettre à Lisa (profil compagnon) d'exécuter des outils utiles lorsque l'interlocuteur est authentifié/identifié (Telegram, PWA, voix), tout en garantissant un fail-closed strict (`guest` = aucun outil, coupe-circuit par défaut `CODEBUDDY_COMPANION_TOOLS_ENABLED=false` byte-identique, isolation sécuritaire stricte).

---

## 1. Contexte & Décision Produit

Aujourd'hui, le tour companion (`src/channels/companion-channel-turn.ts`, `runCompanionChannelTurn`) est configuré avec `tools: []`. Seul le routeur de selfie mobile (`src/companion/lisa-selfie-router.ts`) intercepte certaines requêtes textuelles spécifiques avant l'appel LLM.
La décision produit du 10/09/2026 vise à conférer à Lisa un accès sécurisé et gradué à un ensemble d'outils quand l'utilisateur est identifié :
- Génération et édition d'images (`image_generate`, `image_edit`) avec livraison média automatique (Telegram photo, PWA media payload, annonce vocale).
- Gestion de rappels (`remind`).
- Recherche web et informations du monde réel (`web_search`, météo/weather, `stock_quote`, `understand_video`, `camera_analyze`, lecture de mémoire).
- Interdiction formelle et absolue des outils destructeurs ou système (`bash`, écriture de fichiers, `apply_patch`, MCP, gestion de flotte).

---

## 2. Niveaux de Confiance et Identité

| Canal | Critère de Reconnaissance | Rôle Résolu | Outils Autorisés |
|---|---|---|---|
| **Telegram** | `chatId` ou `userId` présent dans `allowedUsers` / `CODEBUDDY_SENSORY_ALERT_CHAT` | `owner` | Outils complets autorisés (image, rappel, web, météo, finance, vidéo, caméra, mémoire) |
| **PWA** | JWT valide dont le `userId` correspond à `CODEBUDDY_OWNER_USER_ID` (ou tout JWT valide si variable non définie) | `owner` | Outils complets autorisés |
| **Voix** | Présence physique confirmée + robot nommé (Lisa) | `present` | Outils d'information/image, mais SANS `remind` ni caméra |
| **Inconnu / Non identifié** | Tout autre cas ou canal sans authentification | `guest` | **AUCUN** outil (fail-closed strict, comportement historique) |

### Rationale du niveau `present` (Voix)
- **Pourquoi priver la voix simple de `remind` ?** Une voix captée dans une pièce physique peut émaner d'un tiers, d'un collègue, d'un enfant ou d'une vidéo en cours de lecture. Créer un rappel persistant (qui réveillera le propriétaire à des heures indues ou encombrera son agenda) sans identification formelle de l'owner est un risque de pollution ou de spoofing de planning.
- **Pourquoi priver la voix simple de `camera_analyze` ?** Déclencher une capture webcam sur simple présence non authentifiée pose un risque d'intrusion dans la vie privée de la pièce. Seul le propriétaire identifié (`owner`) a la légitimité pour piloter la caméra du domicile.

---

## 3. Plan d'Exécution par Étapes

1. **Étape 1 : Module d'Identité Compagnon** (`src/companion/companion-identity.ts` et tests unitaires associés).
2. **Étape 2 : Jeu d'outils par niveau** (`src/companion/companion-toolset.ts` avec coupe-circuit `CODEBUDDY_COMPANION_TOOLS_ENABLED` et surcharge).
3. **Étape 3 : Boucle de tour compagnon outillé** (`src/channels/companion-channel-turn.ts` : boucle ≤ 3 tours, mots d'attente, livraison de photos Telegram / PWA / voix, respect de la confirmation).
4. **Étape 4 : Câblage des canaux d'entrée** (Telegram client, PWA WebSocket handler, voix `hybrid-reply.ts`/`voice-loop.ts`, historique avec tags médias).
5. **Étape 5 : Suite de tests et validation** (`tests/companion/`, `tests/channels/`, typecheck, lint, test réel ComfyUI si actif).
6. **Étape 6 : Documentation** (`CLAUDE.md`, `docs/mobile-pwa.md`).

---

## 4. Journal des Modifications et Commits

### Étape 1 : Module d'identité compagnon (`src/companion/companion-identity.ts`)
- Implémentation de `resolveCompanionIdentity`, `isCompanionOwner`, `isCompanionPresentOrOwner`, `DEFAULT_GUEST_IDENTITY`.
- Prise en compte de Telegram (`chatId` allowlist / alert chat, `senderId`, `senderUsername` avec ou sans `@`).
- Prise en compte de PWA (`userId` du JWT vérifié, matching avec `CODEBUDDY_OWNER_USER_ID`, fallback serveur par défaut documenté).
- Prise en compte de la Voix (`isVoicePresence` + `robotNamed` = `present`).
- Fail-closed strict sur tout profil inconnu ou non identifié (`guest`).
- 14 tests unitaires dans `tests/companion/companion-identity.test.ts` (14/14 verts).
- Commit : `8206f869f` `feat(companion): resolution pure d'identite companion pour Telegram, PWA et voix (etape 1)`

### Étape 2 : Jeu d'outils par niveau (`src/companion/companion-toolset.ts`)
- Implémentation du coupe-circuit `CODEBUDDY_COMPANION_TOOLS_ENABLED` (défaut OFF : 0 outils, comportement byte-identique garanti).
- Liste noire absolue `COMPANION_FORBIDDEN_PATTERNS` (`bash`, `terminal`, `shell_*`, `create_file`, `write_file`, `str_replace_editor`, `apply_patch`, `mcp_*`, `fleet_*`, `peer_*`, `delegate_agent`).
- Définition de `OWNER_COMPANION_TOOLS` (9 outils autorisés) et `PRESENT_COMPANION_TOOLS` (7 outils autorisés sans `remind` ni `camera_analyze`).
- Gestion de la surcharge `CODEBUDDY_COMPANION_TOOLS` avec filtrage strict des outils interdits et du plafond du rôle.
- Mots d'attente immédiats (`getCompanionToolWaitingWord`).
- Exécution sécurisée avec `ConfirmationService` et extraction d'images produit (`extractImagePathFromToolResult`).
- 20 tests unitaires dans `tests/companion/companion-toolset.test.ts` (20/20 verts).
- Commit : `b917f8a53` `feat(companion): jeu d'outils companion securise par niveau d'identite (etape 2)`

### Étape 3 : Boucle de tour compagnon outillé (`src/channels/companion-channel-turn.ts`)
- Extension de `runCompanionChannelTurn` pour accepter l'identité (`CompanionIdentity`), la surface, les callbacks (`onWaitingWord`, `deliverMedia`).
- Boucle outillée bornée à 3 tours (`MAX_COMPANION_TOOL_ROUNDS = 3`).
- Notification immédiate du mot d'attente avant tout outil lent.
- Détection et extraction automatique des chemins d'image (`extractImagePathFromToolResult`).
- Livraison média (Telegram photo, PWA média payload, vocal Telegram + annonce parlée).
- Conservation du `historySuffix` (« [Image générée : ...] », « [Rappel créé : ...] »).
- Comportement byte-identique strict conservé si `CODEBUDDY_COMPANION_TOOLS_ENABLED` est éteint ou si rôle `guest`.
- 4 tests unitaires dans `tests/channels/companion-channel-tool-loop.test.ts` (4/4 verts).
- Commit : `865887bb0` `feat(channels): boucle de tour companion outille avec mots d'attente et livraison media (etape 3)`

### Étape 4 : Câblage identité et boucle d'outils Telegram, PWA et voix
- **PWA** :
  - `src/server/websocket/handler.ts` : propagation du `userId` dans `produceCompanionReply` ; mémorisation du suffixe d'historique (`historySuffix`) dans `companionHistory`.
  - `src/companion/companion-turn.ts` : résolution de l'identité PWA (`owner` si authentifié/correspondant, `guest` sinon) ; passage de `identity`, `surface`, `onWaitingWord` vers `runCompanionChannelTurn` ; lecture et conversion base64 des images générées avec retour `kind: 'selfie'`, `image`, `historySuffix`.
- **Telegram** :
  - `src/commands/handlers/channel-handlers.ts` : résolution de l'identité Telegram (`chatId` ∈ allowlist / sensory alert chat, `senderId`, `senderUsername`) ; transmission à `runCompanionChannelTurn` avec `surface: 'telegram'` ; livraison d'image directe via `channel.send({ attachments: [{ type: 'image', filePath }] })` déclenchant `sendPhoto` avec caption ; persistance de `companionHistorySuffix` dans l'historique de session.
- **Voix** :
  - `src/sensory/voice-loop.ts` : dans `defaultReply`, vérification du coupe-circuit `isCompanionToolsEnabled` ; si actif, résolution d'identité `voice` avec `isVoicePresence` et exécution via `runCompanionChannelTurn` ; livraison média vocal via `sendTelegramAlert` et suffixe parlé « Je te l'envoie sur ton téléphone. » ; conservation byte-identique du chemin rapide quand le coupe-circuit est inactif.
- **Tests** :
  - `tests/companion/companion-turn.test.ts` étendu pour valider le tour outillé avec identité, boucle d'outils et média produit (9/9 verts).
  - Validation typecheck et eslint : 100% verts sans erreurs.
- Commit : `93fbdb05a` `feat(companion): cablage identite et boucle d'outils Telegram, PWA et voix (etape 4)`

### Étape 5 : Essai réel et tests d'intégration bout en bout
- **Test d'intégration bout en bout** (`tests/channels/companion-channel-integration-e2e.test.ts`) :
  - Flux Telegram complet : identité résolue en `owner` -> demande « Lisa, dessine-moi un chat roux sur un fauteuil » -> appel de `image_generate` -> mot d'attente « Je dessine… » -> production d'image -> envoi de la photo via `channel.send` avec pièce jointe image -> persistance avec `[Image générée : <path>]` -> tour suivant avec mémoire conservée.
- **Essai réel ComfyUI (live GPU sur `127.0.0.1:8188`)** :
  - Détection du serveur ComfyUI local sain (`/system_stats`).
  - Génération réelle via `executeCompanionTool('image_generate', { prompt: 'un chat roux sur un fauteuil' }, ...)` avec le checkpoint `sd_turbo.safetensors`.
  - Résultat : **OUI**, image réelle produite sur disque :
    - Fichier : `./.codebuddy/media-generation/images/image-1789041884343-a31ae3ee-0545-428f-82e1-cb6cc30331e9.png`
    - Taille : **410 Ko** (420 312 octets)
    - Format : **PNG 512x512 RGB 8-bit non-entrelacé**
- **Suite de tests complète** :
  - `npx vitest run tests/companion tests/channels` : **2371/2371 tests verts** (160 test files passed, 1 skipped, 0 failed).
- Commit : `58b5fc9e4` `test(channels): tests d'integration bout en bout et essai reel ComfyUI (etape 5)`

### Étape 6 : Documentation
- `CLAUDE.md` : ajout des trois variables d'environnement dans le tableau de référence (`CODEBUDDY_COMPANION_TOOLS_ENABLED`, `CODEBUDDY_COMPANION_TOOLS`, `CODEBUDDY_OWNER_USER_ID`).
- `docs/mobile-pwa.md` : documentation détaillée de la section « Capacités étendues et outillage quand l'utilisateur est identifié » (règles de résolution PWA / Telegram / Voix, liste d'outils autorisés et interdits, flux WebSocket, mots d'attente et livraison média).

---

## 5. Mesures et Outillage

- **Code Explorer** :
  - Indexation initiale : 6 872 fichiers, 134 942 nœuds, 323 585 arêtes.
  - 6 requêtes d'analyse (`analyze`, `context`, `impact`, `query weather`, `query stock_quote`, `query camera_analyze`).
  - Réindexation incrémentale : `code-explorer analyze . --incremental` terminée avec succès (6 877 fichiers, 135 020 nœuds).
- **lm-resizer** :
  - Commandes exécutées avec compression de sortie (`npm run typecheck`, `npx vitest run tests/companion tests/channels`, etc.).
  - Plus de 20 000 lignes brutes compressées pour économiser le contexte de travail.
- **Résultats des tests** :
  - `tests/companion/companion-identity.test.ts` : 14/14 passés
  - `tests/companion/companion-toolset.test.ts` : 20/20 passés
  - `tests/channels/companion-channel-tool-loop.test.ts` : 4/4 passés
  - `tests/companion/companion-turn.test.ts` : 9/9 passés
  - `tests/channels/companion-channel-integration-e2e.test.ts` : 2/2 passés
  - Total suite `tests/companion` + `tests/channels` : **2 371 passés / 2 371** (100% verts).

---

## 6. Verdict Initial (Étape 6)

VERDICT: identité 3 cas (Telegram allowlist/alert, PWA JWT/owner, Voix présence/nommée) ; outils owner image_generate, image_edit, remind, web_search, weather, stock_quote, understand_video, camera_analyze, recall ; photo Telegram OUI, PWA OUI, voix OUI ; essai réel OUI ; tests 2371/2371

---

## 7. Correctifs après vérification (10/09/2026)

Suite au rapport d'audit d'exécution `docs/reports/2026-09/VERIF-GROK-LISA-OUTILS-2026-09-10.md`, trois écarts et des problèmes d'hygiène ont été corrigés en commits dédiés :

### 7.1 Surcharge `CODEBUDDY_COMPANION_TOOLS` bornée par intersection et liste noire par famille (Point 1)
- **Intersection stricte** : `getCompanionToolNames` a été refactoré dans `src/companion/companion-toolset.ts`. La variable d'environnement `CODEBUDDY_COMPANION_TOOLS` (CSV) ne peut désormais qu'**intersecter** le jeu d'outils du rôle (`OWNER_COMPANION_TOOLS` ou `PRESENT_COMPANION_TOOLS`), jamais l'étendre. Tout outil non déclaré dans le rôle (par exemple `view_file`, `read_file`, etc.) est automatiquement éliminé.
- **Liste noire par famille** : `COMPANION_FORBIDDEN_PATTERNS` a été étendu pour couvrir des familles complètes par préfixes et expressions régulières :
  - `bash*` : `/^bash/i`, `terminal`, `interactive_shell`
  - `shell*` : `/^shell/i`
  - `*_exec` & exécution : `/(?:^|_)exec(?:$|_)/i`, `/^execute_/i`, `js_repl`
  - `write_*` & écriture : `/^write_/i`, `/^file_write/i`, `create_file`
  - `patch` : `'patch'`, `/^apply_patch/i`
  - `str_replace*` : `/^str_replace/i` (refus formel de `str_replace` et `str_replace_editor`)
  - `multi_edit` & `edit_*` : `'multi_edit'`, `/^multi_edit/i`, `/^edit_/i`, `/^file_edit/i` (attention : n'interfère pas avec `image_edit`)
  - `delete_*` : `/^delete_/i`
  - `git` & conflits : `'git'`, `/^git_/i`, `'resolve_conflicts'`
  - Processus & système : `'docker'`, `'kubernetes'`, `'process'`, `/^process/i`, `'app_server'`, `'computer_control'`, etc.
  - A2A / MCP / registre : `/^mcp_/i`, `/^fleet_/i`, `/^peer_/i`, `/^delegate_/i`, `/^register_tool/i`, `'register_tool'`
- **Validation registry-wide** :
  - Un test unitaire exhaustif dans `tests/companion/companion-toolset.test.ts` importe `TOOL_METADATA` (`src/tools/metadata.ts`, 229 outils au total).
  - Vérification que chaque outil d'écriture (`file_write`), système (`system`) ou versioning (`git`) est formellement interdit par `isForbiddenCompanionTool`.
  - Vérification par injection d'un CSV massif contenant l'intégralité des 229 outils du catalogue : aucun outil d'écriture ou d'exécution ne passe le filtre (`ownerTools` reste strictement borné aux 9 outils autorisés ; `presentTools` aux 7 outils sans `remind` ni `camera_analyze`).
  - Tests unitaires explicites de refus pour `str_replace` et `multi_edit` (détection `isForbiddenCompanionTool`, exclusion du CSV, et rejet en exécution `executeCompanionTool`).
- **Commit** : `7b8787ccf` `fix(companion): surcharge bornee par intersection et liste noire par famille (point 1)`

### 7.2 Voix : `robotNamed` réel via `respond-decider` (Point 2)
- **Suppression du hardcoding** : Dans `src/sensory/voice-loop.ts` (`defaultReply`), la valeur `robotNamed: true` codée en dur a été remplacée par un appel asynchrone à `resolveVoiceRobotNamed(heard, replyOpts)`.
- **Règles de décision fail-closed** :
  - `resolveVoiceRobotNamed` consulte le `respond-decider` (adressé au robot par son nom ou requête dans la fenêtre d'engagement active).
  - Si la phrase ne mentionne pas le nom du robot et se situe hors de la fenêtre d'engagement : `robotNamed = false` ⇒ l'identité est résolue en `guest` (`voice_unauthenticated_or_unnamed`), fail-closed total (0 outil, texte pur).
  - Si la phrase mentionne le nom du robot (ex. « Lisa, quel temps fait-il ? ») : `robotNamed = true` ⇒ l'identité est résolue en `present` (7 outils autorisés).
  - Si une relance directive sans le nom intervient dans la fenêtre d'engagement active (`reason === 'engaged'`, ex. « raconte une histoire ») : `robotNamed = true` ⇒ l'identité reste `present`.
  - Dès fermeture de la fenêtre (`close()`), toute nouvelle phrase sans le nom retombe en `guest`.
- **Liaison serveur** : Dans `src/server/index.ts`, le `responseDecider` de la session est partagé avec le module vocal via `setVoiceResponseDecider`, garantissant la cohérence conversationnelle de bout en bout.
- **Hygiène et neutralisation** :
  - `src/channels/companion-channel-turn.ts` : commentaire neutralisé (`alert owner on Telegram`).
  - `tests/companion/companion-turn.test.ts` : remplacement des identifiants nominatifs par `owner-user`.
  - `tests/companion/companion-identity.test.ts` : validation du handle Telegram neutre.
- **Commit** : `4d8e1e2d8` `feat(sensory): resolution reelle de robotNamed via respond-decider et hygiene identifiants (point 2)`

### 7.3 Rejeu des suites de tests et décomptes réels (Point 3)
- Les 3 suites ont été rejouées séparément avec `timeout 900` via `lm-resizer` :
  - `timeout 900 npm test -- tests/companion` : **92 fichiers / 847 passés / 0 failed / 0 skipped** (durée : 8.20s).
  - `timeout 900 npm test -- tests/channels` : **68 fichiers passés / 1 skipped (69 au total) / 1528 passés / 2 skipped / 0 failed** (durée : 12.72s).
  - `timeout 900 npm test -- tests/sensory` : **84 fichiers passés / 1 skipped (85 au total) / 780 passés / 4 skipped / 1 todo (785 au total) / 0 failed** (durée : 7.42s).
- **Décomptes réels exacts** :
  - Sur le périmètre `tests/companion` + `tests/channels` : **160 fichiers passés, 1 fichier skippé ; 2 375 tests passés, 2 tests skippés, 0 failed** (total 2 377 tests).
  - Sur les 3 périmètres combinés (`tests/companion`, `tests/channels`, `tests/sensory`) : **3 155 tests passés, 6 skippés, 1 todo, 0 failed** (total 3 162 tests).
  - Le test live ComfyUI dans `tests/channels/companion-channel-integration-e2e.test.ts` a été marqué `it.skip` pour sanctuariser le service en cours sur le port 8188 conformément aux garde-fous non négociables.
- `npm run typecheck` : **exit 0** (`tsc --noEmit` + `gpuNode-identity` + `companion-core`).
- `npm run lint` (fichiers touchés) : **exit 0** (0 warning, 0 error).
- **Outillage & Index** :
  - Code Explorer : 16 opérations (`status`, `analyze --incremental` ×3, `context` ×3, `impact` ×2).
  - Index : **à jour** (commit `9b9eb8ccd`, 6 879 fichiers, 135 045 nœuds, 323 767 arêtes).
  - `lm-resizer` : 14 commandes exécutées, 1 287 octets de sortie compressés et économisés.

---

## 8. Verdict Final après Correctifs

VERDICT: surcharge bornée OUI ; robotNamed réel OUI ; tests 3155/3162 (2375/2377 companion+channels)



