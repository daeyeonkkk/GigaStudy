# GigaStudy

GigaStudy is a six-track a cappella practice studio.
The product is now centered on four user-facing steps:

1. Create a studio from a score/document upload or from an empty six-track board.
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

The web client expects the API at `http://127.0.0.1:8000` in local dev.
Set `VITE_API_BASE_URL` for preview/production builds; production has no
hardcoded Cloud Run fallback.

## API

The API exposes the current product surface only:

- `GET /api/health`
- `GET /api/studios`
- `POST /api/studios`
- `POST /api/studios/upload-target`
- `PUT /api/studios/direct-uploads/{asset_id}`
- `GET /api/studios/{studio_id}`
- `DELETE /api/studios/{studio_id}`
- `GET /api/studios/{studio_id}/tracks/{slot_id}/audio`
- `GET /api/studios/{studio_id}/jobs/{job_id}/source-preview`
- `GET /api/studios/{studio_id}/exports/midi`
- `POST /api/studios/{studio_id}/jobs/{job_id}/approve-tempo`
- `POST /api/studios/{studio_id}/tracks/{slot_id}/upload-target`
- `POST /api/studios/{studio_id}/tracks/{slot_id}/upload` (recording audio only)
- `POST /api/studios/{studio_id}/tracks/{slot_id}/generate`
- `PATCH /api/studios/{studio_id}/tracks/sync`
- `PATCH /api/studios/{studio_id}/tracks/{slot_id}/sync`
- `PATCH /api/studios/{studio_id}/tracks/{slot_id}/volume`
- `PATCH /api/studios/{studio_id}/regions/{region_id}`
- `PATCH /api/studios/{studio_id}/regions/{region_id}/revision`
- `POST /api/studios/{studio_id}/regions/{region_id}/revision-history/{revision_id}/restore`
- `POST /api/studios/{studio_id}/track-archives/{archive_id}/restore`
- `POST /api/studios/{studio_id}/regions/{region_id}/copy`
- `POST /api/studios/{studio_id}/regions/{region_id}/split`
- `DELETE /api/studios/{studio_id}/regions/{region_id}`
- `PATCH /api/studios/{studio_id}/regions/{region_id}/events/{event_id}`
- `POST /api/studios/{studio_id}/candidates/{candidate_id}/approve`
- `POST /api/studios/{studio_id}/candidates/{candidate_id}/reject`
- `POST /api/studios/{studio_id}/jobs/{job_id}/approve-candidates`
- `POST /api/studios/{studio_id}/jobs/{job_id}/retry`
- `POST /api/studios/{studio_id}/tracks/{slot_id}/score`
- `GET /api/playback-instrument`
- `GET /api/playback-instrument/audio`
- `POST /api/admin/session`
- `GET /api/admin/storage`
- `POST /api/admin/studios/{studio_id}/deactivate`
- `DELETE /api/admin/studios/{studio_id}`
- `DELETE /api/admin/inactive-studios`
- `PUT /api/admin/playback-instrument`
- `DELETE /api/admin/playback-instrument`
- `DELETE /api/admin/studios/{studio_id}/assets`
- `DELETE /api/admin/staged-assets`
- `DELETE /api/admin/expired-staged-assets`
- `POST /api/admin/maintenance/cleanup`
- `DELETE /api/admin/assets/{asset_id}`
- `POST /api/admin/engine/drain`

By default, studio state is persisted under `apps/api/storage`.
Set `GIGASTUDY_API_STORAGE_ROOT` to use a different local directory.

For alpha deployment on free-plan infrastructure, keep Cloud Run stateless:

- Set `GIGASTUDY_API_DATABASE_URL` to use Postgres/Neon for studio metadata.
- Or leave `GIGASTUDY_API_DATABASE_URL` unset and set
  `GIGASTUDY_API_METADATA_BACKEND=s3` to store new studio metadata, sidecars,
  the engine queue, asset registry, and guide-tone config in Cloudflare R2.
- Set `GIGASTUDY_API_STORAGE_BACKEND=s3` plus the `GIGASTUDY_API_S3_*`
  settings to use Cloudflare R2 or another S3-compatible object store for
  uploads, retained recordings, and document extraction outputs.
- `GIGASTUDY_API_METADATA_PREFIX=metadata` keeps metadata separate from
  `uploads/`, `jobs/`, and `staged/` asset prefixes in the same bucket.
