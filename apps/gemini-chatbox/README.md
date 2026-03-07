# Gemini Chatbox (dossier dédié)

Mini application chatbox (backend + frontend) connectée à l'API Gemini en conditions réelles.

## Lancer l'app

Depuis la racine du repo:

```bash
node -r dotenv/config apps/gemini-chatbox/server.mjs
```

Ouvrir ensuite: `http://localhost:3333`

## Smoke test réel

```bash
node -r dotenv/config apps/gemini-chatbox/smoke-test.mjs
```

Le test vérifie:
- endpoint `/health`
- chargement de la page web `/`
- requête réelle sur `/api/chat` vers Gemini
