# cli-proxy — recette du 2 octobre 2026

État : **Prérequis vérifiés**. Décision : **a+b+c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

Le catalogue de modèles est exposé sans prouver qu’un fournisseur peut répondre ; chat renvoyait 500 sur clé vide.

Correction mutualisée dans l’adaptateur HTTP ; aucun faux succès d’inférence derrière le catalogue.

[Protocole, validation et limites](README.md).

## Avant

### proxy-http

```text
200 {"object":"list","data":[{"id":"grok-3-latest","object":"model","created":1790950312,"owned_by":"xai"},{"id":"grok-3-fast","object":"model","created":1790950312,"owned_by":"xai"},{"id":"grok-2-latest","object":"model","created":1790950312,"owned_by":"xai"}]}
500 {"error":{"message":"API key is required and must be a non-empty string","type":"server_error","code":"INTERNAL_ERROR"}}
500 {"code":"INTERNAL_ERROR","message":"API key is required and must be a non-empty string","status":500,"requestId":"10c1ede7a8bb0218"}
200 {"name":"Code Buddy","description":"Multi-provider AI coding agent. A2A inbound surface is read-only: search, view, web fetch, codebase analysis, reasoning. Mutating skills (edit/exec) require an upgraded scope and are not exposed by default.","url":"local://codebuddy","version":"1.0.0","skills":[{"id":"code-search","name":"Code search","description":"grep + symbol/reference lookup across the codebase","inputModes":["text/plain"],"outputModes":["text/plain"]},{"id":"code-read","name":"Code read","description":"view files and list directories","inputModes":["text/plain"],"outputModes":["text/plain"]},{"id":"codebase-analysis","name":"Codebase analysis","description":"graph + map + impact + bug-finder (static analysis only)","inputModes":["text/plain"],"outputModes":["text/plain"]},{"id":"web-query","name":"Web query","description":"web_search + web_fetch + firecrawl scraping","inputModes":["text/plain"],"outputModes":["text/plain"]},{"id":"reasoning","name":"Reasoning","description":"Tree-of-thought analysis on a problem (no host effects)","inputModes":["text/plain"],"outputModes":["text/plain"]}],"capabilities":{"streaming":false,"pushNotifications":false}}
200 {"id":"task_1790950312852_o9bz3","status":{"status":"failed","message":"No LLM provider configured","timestamp":1790950312852},"result":"No LLM provider configured","artifacts":[],"routedTo":"codebuddy"}
```

## Après — paquet reconstruit et réinstallé

### proxy-http

```text
200 {"object":"list","data":[{"id":"grok-3-latest","object":"model","created":1790951771,"owned_by":"xai"},{"id":"grok-3-fast","object":"model","created":1790951771,"owned_by":"xai"},{"id":"grok-2-latest","object":"model","created":1790951771,"owned_by":"xai"}]}
503 {"error":{"message":"No LLM provider configured. Run `buddy login`, configure local Ollama, or set a provider API key.","type":"server_error","code":"PROVIDER_NOT_CONFIGURED"}}
503 {"code":"PROVIDER_NOT_CONFIGURED","message":"No LLM provider configured. Run `buddy login`, configure local Ollama, or set a provider API key.","status":503,"requestId":"1af80f461cd63e72"}
200 {"name":"Code Buddy","description":"Multi-provider AI coding agent. A2A inbound surface is read-only: search, view, web fetch, codebase analysis, reasoning. Mutating skills (edit/exec) require an upgraded scope and are not exposed by default.","url":"local://codebuddy","version":"1.0.0","skills":[{"id":"code-search","name":"Code search","description":"grep + symbol/reference lookup across the codebase","inputModes":["text/plain"],"outputModes":["text/plain"]},{"id":"code-read","name":"Code read","description":"view files and list directories","inputModes":["text/plain"],"outputModes":["text/plain"]},{"id":"codebase-analysis","name":"Codebase analysis","description":"graph + map + impact + bug-finder (static analysis only)","inputModes":["text/plain"],"outputModes":["text/plain"]},{"id":"web-query","name":"Web query","description":"web_search + web_fetch + firecrawl scraping","inputModes":["text/plain"],"outputModes":["text/plain"]},{"id":"reasoning","name":"Reasoning","description":"Tree-of-thought analysis on a problem (no host effects)","inputModes":["text/plain"],"outputModes":["text/plain"]}],"capabilities":{"streaming":false,"pushNotifications":false}}
200 {"id":"task_1790951771400_zlhi3","status":{"status":"failed","message":"No LLM provider configured. Run `buddy login`, configure local Ollama, or set a provider API key.","timestamp":1790951771401},"result":"No LLM provider configured. Run `buddy login`, configure local Ollama, or set a provider API key.","artifacts":[],"routedTo":"codebuddy"}
```
