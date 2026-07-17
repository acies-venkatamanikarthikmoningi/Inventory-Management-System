FROM python:3.12-slim
WORKDIR /app
COPY backend /app/backend
COPY src/data /app/src/data
RUN pip install --no-cache-dir /app/backend
WORKDIR /app/backend
CMD ["sh", "-c", "alembic upgrade head && alembic -c alembic_fill_rate.ini upgrade head && python -m app.seed.network_foundation && python -m app.seed.multi_node && python -m app.seed.exceptions_and_expiry && python -m app.seed.dynamic_policy && python -m app.fill_rate.seed && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
