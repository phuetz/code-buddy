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
