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
- **Pourquoi priver la voix simple de `remind` ?** Une voix captée dans une pièce physique peut émaner d'un tiers, d'un collègue, d'un enfant ou d'une vidéo en cours de lecture. Créer un rappel persistant (qui réveillera Patrice à des heures indues ou encombrera son agenda) sans identification formelle de l'owner est un risque de pollution ou de spoofing de planning.
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

---

## 5. Mesures et Outillage

- **Outillage** : 6 appels Code Explorer (`analyze`, `context`, `impact`, `query weather`, `query stock_quote`, `query camera_analyze`), 2 commandes via lm-resizer (`typecheck baseline`, `vitest tests/companion/companion-identity.test.ts`), sortie compressée.
- **Index Code Explorer** : à jour (commit `76e675a6923e67e48b2fb2cf68c7fdd7c5fba5f7`).
