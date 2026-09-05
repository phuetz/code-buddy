# CodeBuddyAvatar — Split A v6

Plugin Runtime Win64 pour relier `D:\DEV\AvatarStudio` au Gateway Code Buddy sans déplacer le
raisonnement ni la mémoire de Lisa dans Unreal. Cette version est un **fork reproductible** : elle ne
remplace jamais automatiquement un plugin présent et ne modifie pas le projet v4 gelé.

## Ce que le plugin fait réellement

- connexion WebSocket `ws://` ou `wss://`, authentification JWT en mémoire et scopes
  `avatar:read` + `avatar:write` ;
- `avatar.renderer.hello`, synchronisation sans replay audio, heartbeat et reconnexion exponentielle ;
- barrière de séquence, rejet des doublons et resynchronisation en cas de trou ;
- reconstruction stricte de chaque RIFF/WAVE PCM 16 bits : index, offsets, longueur base64,
  plafond 48 Kio par chunk et 16 Mio par WAV ;
- lecture avec `USoundWaveProcedural` seulement après `avatar.speech.started`, coupure immédiate sur
  interruption ;
- événements Blueprint pour affect, intensité, geste, regard, rythme vocal, texte de performance et
  WAV préparé ;
- état réel renvoyé à Code Buddy : phase, FPS, tampon audio, latence bouche/audio et chunks perdus.

Le plugin ne prétend pas créer le visage Lisa ni activer silencieusement MetaHuman Animator. La
capacité `audioDrivenAnimation` reste fausse tant qu'un sujet MetaHuman Audio Live Link sain n'a pas
été relié et que le Blueprint n'a pas appelé `Set Audio Driven Animation Ready(true)`.

## Installation sûre

Depuis le dépôt Code Buddy copié sur GPU node :

```powershell
powershell -ExecutionPolicy Bypass -File scripts\unreal\Invoke-CodeBuddyAvatarV6.ps1 `
  -Mode Stage -ProjectRoot D:\DEV\AvatarStudio
```

Le bundle est copié dans :

```text
D:\DEV\AvatarStudio\.codebuddy\metahuman-splits\split-a.6\CodeBuddyAvatar
```

La promotion vers `Plugins\CodeBuddyAvatar` est une opération distincte. Elle refuse de s'exécuter
si Unreal Editor tourne et conserve l'ancien plugin sous un nom horodaté lorsque `-Force` est
explicitement fourni.

## Branchement Blueprint / MetaHuman

1. Activer **Code Buddy Avatar**, **MetaHuman Animator**, **MetaHuman Live Link** et **WebSockets**.
2. Dans le Blueprint du niveau ou du MetaHuman, récupérer le Game Instance Subsystem
   `CodeBuddyAvatarSubsystem`.
3. Relier `On Performance Cue` à une couche sobre de regard, posture et montages courts. Les chaînes
   attendues sont celles du contrat V1 (`small_nod`, `thinking_glance`, `user`, etc.). Utiliser
   `DeliveryPace`, `PauseStyle`, `ResponseShape`, `TargetWpm` et `SentencePauseMs` pour régler
   l'énergie corporelle et le temps de stabilisation entre phrases. Ces indications ne doivent pas
   étirer l'audio : celui-ci reste la vérité pour les lèvres.
4. Relier `On Speech State(false)` à l'arrêt du solveur, des montages et des lèvres.
5. Créer une **MetaHuman Audio Live Link Source** officielle et affecter son sujet au Blueprint du
   MetaHuman (`Use Live Link`). Le son lu par le plugin doit alimenter la même source audio — sur
   Windows, un périphérique loopback/virtuel dédié évite de résoudre le microphone ambiant.
6. Une fois le sujet vert et la bouche réellement animée, appeler
   `Set Audio Driven Animation Ready(true)`. Avant cette preuve, Code Buddy ne diffuse pas l'audio en
   mode `auto` vers ce renderer.

MetaHuman 5.8 améliore le modèle audio temps réel, mais l'animation audio générée reste à 30 fps.
Cette cadence ne doit pas être confondue avec les 60 fps du rendu de la scène.

## Tunnel et authentification

Le transport recommandé reste un tunnel Tailscale/SSH vers le serveur lié à la boucle locale :

```powershell
ssh -N -L 3055:127.0.0.1:3055 patrice@203.0.113.10
$env:CODEBUDDY_AVATAR_TOKEN = '<jwt-court-avatar-read-write>'
```

Le token n'est ni loggé ni stocké dans `DefaultCodeBuddyAvatar.ini`. Pour une session de développement locale
sans authentification, le Gateway doit lui-même être lié uniquement à `127.0.0.1`.

## Validation Unreal

```powershell
powershell -ExecutionPolicy Bypass -File scripts\unreal\Invoke-CodeBuddyAvatarV6.ps1 `
  -Mode Validate -ProjectRoot D:\DEV\AvatarStudio -EngineRoot D:\Epic\UE_5.8
```

Le script vérifie tous les SHA-256, construit le plugin avec RunUAT, lance les tests
`CodeBuddy.Avatar` via `UnrealEditor-Cmd`, propage les codes d'échec et écrit les preuves hors du
bundle. Il ne tue jamais un Unreal Editor actif.

## Références Epic 5.8

- [MetaHuman 5.8 Release Notes](https://dev.epicgames.com/documentation/metahuman/metahuman-5-8-release-notes-in-unreal-engine)
- [Real-Time Animation](https://dev.epicgames.com/documentation/metahuman/realtime-animation-for-metahumans-in-unreal-engine)
- [Audio Driven Animation](https://dev.epicgames.com/documentation/metahuman/audio-driven-animation)
- [WebSockets Runtime API](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/WebSockets)
- [USoundWaveProcedural](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/USoundWaveProcedural)
