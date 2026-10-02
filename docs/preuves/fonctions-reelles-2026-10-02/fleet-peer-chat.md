# fleet-peer-chat — recette du 2 octobre 2026

État : **Prérequis vérifiés**. Décision : **b** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

Le pair sans fournisseur répondait avec le jargon « no LLM client wired ».

Conserver CLIENT_UNAVAILABLE et préciser login/Ollama/clé API sur le pair.

[Protocole, validation et limites](README.md).

Fichiers du correctif : `src/fleet/peer-chat-bridge.ts`, `tests/server/peer-chat-bridge.test.ts`.

## Avant

### fleet-peer

```text
authenticated
{"type":"peer:response","payload":{"id":"1","ok":false,"error":{"code":"METHOD_ERROR","message":"CLIENT_UNAVAILABLE: no LLM client wired on this peer (peer.chat cannot answer)"}},"timestamp":"2026-10-02T14:11:54.529Z"}
{"type":"peer:response","payload":{"id":"2","ok":true,"payload":{"sessionId":"sess_mur1kqw2_abd7ms","expiresAt":1790952114530,"traceId":"trace-mur1kqw2-4xkbho"}},"timestamp":"2026-10-02T14:11:54.571Z"}
{"type":"peer:response","payload":{"id":"3","ok":false,"error":{"code":"METHOD_ERROR","message":"CLIENT_UNAVAILABLE: no LLM client wired on this peer (peer.chat-session.continue cannot answer)"}},"timestamp":"2026-10-02T14:11:54.573Z"}
{"type":"peer:response","payload":{"id":"4","ok":true,"payload":{"count":2,"sessions":[{"sessionId":"sess_mur1han3_cp8sqt","turnCount":0,"ageMs":161071,"idleMs":161071,"expiresInMs":1638929},{"sessionId":"sess_mur1kqw2_abd7ms","turnCount":0,"ageMs":44,"idleMs":44,"expiresInMs":1799956}],"traceId":"trace-mur1kqxa-6d8vg"}},"timestamp":"2026-10-02T14:11:54.574Z"}
{"type":"peer:response","payload":{"id":"5","ok":true,"payload":{"closed":true,"traceId":"trace-mur1kqxa-2d8dmc"}},"timestamp":"2026-10-02T14:11:54.575Z"}

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### fleet-peer

```text
authenticated
{"type":"peer:response","payload":{"id":"1","ok":false,"error":{"code":"METHOD_ERROR","message":"CLIENT_UNAVAILABLE: No LLM provider configured. Run `buddy login`, configure local Ollama, or set a provider API key. Configure it on this peer (peer.chat)."}},"timestamp":"2026-10-02T14:36:12.404Z"}
{"type":"peer:response","payload":{"id":"2","ok":true,"payload":{"sessionId":"sess_mur2fzsn_1rlxpo","expiresAt":1790953572406,"traceId":"trace-mur2fzsm-fcz8yx"}},"timestamp":"2026-10-02T14:36:12.414Z"}
{"type":"peer:response","payload":{"id":"3","ok":false,"error":{"code":"METHOD_ERROR","message":"CLIENT_UNAVAILABLE: No LLM provider configured. Run `buddy login`, configure local Ollama, or set a provider API key. Configure it on this peer (peer.chat-session.continue)."}},"timestamp":"2026-10-02T14:36:12.416Z"}
{"type":"peer:response","payload":{"id":"4","ok":true,"payload":{"count":1,"sessions":[{"sessionId":"sess_mur2fzsn_1rlxpo","turnCount":0,"ageMs":12,"idleMs":12,"expiresInMs":1799988}],"traceId":"trace-mur2fzsy-3emfwq"}},"timestamp":"2026-10-02T14:36:12.418Z"}
{"type":"peer:response","payload":{"id":"5","ok":true,"payload":{"closed":true,"traceId":"trace-mur2fzsz-a8duxt"}},"timestamp":"2026-10-02T14:36:12.419Z"}

EXIT=0
```
