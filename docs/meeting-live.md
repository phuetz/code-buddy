# Meeting Live (Cowork)

Meeting Live complète le pipeline [Meeting Notes](./meeting-notes.md) avec une capture audio locale,
visible dans l’espace **Réunion** de Cowork. Le micro reste obligatoire. L’audio système n’est proposé
que lorsque le runtime peut réellement fournir une piste loopback Electron ou une source PipeWire.

## Parcours

1. L’utilisateur choisit explicitement **microphone** ou **microphone + audio système**, puis active ou
   non la diarisation Sherpa-ONNX.
2. Cowork vérifie les capacités. Une capacité `runtime-probe` n’est considérée active qu’après avoir
   obtenu une vraie piste audio. Sur une plateforme refusée, l’interface affiche `unavailable`.
3. L’utilisateur confirme qu’il a informé les participants et obtenu leur accord. Cowork demande les
   autorisations du système puis conserve cette validation horodatée.
4. Si l’audio système est demandé, le main process arme un accès à usage unique pour la seule fenêtre
   principale. Sous Windows, `getDisplayMedia` reçoit le loopback Electron et le renderer arrête
   immédiatement sa piste vidéo de transport. Sous Linux, `pw-loopback` publie temporairement la
   sortie PipeWire par défaut comme entrée audio au nom unique ; Cowork attend sa présence dans
   `enumerateDevices()`, puis la sélectionne par `deviceId` exact. Les deux pistes sont mélangées avec
   `AudioContext`. En cas de refus ou d’échec de sonde, le repli micro seul n’est appliqué que si la
   case correspondante a été explicitement laissée active ; la raison reste affichée.
5. Le renderer transmet un bloc audio au main process toutes les 10 secondes. Chaque bloc devient un
   checkpoint atomique privé.
6. Une pause ou un changement d’écran ferme proprement le flux. Une fermeture brutale peut perdre le
   bloc en cours, mais jamais les checkpoints déjà publiés.
7. Au prochain démarrage, une capture qui était `recording` ou `finalizing` apparaît comme
   `interrupted`. Sa liste de checkpoints est reconstruite depuis les enveloppes audio et vérifiée par
   SHA-256. Une nouvelle validation de consentement est exigée avant la reprise.
8. **Arrêter et créer les notes** regroupe les blocs appartenant à chaque flux MediaRecorder. Les
   groupes sont traités séquentiellement pour borner RAM/CPU. Whisper local fournit texte + timestamps.
   Si elle a été demandée et est disponible, Sherpa-ONNX calcule les tours de parole et ceux-ci sont
   alignés sur les segments Whisper avant l’appel Meeting Notes déterministe (`useAI: false`).

Les rapports Markdown et JSON restent dans le dossier privé de la capture. L’écran permet de les
révéler dans le gestionnaire de fichiers ou de supprimer définitivement la capture et ses rapports.

## Stockage et confidentialité

- Racine : `<Electron userData>/meeting-live/<session UUID>/`.
- Dossiers en mode `0700`, manifestes, checkpoints et rapports en mode `0600`.
- Un checkpoint est une enveloppe JSON autoportante contenant les métadonnées et l’audio en base64.
  Le fichier est écrit et `fsync`, puis publié par renommage atomique.
- Le manifeste n’est qu’un index récupérable ; une publication audio réussie ne dépend donc pas d’une
  seconde écriture atomique coordonnée.
- Les octets sont limités à 32 Mio par checkpoint et 4 Gio par réunion.
- Le renderer ne choisit aucun chemin de stockage et l’IPC n’expose aucun canal d’upload ou d’export
  réseau.
- Le transcript et les notes ne sont jamais envoyés à un LLM par ce parcours.
- Les permissions `media` de `defaultSession` sont limitées au `webContents` de la fenêtre principale.
  Les previews/webviews ne peuvent pas hériter du micro. Sous Windows, le partage d’écran/audio exige
  en plus une autorisation éphémère de 15 secondes, consommée au premier appel avec geste utilisateur.
- Sous Linux, la source PipeWire porte un bail opaque. Elle est détruite à la pause, en cas d’échec,
  au changement d’écran, à la fermeture de la fenêtre et à l’arrêt de l’application. Aucun shell ni
  nom de périphérique fourni par le renderer n’est exécuté par le main process.

## Diarisation locale

Le provider concret est `sherpa_onnx.OfflineSpeakerDiarization`. Aucun jeton Hugging Face et aucun
téléchargement implicite ne sont utilisés. La sonde exige `python3`, `numpy`, `sherpa_onnx`, `ffmpeg`
et deux modèles locaux :

- segmentation : `~/.codebuddy/diarization/sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx` ;
- embedding : `~/.codebuddy/diarization/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`.

Les chemins peuvent être remplacés avec `CODEBUDDY_DIARIZATION_SEGMENTATION_MODEL`,
`CODEBUDDY_DIARIZATION_EMBEDDING_MODEL` et `CODEBUDDY_DIARIZATION_PYTHON`. Les modèles proviennent
des publications officielles Sherpa-ONNX :
[segmentation](https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-segmentation-models) et
[speaker embedding](https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models).

Les libellés sont volontairement anonymes (`Locuteur 1`, `Locuteur 2`). Après une pause/reprise, ils
sont préfixés par `Prise N` : le système ne prétend pas qu’un cluster de deux prises correspond à la
même personne. Le compteur du rapport désigne donc des **clusters locaux par prise**, pas un nombre de
personnes uniques.

## Limites honnêtes

- [Electron 35 documente](https://www.electronjs.org/docs/latest/api/structures/streams) `audio: 'loopback'`
  comme **Windows-only**. Meeting Live utilise ce chemin natif sous Windows. Sous Linux, il exige
  `wpctl` et `pw-loopback`, puis vérifie qu’une vraie entrée audio PipeWire apparaît dans Chromium ;
  sinon l’interface indique l’indisponibilité ou le repli micro. Les chemins peuvent être remplacés
  avec `CODEBUDDY_WPCTL_BIN` et `CODEBUDDY_PW_LOOPBACK_BIN`. macOS reste micro uniquement.
- Code Buddy ne rejoint pas Zoom, Google Meet ou Teams et ne contourne pas leurs indicateurs
  d’enregistrement.
- Un arrêt brutal peut perdre jusqu’à dix secondes, soit le checkpoint pas encore émis par
  MediaRecorder.
- Si Sherpa-ONNX ou un modèle manque/échoue, la finalisation continue avec un transcript explicitement
  marqué non diarizé. Aucun locuteur n’est inventé.
- Whisper local doit être installé. En cas d’échec, la capture passe à `failed`, les checkpoints sont
  conservés et la finalisation peut être relancée.

## Fichiers principaux

- Contrat : `cowork/src/shared/meeting-live.ts`
- Persistance et reprise : `cowork/src/main/meeting/meeting-live-service.ts`
- Broker audio système : `cowork/src/main/meeting/meeting-display-audio.ts`
- IPC : `cowork/src/main/ipc/meeting-live-ipc.ts`
- Interface : `cowork/src/renderer/components/MeetingLiveView.tsx`
