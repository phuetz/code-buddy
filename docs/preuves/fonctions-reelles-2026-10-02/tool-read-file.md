# tool-read-file — recette du 2 octobre 2026

État : **Partiellement vérifiée**. Décision : **b+c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

L’outil direct lit le fichier ; le parcours agent exige un fournisseur.

Distinguer la lecture locale directe et l’orchestration par modèle. Harnais -p laissé intact conformément à la réserve.

[Protocole, validation et limites](README.md).

## Avant

### tool-read-file

```text
$ buddy --enabled-tools read_file -p Read README and quote its contents
[2026-10-02T14:04:44.090Z]  ERROR ❌ No AI provider configured.
   1. Recommended — ChatGPT OAuth (no API key, $0 marginal cost with your plan):
      buddy login
   2. Local & free — start Ollama and pull a model that can call tools:
      ollama pull qwen3:8b
      export OLLAMA_HOST=http://127.0.0.1:11434
      export CODEBUDDY_PROVIDER=ollama
      (qwen2.5 under 14B, including qwen2.5-coder:7b, is chat-only: it cannot edit files.)
   3. More providers — run the full wizard or configure an API key:
      buddy onboard
      GROK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY
   After option 1 or 2, run  buddy try  for the one-minute coding demo.
   Check anytime:  buddy doctor   (add --fix to select a model already installed in a running Ollama).

EXIT=1
```

### tools-read

```text
{"success":true,"output":"Contents of <WORKSPACE>/README:\n1: Hello World!\n2: "}

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### tool-read-file

```text
$ buddy --enabled-tools read_file -p Read README and quote its contents
[2026-10-02T14:35:07.926Z]  ERROR ❌ No AI provider configured.
   1. Recommended — ChatGPT OAuth (no API key, $0 marginal cost with your plan):
      buddy login
   2. Local & free — start Ollama and pull a model that can call tools:
      ollama pull qwen3:8b
      export OLLAMA_HOST=http://127.0.0.1:11434
      export CODEBUDDY_PROVIDER=ollama
      (qwen2.5 under 14B, including qwen2.5-coder:7b, is chat-only: it cannot edit files.)
   3. More providers — run the full wizard or configure an API key:
      buddy onboard
      GROK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY
   After option 1 or 2, run  buddy try  for the one-minute coding demo.
   Check anytime:  buddy doctor   (add --fix to select a model already installed in a running Ollama).

EXIT=1
```

### tools-read

```text
$ node tools.mjs read
{"success":true,"output":"Contents of <WORKSPACE>/README:\n1: Hello World!\n2: "}

EXIT=0
```
