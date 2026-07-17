# Local development

1. Run `docker compose up -d --build`; the API service applies the migration and seed idempotently on start.
2. Set `VITE_API_BASE_URL=http://localhost:8000` before running the Vite app.

# Production deployment

1. On Render, create a new Blueprint from `render.yaml`.
2. Render will create the backend web service and the two Postgres databases.
3. Copy the backend service's public HTTPS URL from the Render dashboard.
4. Set `VITE_API_BASE_URL` in Vercel to that public URL, not `localhost`.
5. Redeploy the Vercel frontend after changing the environment variable.

The seed is safe to run repeatedly and updates rows by their existing business/source keys.
