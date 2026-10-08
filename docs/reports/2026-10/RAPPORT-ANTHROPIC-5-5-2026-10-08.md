# Compatibilité Code Buddy / Cowork avec la gamme Claude 5.5 — 08/10/2026

Branche `fix/anthropic-5-5-2026-10-08`, départ `origin/main` `aa328839c`. Aucun push.
Source des défauts : `~/Videos/Partage/20261008-validation-anthropic/essais/RAPPORT.md` (D1, D2, D3, D9, thinking latent).

Rapport de mission en cours ; le détail final (tests rouge→vert, essais réels) est livré dans
`~/Videos/Partage/20261008-correctifs-anthropic-55/code-buddy/RAPPORT.md`.

## Mesures préalables sur l'endpoint réellement utilisé (`POST /v1/chat/completions`)

Code Buddy passe par l'endpoint OpenAI-compatible d'Anthropic, pas par `/v1/messages` (celui du RAPPORT de validation).
Sondes réelles du 08/10/2026, clé masquée, corps de réponse conservés sous `tests/fixtures/anthropic-5-5/` :

| Requête | Résultat |
|---|---|
| Haiku 5.5, `temperature: 0.7` ou `0` | 400 « `temperature` is deprecated for this model. » |
| Sonnet 5.5, `top_p: 0.9` | 400 « `top_p` is deprecated for this model. » |
| Haiku/Sonnet 5.5, `thinking: {type:"adaptive"}` | **400 « Adaptive thinking is not available via the OpenAI compatibility endpoint. »** |
| Haiku/Sonnet 5.5 et Haiku 4.5, `thinking: {type:"enabled", budget_tokens:1024}` | **200** |
| Haiku 5.5 et 4.5, `thinking: {type:"disabled"}`, `max_tokens: 50` | 200, contenu rendu |
| Haiku 5.5, `max_tokens: 50`, sans `thinking` | **200, `content: ""`, `finish_reason: "length"`** (réflexion adaptative active par défaut, non exposée par l'endpoint) |
| Flux, `max_tokens: 300`, question difficile | un delta `role`, puis `finish_reason: "length"` : aucun texte |
| Flux avec outil | `"type":"function"` répété dans **chaque** delta de `tool_calls` |

Conséquence : sur ce chemin, la consigne « `enabled` → `adaptive` » ne s'applique pas ; `enabled` reste la forme acceptée.

Autres sondes réelles du même jour (mêmes conditions) :

| Requête | Résultat |
|---|---|
| `temperature` sur Opus 4.7, Opus 4.8, Opus 5.5 | 400 « deprecated » ; Sonnet 4.5/4.6, Opus 4.6, Haiku 4.5 : 200 |
| Sonnet 5.5, `thinking: {type:"disabled"}` | **400 « send "thinking": {"type": "between_tools"} instead of {"type": "disabled"} »** ; `between_tools` accepté (200) |
| Opus 5.5 / Fable 5.1, `disabled` | 400 « "thinking.type.disabled" is not supported » ; `between_tools` aussi refusé : aucune coupure possible |
| Haiku 5.5, `between_tools` | 400 (refusé) |
| `max_tokens: 128000` Haiku/Sonnet 5.5, 129000 Haiku 5.5 | 200 ; 400 « 129000 > 128000 » |

## Correctifs (branche `fix/anthropic-5-5-2026-10-08`)

| Défaut | Correctif | Fichiers |
|---|---|---|
| D3 type de tool_call concaténé | `type`, `id`, `role` gardent leur première valeur ; un nom d'outil répété à l'identique n'est pas doublé, un nom réellement fragmenté est recollé | `src/agent/streaming/message-reducer.ts` |
| D2 temperature | jamais de défaut 0,7 vers `anthropic.com` ; retirée pour les modèles qui la refusent (5.x, Opus 4.7/4.8) même quand un appelant interne la fixe (`temperature: 0` du juge de buts) ; transmise telle quelle pour les 4.x ; un 400 « deprecated » d'un modèle inconnu est retiré, rejoué une fois et retenu par modèle | `src/providers/anthropic-compat.ts`, `provider-openai-compat.ts` |
| thinking latent | `enabled` conservé (c'est la forme que cet endpoint accepte), budget borné sous `max_tokens` ; appel borné (`maxTokens` ≤ 4096) sans réflexion demandée : réflexion coupée avec la valeur propre au modèle, apprise du corps du 400 (`disabled`, `between_tools`, ou aucune) ; `CODEBUDDY_ANTHROPIC_THINKING=disabled\|default` | idem |
| réponse vide | `content ""` sans appel d'outil, en direct comme en flux, lève une erreur qui nomme `finish_reason` et le `max_tokens` demandé | idem |
| D1 modèle par défaut | `claude-sonnet-5-5` (variables `ANTHROPIC_MODEL` ou `CLAUDE_MODEL`), rôles `CODEBUDDY_ANTHROPIC_LIGHT_MODEL` / `_ARCHITECT_MODEL`, catalogue de repli opus/sonnet/haiku 5.5, entrée `claude-haiku-5*` dans `model-tools.ts` | `src/config/model-defaults.ts` et 25 sites qui l'importent |
| D9 catalogues | Cowork `cowork/src/shared/anthropic-models.ts`, extension VS Code `config-validator.ts` ; un test interdit les nouveaux littéraux Claude dans `src/` | voir commits |

Choix assumés : (1) la consigne « `enabled` → `adaptive` » ne s'applique pas à l'endpoint compat, qui refuse `adaptive` ; Code Buddy ne passe pas par `/v1/messages`. (2) Tarifs 5.5 : non vérifiés, aucune ligne inventée (repli `UNKNOWN_MODEL_PRICE`). (3) Passerelles tierces (OpenCode, OpenRouter, Copilot, Bedrock) : non touchées, autres espaces de noms.
