# RAPPORT GK30 — Widgets génératifs et widget boursier en vrai

Date : 2026-09-03
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-repar-widgets-2026-09-02`
Branche : `fix/gk30-widgets-reel-2026-09-03`
HEAD au démarrage : `a41944cc2` (`Merge GK21 (outils navigateur en vrai : app_server, web_test, computer_control) into codex/audit-systeme-nerveux-2026-09-01`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code widgets, `stock_quote`, canvas serveur, tests et documentation associée.

## Mission

Éprouver en vrai le parcours widgets génératifs + widget boursier :

- `buddy server` de test → agent headless Ollama « cours de AAPL » → `stock_quote` → payload `data:{type:'stock'}` → widget rendu sur le canvas (HTML récupéré via `/__codebuddy__/canvas/:id`, capture headless)
- source primaire coupée (faux serveur en erreur) → repli sur la suivante annoncé honnêtement, jamais un cours inventé
- widget génératif auto-proposé (`CODEBUDDY_WIDGETS…=true`) sur une réponse tabulaire → widget serveur, réutilisation d'un widget déjà autorisé
- sans les variables : byte-identique (test)

Loi : « se servir de ses applis EN VRAI ». Chaque défaut (widget « rendu » sans HTML, cours périmé sans date, repli silencieux, doc fausse) : test rouge → correctif → vert, un commit.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Ollama local uniquement. `stock_quote` : Yahoo → Nasdaq → Stooq sans clé, ou faux serveur HTTP local via `CODEBUDDY_YAHOO_FINANCE_BASE` / `_NASDAQ_BASE` / `_STOOQ_BASE`.
- Aucun service systemd. ComfyUI 8188/8189 non touché. Ports 3000/3001 déjà occupés → ports libres pour le serveur de test.
- HOME temporaire dans le clone (`_qa/gk30/home`). Jamais le vrai `~/.codebuddy`.
- Un commit conventionnel par lot, fichiers nommés un par un.

## Journal

| Heure (Europe/Paris) | Action |
|---|---|
| 13:08 | Rapport créé **avant inspection**. Coordination réservée. |

## Fichiers lus

_(aucun encore — inspection après réservation)_

## Écarts

_(à remplir)_

## Tableau final « scénario → attendu → obtenu → correctif → commit »

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| _(à remplir)_ | | | | |
