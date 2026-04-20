FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY apps/api/pyproject.toml apps/api/uv.lock* ./
RUN pip install --no-cache-dir uv && uv sync --no-dev

COPY apps/api/src ./src

ENV PYTHONPATH=/app/src
EXPOSE 8080

CMD ["uv", "run", "uvicorn", "gigastudy_api.main:app", "--host", "0.0.0.0", "--port", "8080"]
