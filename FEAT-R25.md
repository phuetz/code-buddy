# FEAT-R25 — « Lisa, qu'est-ce que tu vois ? »

## Réservation

- Dépôt : `/home/patrice/DEV/cb-feat-regarde-2026-09-02`
- Branche : `feat/regarde-camera-2026-09-02`
- Propriétaire : Grok 4.6
- Zone : `src/companion/camera-share.ts`, câblage Telegram dans `src/commands/handlers/channel-handlers.ts`, câblage voix dans `src/sensory/voice-loop.ts` et `src/sensory/hybrid-reply.ts`, tests `tests/companion/camera-share.test.ts` et `tests/sensory/camera-share-voice.test.ts`, et ce rapport.
- `docs/FABLE5-CODEX-COORDINATION.md` est gelé conformément à la demande de mission ; la réservation est consignée ici.
- État initial : `node_modules` non suivi ; hors périmètre. Aucun autre fichier sale.

## Objet

Aujourd'hui `CODEBUDDY_VISION_TELEGRAM_PHOTO=true` joint une photo-clé aux **alertes** vision, mais il n'existe aucune commande à la demande. `lisa-selfie.ts` ne couvre que le portrait généré de Lisa. `visual-grounding.ts` ouvre la caméra pour un objet nommé, puis **efface** la frame — donc ne peut pas l'envoyer.

R25 ajoute l'intention « montre-moi ce que voit la caméra » :

1. **Telegram** : capture → photo dans le chat configuré + phrase courte de description **locale**.
2. **Voix** : la même intention → description parlée locale. Pas de photo sauf demande explicite « envoie-la sur Telegram » / « envoie-moi une photo de la pièce ».

## Contrat

### Détection (FR, motif comme le selfie)

Positif (scène / caméra, pas un objet nommé) :

- « qu'est-ce que tu vois ? », « que vois-tu », « what do you see »
- « montre-moi la caméra », « montre la pièce », « montre-moi ce que tu vois »
- « regarde » (forme nue ou « regarde la caméra / la pièce / autour »)
- « envoie-moi une photo de la pièce », « envoie ce que tu vois »

Négatif (laissé aux chemins existants) :

- selfie de Lisa (`isLisaSelfieRequest`)
- « tu vois ce que je veux dire », « tu vois que… »
- « regarde les actualités / le code / la météo »
- « regarde le hamburger », « tu vois mon tournevis » → `visual-grounding`

### Capture et description

- Capture via `captureCameraSnapshot` (injectable ; aucun ffmpeg réel dans les tests).
- Description via `CODEBUDDY_VISION_MODEL` sur un endpoint **local** (loopback). `CODEBUDDY_VISION_REMOTE_IMAGE` reste `false` : les octets image ne partent pas vers un VLM distant (`shouldAllowVisionImageEndpoint`).
- Caméra absente / capture vide → « je n'ai pas d'image en ce moment ».

### Telegram

- Photo **uniquement** via `sendTelegramAlert` → `CODEBUDDY_SENSORY_ALERT_CHAT`. Jamais `channel.sendImageFile` vers un autre `chat_id`.
- Si le message inbound n'est pas ce chat : pas d'envoi photo, pas de fuite vers un autre destinataire.
- Si `CODEBUDDY_VISION_TELEGRAM_PHOTO` ≠ `true` : description seule + « l'envoi de photo est désactivé ».
- Un envoi au plus toutes les 10 s.

### Voix

- Description parlée locale.
- Envoi photo seulement si l'énoncé demande explicitement l'envoi (Telegram / photo de la pièce / « envoie-la »).
- S'exécute **avant** le grounding visuel ambigu, pour que « qu'est-ce que tu vois ? » et « regarde » ne demandent plus confirmation.

## Hors périmètre

Aucun message Telegram réel, aucune capture de la vraie caméra, aucun service touché, `~/code-buddy` intact, pas de modification de `docs/FABLE5-CODEX-COORDINATION.md`.

## Journal

### Surface Telegram

Rouge (module absent) :

```text
$ npx vitest run tests/companion/camera-share.test.ts
FAIL  tests/companion/camera-share.test.ts
Error: Cannot find module '../../src/companion/camera-share.js'
Test Files  1 failed (1)
```

Vert :

```text
$ npx vitest run tests/companion/camera-share.test.ts
Test Files  1 passed (1)
Tests  13 passed (13)

$ npx vitest run tests/companion/lisa-selfie.test.ts tests/companion/visual-grounding.test.ts
Test Files  2 passed (2)
Tests  35 passed (35)

$ npm run typecheck
exit 0

$ npx eslint src/companion/camera-share.ts src/commands/handlers/channel-handlers.ts tests/companion/camera-share.test.ts
exit 0
```

Commit Telegram : `3a9357352` `feat(companion): envoyer sur Telegram ce que voit la caméra`

### Surface voix

Rouge (câblage absent — « qu'est-ce que tu vois ? » tombait sur le consentement ambigu) :

```text
$ npx vitest run tests/sensory/camera-share-voice.test.ts
FAIL  ... cameraShare to be called once, but got 0 times
FAIL  ... expected 'pour le dire autrement, oui, je peux regarder. tu veux que j'ouvre la caméra...'
      to contain 'je n'ai pas d'image en ce moment'
Test Files  1 failed (1)
Tests  4 failed | 1 passed (5)
```

Vert :

```text
$ npx vitest run tests/sensory/camera-share-voice.test.ts tests/sensory/voice-loop.test.ts tests/companion/camera-share.test.ts
Test Files  3 passed (3)
Tests  109 passed (109)

$ npx vitest run tests/sensory/hybrid-reply.test.ts
Test Files  1 passed (1)
Tests  55 passed (55)

$ npm run typecheck
exit 0

$ npx eslint src/sensory/voice-loop.ts src/sensory/hybrid-reply.ts src/companion/camera-share.ts tests/sensory/camera-share-voice.test.ts
exit 0
```
