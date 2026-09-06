# PROVIDER-FALLBACK-GROK — basculement automatique de fournisseur LLM

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-fallback-2026-09-06`
Branche : `feat/provider-fallback-2026-09-06`
HEAD au départ : `aef1bdfbd` (`test(tools): justifications d'émission pour les 5 outils reclassés (C5 vert)`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection**.
HOME temporaire : `_qa/fb/home`. Aucune écriture dans le vrai `~/.codebuddy`.

Incident du jour (06/09) : le compagnon Telegram (`buddy channels start --type telegram`, `CODEBUDDY_PROVIDER=chatgpt-oauth`) est resté muet toute la matinée. Le backend ChatGPT Responses répond `429 {"type":"usage_limit_reached","resets_in_seconds":…}` jusqu'au reset hebdomadaire ; le canal a journalisé « Channel provider failure hidden from conversation » et n'a rien tenté d'autre alors qu'un Ollama local (`qwen3.8-ctx32k`) et d'autres fournisseurs (xAI OAuth, Gemini) étaient disponibles. Le pilote a basculé à la main.

Inspiration : OmniRoute — idées seulement, pas de copie.

## Mission

1. Cartographier les appels LLM (dispatcher `client.ts`, providers, `ModelRoutingFacade`, `resolveCommandProvider`, registre multi-LLM, `model-selector`, catalogue OmniRoute s'il existe) ; comment une 429/5xx remonte (canaux, sensory, headless `-p`) ; ce qui existe déjà en repli.
2. Concevoir un repli opt-in `CODEBUDDY_PROVIDER_FALLBACK=true` (défaut OFF = byte-identique) : classification des échecs, chaîne de secours, mémoire de panne persistée, transfert de contexte, visibilité, retour au fournisseur d'origine.
3. Câbler au seul point de couture `client.ts` (`chat` / `chatStream`) pour que canaux et companion en bénéficient sans changement.
4. Tests rouge→vert (providers factices) + preuves + docs.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-fallback-2026-09-06/_qa/fb/home` et `env -u FORCE_COLOR`.
- Jamais `/home/<user>` ni prénom dans les fichiers suivis (écrire `~`).
- ComfyUI 8188/8189 non touché.
- Pas de verdict dans ce rapport (le pilote le fera).

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `aef1bdfbd`. Branche déjà extraite. Inspection et conception à suivre.

## Cartographie

(à remplir après inspection)

## Conception

(à remplir)

## Implémentation

(à remplir)

## Preuves

(à remplir)

## Bilan

(à remplir — 10 lignes, pas de verdict)
