# GigaStudy

GigaStudy is a six-track a cappella practice studio.
The product is now centered on three user flows:

1. Create a studio from a score/music upload or from an empty six-track board.
2. Complete six fixed tracks: Soprano, Alto, Tenor, Baritone, Bass, and Percussion.
3. Score a singer against selected reference tracks and append a timing/pitch report to the studio feed.

Everything outside those flows is intentionally removed from the current foundation and implementation.

## Repository Layout

- `apps/web`
  React + Vite client for the home screen and main six-track studio.
- `apps/api`
  FastAPI service with a local JSON-backed studio repository.
- `PROJECT_FOUNDATION`
  Current product foundation for the six-track GigaStudy direction.
- `e2e`
  Playwright smoke coverage for the new core flow.

## Quick Start

Install JavaScript dependencies:

```bash
npm install
```

Run the API:

```bash
cd apps/api
uv sync
uv run uvicorn gigastudy_api.main:app --reload --app-dir src
```

Run the web client:

```bash
npm run dev:web
```

The web client expects the API at `http://127.0.0.1:8000` by default.
Override it with `VITE_API_BASE_URL` if needed.

## API

The API exposes the current product surface only:

- `GET /api/health`
- `GET /api/studios`
- `POST /api/studios`
- `GET /api/studios/{studio_id}`
- `GET /api/studios/{studio_id}/export/pdf`
- `POST /api/studios/{studio_id}/tracks/{slot_id}/upload`
- `POST /api/studios/{studio_id}/tracks/{slot_id}/generate`
- `PATCH /api/studios/{studio_id}/tracks/{slot_id}/sync`
- `POST /api/studios/{studio_id}/candidates/{candidate_id}/approve`
- `POST /api/studios/{studio_id}/candidates/{candidate_id}/reject`
- `POST /api/studios/{studio_id}/jobs/{job_id}/approve-candidates`
- `POST /api/studios/{studio_id}/tracks/{slot_id}/score`

By default, studio state is persisted under `apps/api/storage`.
Set `GIGASTUDY_API_STORAGE_ROOT` to use a different local directory.

## Verification

API tests:

```bash
cd apps/api
uv run pytest
```

Web build and lint:

```bash
npm run build:web
npm run lint:web
```

Browser smoke test:

```bash
npm run test:e2e
```

## Foundation Docs

- [Master Plan](./PROJECT_FOUNDATION/GigaStudy_master_plan.md)
- [Roadmap](./PROJECT_FOUNDATION/ROADMAP.md)
- [Checklist](./PROJECT_FOUNDATION/GigaStudy_check_list.md)
- [Foundation Status](./PROJECT_FOUNDATION/FOUNDATION_STATUS.md)
- [UI Screen Spec Package](./PROJECT_FOUNDATION/DESIGN/UI_SCREEN_SPEC_PACKAGE/README.md)
