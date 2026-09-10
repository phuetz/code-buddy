# PWA mobile

La coquille `/__codebuddy__/mobile/` et le pont d'approbation WebSocket
(`confirmation_required` / `confirmation_response`) sont **opt-in**.

```bash
export CODEBUDDY_MOBILE_PWA=true
```

Sans cette variable :

- `GET /__codebuddy__/mobile/` répond 404
- `ConfirmationService` ne reçoit pas de `wsApprovalBridge` (comportement
  byte-identique à l'absence de PWA)
- le repli Telegram / TTY d'approbation n'est pas capturé

Le client PWA s'authentifie avec `approvalCapable: true` et la portée `tools`.
Un `/fleet listen` n'est pas une surface d'approbation.

L'exploitant du service mobile doit ajouter `CODEBUDDY_MOBILE_PWA=true` à
son fichier d'environnement, sinon le téléphone n'a plus de PWA ni de pont.

## Photos partagées

Montrer une photo à Lisa est un geste de couple, pas un téléversement : elle
regarde, réagit avec un détail concret, pose une question en retour, et s'en
souvient pour en reparler.

### Depuis le téléphone

Le bouton 📷 du composer ouvre l'appareil photo (`capture="environment"`) ou la
galerie, quatre photos au maximum par message. Le navigateur **redimensionne
avant l'envoi** (côté canvas, 1 280 px de côté maximum, JPEG qualité 0,82) :
une photo d'appareil fait 3 à 5 Mo, la limite serveur est de 600 Ko par photo.
Chaque vignette porte une croix pour la retirer ; une photo seule suffit, le
texte est facultatif.

Le serveur refuse proprement (message d'erreur, pas de tour) au-delà de quatre
photos, au-delà de 600 Ko, ou quand les octets ne sont pas une image. **Le type
vient toujours des octets** (nombres magiques), jamais du `mimeType` annoncé ni
d'une extension.

### Depuis Telegram

Une photo (avec ou sans légende) passe par le même chemin. Un **album** est
regroupé sur 1,5 s (`CODEBUDDY_TELEGRAM_MEDIA_GROUP_MS`) pour ne produire
**qu'une seule réaction**. Le téléchargement passe par `getFile`, plafonné à
10 Mo, uniquement en https (ou loopback pour un serveur de test).

### Vie privée — `CODEBUDDY_COMPANION_PHOTO_VISION`

| Valeur | Effet |
| --------- | ------------------------------------------------------------------------------------------------------- |
| `auto` (défaut) | L'image part au modèle **s'il est déclaré multimodal** (`getModelStrengths`), sinon description locale. |
| `local` | **L'image ne quitte jamais la machine.** Seule une description produite par `CODEBUDDY_VISION_MODEL` (moondream, boucle locale) entre dans le message, sous la forme `[Photo envoyée : …]`. |
| `cloud` | L'image part systématiquement au fournisseur configuré, en part `image_url`. |

En mode `local` la garantie est testée : un faux client cloud ne reçoit aucune
part image et aucun base64. Si un modèle déclaré multimodal répond malgré tout
« je ne peux pas voir les images », le tour **reprend une seule fois en local**
pour que cette phrase n'atteigne jamais l'utilisateur.

### Album commun

Chaque photo partagée est rangée hors du dépôt, dans
`~/.codebuddy/companion/shared-photos/<aaaa-mm>/<sha256>.jpg` (fichiers `0600`),
avec un sidecar JSON `{receivedAt, surface, captionUser, descriptionLisa, hash}`
— sans prénom, sans chemin absolu, sans identifiant de conversation. La même
photo envoyée deux fois reste une seule entrée. La capacité est plafonnée par
`CODEBUDDY_SHARED_PHOTOS_MAX` (500 par défaut) ; l'éviction retire les plus
anciennes et **jamais un favori**.

Une ligne de mémoire roulante (`photos:recent`, cinq lignes au plus, le même
mécanisme que `episode:recent` du journal épisodique) est réinjectée par le
contexte relationnel dans un bloc `<recent_photos>`, pour que Lisa puisse
d'elle-même reparler de « la photo du lac de l'autre jour ».

L'onglet **Album** de la PWA affiche dans une même grille les photos partagées
et les selfies de Lisa, triés par date, avec lightbox, favori ❤️ et suppression
confirmée. Il est servi par `GET /__codebuddy__/mobile/album` et
`GET /__codebuddy__/mobile/album/<hash>`, **authentifiés** (JWT `Bearer`, ou
requête loopback directe — aucune assertion de proxy n'est acceptée). La réponse
ne contient que des empreintes : aucun chemin de fichier n'en sort. Sans
`CODEBUDDY_MOBILE_PWA=true`, ces routes répondent 404 comme le reste de la PWA.

### Variables

| Variable | Rôle |
| ------------------------------------- | ---------------------------------------------------------------- |
| `CODEBUDDY_COMPANION_PHOTO_VISION` | `auto` (défaut) / `local` / `cloud` — voir ci-dessus |
| `CODEBUDDY_SHARED_PHOTOS_MAX` | Capacité de l'album (défaut 500) |
| `CODEBUDDY_SHARED_PHOTOS_DIR` | Emplacement de l'album (défaut `~/.codebuddy/companion/shared-photos`) |
| `CODEBUDDY_TELEGRAM_MEDIA_GROUP_MS` | Fenêtre de regroupement d'un album Telegram (défaut 1 500 ms) |
| `CODEBUDDY_VISION_MODEL` | Modèle de description locale (moondream) utilisé en mode `local` |

## Application Android

L'application native Android utilise une clé EC P-256 du Keystore, dont l'usage
est autorisé par la sécurité Android (biométrie). Le serveur conserve uniquement
la clé publique et vérifie une signature de connexion. La contrainte biométrique
et la protection matérielle de la clé sont appliquées par l'application/Keystore ;
ce protocole ne réalise pas d'attestation matérielle à distance.

Sur la machine du serveur, sous **le même compte système** que `buddy server` :

```bash
buddy pair --url https://buddy.example.test
buddy devices list
buddy devices rename <deviceId> "Mon Android"
buddy devices revoke <deviceId>
```

`buddy pair` affiche un code de huit caractères sans ambiguïté, valable dix minutes
et une seule fois, ainsi qu'un QR ANSI via `qrencode`. Si `qrencode` est absent,
la commande indique comment l'installer et conserve le code affiché utilisable.
Le contenu exact du QR est `{"url":"https://buddy.example.test","pairingCode":"…"}`.
`--json` imprime uniquement ce contenu. `--url` prime sur `CODEBUDDY_SERVER_URL` ;
sans configuration, l'URL est `http://127.0.0.1:3000` (ou le port configuré),
à remplacer par une adresse joignable depuis le téléphone. Aucune route réseau
ne délivre de code d'appairage.

Les trois routes sont publiques, indépendantes du drapeau PWA, sans JWT préalable
ni cookie/jeton CSRF. Chaque route est limitée à dix requêtes par minute et par
adresse de transport. Les en-têtes `X-Forwarded-For` ne changent pas cette limite ;
derrière un reverse proxy, ses clients partagent donc la limite. Réponses
`Cache-Control: no-store`. Utiliser HTTPS/WSS pour le téléphone hors boucle locale.

| POST | Corps JSON | Réponse 200 |
| --- | --- | --- |
| `/api/auth/device/register` | `{ pairingCode, deviceName, publicKeyJwk }` | `{ deviceId }` |
| `/api/auth/device/challenge` | `{ deviceId }` | `{ nonce, expiresAt }` |
| `/api/auth/device/verify` | `{ deviceId, nonce, signature }` | `{ token }` |

`publicKeyJwk` contient `kty: "EC"`, `crv: "P-256"`, `x` et `y` en base64url.
Une JWK privée (`d`) est refusée. `deviceName` contient 1 à 80 caractères après
trim, sans caractères de contrôle. `nonce` encode 32 octets aléatoires en
**base64url sans padding** ; `expiresAt` est une date ISO 8601 UTC. Le challenge
expire après 60 secondes ; en demander un autre invalide le précédent du même
appareil. Un redémarrage du serveur invalide les challenges en mémoire.

L'application signe les octets **UTF-8 de `deviceId + "." + nonce`**, sans nouvelle
ligne, avec ECDSA/SHA-256 (ES256). `signature` est le **base64url sans padding des
64 octets `r || s`**, chaque entier étant non signé et complété à 32 octets
(format IEEE P1363/JOSE). Android `SHA256withECDSA` renvoie habituellement une
séquence ASN.1 DER : le serveur accepte aussi directement ce format natif,
encodé en base64url ou en base64 standard (avec ou sans padding). Un essai avec le
nonce courant le consomme même si la signature est fausse.

Un code inconnu, expiré ou déjà utilisé retourne le même `400` générique ; une
preuve invalide, expirée ou un appareil révoqué retourne `401` ; dépassement de
limite : `429` ; magasin occupé/indisponible ou configuration JWT manquante : `503`.
Les erreurs ne reflètent ni nom, ni identifiant, ni clé. Le serveur doit disposer
d'un secret JWT valide ; le mode de développement authentifié peut en créer un
éphémère, tandis qu'un `JWT_SECRET` stable conserve les jetons après redémarrage.
La CLI d'appairage n'a pas besoin de lire ce secret.

Le JWT expire après une heure et porte `sub: deviceId`,
`amr: ["biometric", "device"]`, `profile: "agent"`, `identity: "owner"`, et les
portées utilisateur `chat`, `chat:stream`, `sessions`, `tools`. Le renouvellement
nécessite une nouvelle preuve par challenge/signature. La révocation est relue
sur les requêtes HTTP, à l'authentification WS et avant chaque nouveau message WS,
y compris une réponse de confirmation ; elle n'annule pas une action déjà achevée.

Sur `/ws`, envoyer `{"type":"authenticate","payload":{"token":"…"}}`, puis les
messages `chat` habituels. La réponse `authenticated.payload` expose aussi
`profile`, `identity` et `amr`. Avec `profile: "agent"`, le serveur utilise l'agent
complet même si le client demande `assistant: "companion"`. Le mode de permission
est `default`, isolé par tour ; les outils suivent les confirmations normales de
Code Buddy. Le téléphone est automatiquement une surface d'approbation et reçoit
`confirmation_required { id, tool, summary, risk }`. Il répond
`confirmation_response { id, approved }` par le pont existant, même lorsque la PWA
est désactivée. Les jetons historiques sans ces champs gardent leur réponse
d'authentification et leur routage agent/companion existants.

**Intégration companion (lane séparée)** :
`src/server/auth/device-session-context.ts` exporte `getDeviceSessionIdentity()`.
Pendant le tour WS, cette fonction rend une vue immuable des champs signés
`deviceId`, `profile`, `identity`, `amr` ; hors du tour ou pour un jeton historique,
elle rend `undefined`. Les extensions WS les lisent aussi via `ctx.principal`.
Aucun champ d'identité fourni dans le corps d'un message ne remplace ces valeurs.
La politique de conversation de Lisa reste gérée par la lane companion.

Le fichier `~/.codebuddy/devices.json` est écrit atomiquement en mode `0600`.
Son enveloppe conserve les nœuds SSH/ADB historiques (`version`, `devices`) et
ajoute `deviceAuth.devices` (clé publique, nom, dates et `revokedAt`) ainsi que
`deviceAuth.pairings` (empreintes SHA-256 des codes et échéances). Un verrou
`devices.json.lock` sérialise CLI et serveur. En cas de processus tué pendant une
écriture, les mutations échouent sans ouvrir l'accès : après avoir vérifié qu'aucun
écrivain ne travaille encore, retirer uniquement ce répertoire de verrou vide.
Ne pas restaurer une ancienne sauvegarde pour contourner une révocation.
Les événements `device_register`, `device_verify`, `device_revoke` sont consignés
par `audit-logger` dans le répertoire d'audit voisin, sans codes, signatures,
jetons, clés ni noms d'appareils.

## Capacités étendues et outillage quand l'utilisateur est identifié

Lorsque l'interlocuteur est identifié et que le coupe-circuit `CODEBUDDY_COMPANION_TOOLS_ENABLED=true` est activé, Lisa dispose d'un jeu d'outils adapté à la conversation naturelle et aux requêtes du quotidien (« dessine-moi un chat roux », « rappelle-moi le train demain à 9h », « quel temps fait-il ? »).

### Résolution d'identité

- **PWA (WebSocket)** : L'authentification par JWT serveur validé identifie le `userId`. Si `CODEBUDDY_OWNER_USER_ID` est configuré, seul l'utilisateur correspondant obtient le niveau `owner` ; par défaut, tout token JWT serveur valide confère le niveau `owner`. Une session anonyme ou non authentifiée retombe en `guest` (0 outil, comportement historique).
- **Telegram** : L'expéditeur ou le canal présent dans l'allowlist (`allowedUsers` ou `CODEBUDDY_SENSORY_ALERT_CHAT`) obtient le niveau `owner`.
- **Voix** : La présence détectée face au robot avec interpellation nominale (« Lisa ») confère le niveau `present`.

### Outils autorisés par niveau

| Rôle | Outils disponibles |
| ---- | ------------------ |
| `owner` | `image_generate`, `image_edit`, `remind`, `web_search`, `weather`, `stock_quote`, `understand_video`, `camera_analyze`, `recall` |
| `present` | Idem sans `remind` (pas de création aveugle) ni `camera_analyze` (œil déjà actif) |
| `guest` | Aucun outil (0 outil, fail-closed strict) |

### Sécurité et garde-fous

- **Liste noire absolue** : Les outils d'exécution shell (`bash`, `terminal`, `process`), de manipulation de fichiers (`create_file`, `write_file`, `str_replace_editor`, `apply_patch`), les outils MCP et fleet sont **strictement interdits** et filtrés en amont.
- **Mots d'attente immédiats** : Dès qu'un outil plus long est déclenché, Lisa annonce immédiatement un mot d'attente naturel (« Je dessine… », « Je regarde… ») avant même la fin de l'appel.
- **Livraison média et mémoire** : Une image produite (via ComfyUI local ou backend configuré) est automatiquement envoyée en média dans le flux (photo Telegram, image PWA, envoi Telegram pour la voix). L'historique conserve la trace sous `[Image générée : <chemin>]` ou `[Rappel créé : <label>]`, permettant à Lisa de s'en souvenir au tour suivant.

