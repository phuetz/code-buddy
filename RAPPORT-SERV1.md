# RAPPORT SERV1 — le serveur de Code Buddy branché par un inconnu

Date : 2026-09-03
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-serv1-2026-09-03`
Branche : `fix/serv1-serveur-reel-2026-09-03`
HEAD au démarrage : `6c6e43b58` (`docs(coordination): reprise du quart de pilotage, FLOTTE1/GK34/GK35/GK36 intégrés, quatre lanes en vol`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** de `src/server/`, des routes, de l'auth JWT, du gateway WS, d'A2A et de `heartbeat-monitor.ts`.

## Mission

Éprouver en vrai `buddy server` comme un inconnu qui lit la doc, lance le serveur et branche le SDK OpenAI officiel :

- `/api/chat/completions` compatible OpenAI (non-streaming, streaming SSE, tools, erreurs)
- JWT de production (`NODE_ENV=production` sans secret / avec secret / sans jeton / avec jeton)
- Origines / CORS (GHSA-5wcw-8jjv-m286) HTTP + WS
- A2A (`/api/a2a/*`) AgentCard + cycle de tâche
- Limite de débit 100 req/min → 429
- `/api/health` et battement d'API : valeurs réelles ou codées en dur

Loi : « se servir de ses applis EN VRAI ». Ports libres (ex. 3610 HTTP / 3611 WS), HOME temporaire dans le clone, Ollama `qwen3:4b-instruct` uniquement.

## Garde-fous tenus

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Ollama local `qwen3:4b-instruct`. `ollama ps` avant tout gros modèle.
- Aucun service systemd. ComfyUI 8188/8189 non touché. Ports robot non touchés.
- HOME temporaire `_qa/serv1/home` dans le clone seulement. Jamais le vrai `~/.codebuddy`.
- Un commit conventionnel par lot, fichiers nommés un par un.
- Zones gelées respectées : `src/server/mcp/` (MCPFIX1), `src/index.ts` (HEADLESS1), `src/observability/` (TTFT1), `src/security/native-sandbox.ts` (SANDBOX1).

## Journal

| Heure (Europe/Paris) | Action |
|---|---|
| 18:12 | Rapport créé **avant inspection**. Coordination réservée. |

## Promesses de la doc (à coller ligne par ligne après lecture)

*(vide — inspection pas encore commencée)*

## Fichiers lus

*(vide — inspection pas encore commencée)*

## Preuves live

*(vide)*

## Écarts

*(vide)*

## Vérifications

*(vide)*

## Bilan (≤ 10 lignes)

Mission ouverte. Rien n'a encore été inspecté ni lancé.
