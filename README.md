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
If the web client and API run on different origins, set `GIGASTUDY_API_PUBLIC_APP_URL` so share links open the frontend viewer route instead of the API origin.

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

## Current Product State

- P0 MVP flow is implemented from project creation through export.
- P1 reinforcement features are implemented, including presets, candidate comparison polish, project history, share links, and ops monitoring.
- Analysis and melody extraction now use `librosa.pyin`-based pitch support on the backend.
- Upload processing now stores frame-level pitch artifacts, and analysis responses expose which scoring quality mode is in use.
- Processed takes now also generate note-event artifacts and signed-cents note feedback on the backend.
- Runtime note scoring now down-weights low-confidence frames, and harmony-fit can switch to a chord-aware path when the project provides a chord timeline.
- The studio now exposes note-level correction UI, confidence badges, and clear `note-level` versus `fallback` analysis mode labels.
- The backend regression suite now includes vocal-like synthetic intonation cases and a written calibration report for current claim limits.
- The studio now includes a lightweight chord timeline editor and JSON import path so chord-aware harmony is reachable without leaving the main workflow.
- DeviceProfile capture now also stores browser audio capability snapshots and diagnostic warning flags, so permission and Web Audio differences are visible per environment instead of hidden behind one-off setup failures.
- The admin ops view now aggregates those environment diagnostics into a browser matrix, warning-flag counts, and recent captured profiles for support and release triage.
- The ops view can now also download an environment diagnostics report JSON, which is the baseline artifact for native Safari and real-hardware validation rounds.
- A browser-level release-gate smoke path now covers project creation, studio entry, guide and take attachment, chord timeline save, and chord-aware note-feedback visibility.
- The browser release gate also covers read-only sharing: create a share link, open the frozen viewer, and verify access disappears after deactivation.
- The browser release gate now also covers melody extraction, arrangement candidate generation, and MusicXML/MIDI/guide-WAV export reachability from the score view.
- The browser release gate now also covers browser recorder transport with fake microphone input: permission request, DeviceProfile save, and start/stop take upload.
- The browser release gate now also covers arrangement playback behavior: preview start, transport progress movement, and stop/reset back to ready state.
- The browser release gate now also covers a longer continuous session: repeated takes, take switching, repeated analysis, regeneration, playback, and share creation without page errors.
- The browser release gate now also covers a cross-browser matrix for the seeded safe paths: Chromium, Firefox, and WebKit verify the core studio smoke, sharing, and arrangement export journeys, while arrangement playback is currently verified in Chromium and Firefox.
- The browser release gate now also covers environment diagnostics report export in Chromium, Firefox, and WebKit.

## Current Hardening Focus

- Execute the remaining Phase 9 intonation quality track: real-vocal calibration and human-rating comparison on top of the current synthetic-vocal checkpoint.
- Deepen the harmony authoring flow only if real usage shows the lightweight marker editor is not enough.
- Complete the remaining planned music stack adoption where it adds real quality: `Basic Pitch`, `music21`, and `note-seq`.
- Harden production infrastructure: PostgreSQL guidance and S3-compatible storage support.
- Expand browser hardening into real hardware-variable recording checks, native Safari/WebKit audio validation, and richer endurance runs, using the new capability snapshot, warning flags, and ops diagnostics view as the inspection baseline.
- Follow the browser environment validation protocol in `PROJECT_FOUNDATION/BROWSER_ENVIRONMENT_VALIDATION.md` when running manual native-browser checks.

## Foundation Docs

- [Master Plan](./PROJECT_FOUNDATION/GigaStudy_master_plan.md)
- [Roadmap](./PROJECT_FOUNDATION/ROADMAP.md)
- [Phase 1 Backlog](./PROJECT_FOUNDATION/PHASE1_BACKLOG.md)
- [Phase 9 Intonation Backlog](./PROJECT_FOUNDATION/PHASE9_INTONATION_BACKLOG.md)
- [Intonation Calibration Report](./PROJECT_FOUNDATION/INTONATION_CALIBRATION_REPORT.md)
- [Checklist](./PROJECT_FOUNDATION/GigaStudy_check_list.md)
- [Foundation Status](./PROJECT_FOUNDATION/FOUNDATION_STATUS.md)
- [Intonation Assessment](./PROJECT_FOUNDATION/INTONATION_ANALYSIS_ASSESSMENT.md)
- [Browser Environment Validation](./PROJECT_FOUNDATION/BROWSER_ENVIRONMENT_VALIDATION.md)
