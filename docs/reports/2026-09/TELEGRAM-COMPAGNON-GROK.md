# TELEGRAM-COMPAGNON-GROK — le compagnon Telegram de Lisa ne répond plus

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-telegram-2026-09-06`
Branche : `fix/telegram-compagnon-2026-09-06`
HEAD au départ : `df3951134` (`Merge branch 'feat/lisa-copine-v1-2026-09-06' into codex/audit-systeme-nerveux-2026-09-01`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code.
HOME temporaire : `_qa/tg/home`. Aucune écriture dans le vrai `~/.codebuddy`.
Ports de test ≥ 3470. Vitest : `HOME=…/_qa/tg/home` et `env -u FORCE_COLOR`.

## Mission

Diagnostic de fond et correctifs (code public), dans cet ordre, chacun avec tests rouge→vert :

1. **Modèle par fournisseur** — un nom de modèle ne doit jamais être appliqué à un fournisseur qui ne le sert pas. `CODEBUDDY_PEER_MODEL` / `CODEBUDDY_MODEL` ignorés (avec avertissement) si `CODEBUDDY_PROVIDER` est explicitement un autre fournisseur, ou validés contre le catalogue (`resolveProviderFromCatalog`). Le canal utilise le `defaultModel` du fournisseur détecté.
2. **Profil « compagnon » léger pour les canaux** — quand le canal sert Lisa (persona compagnon), le prompt système est le `spokenPrompt` de la persona + contexte relationnel + 10 derniers tours, SANS le prompt système d'agent complet ni le catalogue d'outils. Opt-in `CODEBUDDY_CHANNEL_PROFILE=companion`, ou automatique si `CODEBUDDY_COMPANION_PERSONA` est défini et que le message n'est pas une commande. Mesure : tokens du prompt avant/après (attendu < 1 500). Les commandes (`/…`, « lance », « code ») gardent le profil agent.
3. **Délai de tour configurable et adaptatif** — `CODEBUDDY_CHANNEL_TURN_TIMEOUT_MS` (défaut 180 000) + un message d'attente honnête sur Telegram si la génération dépasse 20 s (« je réfléchis, quelques secondes… ») au lieu du silence puis de l'excuse.
4. **Échec fournisseur visible et utile** — à la place de « je n'ai pas réussi à formuler une réponse fiable », Lisa dit la vraie raison en une phrase adaptée à la persona (quota atteint jusqu'à \<heure\>, modèle indisponible, trop lent). Le repli automatique (`feat/provider-fallback-2026-09-06`, lane sœur) n'est pas refait ; un point d'accroche est prévu.
5. **MCP `pdfcommander` / `user-settings.json` vide** — ne pas tenter d'initialiser des serveurs MCP inutiles pour un tour compagnon (couvert par le profil léger). Fichier d'état vide → réparation propre (recréé avec défauts, une seule fois, journalisé).

Faits du jour (service `buddy channels start --type telegram`, journal systemd) : (a) ChatGPT-OAuth `429 usage_limit_reached` (reset lundi) → « Channel provider failure hidden from conversation » + excuse générique ; (b) bascule manuelle Ollama, le canal a demandé `gpt-5.5` via `CODEBUDDY_PEER_MODEL` ; (c) avec le bon modèle local, timeout 180 s sur un prompt ~9 000 tokens ; (d) xAI 403 crédits épuisés ; (e) `user-settings.json` vide ; (f) MCP `pdfcommander` « Connection closed » à chaque tour.

## Invariants

- Code public. Jamais `/home/<user>`, prénom, secret dans les fichiers suivis.
- `git add` nommément fichier par fichier. Commit par correctif.
- Aucun push. ComfyUI 8188/8189 non touché.
- Lane sœur `feat/provider-fallback-2026-09-06` : lire son rapport, ne pas la refaire.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-telegram-2026-09-06/_qa/tg/home` et `env -u FORCE_COLOR`.
- Jamais `~/code-buddy` ni `~/.codebuddy`.

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `df3951134`. Branche déjà extraite (lisa-copine + trajectory). Working tree propre. Réservation `e07bd3f13`.

### Inspection

