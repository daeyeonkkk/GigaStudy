# GigaStudy

GigaStudy is a web studio for guided vocal practice.
It lets a user record multiple takes against a guide, run post-recording alignment and scoring, extract an editable melody draft, generate rule-based 4-5 part arrangement candidates, render the score, and export practice artifacts.

## Repository Layout

- `apps/web`
  React 19 + Vite studio client.
- `apps/api`
  FastAPI backend for project, audio, analysis, melody, arrangement, sharing, and ops flows.
- `PROJECT_FOUNDATION`
  Product plan, roadmap, backlog, checklist, and current foundation audit.

## Quick Start

### Web

```bash
npm install
npm run dev:web
```

### API

```bash
cd apps/api
uv sync
uv run alembic upgrade head
uv run uvicorn gigastudy_api.main:app --reload --app-dir src
```

By default the API uses local development storage under `apps/api/storage`.

### API Test

```bash
cd apps/api
uv run pytest
```

## Current Product State

- P0 MVP flow is implemented from project creation through export.
- P1 reinforcement features are implemented, including presets, candidate comparison polish, project history, share links, and ops monitoring.
- Analysis and melody extraction now use `librosa.pyin`-based pitch support on the backend.

## Current Hardening Focus

- Upgrade intonation analysis from preview-contour scoring to note-level signed-cent feedback with confidence weighting.
- Complete the remaining planned music stack adoption where it adds real quality: `Basic Pitch`, `music21`, and `note-seq`.
- Harden production infrastructure: PostgreSQL guidance and S3-compatible storage support.
- Add release-gate smoke coverage for the main studio journey.

## Foundation Docs

- [Master Plan](./PROJECT_FOUNDATION/GigaStudy_master_plan.md)
- [Roadmap](./PROJECT_FOUNDATION/ROADMAP.md)
- [Phase 1 Backlog](./PROJECT_FOUNDATION/PHASE1_BACKLOG.md)
- [Checklist](./PROJECT_FOUNDATION/GigaStudy_check_list.md)
- [Foundation Status](./PROJECT_FOUNDATION/FOUNDATION_STATUS.md)
- [Intonation Assessment](./PROJECT_FOUNDATION/INTONATION_ANALYSIS_ASSESSMENT.md)
