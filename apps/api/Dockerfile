FROM node:20-bookworm-slim AS node_runtime

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    UV_PROJECT_ENVIRONMENT=/app/apps/api/.venv \
    PATH="/app/apps/api/.venv/bin:${PATH}" \
    PYTHONPATH=/app/apps/api/src \
    GIGASTUDY_API_BASIC_PITCH_NODE_BINARY=node \
    PORT=8080

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node_runtime /usr/local /usr/local

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY apps/api ./apps/api
COPY scripts ./scripts

RUN pip install --no-cache-dir uv \
    && cd /app/apps/api \
    && uv sync --frozen --no-dev \
    && chmod +x /app/scripts/run_api_alembic_upgrade.sh

EXPOSE 8080

CMD ["sh", "-c", "uvicorn gigastudy_api.main:app --app-dir /app/apps/api/src --host 0.0.0.0 --port ${PORT:-8080}"]