- Canal : `src/commands/handlers/channel-handlers.ts`. Tour borné à 180 s (`CODEBUDDY_CHANNEL_TURN_TIMEOUT_MS` existait déjà, non documenté). « Channel provider failure hidden from conversation » masquait `Sorry, I encountered an error:`.
- Modèle : `resolveProviderFromEnv` / `createPeerChatClientFromEnv` appliquaient `CODEBUDDY_PEER_MODEL` au fournisseur détecté sans vérifier qu'il le sert. `gpt-5.5` (catalogue ChatGPT) partait vers Ollama → 404.
- Prompt : même un `promptId: auto` restait un agent complet + outils + MCP (`pdfcommander` « Connection closed »). ~9 000 tokens, 150 s de prefills iGPU, timeout 180 s.
- Repli : lane sœur `feat/provider-fallback-2026-09-06` (`docs/reports/2026-09/PROVIDER-FALLBACK-GROK.md`). Non refaite. Couture : `CodeBuddyClient.chat`.
- `user-settings.json` vide : `readJsonAtomicSync` tombait sur le fallback sans réécrire le fichier.

### Correctifs

1. **Modèle par fournisseur** (`74d4510a1`) — `src/fleet/compatible-model.ts` + `pickCompatibleModelForProvider`. `CODEBUDDY_PEER_MODEL` / `CODEBUDDY_MODEL` / `GROK_MODEL` (clé catalogue Ollama) ignorés avec `logger.warn` s'ils appartiennent à un autre fournisseur. Le canal prend alors le `defaultModel` du spec (ex. `qwen2.5-coder:7b`) ou `OLLAMA_MODEL` / un `GROK_MODEL` compatible (`qwen3:4b-instruct`).
2. **Profil compagnon** (`27ba13b69`) — `CODEBUDDY_CHANNEL_PROFILE=companion` ou auto si `CODEBUDDY_COMPANION_PERSONA` est défini. Prompt = `spokenPrompt` + contexte relationnel (si `CODEBUDDY_COMPANION_RELATIONAL`) + 10 derniers tours. Aucun catalogue d'outils, aucun `CodeBuddyAgent` (donc aucun MCP). Commandes `/…`, « lance », « code » restent en profil agent. Mesure : `tokenEstimate < 1500`.
3. **Délai** (même commit canal) — `CODEBUDDY_CHANNEL_TURN_TIMEOUT_MS` (défaut 180000, déjà câblé) documenté. `CODEBUDDY_CHANNEL_WAIT_NOTICE_MS` (défaut 20000) envoie « Je réfléchis, quelques secondes… ».
4. **Parole de panne** (même commit canal) — `src/channels/provider-failure-speech.ts` : quota (+ heure de reset), crédits, modèle absent, trop lent. Plus de « hidden from conversation ». Accroche repli : `COMPANION_CHANNEL_FAILOVER_SEAM = 'CodeBuddyClient.chat'`.
5. **MCP / settings** (`157aa2ec3`) — tour compagnon ne construit pas l'agent ⇒ pas d'init MCP. `user-settings.json` vide réécrit avec les défauts, journalisé une fois.

### Preuves

HOME `_qa/tg/home`, `env -u FORCE_COLOR`.

```text
./node_modules/.bin/vitest run tests/channels tests/fleet tests/companion \
  tests/security/donnees-personnelles.test.ts \
  --exclude tests/channels/telegram-inconnu-journey.test.ts
# 180 passed / 2 skipped files ; 2836 passed / 8 skipped

./node_modules/.bin/vitest run tests/security/donnees-personnelles.test.ts
# 1 file / 40 passed

./node_modules/.bin/tsc --noEmit -p tsconfig.json
# exit 0

./node_modules/.bin/eslint --max-warnings=0 <src touchés>
# exit 0

git diff --check
# exit 0

CODEBUDDY_PROVIDER=ollama OLLAMA_HOST=http://127.0.0.1:11435 GROK_MODEL=qwen3:4b-instruct \
  ./node_modules/.bin/vitest run tests/channels/companion-channel-live.test.ts
# 1 passed, 4942 ms (< 30 s)
```

`tests/channels/telegram-inconnu-journey.test.ts` non rejoué (parcours live ~150 s, flake `/help` déjà noté par la lane repli).

### Bilan

- Cinq correctifs dans le canal Telegram compagnon, opt-in / auto-persona, défaut agent inchangé.
- Preuves : 2836 verts hors GK10 live ; privacy 40/40 ; tsc 0 ; eslint src 0 ; live Ollama 4,9 s.
- Ouvert : activer `CODEBUDDY_CHANNEL_PROFILE=companion` (ou `CODEBUDDY_COMPANION_PERSONA=copine`) sur le service ; fusionner la lane repli pour le 429 ChatGPT ; relancer GK10 si le pilote le demande.
- Aucun push. `~/code-buddy` et `~/.codebuddy` non écrits. ComfyUI 8188/8189 intacts.
