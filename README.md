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
When you are ready to compare against human raters, use `apps/api/calibration/human_rating_corpus.template.json` plus `PROJECT_FOUNDATION/QUALITY/HUMAN_RATING_CALIBRATION_WORKFLOW.md` as the starting workflow.
For new collection rounds, prefer the structured intake path: `apps/api/calibration/human_rating_cases.template.json`, `apps/api/calibration/human_rating_sheet.template.csv`, and `uv run python scripts/build_human_rating_corpus.py`.

### Project-To-Round Export

```bash
cd apps/api
uv run python scripts/export_project_case_to_evidence_round.py --round-root <round> --project-id <project-id> --take-track-id <take-track-id>
```

This copies a real processed guide/take pair from GigaStudy into one evidence round as canonical WAV files and updates that round's human-rating metadata automatically.
On first use in a fresh scaffold, it also removes the seeded placeholder case and placeholder sheet rows so the round is ready for real rater labels instead of template data.
If note-event artifacts already exist for that take, the same export also writes neutral note-reference CSV / JSON files under `human-rating/references/` so raters can align note indices and target pitches without seeing the scorer's own verdict text first.
For analyzed takes, that export also writes note-level guide/take clip WAVs under `human-rating/references/clips/<case-id>/` so raters can review one note at a time instead of scrubbing the full recordings.

### Human Rating Corpus Builder

```bash
cd apps/api
uv run python scripts/build_human_rating_corpus.py --round-root <round>
```

This converts the round metadata JSON plus per-rater CSV sheet into the generated calibration manifest shape that `run_intonation_calibration.py` can consume.

### Human Rating Corpus Inventory

```bash
cd apps/api
uv run python scripts/inspect_human_rating_corpus.py --round-root <round>
```

This inspects guide/take source paths, WAV metadata, and rating coverage before calibration runs.
Use `--source-kind manifest` after building a corpus, and add `--require-real-audio --fail-on-missing` once the collection round switches to actual singer WAV files.

### Human Rating Threshold Fitting

```bash
cd apps/api
uv run python scripts/fit_human_rating_thresholds.py --round-root <round>
```

This runs the generated human-rated corpus through the calibration flow and emits candidate `strict`, `basic`, and `beginner` cent bands as a report.

### Human Rating Claim Gate

```bash
cd apps/api
uv run python scripts/evaluate_human_rating_claim_gate.py --round-root <round>
```

This evaluates whether the current round is strong enough to even begin threshold-closure review.
For workflow-only smoke, you can still point `--manifest` at the seeded fixture manifest, but real checklist closure still requires a trusted real-vocal corpus.

### Environment Validation Intake Import

```bash
cd apps/api
uv run python scripts/import_environment_validation_runs.py --round-root <round>
```

This converts spreadsheet-style native browser or real-hardware validation evidence into the API request shape used by ops.
Add `--api-base-url http://127.0.0.1:8000` to submit the rows directly into the running API.

### Evidence Round Scaffold

```bash
cd apps/api
uv run python scripts/create_evidence_round.py --round-id round-YYYYMMDD
```

This creates one named folder for the still-open real-world evidence tracks:

- human-rating WAV and sheet collection
- native browser and hardware validation CSV intake

When `C:\my_project\DreamCatcher` exists, the scaffold defaults there so the evidence round stays outside the repo and outside `PROJECT_FOUNDATION`.

Once a round exists, prefer passing `--round-root <round>` to the human-rating and environment-validation CLIs so metadata, generated corpora, reports, claim gates, evidence bundles, and preview JSON all stay inside that same round folder.
That now includes round-local `environment_validation_packet.preview.json` and `environment_validation_claim_gate.preview.{json,md}` outputs before ops import.

### Evidence Round Audit

```bash
cd apps/api
uv run python scripts/inspect_evidence_round.py --round-root <round>
```

This gives one summary of what that round already has, what generated support artifacts are still missing, and what the next collection step should be before review.

### Evidence Round Refresh

```bash
cd apps/api
uv run python scripts/refresh_evidence_round.py --round-root <round>
```

This rebuilds the round-local support artifacts in place: generated human-rating corpus, calibration/threshold/claim/evidence-bundle outputs when the audio sources are ready, environment-validation preview JSON, round-local environment packet and claim-gate previews, and the round audit files.

### Browser Environment Claim Gate

After validation runs are loaded into ops, use the ops UI or call `/api/admin/environment-validation-claim-gate`.
It evaluates whether current native-browser and real-hardware evidence is strong enough to begin a support-claim review.

### Human Rating Evidence Bundle

```bash
cd apps/api
uv run python scripts/build_human_rating_evidence_bundle.py --round-root <round>
```

