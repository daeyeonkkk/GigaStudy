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
Melody extraction now calls a repo-local `@spotify/basic-pitch` helper, so keep the root `node_modules` installed with `npm install` even when you are focusing on API-only work.
If the web client and API run on different origins, set `GIGASTUDY_API_PUBLIC_APP_URL` so share links open the frontend viewer route instead of the API origin.
The API now also supports `GIGASTUDY_API_STORAGE_BACKEND=s3` for S3-compatible object storage, and the Python dependencies now include both `psycopg` for PostgreSQL and `boto3` for object storage.
The developer fallback is still SQLite + local filesystem, but the default product deployment profile is now PostgreSQL + S3-compatible storage and has a repeatable smoke path.

### API Test

```bash
cd apps/api
uv run pytest
```

### Browser Release-Gate Smoke Test

```bash
npm run test:e2e
```

This currently runs the seeded browser release gate in Chromium, Firefox, and WebKit.
Recorder transport and recorder-driven endurance checks remain Chromium-only because they rely on fake-microphone launch behavior.
Arrangement playback is verified in Chromium and Firefox; Playwright WebKit on Windows still lacks Web Audio playback in this environment.

### Infrastructure Bootstrap

```bash
docker compose -f docker-compose.infrastructure.yml up -d
```

This starts a local PostgreSQL and MinIO pair and also provisions the `gigastudy` bucket, so the production-like storage path can be exercised without changing the default developer fallback.
Use `apps/api/.env.production.example` as the reference profile for `GIGASTUDY_API_DATABASE_URL` plus the S3-compatible settings.

### Production-Stack Smoke

```bash
cd apps/api
uv run python scripts/production_stack_smoke.py
```

Run this with the PostgreSQL + S3-compatible environment variables from `apps/api/.env.production.example`.
It verifies project creation, guide/take upload, post-recording analysis, Basic Pitch melody extraction, arrangement generation, and export artifact reads against the product storage path.

### Intonation Calibration Runner

```bash
cd apps/api
uv run python scripts/run_intonation_calibration.py
```

This runs the repeatable synthetic-vocal baseline in `apps/api/calibration/synthetic_vocal_baseline.json` through the real upload and analysis API flow.
It is a regression path for the current note-event scorer, not a substitute for the still-open real-human calibration gate.

## Current Product State

- P0 MVP flow is implemented from project creation through export.
- P1 reinforcement features are implemented, including presets, candidate comparison polish, project history, share links, and ops monitoring.
- Analysis now uses `librosa.pyin`-based pitch support on the backend, and melody extraction now uses the official `@spotify/basic-pitch` helper with the previous `librosa.pyin` path retained as an explicit fallback.
- Upload processing now stores frame-level pitch artifacts, and analysis responses expose which scoring quality mode is in use.
- Processed takes now also generate note-event artifacts and signed-cents note feedback on the backend.
- Melody MIDI export now runs through `note-seq`, and arrangement MIDI plus MusicXML export now run through `note-seq` and `music21`.
- Runtime note scoring now down-weights low-confidence frames, and harmony-fit can switch to a chord-aware path when the project provides a chord timeline.
- The studio now exposes note-level correction UI, confidence badges, and clear `note-level` versus `fallback` analysis mode labels.
- The backend regression suite now includes vocal-like synthetic intonation cases and a written calibration report for current claim limits.
- The backend now also includes a manifest-driven calibration runner for the repeatable synthetic vocal baseline, so scorer changes can be checked against the same Phase 9 evidence set on demand.
- The studio now includes a lightweight chord timeline editor and JSON import path so chord-aware harmony is reachable without leaving the main workflow.
- DeviceProfile capture now also stores browser audio capability snapshots and diagnostic warning flags, so permission and Web Audio differences are visible per environment instead of hidden behind one-off setup failures.
- The admin ops view now aggregates those environment diagnostics into a browser matrix, warning-flag counts, and recent captured profiles for support and release triage.
- The ops view can now also download an environment diagnostics report JSON, which is the baseline artifact for native Safari and real-hardware validation rounds.
- The ops view now also stores structured manual validation runs, so PASS / WARN / FAIL browser checks live beside the diagnostics baseline.
- A browser-level release-gate smoke path now covers project creation, studio entry, guide and take attachment, chord timeline save, and chord-aware note-feedback visibility.
- The browser release gate also covers read-only sharing: create a share link, open the frozen viewer, and verify access disappears after deactivation.
- The browser release gate now also covers melody extraction, arrangement candidate generation, and MusicXML/MIDI/guide-WAV export reachability from the score view.
- The browser release gate now also covers browser recorder transport with fake microphone input: permission request, DeviceProfile save, and start/stop take upload.
- The browser release gate now also covers arrangement playback behavior: preview start, transport progress movement, and stop/reset back to ready state.
- The browser release gate now also covers a longer continuous session: repeated takes, take switching, repeated analysis, regeneration, playback, and share creation without page errors.
- The browser release gate now also covers a cross-browser matrix for the seeded safe paths: Chromium, Firefox, and WebKit verify the core studio smoke, sharing, and arrangement export journeys, while arrangement playback is currently verified in Chromium and Firefox.
- The browser release gate now also covers environment diagnostics report export in Chromium, Firefox, and WebKit.
- The browser release gate now also covers manual environment validation run capture in Chromium, Firefox, and WebKit.
- The PostgreSQL + S3-compatible product storage path is now exercised by a repeatable smoke script instead of staying an optional note.

## Current Hardening Focus

- Lock the visual refactor to the `Quiet Studio Console` direction in `PROJECT_FOUNDATION/UI_DESIGN_DIRECTION.md` and stop adding one-off local UI styles.
- Execute the remaining Phase 9 intonation quality track: real-vocal calibration and human-rating comparison on top of the current synthetic-vocal checkpoint.
- Keep the synthetic-vocal baseline runner green while expanding from synthetic evidence to real singer recordings and human-rating comparison.
- Deepen the harmony authoring flow only if real usage shows the lightweight marker editor is not enough.
- Keep rehearsing the PostgreSQL + S3-compatible deployment profile beyond the local smoke path so operational assumptions stay current.
- Expand browser hardening into real hardware-variable recording checks, native Safari/WebKit audio validation, and richer endurance runs, using the new capability snapshot, warning flags, and ops diagnostics view as the inspection baseline.
- Follow the browser environment validation protocol in `PROJECT_FOUNDATION/BROWSER_ENVIRONMENT_VALIDATION.md` when running manual native-browser checks.

## Foundation Docs

- [Master Plan](./PROJECT_FOUNDATION/GigaStudy_master_plan.md)
- [Roadmap](./PROJECT_FOUNDATION/ROADMAP.md)
- [UI Design Direction](./PROJECT_FOUNDATION/UI_DESIGN_DIRECTION.md)
- [Phase 1 Backlog](./PROJECT_FOUNDATION/PHASE1_BACKLOG.md)
- [Phase 9 Intonation Backlog](./PROJECT_FOUNDATION/PHASE9_INTONATION_BACKLOG.md)
- [Intonation Calibration Report](./PROJECT_FOUNDATION/INTONATION_CALIBRATION_REPORT.md)
- [Checklist](./PROJECT_FOUNDATION/GigaStudy_check_list.md)
- [Foundation Status](./PROJECT_FOUNDATION/FOUNDATION_STATUS.md)
- [Intonation Assessment](./PROJECT_FOUNDATION/INTONATION_ANALYSIS_ASSESSMENT.md)
- [Browser Environment Validation](./PROJECT_FOUNDATION/BROWSER_ENVIRONMENT_VALIDATION.md)
