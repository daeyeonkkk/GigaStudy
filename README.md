# GigaStudy

GigaStudy is a six-track a cappella practice studio.
The product is now centered on three user flows:

1. Create a studio from a document/music upload or from an empty six-track board.
2. Complete six fixed tracks: Soprano, Alto, Tenor, Baritone, Bass, and Percussion.
3. Arrange with region lanes and piano-roll events, then practice in the dedicated waterfall view.
4. Score a singer against selected reference tracks and append a timing/pitch report to the studio feed.

Everything outside those flows is intentionally removed from the current foundation and implementation.

## Repository Layout

- `apps/web`
  React + Vite client for the home screen, six-track region studio, and
  practice waterfall mode.
- `apps/api`
  FastAPI service with pitch-event engines, optional Postgres metadata
  persistence, and optional S3-compatible asset persistence.
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

Production web builds default to the live alpha Cloud Run API
(`https://gigastudy-api-alpha-387697530936.asia-northeast3.run.app`) unless
`VITE_API_BASE_URL` is set. This keeps manual Pages builds from accidentally
shipping a localhost API URL.

## API

The API exposes the current product surface only:

- `GET /api/health`
- `GET /api/studios`
- `POST /api/studios`
- `POST /api/studios/upload-target`
- `PUT /api/studios/direct-uploads/{asset_id}`
- `GET /api/studios/{studio_id}`
- `GET /api/studios/{studio_id}/tracks/{slot_id}/audio`
- `GET /api/studios/{studio_id}/jobs/{job_id}/source-preview`
- `POST /api/studios/{studio_id}/tracks/{slot_id}/upload-target`
- `POST /api/studios/{studio_id}/tracks/{slot_id}/upload`
- `POST /api/studios/{studio_id}/tracks/{slot_id}/generate`
- `PATCH /api/studios/{studio_id}/tracks/{slot_id}/sync`
- `POST /api/studios/{studio_id}/candidates/{candidate_id}/approve`
- `POST /api/studios/{studio_id}/candidates/{candidate_id}/reject`
- `POST /api/studios/{studio_id}/jobs/{job_id}/approve-candidates`
- `POST /api/studios/{studio_id}/jobs/{job_id}/retry`
- `POST /api/studios/{studio_id}/tracks/{slot_id}/score`
- `GET /api/admin/storage`
- `DELETE /api/admin/studios/{studio_id}`
- `DELETE /api/admin/studios/{studio_id}/assets`
- `DELETE /api/admin/staged-assets`
- `DELETE /api/admin/expired-staged-assets`
- `DELETE /api/admin/assets/{asset_id}`
- `POST /api/admin/engine/drain`

By default, studio state is persisted under `apps/api/storage`.
Set `GIGASTUDY_API_STORAGE_ROOT` to use a different local directory.

For alpha deployment on free-plan infrastructure, keep Cloud Run stateless:

- Set `GIGASTUDY_API_DATABASE_URL` to use Postgres/Neon for studio metadata.
- Set `GIGASTUDY_API_STORAGE_BACKEND=s3` plus the `GIGASTUDY_API_S3_*`
  settings to use Cloudflare R2 or another S3-compatible object store for
  uploads, retained recordings, and document extraction outputs.
- Keep `GIGASTUDY_API_STORAGE_ROOT` as temporary engine/cache space only.
- Use `GIGASTUDY_API_MAX_UPLOAD_BYTES` to keep base64 JSON uploads inside the
  Cloud Run request and memory envelope.
- In S3/R2 mode, `GIGASTUDY_API_ASSET_CACHE_MAX_BYTES` and
  `GIGASTUDY_API_ASSET_CACHE_MAX_AGE_SECONDS` bound the temporary local object
  cache under `GIGASTUDY_API_STORAGE_ROOT`.
- Local API-proxy direct uploads use signed, expiring upload tokens. Owner-token
  mode also binds those proxy upload tokens to the studio owner hash before any
  bytes are written.
- Document extraction quality/runtime can be tuned with `GIGASTUDY_API_OMR_BACKEND`
  (`auto`, `audiveris`, `pdf_vector`, `vector_first`) plus
  `GIGASTUDY_API_OMR_PREPROCESS_MODE` and
  `GIGASTUDY_API_OMR_PREPROCESS_DPI` for scanned PDF/image retry.
  - Voice transcription can be tuned with
    `GIGASTUDY_API_VOICE_TRANSCRIPTION_BACKEND`
    (`auto`, `basic_pitch`, `librosa`, `pyin`, `local`). The `basic_pitch` path
    is optional and only runs where the server Python environment has Spotify
    Basic Pitch installed. The free-plan default uses librosa pYIN before the
    built-in local fallback.

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

## Alpha API Deploy

The alpha web app calls the Cloud Run API. Rebuild and redeploy the API after
changing the backend contract:

```bash
gcloud builds submit . --config cloudbuild.api.yaml
gcloud run deploy gigastudy-api-alpha \
  --image asia-northeast3-docker.pkg.dev/gigastudy-alpha-493208/gigastudy-alpha/gigastudy-api:latest \
  --region asia-northeast3 \
  --platform managed \
  --concurrency 4 \
  --max-instances 3 \
  --update-env-vars GIGASTUDY_API_APP_ENV=production \
  --allow-unauthenticated
```

Smoke-check the deployed API before testing the Pages UI:

```bash
curl https://gigastudy-api-alpha-387697530936.asia-northeast3.run.app/api/health
curl https://gigastudy-api-alpha-387697530936.asia-northeast3.run.app/api/studios
```

## Foundation Docs

- [Current Architecture](./PROJECT_FOUNDATION/CURRENT_ARCHITECTURE.md)
- [Region/Piano Roll Reset Plan](./PROJECT_FOUNDATION/REGION_PIANOROLL_RESET_PLAN.md)
- [Working Protocol](./PROJECT_FOUNDATION/WORKING_PROTOCOL.md)
- [A Cappella Arrangement Audit](./PROJECT_FOUNDATION/ACAPPELLA_ARRANGEMENT_AUDIT.md)
- [AI Harmony Generation Design](./PROJECT_FOUNDATION/AI_HARMONY_GENERATION_DESIGN.md)
