# KeyPilot – Semantic API Gateway with Real‑Time AI Routing & Caching

One request, one intent—and KeyPilot routes to the right provider automatically. No key juggling. No endpoint guessing. Faster builds, lower cost.

Live demo: `https://smartkeypilot.vercel.app/`  
Post: KeyPilot on DEV [`https://dev.to/joeljaison394/keypilot-semantic-api-gateway-with-real-time-ai-routing-caching-2b94`]

### Idea in 30 seconds
- **Describe what you want** (intent + payload). KeyPilot selects the best template (Gemini/OpenAI/Anthropic), applies limits, and proxies the call.
- **Semantic cache** detects near‑duplicate requests and returns results instantly.
- **Ephemeral sessions** make the demo safe: keys expire automatically.

Demo login pattern (for the live app):
```
Username: demo + 3 digits  (e.g., demo123)
Password: pass + same 3 digits  (e.g., pass123)
```

## How we use Redis (beyond cache)
- **Semantic cache (Strings + TTL):** store responses under user + payload hash, with a conservative similarity threshold for cache hits.
- **Sessions & API keys (Strings + TTL):** `user:<id>` holds session with TTL; API keys `user:<id>:keys:<template>` inherit the same TTL. Keys are encrypted with the user’s session token.
- **Streams & Pub/Sub:** live request received/completed events, plus timelines for debug/feedback.
- **Counters & Trends:** track usage, cluster intents over time for insight into what users request next.

## Run locally (backend only or full‑stack)
Prereqs: Node 18+, Redis 7+, npm

1) Backend (this repo)
- Install: `npm install`
- Env: `cp .env.example .env` and set `REDIS_URL` (local or Redis Cloud)
- Start Redis: `docker run -d -p 6379:6379 redis:7-alpine` or `docker-compose up -d redis`
- Run: `npm run dev` → API at `http://localhost:3000`

2) Full‑stack (with frontend)
- Frontend repo: `https://github.com/Joeljaison391/KeyPilot-Frontend`
- Start backend as above (or change ports as you like)
- In the frontend: set `VITE_API_BASE_URL=http://localhost:3000`, then `npm install && npm run dev` → `http://localhost:5173`

## Project structure (backend)
- `src/app.ts` express app wiring: security, logging, routes, rate‑limit
- `src/routes/` auth, keys, proxy, templates, feedback, cache inspector, intent trends, health
- `src/utils/` redis client, semantic cache, vector scoring, access control, encryption, notifications
- `src/config/` environment configuration

## Redis AI Challenge
Built for the Redis AI Challenge 2025 to showcase a semantic API gateway powered end‑to‑end by Redis: vector‑style matching, fast cache, ephemeral sessions, and real‑time analytics—all without extra brokers or databases. See the write‑up: KeyPilot on DEV [`https://dev.to/joeljaison394/keypilot-semantic-api-gateway-with-real-time-ai-routing-caching-2b94`]

## Quick API notes
- Auth: `/auth/login`, `/auth/logout`, `/auth/status/:userId`, `/auth/add-key`, `/auth/update-key`, `/auth/delete-key`, `/auth/demo-api-key`
- Proxy: `/api/proxy` (real call), `/api/proxy/test` (semantic test, no external call)
- Analytics: `/api/cache-inspector`, `/api/intent-trends`, `/api/feedback`, `/api/feedback-stats`
- Health: `/health`, `/health/ready`, `/health/live`

Security note: demo sessions are short‑lived; do not use personal/production keys.

Frontend: KeyPilot Frontend [`https://github.com/Joeljaison391/KeyPilot-Frontend`]