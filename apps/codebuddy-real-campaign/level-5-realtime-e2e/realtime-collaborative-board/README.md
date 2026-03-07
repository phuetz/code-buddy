# Realtime Collaborative Board

Application full-stack Node.js avec collaboration en temps reel via WebSocket.

## Fonctionnalites

- API REST `GET/POST/PUT/DELETE /api/items`
- Endpoint de sante `GET /health`
- Diffusion WebSocket sur chaque creation, modification et suppression
- Persistance locale fichier JSON (`items.json`) avec ecriture atomique
- Frontend simple dans `public/`
- Smoke test E2E (`smoke-test.mjs`) avec 2 clients WebSocket

## Installation

```bash
npm install
```

## Lancer l'application

```bash
npm start
```

## Lancer le test de fumee

```bash
npm run smoke-test
```
