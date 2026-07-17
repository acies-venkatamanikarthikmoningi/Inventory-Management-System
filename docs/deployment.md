# Phase 1 local deployment

1. Run `docker compose up -d --build`; the API service applies the migration and seed idempotently on start.
2. Set `VITE_API_BASE_URL=http://localhost:8000` before running the Vite app.

The seed is safe to run repeatedly and updates rows by their existing business/source keys.
