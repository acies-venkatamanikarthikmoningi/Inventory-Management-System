# Local development

1. Run `docker compose up -d --build`; the API service applies the migration and seed idempotently on start.
2. Set `VITE_API_BASE_URL=http://localhost:8000` before running the Vite app.

# Production deployment

1. Deploy the backend Docker image to any public HTTPS host.
2. Set `INVENTORY_DATABASE_URL`, `FILL_RATE_DATABASE_URL`, and `INVENTORY_CORS_ORIGINS` on that backend host.
3. Set `VITE_API_BASE_URL` in Vercel to the backend's public HTTPS URL, not `localhost`.
4. Redeploy the Vercel frontend after changing the environment variable.

The seed is safe to run repeatedly and updates rows by their existing business/source keys.
