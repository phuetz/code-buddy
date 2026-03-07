# Multi-Worker Orchestrator (Level 8)

API Express + WebSocket avec file de jobs persistante (`jobs.json`) et deux workers logiques:
- `workerA` (échoue une fois puis réussit, retry max 2)
- `workerB` (réussit directement)

## Endpoints

- `GET /health`
- `POST /api/jobs`
- `GET /api/jobs/:id`

## WebSocket Events

- `initial_jobs`
- `job_queued`
- `job_running`
- `job_retry`
- `job_done`
- `job_failed`

## Run

```bash
npm install
npm start
npm run smoke-test
```
