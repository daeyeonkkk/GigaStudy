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
- Upload processing now stores frame-level pitch artifacts, and analysis responses expose which scoring quality mode is in use.
- Processed takes now also generate note-event artifacts and signed-cents note feedback on the backend.
- Runtime note scoring now down-weights low-confidence frames, and harmony-fit can switch to a chord-aware path when the project provides a chord timeline.
- The studio now exposes note-level correction UI, confidence badges, and clear `note-level` versus `fallback` analysis mode labels.
- The backend regression suite now includes vocal-like synthetic intonation cases and a written calibration report for current claim limits.

## Current Hardening Focus

- Execute the remaining Phase 9 intonation quality track: real-vocal calibration and human-rating comparison on top of the current synthetic-vocal checkpoint.
- Add a studio-friendly chord-authoring path so chord-aware harmony is reachable without leaving the main workflow.
- Complete the remaining planned music stack adoption where it adds real quality: `Basic Pitch`, `music21`, and `note-seq`.
- Harden production infrastructure: PostgreSQL guidance and S3-compatible storage support.
- Add release-gate smoke coverage for the main studio journey.

## Foundation Docs

- [Master Plan](./PROJECT_FOUNDATION/GigaStudy_master_plan.md)
- [Roadmap](./PROJECT_FOUNDATION/ROADMAP.md)
- [Phase 1 Backlog](./PROJECT_FOUNDATION/PHASE1_BACKLOG.md)
- [Phase 9 Intonation Backlog](./PROJECT_FOUNDATION/PHASE9_INTONATION_BACKLOG.md)
- [Intonation Calibration Report](./PROJECT_FOUNDATION/INTONATION_CALIBRATION_REPORT.md)
- [Checklist](./PROJECT_FOUNDATION/GigaStudy_check_list.md)
- [Foundation Status](./PROJECT_FOUNDATION/FOUNDATION_STATUS.md)
- [Intonation Assessment](./PROJECT_FOUNDATION/INTONATION_ANALYSIS_ASSESSMENT.md)
