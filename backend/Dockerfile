FROM python:3.12-slim
WORKDIR /app
COPY backend /app/backend
COPY src/data /app/src/data
RUN pip install --no-cache-dir /app/backend
WORKDIR /app/backend
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
