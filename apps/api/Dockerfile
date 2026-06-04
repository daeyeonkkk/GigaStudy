FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

ARG AUDIVERIS_VERSION=5.10.2
ARG AUDIVERIS_UBUNTU_SERIES=ubuntu22.04
ARG AUDIVERIS_DEB=Audiveris-${AUDIVERIS_VERSION}-${AUDIVERIS_UBUNTU_SERIES}-x86_64.deb
ARG AUDIVERIS_URL=https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/${AUDIVERIS_DEB}

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        fontconfig \
        libasound2 \
        libfreetype6 \
        libgtk-3-0 \
        libxext6 \
        libxi6 \
        libxrender1 \
        libxtst6 \
        rubberband-cli \
    && curl -fsSL "$AUDIVERIS_URL" -o /tmp/audiveris.deb \
    && dpkg-deb -x /tmp/audiveris.deb / \
    && test -x /opt/audiveris/bin/Audiveris \
    && rm -f /tmp/audiveris.deb \
    && rm -rf /var/lib/apt/lists/*

COPY apps/api/pyproject.toml apps/api/uv.lock* ./
RUN pip install --no-cache-dir uv && uv sync --no-dev

COPY apps/api/src ./src

ENV PYTHONPATH=/app/src
ENV GIGASTUDY_API_AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris
EXPOSE 8080

CMD ["uv", "run", "uvicorn", "gigastudy_api.main:app", "--host", "0.0.0.0", "--port", "8080"]
