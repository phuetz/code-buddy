# cli-companion — recette du 2 octobre 2026

État : **Prérequis vérifiés**. Décision : **b+c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

La configuration ne fournit ni authentification ni équipements audio.

Setup/status fonctionnent. espeak est disponible ici, sox et OAuth manquent ; aucun échange vocal ni capture matérielle revendiqué.

[Protocole, validation et limites](README.md).

## Avant

### cli-companion-setup

```text
$ buddy companion setup --no-set-model --tts-provider espeak
Buddy companion setup complete.
Installed .codebuddy/SOUL.md
Installed .codebuddy/BOOT.md
Voice input and TTS defaults configured.
Project model not changed; run `buddy login` to connect ChatGPT OAuth first.

Buddy Companion Status
==================================================

Workspace: <WORKSPACE>
Brain: [todo] ChatGPT OAuth credentials missing
Auth file: <HOME>/.codebuddy/codex-auth.json
Model: grok-code-fast-1

Identity: [ok] SOUL.md loaded from project
Boot: [ok] BOOT.md loaded from project

Voice input: [todo] enabled / whisper-local / fr / auto-send on
Wake word: [ok] text-match / hey buddy, ok code
TTS: [ok] enabled / espeak / fr-FR-HenriNeural / auto-speak on
Camera: [ok] ffmpeg available / linux
Percepts: [todo] 0 recorded / <WORKSPACE>/.codebuddy/companion/percepts.jsonl

Next steps:
- Run `buddy login` to connect the ChatGPT subscription brain.
- Voice input setup: Missing required tools: sox. Install with: brew install sox (macOS) or apt-get install sox (Linux)

EXIT=0
```

### cli-companion-status

```text
$ buddy companion status
Buddy Companion Status
==================================================

Workspace: <WORKSPACE>
Brain: [todo] ChatGPT OAuth credentials missing
Auth file: <HOME>/.codebuddy/codex-auth.json
Model: grok-code-fast-1

Identity: [ok] SOUL.md loaded from project
Boot: [ok] BOOT.md loaded from project

Voice input: [todo] enabled / whisper-local / fr / auto-send on
Wake word: [ok] text-match / hey buddy, ok code
TTS: [ok] enabled / espeak / fr-FR-HenriNeural / auto-speak on
Camera: [ok] ffmpeg available / linux
Percepts: [todo] 0 recorded / <WORKSPACE>/.codebuddy/companion/percepts.jsonl

Next steps:
- Run `buddy login` to connect the ChatGPT subscription brain.
- Voice input setup: Missing required tools: sox. Install with: brew install sox (macOS) or apt-get install sox (Linux)

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### cli-companion-setup

```text
$ buddy companion setup --no-set-model --tts-provider espeak
Buddy companion setup complete.
Installed .codebuddy/SOUL.md
Installed .codebuddy/BOOT.md
Voice input and TTS defaults configured.
Project model not changed; run `buddy login` to connect ChatGPT OAuth first.

Buddy Companion Status
==================================================

Workspace: <WORKSPACE>
Brain: [todo] ChatGPT OAuth credentials missing
Auth file: <HOME>/.codebuddy/codex-auth.json
Model: grok-code-fast-1

Identity: [ok] SOUL.md loaded from project
Boot: [ok] BOOT.md loaded from project

Voice input: [todo] enabled / whisper-local / fr / auto-send on
Wake word: [ok] text-match / hey buddy, ok code
TTS: [todo] enabled / espeak / fr-FR-HenriNeural / auto-speak on
Camera: [ok] ffmpeg available / linux
Percepts: [todo] 0 recorded / <WORKSPACE>/.codebuddy/companion/percepts.jsonl

Next steps:
- Run `buddy login` to connect the ChatGPT subscription brain.
- Voice input setup: Missing required tools: sox. Install with: brew install sox (macOS) or apt-get install sox (Linux)
- TTS setup: espeak not found. Install with: pip3 install espeak

EXIT=0
```

### cli-companion-status

```text
$ buddy companion status
Buddy Companion Status
==================================================

Workspace: <WORKSPACE>
Brain: [todo] ChatGPT OAuth credentials missing
Auth file: <HOME>/.codebuddy/codex-auth.json
Model: grok-code-fast-1

Identity: [ok] SOUL.md loaded from project
Boot: [ok] BOOT.md loaded from project

Voice input: [todo] enabled / whisper-local / fr / auto-send on
Wake word: [ok] text-match / hey buddy, ok code
TTS: [todo] enabled / espeak / fr-FR-HenriNeural / auto-speak on
Camera: [ok] ffmpeg available / linux
Percepts: [todo] 0 recorded / <WORKSPACE>/.codebuddy/companion/percepts.jsonl

Next steps:
- Run `buddy login` to connect the ChatGPT subscription brain.
- Voice input setup: Missing required tools: sox. Install with: brew install sox (macOS) or apt-get install sox (Linux)
- TTS setup: espeak not found. Install with: pip3 install espeak

EXIT=0
```
