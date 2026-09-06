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

HEAD `df3951134`. Branche déjà extraite (lisa-copine + trajectory). Working tree propre. Réservation du chantier dans `docs/FABLE5-CODEX-COORDINATION.md`.