This packages the calibration summary, threshold-fit report, and release-claim guardrails into the selected round folder.
Those outputs are review artifacts, not canonical foundation docs.

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
- The calibration runner now also supports note-level human-rating comparison summaries and optional agreement thresholds, so future real-rater evidence can be attached without inventing a second evaluation path.
- The repo now also includes a human-rating intake builder plus metadata and sheet templates, so raw rater labels can be turned into a calibration corpus without hand-authoring the final manifest JSON.
- The repo now also includes a repeatable evidence-round scaffold, so real-vocal and browser-hardware collection can start in one named folder outside `PROJECT_FOUNDATION`.
- The repo now also includes a project-to-round export path, so real studio guide/take data can seed one human-rating evidence round directly instead of being recopied by hand.
- That export path now also writes neutral note-reference files for analyzed takes, which makes human-rater collection less error-prone without leaking scorer verdict text into the rating prompt.
- That export path now also writes note-level clip WAVs for analyzed takes, which reduces manual scrubbing during human note-rating rounds.
- The repo now also includes a real-vocal corpus inventory tool, so collection rounds can verify audio-path integrity, WAV metadata, and rating coverage before calibration and threshold fitting.
- The repo now also includes a threshold-fit report path for candidate difficulty bands, so future human-rated corpora can yield repeatable `strict / basic / beginner` recommendations instead of ad hoc threshold notes.
- The repo now also includes a claim-gate evaluator, so the team can repeatably decide whether current human-rating evidence is strong enough to even begin threshold-closure review.
- The repo now also includes a human-rating evidence-bundle path, so future release reviews can attach calibration summary, threshold-fit output, and claim guardrails without assembling them by hand.
- The studio now includes a lightweight chord timeline editor and JSON import path so chord-aware harmony is reachable without leaving the main workflow.
- DeviceProfile capture now also stores browser audio capability snapshots and diagnostic warning flags, so permission and Web Audio differences are visible per environment instead of hidden behind one-off setup failures.
- The browser audio stack is now wired end-to-end in product code: `AudioWorklet` powers live input metering during take capture, waveform and contour previews run in a `Web Worker`, that preview path uses a small `WASM` helper for peak math, and `OfflineAudioContext` remains the local mixdown engine.
- The admin ops view now aggregates those environment diagnostics into a browser matrix, warning-flag counts, and recent captured profiles for support and release triage.
- The ops view can now also download an environment diagnostics report JSON, which is the baseline artifact for native Safari and real-hardware validation rounds.
- The ops view now also stores structured manual validation runs, so PASS / WARN / FAIL browser checks live beside the diagnostics baseline.
- The ops view can now also download an environment validation packet, so diagnostics, manual validation runs, matrix coverage, compatibility notes, and release guardrails can be handed to release review as one JSON artifact.
- The ops view can now also download a browser compatibility release-note draft, so unsupported paths and environment caveats can be reviewed as Markdown before publishing support claims.
- The ops view can now also download a browser and hardware claim gate, so checklist-closure review does not depend on ad hoc judgment.
- The ops overview now also shows the current browser and hardware claim gate inline, so blockers and next evidence-collection steps are visible before exporting the Markdown artifact.
- The ops overview now also lets reviewers preview and import spreadsheet-style environment validation CSV evidence directly, so external QA rounds no longer depend on a CLI-only intake path.
- The repo now also includes a spreadsheet-friendly environment-validation intake template and importer, so native browser or real-hardware evidence collected outside the product UI can still be normalized before it reaches ops.
- That external evidence can now also be previewed and imported directly from the ops screen after paste or file load, while the CLI importer remains available for automation-heavy rounds.
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
- The foundation now also includes a reference-led wireframe pack for the canonical Home, Studio, Arrangement, Shared Review, and Ops screens, so the next UI refactor can follow one agreed layout system.
- The foundation now also includes a mockup track plus repo-visible mockup exports, so visual implementation can target explicit design files instead of only textual wireframes.
- Seeded mockup exports now exist for all five canonical screens under `PROJECT_FOUNDATION/DESIGN/UI_MOCKUPS/`.
- A repo-local equivalent editable design source now also exists under `PROJECT_FOUNDATION/DESIGN/UI_EDITABLE_SOURCE/`, so the canonical mockups are editable in-repo even before a shared Figma file is connected.
- The Home, Studio, Arrangement, Shared Review, and Ops screens now follow that visual system closely enough to read like one product workspace family instead of a utility dashboard plus stacked tool panels.
- The Home screen now also carries one curated non-identifying ambient photo copied from the user-owned external library into a repo-owned asset path, so the entry surface can gain real atmosphere without coupling the app to the raw photo archive.
- Arrangement work now also has its own dedicated `/projects/:projectId/arrangement` route, so score comparison and export can happen in a score-first workspace instead of only inside the studio page.
- Shared review now also reads like a frozen review desk instead of a generic details page, making the read-only boundary much clearer for recipients.
- The web app now also route-splits the heavy non-home workspaces, so the home entry does not ship the full studio, arrangement, sharing, and ops surfaces up front.

