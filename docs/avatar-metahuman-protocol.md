# Pont Code Buddy ↔ Unreal/MetaHuman

Ce document est le contrat d'intégration V1 pour le projet Unreal Engine 5.8 installé sur Darkstar.
Le renderer reçoit la voix et les intentions de Lisa, anime le MetaHuman, puis renvoie son état réel à
Code Buddy. Il ne décide jamais du contenu conversationnel.

## Connexion et sécurité

Le client Unreal ouvre `/ws` sur le même hôte et le même port que le serveur HTTP Code Buddy. Pour
l'instance Lisa actuelle, le serveur écoute uniquement sur Ministar à
`ws://127.0.0.1:3055/ws`. N'exposez pas ce port directement sur Internet.

Depuis Darkstar, la voie la plus sûre est un tunnel SSH sur Tailscale :

```powershell
ssh -N -L 3055:127.0.0.1:3055 patrice@100.98.18.76
```

Unreal se connecte alors à `ws://127.0.0.1:3055/ws` sur Darkstar. Le serveur de développement actuel
est sans authentification mais reste inaccessible hors de la boucle locale et du tunnel. Pour une
liaison réseau directe ou une instance de production, activez l'authentification et utilisez un JWT
court avec les scopes `avatar:read` et `avatar:write`.

```json
{"type":"authenticate","payload":{"token":"<jwt>"}}
```

Après `authenticated`, le renderer s'enregistre puis demande une synchronisation :

```json
{
  "type": "avatar.renderer.hello",
  "payload": {
    "rendererId": "darkstar-metahuman-lisa",
    "displayName": "Lisa MetaHuman on Darkstar",
    "protocolVersion": 1,
    "runtime": "unreal",
    "runtimeVersion": "5.8",
    "project": "D:\\DEV\\AvatarStudio",
    "capabilities": {
      "audioDrivenAnimation": true,
      "wavStream": true,
      "affect": true,
      "gestures": true,
      "gaze": true,
      "interruptionAck": true
    }
  }
}
```

Attendez `avatar.renderer.ack`, puis envoyez `{"type":"avatar.sync"}`. La réponse est nommée
`avatar:sync` pour rester compatible avec le format de diffusion du Gateway.

## Reprise après reconnexion

La réponse `avatar:sync` contient :

- `events` : seulement des tours de contrôle terminés parmi les 24 derniers événements ;
- `latestSequence` : barrière anti-duplication à conserver ;
- `audioReplay: false` : aucun ancien son ne doit être joué ;
- `ignoredTurnIds` : tours dont l'audio a été perdu pendant la coupure ;
- `renderers` : état public des renderers connus.

Au reconnect, arrêtez immédiatement tout son et toute animation de parole, revenez à l'état idle,
appliquez `events` dans l'ordre, puis positionnez la dernière séquence à `latestSequence`. Ignorez les
événements appartenant à `ignoredTurnIds` jusqu'à leur événement terminal. Ne tentez jamais de
rejouer un tour incomplet.

## Cycle d'un tour

Les messages reçus ont la forme `{"type":"avatar:event","payload":{...}}`. Le champ `payload.type`
suit normalement cet ordre :

1. `avatar.turn.started` — préparer affect, regard et geste ;
2. `avatar.speech.prepared` ou plusieurs `avatar.speech.segment` — texte de performance ;
3. `avatar.audio.started`, `avatar.audio.chunk`…, `avatar.audio.ended` — transfert d'un WAV ;
4. `avatar.speech.started` — commencer lecture et animation faciale ;
5. `avatar.speech.completed`, `avatar.speech.interrupted` ou `avatar.speech.failed` — arrêt terminal.

Un tour streaming peut contenir plusieurs WAV. Ne concaténez jamais deux streams : chaque `streamId`
correspond à un conteneur RIFF complet et indépendant.

```json
{
  "type": "avatar.audio.chunk",
  "turnId": "turn-uuid",
  "streamId": "turn-uuid:audio:0",
  "format": "wav_stream",
  "chunkIndex": 0,
  "byteOffset": 0,
  "byteLength": 49152,
  "data": "<base64>",
  "version": 1,
  "sequence": 42
}
```

Pour chaque stream, vérifiez : séquences strictement croissantes, `chunkIndex` contigu,
`byteOffset` égal au nombre d'octets déjà reçus, `byteLength` égal au résultat du décodage base64 et
taille maximale de 49 152 octets. À `avatar.audio.ended`, vérifiez `chunks` et `totalBytes`. Jetez le
stream s'il manque un morceau. Le transfert peut être fini avant `avatar.speech.started` : bufferisez
le WAV, mais ne lancez l'animation qu'au signal de parole.

## Retour d'état Unreal

Envoyez `avatar.renderer.status` à chaque changement de phase et au moins toutes les 15 à 30 secondes.
Après 45 secondes sans heartbeat, Code Buddy considère le renderer déconnecté et le mode audio
`auto` s'arrête.

```json
{
  "type": "avatar.renderer.status",
  "payload": {
    "rendererId": "darkstar-metahuman-lisa",
    "phase": "playing",
    "activeTurnId": "turn-uuid",
    "lastSequence": 42,
    "fps": 60,
    "audioBufferMs": 80,
    "mouthLatencyMs": 35,
    "droppedAudioChunks": 0
  }
}
```

Phases acceptées : `ready`, `buffering`, `playing`, `interrupted`, `unavailable`, `error`. Les valeurs
de statut servent au diagnostic et à la future régulation de latence ; elles ne contiennent ni texte,
ni audio, ni secret.

## Mapping MetaHuman recommandé

| Événement ou cue | Action Unreal |
|:--|:--|
| `turn.started` | Oriente doucement le regard, prépare l'expression sans bouger les lèvres. |
| `affect` + `intensity` | Mélange une pose faciale sobre ; borne l'intensité pour éviter le surjeu. |
| `gesture` | Déclenche au plus un montage court (`small_nod`, `head_tilt`, `open_palm`, etc.). |
| `audio.started…ended` | Reconstruit et valide le WAV du `streamId`. |
| `speech.started` | Joue le WAV et démarre Audio Driven Animation sur la même horloge. |
| `speech.interrupted` | Coupe immédiatement audio, solveur facial et montage ; répond `interrupted`. |
| événement terminal | Libère les buffers du `turnId`, ramène le visage et le regard au repos. |

Le rendu doit rester subtil : les intentions sont des directions de jeu, pas des animations obligées.
Le lipsync doit suivre l'audio réel, tandis que regard et gestes peuvent être légèrement anticipés.

## Référence et validation

`src/avatar/avatar-renderer-simulator.ts` est la spécification exécutable du consommateur. Les tests
`tests/avatar/avatar-renderer-e2e.test.ts` et `tests/server/avatar-renderer-websocket.test.ts`
valident respectivement la reconstruction WAV et l'aller-retour avec un vrai Gateway WebSocket.

Avant le branchement MetaHuman, le client Unreal est accepté quand il peut : se reconnecter sans
parole fantôme, reconstruire un WAV de plusieurs chunks à l'octet près, abandonner un stream troué,
couper sur barge-in et publier un heartbeat stable sans perdre de chunk.