- Keep `GIGASTUDY_API_STORAGE_ROOT` as temporary engine/cache space only.
- In R2 metadata mode, deploy Cloud Run with `--min-instances 0` and
  `--max-instances 1`; do not run a 5-minute scheduler against
  `/api/admin/engine/drain`.
- Default free-plan cleanup keeps pending browser recordings for 30 minutes,
  inactive studio assets for 7 days, and non-pinned track archives to the
  latest 3 per slot.
- Use `GIGASTUDY_API_MAX_UPLOAD_BYTES` to keep base64 JSON uploads inside the
  Cloud Run request and memory envelope.
- In S3/R2 mode, `GIGASTUDY_API_ASSET_CACHE_MAX_BYTES` and
  `GIGASTUDY_API_ASSET_CACHE_MAX_AGE_SECONDS` bound the temporary local object
  cache under `GIGASTUDY_API_STORAGE_ROOT`.
- Local API-proxy direct uploads use signed, expiring upload tokens. Owner-token
  mode also binds those proxy upload tokens to the studio owner hash before any
  bytes are written.
- Store production/alpha secrets in Google Secret Manager, not in tracked env
  files or the web bundle. Admin browser login uses a short-lived bearer
  session token; static admin tokens are script/emergency fallback only.
- `ops/cloud-run.alpha.env.example.yaml` defines the non-secret Cloud Run env
  template. Copy it to the ignored `ops/cloud-run.alpha.env.yaml`, fill
  environment-specific non-secret values, create the required Secret Manager
  secrets, then use `ops/deploy-api-alpha.ps1`.
- Document extraction quality/runtime can be tuned with
  `GIGASTUDY_API_DOCUMENT_EXTRACTION_BACKEND`
  (`auto`, `audiveris`, `pdf_vector`, `vector_first`) plus
  `GIGASTUDY_API_DOCUMENT_PREPROCESS_MODE` and
  `GIGASTUDY_API_DOCUMENT_PREPROCESS_DPI` for scanned PDF/image retry.
  PDF recognition also has bounded-cost defaults:
  `GIGASTUDY_API_DOCUMENT_AUDIVERIS_CHUNK_PAGES`,
  `GIGASTUDY_API_DOCUMENT_MAX_EXTRACTION_ATTEMPTS`, and
  `GIGASTUDY_API_DOCUMENT_QUALITY_MIN_SCORE`.
  Older `GIGASTUDY_API_OMR_*` names remain accepted as migration aliases.
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
  --min-instances 0 \
  --concurrency 4 \
  --max-instances 1 \
  --update-env-vars GIGASTUDY_API_APP_ENV=production \
  --allow-unauthenticated
```

Secret Manager based deploy:

```powershell
Copy-Item ops/cloud-run.alpha.env.example.yaml ops/cloud-run.alpha.env.yaml
# Fill ops/cloud-run.alpha.env.yaml with non-secret alpha values.
# Create required Secret Manager secrets before deploying:
# gigastudy-api-admin-password
# gigastudy-api-admin-session-secret
# gigastudy-api-s3-access-key-id
# gigastudy-api-s3-secret-access-key
# gigastudy-api-deepseek-api-key
./ops/deploy-api-alpha.ps1
```

Smoke-check the deployed API before testing the Pages UI:

```bash
curl https://gigastudy-api-alpha-387697530936.asia-northeast3.run.app/api/health
curl https://gigastudy-api-alpha-387697530936.asia-northeast3.run.app/api/studios
```

## Foundation Docs

- [Evaluation Metrics](./PROJECT_FOUNDATION/EVALUATION_METRICS.md)
- [Current Architecture](./PROJECT_FOUNDATION/CURRENT_ARCHITECTURE.md)
- [Region/Piano Roll Reset Plan](./PROJECT_FOUNDATION/REGION_PIANOROLL_RESET_PLAN.md)
- [Working Protocol](./PROJECT_FOUNDATION/WORKING_PROTOCOL.md)
- [A Cappella Arrangement Audit](./PROJECT_FOUNDATION/ACAPPELLA_ARRANGEMENT_AUDIT.md)
- [AI Harmony Generation Design](./PROJECT_FOUNDATION/AI_HARMONY_GENERATION_DESIGN.md)
