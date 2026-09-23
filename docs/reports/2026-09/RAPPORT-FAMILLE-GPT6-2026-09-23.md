# Famille GPT-6 dans Code Buddy — 23/09/2026

Agent : Opus 5.5 (Claude Code), à la demande de Patrice.

## Constat de départ (mesuré sur `main` = `f48f5c1e`)

- `isChatGptSubscriptionModel('gpt-6-astra')` → `false` : sans `--model` explicite, Code Buddy
  remplace GPT-6 Astra par `gpt-5.6-sol`.
- `getModelToolConfig('gpt-6-astra')` → fenêtre 32 768, sortie 4 096 (valeurs de repli).
- Catalogue du backend Codex (`~/.codex/models_cache.json`, rafraîchi le 23/09 à 21 h 08) :
  `gpt-6-astra` (priorité 1), `gpt-6-sol` (2), `gpt-6-luna` (3), fenêtre servie 272 000,
  `max_context_window` 872 000, entrée texte + image.
- `gpt-5.6-sol` est déclaré à 1 050 000 dans `model-tools.ts`, alors que le backend ChatGPT
  le sert à 272 000.

## Cause principale (mesurée)

Le backend filtre `/codex/models` selon le `client_version` annoncé. Même compte, même
minute :

| `client_version` | Modèles proposés |
|---|---|
| `0.144.1` (valeur figée de Code Buddy depuis juillet) | gpt-5.6-sol, -terra, -luna, gpt-5.5 |
| `0.155.1` (Codex CLI du jour) | **gpt-6-astra, gpt-6-sol, gpt-6-luna**, puis les mêmes |

Code Buddy ne pouvait donc pas voir GPT-6, quelle que soit sa table de modèles.

## Correctif

- `CHATGPT_CODEX_CLIENT_VERSION` : `0.144.1` → `0.155.1` (surchargeable par
  `CODEBUDDY_CODEX_CLIENT_VERSION`, inchangé).
- `isChatGptSubscriptionModel` accepte `gpt-6-*` (utile quand le catalogue est indisponible).
- `model-tools.ts` : entrée `gpt-6-*`, fenêtre 272 000 et entrée image lues dans le catalogue ;
  niveaux d'effort communs aux trois (`low` → `max`) ; sortie 128 000 **supposée** (le
  catalogue ne la publie pas), alignée sur GPT-5.6.

## Vérifications

- Nouveaux tests : 12/12 avec le correctif ; rejoués contre `main`, 5 tombent (les trois
  fenêtres, la reconnaissance hors catalogue, la version de client), le test qui garde Sol
  inchangé passe des deux côtés.
- Voisinage : `tests/config/`, `tests/providers/`, fournisseur `chatgpt-responses`,
  gestionnaires d'authentification : 47 fichiers, 655 tests verts ; `tsc --noEmit` 0.
- **Bout en bout**, un seul appel réel chacun (`-m gpt-6-astra --output-format json`,
  effort low, réponse « OK ») :
  - `main` : `"model":"gpt-5.6-sol","requestedModel":"gpt-6-astra"`, avertissement
    « not served by the Codex backend… Set --model to override » — alors que `--model`
    était passé ;
  - correctif : `"model":"gpt-6-astra"`, aucun avertissement de repli.

## Non traité, signalé

- La fenêtre publiée par le catalogue (`context_window`) est lue mais jamais utilisée pour
  le budget de contexte. Conséquence : `gpt-5.6-sol`, déclaré à 1 050 000 (valeur juste pour
  l'API publique), peut dépasser les 272 000 que le backend ChatGPT sert réellement en
  session longue. Correctif propre : plafonner par la fenêtre du catalogue sur le chemin
  ChatGPT. Hors de cette PR.
- La version de client figée vieillira de nouveau. La lire depuis le Codex CLI installé
  éviterait de la remettre à jour à la main.
- Le message « Set --model to override » s'affiche même quand `--model` est passé.