## Current Hardening Focus

- Keep the visual refactor locked to `PROJECT_FOUNDATION/DESIGN/UI_DESIGN_DIRECTION.md` plus `PROJECT_FOUNDATION/DESIGN/UI_WIREFRAMES_V1.md` and stop adding one-off local UI styles.
- Use `PROJECT_FOUNDATION/DESIGN/UI_MOCKUP_TRACK.md` plus the editable source under `PROJECT_FOUNDATION/DESIGN/UI_EDITABLE_SOURCE/` and the exports under `PROJECT_FOUNDATION/DESIGN/UI_MOCKUPS/` as the visual implementation baseline, not prose interpretation alone.
- The first-wave product screens now all follow that visual system; next is to upgrade the repo-local editable source into a shared Figma workflow and keep future ops-only work from bleeding utility styling back into rehearsal screens.
- Execute the remaining Phase 9 intonation quality track: real-vocal calibration and human-rating comparison on top of the current synthetic-vocal checkpoint.
- Use `PROJECT_FOUNDATION/QUALITY/HUMAN_RATING_CALIBRATION_WORKFLOW.md` as the default path for adding real singer evidence instead of inventing ad hoc one-off rating notes.
- Prefer the new human-rating intake builder workflow over editing the final corpus JSON by hand.
- Prefer the human-rating corpus inventory CLI before calibration runs so missing WAV files or thin rating coverage fail early instead of during release-review prep.
- Use the threshold-fit report as the default way to propose difficulty-tier cent bands once a real human-rated corpus exists.
- Use the claim-gate CLI before any checklist-closure discussion so threshold claims are not approved by gut feel.
- Use the evidence-bundle CLI as the default way to package human-rating release evidence once a corpus round has been run.
- Keep the synthetic-vocal baseline runner green while expanding from synthetic evidence to real singer recordings and human-rating comparison.
- Deepen the harmony authoring flow only if real usage shows the lightweight marker editor is not enough.
- Keep rehearsing the PostgreSQL + S3-compatible deployment profile beyond the local smoke path so operational assumptions stay current.
- Expand browser hardening into real hardware-variable recording checks, native Safari/WebKit audio validation, and richer endurance runs, using the new capability snapshot, warning flags, and ops diagnostics view as the inspection baseline.
- Follow the browser environment validation protocol in `PROJECT_FOUNDATION/OPERATIONS/BROWSER_ENVIRONMENT_VALIDATION.md` when running manual native-browser checks, and use the exported environment validation packet as the default release-review artifact.
- Use the exported browser environment claim gate before discussing whether native Safari or real-hardware checklist items can close.
- Start that review from the inline claim-gate summary in ops, then export the Markdown artifact once the current blockers are understood.
- When QA delivers spreadsheet-style hardware evidence, preview and import it in ops first so the packet, claim gate, and release-note exports all read from the same stored runs.
- Use the exported browser compatibility release-note draft as the default publishing aid once the packet has been reviewed.
- Prefer the environment-validation CSV template plus importer when QA or external testers collect hardware evidence outside the ops UI.

## Foundation Docs

- [Master Plan](./PROJECT_FOUNDATION/GigaStudy_master_plan.md)
- [Roadmap](./PROJECT_FOUNDATION/ROADMAP.md)
- [UI Design Direction](./PROJECT_FOUNDATION/DESIGN/UI_DESIGN_DIRECTION.md)
- [UI Wireframes v1](./PROJECT_FOUNDATION/DESIGN/UI_WIREFRAMES_V1.md)
- [Phase 1 Backlog](./PROJECT_FOUNDATION/BACKLOGS/PHASE1_BACKLOG.md)
- [Phase 9 Intonation Backlog](./PROJECT_FOUNDATION/BACKLOGS/PHASE9_INTONATION_BACKLOG.md)
- [Intonation Calibration Report](./PROJECT_FOUNDATION/QUALITY/INTONATION_CALIBRATION_REPORT.md)
- [Human Rating Calibration Workflow](./PROJECT_FOUNDATION/QUALITY/HUMAN_RATING_CALIBRATION_WORKFLOW.md)
- [Checklist](./PROJECT_FOUNDATION/GigaStudy_check_list.md)
- [Foundation Status](./PROJECT_FOUNDATION/FOUNDATION_STATUS.md)
- [Intonation Assessment](./PROJECT_FOUNDATION/QUALITY/INTONATION_ANALYSIS_ASSESSMENT.md)
- [Browser Environment Validation](./PROJECT_FOUNDATION/OPERATIONS/BROWSER_ENVIRONMENT_VALIDATION.md)
