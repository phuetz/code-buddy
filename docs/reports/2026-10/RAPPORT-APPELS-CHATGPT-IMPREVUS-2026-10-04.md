# Rapport — appels ChatGPT non demandés (2026-10-04)

Branche `fix/appels-chatgpt-imprevus-2026-10-04`, worktree `cb-appels-chatgpt-2026-10-04`.
Base `70bcab004f822bccadb73f931e9de1d932b900a5`. Correctif `064ff3a9ccc16bffb1a8164600de8213cb48e558`.
Aucun push. Rapport de livraison : `/home/patrice/Videos/Partage/20261004-grok-appels-chatgpt/auteur/RAPPORT.md`.

## Cause

Deux défauts empilés.

1. Les rôles auxiliaires (leçons, mémoire, et les autres listés ci-dessous) construisaient leur propre client. Sans réglage de rôle, la détection ambiante prenait le login ChatGPT OAuth (`gpt-6-sol`), même quand la session parlait à un autre fournisseur.
2. `buddy -p -m <modèle>` : Commander 12 donnait la valeur de `-p, --prompt` au jeton `-m`. `options.model` restait vide, le fournisseur explicite n'était pas posé, et `loadApiKey` / `loadBaseURL` préféraient le fournisseur détecté (ChatGPT) à `GROK_BASE_URL`. Le nom du modèle restait lu dans `argv`, d'où l'avertissement qui remplaçait `deepseek/deepseek-v4.1-flash` par `gpt-6-sol`.

La ligne de journal `Auto-detected provider: chatgpt` reste volontairement : ce n'est pas le critère. Le critère est l'hôte réellement appelé.

## Correctif

- `src/providers/session-llm-route.ts` publie le client de la session.
- `src/providers/auxiliary-llm.ts` choisit : rôle explicite `CODEBUDDY_AUXILIARY_<ROLE>_*`, sinon la session, sinon l'ambiant seulement s'il n'y a ni rôle ni session. `CODEBUDDY_LOCAL_ONLY` refuse une cible non locale.
- `src/cli/headless-argv.ts` : `-p` / `--prompt` / `--print` suivi d'une option devient le commutateur caché `--headless`. `buddy -p "prompt"` est inchangé.
- Réglage : `docs/fournisseur-auxiliaire.md`.

## Preuves

- Test qui partait vers `https://chatgpt.com/backend-api/codex` avant le correctif : `tests/providers/auxiliary-session-provider.test.ts`. Régression d'argv : `tests/cli/headless-argv.test.ts`.
- Barrière : 297 fichiers, 3371 tests verts, 5 ignorés (`tests` touchés + `tests/memory` + `tests/agent`). `npm run typecheck` sortie 0. `npm run lint` sortie 0 (0 erreur, 2601 avertissements déjà présents).
- Rejeu du 2026-10-04 11:56:40Z avec `/home/patrice/.local/share/flotte-pilote-opus/buddy-openrouter.sh`, `CODEBUDDY_ROOT` = ce worktree, HOME `_qa/appels-chatgpt/home` : 4 POST `openrouter.ai/api/v1/chat/completions`, modèle `deepseek/deepseek-v4.1-flash`, 0 hôte `chatgpt.com`. Marqueurs : leçons (1 373 caractères utilisateur) puis mémoire (1 517). Journal : `2 lesson candidate(s), 1 memory candidate(s)`.

## Hors périmètre

Ultraplan Gemini figé, commandes qui sont elles-mêmes la session (`buddy research`, `buddy flow`, le serveur), étiquette `provider` du JSON de session (peut encore dire `ollama` sans appel réseau). `CODEBUDDY_PROVIDER=openrouter` n'est pas le correctif.
