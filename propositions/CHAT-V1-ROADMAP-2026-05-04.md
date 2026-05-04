# gitnexus-chat — Roadmap après V1.1

> Backlog priorisé issu de l'audit en mode plan nuit 03→04 mai 2026.
> Repo : `D:\CascadeProjects\gitnexus-chat` (commit `f2c0578` à ce jour).

## TL;DR

Ce qui a été fait ce soir :
- **V1** (commit `39c6e99`) — chat branché sur `gitnexus serve` réel via SSE
- **V1.1** (commits `b3c960c` + `f2c0578`) — parser SSE conforme RFC + auto-resize textarea + suggestions cliquables empty state + lint propre

Ce qui reste, classé par priorité d'impact (P1 d'abord) :

---

## 🟠 P1 — Quick wins UX (~1-2h chaque)

### Coloration syntaxique des blocs de code
`react-syntax-highlighter` (preset `vscDarkPlus`) injecté via `components.code` de `react-markdown` dans `src/components/ui/Markdown.tsx`. ~3KB gzip. Plus léger que Shiki entier (200KB+ pour 40 langues).

### Bouton Copy sur les messages assistant
Petite icône `<Copy>` dans le coin de la bulle. `navigator.clipboard.writeText(message.content)` + feedback "Copié !" 1.5s.

### Bouton Régénérer
Sur le dernier message assistant : retire le message + retrigger `sendMessage(lastUserMessage.content)`.

### Erreurs SSE visibles distinctement
Aujourd'hui le `ChatStreamError` est affiché en blockquote markdown. Ajouter un flag `isError: true` sur le Message + style cadré rouge dans `ChatMessage.tsx` au lieu de compter sur le markdown.

### Indicateur "tools en cours"
Si `serve.rs` envoyait des `event: tool_call` (cf. backend-coupled ci-dessous), afficher "🔍 search_code: validateUser…" sous le streaming spinner. Pour l'instant, juste "GitNexus réfléchit…".

---

## 🟡 P2 — Features V1.5 (½ à 2 jours chacune)

| # | Feature | Effort | Valeur commerciale agile-up |
|---|---|---|---|
| 1 | **Mermaid rendering** des blocs ```` ```mermaid ```` | 0.5j | Diagrammes auto-générés = killer feature démo |
| 2 | **Slash commands** (`/expliquer`, `/impact`, `/diagramme`, `/architecture`) | 0.5j | Productivité, low-friction prompts |
| 3 | **Cmd+K palette de prompts** | 0.5j | Power-user UX |
| 4 | **File viewer modal** (clic sur path → MCP `read_file`) | 1j | Citations cliquables = pro UX |
| 5 | **Settings panel** (provider switch, temperature) | 0.5j | Config sans toucher chat-config.json |
| 6 | **Export conversation `.md`** | 0.25j | Onboarding clients agile-up |
| 7 | **Modes** (qa/deep_research/architecture) en boutons header | 0.5j | Réplique le multi-mode du desktop |

---

## 🟢 P3 — Nice-to-have (plus tard)

- Theme toggle light/dark (dark hardcodé pour l'instant)
- Mobile responsive (sidebar collapsible)
- Tests Vitest sur `mcp-client.ts` SSE parser (au moins) + store actions
- Error boundary React
- Search full-text dans l'historique des conversations
- i18n (français hardcodé pour l'instant)

---

## 🔵 Backend-coupled — modifs côté `gitnexus-rs`

Ces items ne sont **pas implémentables côté chat** sans toucher d'abord au serveur Rust :

### Tool calls visibles dans le stream
Aujourd'hui `serve.rs:153-155` envoie `Event::default().data(delta)` — texte brut uniquement. Pour qu'on puisse afficher "search_code: validateUser…" inline, le serveur doit émettre des events typés :
```
event: tool_call
data: {"name": "search_code", "args": {"q": "validateUser"}, "status": "running"}
```
→ Modif `ask_question` (callback prend un enum `StreamEvent` au lieu de `&str`) + `serve.rs` mappe vers SSE typé.

### Sources/citations structurées
Le LLM mentionne des fichiers en texte. Pour les rendre cliquables vers le viewer, le serveur devrait émettre :
```
event: source
data: {"path": "src/auth.ts", "line": 42, "snippet": "..."}
```

### Repo strict 404
`serve.rs:110-119` fallback silencieusement au premier repo si le nom demandé n'existe pas. Devrait retourner `404 Not Found`. Une ligne de fix.

### Token usage
`event: usage` avec `{prompt_tokens, completion_tokens, model}` à la fin du stream — utile pour budget tracking + facturation client agile-up.

### Endpoint `cancel`
Aujourd'hui le client AbortController coupe la connexion HTTP, mais le job côté serveur (`spawn_blocking` + `ask_question`) continue à tourner. Idéal : un `POST /api/chat/cancel/<request_id>` qui propage un signal.

---

## Recommandation pour Patrice au réveil

**Si 1 demi-journée** : P1 complète (coloration code + Copy + Régénérer + erreurs visibles) → +30% perception qualité.

**Si 1 journée** : P1 + Mermaid + Slash commands → l'app devient vraiment agréable.

**Si 1 semaine** : viser V1.5 complète (P1 + tous les P2). À ce stade c'est démontrable à un client agile-up. Ouverture en parallèle : packaging Docker (V3 du README).

**Backend-coupled** : prioriser **Repo strict 404** (1 ligne) et **Tool calls visibles** (~1j côté Rust + chat). Sans ça, le chat reste un "boîte noire" du point de vue UX.

---

*Rédigé par Claude Opus 4.7 (1M context), nuit 03→04 mai 2026, MINISTAR.*
*Backlog issu de l'audit en mode plan post-V1.*
