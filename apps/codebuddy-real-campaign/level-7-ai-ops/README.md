# AI Incident Assistant (Level 7)

Application full-stack avec:
- API incidents CRUD
- Queue de jobs asynchrones
- Diffusion WebSocket temps reel
- Endpoint IA Gemini pour resume d'incident

## Endpoints

- `GET /health`
- `GET/POST/PUT/DELETE /api/incidents`
- `POST /api/jobs`
- `GET /api/jobs/:id`
- `POST /api/assist/summarize`

## Configuration

- `GOOGLE_API_KEY` ou `GEMINI_API_KEY` pour activer Gemini
- `GEMINI_MODEL` optionnel (defaut: `gemini-2.5-flash`)
- `PORT` optionnel

## Commands

```bash
npm install
npm start
npm run smoke-test
```

Le smoke test fait un skip explicite de la verification Gemini si aucune cle API n'est presente.
