#!/bin/sh
set -eu

cd /app/apps/api
uv run alembic upgrade head
