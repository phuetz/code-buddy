# Rapport — préfixe de prompt stable pour le cache (2026-10-04)

Agent : Grok 4.7. Worktree `/data/patrice/DEV/cb-cache-prefixe-2026-10-04`, branche `perf/cache-prefixe-2026-10-04`.

Départ `c111cb72bb76fa1995438a041d9db493b76829d7`. Correctif `b544dc05eeca3025da9cc8fa6ac60b3e8eee0107` (`fix(cache): sortir la date et le dossier du préfixe de prompt`). Aucun push. Le rapport détaillé, avec la tête finale et la mesure des outils, est sous `/home/patrice/Videos/Partage/20261004-grok-cache-prefixe/auteur/RAPPORT.md`.

## Correctif

La date, le dossier de travail, le bloc `<context>` qui les porte, et la première ligne non indentée `Project:` sont retirés du premier message system et renvoyés dans un message system de fin. Le modèle les reçoit toujours. Le reste du texte du prompt n'est pas réécrit.

Le repère Anthropic `cache_control` est posé sur le dernier message system de tête, avant le premier message non system. `prompt_cache_key` ChatGPT est `cb-project-` suivi de 16 caractères hexadécimaux du sha256 du dossier, à la place de `Math.random()`. `OPENROUTER_PROVIDER_ORDER` reste vide par défaut ; la doc dit qu'épingler le sous-fournisseur évite le changement qui casse le cache.

## Preuve

Tests rouges avant le correctif (13 tests, 4 échecs) : le préfixe commun s'arrêtait avant `<confirmation_system>`, le mode yolo et le prompt sans outils avaient encore le bloc variable dans la tête, et le repère Anthropic tombait sur la queue. Après : 128/128 sur les fichiers touchés, 118/118 sur `tests/prompts` et `tests/services`.

Rejeu réel, même sonde, `deepseek/deepseek-v4.1-flash`, `OPENROUTER_PROVIDER_ORDER=Together`, deux dossiers jetables. Première requête du second dossier : `cached` 0 avant (binaire installé), 8320/8478 après (ce worktree). Empreintes système différentes avant, identiques après (`698d9bbc7721`).

## Limite

Ollama, LM Studio et vLLM recollent les messages system en un seul message de tête. Le bloc variable se retrouve alors en fin de ce message, donc encore avant les outils. OpenRouter ne fait pas cette fusion : c'est le chemin mesuré. Non remesuré sur un runtime local.
