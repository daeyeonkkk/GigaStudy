# Foundation Status

Date: 2026-04-14

## Sources Checked

- `GigaStudy_master_plan.md`
- `ROADMAP.md`
- `QUALITY/INTONATION_ANALYSIS_ASSESSMENT.md`
- `QUALITY/INTONATION_CALIBRATION_REPORT.md`
- `QUALITY/HUMAN_RATING_CALIBRATION_WORKFLOW.md`
- `DESIGN/UI_DESIGN_DIRECTION.md`
- `DESIGN/FILMORA_REFERENCE_REVIEW.md`
- `DESIGN/MYEDIT_REFERENCE_REVIEW.md`
- `DESIGN/UI_WIREFRAMES_V1.md`
- `DESIGN/UI_MOCKUP_TRACK.md`
- `DESIGN/UI_EDITABLE_SOURCE/README.md`
- `BACKLOGS/PHASE9_INTONATION_BACKLOG.md`
- `BACKLOGS/PHASE1_BACKLOG.md`
- `OPERATIONS/ALPHA_DEPLOYMENT_TARGET.md`
- `OPERATIONS/ALPHA_STAGING_RUNBOOK.md`
- `GigaStudy_check_list.md`

## Checklist Discipline

- `GigaStudy_check_list.md` is now maintained as a live progress board.
- An item should be marked `[x]` only when the implementation exists and the behavior has been verified by code paths, tests, or browser release-gate runs.
- This status document remains the audit narrative that explains why the checked items are considered done and which gaps are still open on purpose.

## Foundation Hygiene

- `PROJECT_FOUNDATION` root is now restricted to canonical core docs only: plan, roadmap, checklist, audit, and the root index.
- Supporting material now lives under `BACKLOGS/`, `DESIGN/`, `QUALITY/`, and `OPERATIONS/` instead of accumulating at the root.
- New foundation files should be placed in the correct category, linked from `PROJECT_FOUNDATION/README.md`, and kept out of the root unless they are canonical source-of-truth documents.

## Readiness Snapshot

- Current stage:
  GigaStudy is now past the planning-only stage and into a working MVP-plus state.
  The core studio loop, melody and arrangement flow, score/export path, share flow, and ops review tooling are implemented.
- What the product can do right now:
  create a project, upload a guide, record takes in the browser, run post-recording analysis, inspect note-level feedback, extract an editable melody draft, generate arrangement candidates, view a score, export MusicXML/MIDI/guide WAV, create read-only share links, and review environment diagnostics in ops.
- What still blocks a stronger product claim:
  real-human vocal evidence for threshold tuning, native Safari / real Apple hardware validation, and broader real microphone variability evidence.
- Honest readiness statement:
  the product is usable now as an internal or pilot-stage vocal practice MVP, but it is not yet ready to claim a human-trustworthy intonation judge or universally validated browser-and-hardware support.

## Confirmed Implemented

- The P0 release line is implemented end-to-end:
  project creation, guide upload, take recording/upload flow, post-recording alignment and 3-axis scoring, editable melody draft extraction, rule-based arrangement candidates, score rendering, guide playback, and MIDI/MusicXML export.
- The P1 reinforcement line is also implemented:
  difficulty presets, voice-range presets, A/B/C candidate comparison, beatbox templates, project history, share links, and admin ops monitoring.
- Admin ops monitoring now also includes browser-audio environment diagnostics from saved DeviceProfiles, so capability warnings can be reviewed by browser and OS instead of staying buried in studio-only state.
- Admin ops monitoring now also includes manual environment validation runs, so native Safari and real-hardware checks can be stored next to the diagnostics baseline instead of living only in ad hoc notes.
- Admin ops monitoring now also includes recent runtime logs, so client-side screen errors, failed fetches, and unhandled server exceptions are no longer invisible when UX quality drops in the alpha product.
- Device profile capture is stored with requested constraints and applied settings, and the studio snapshot includes the latest profile as the foundation docs require.
- Device profiles now also store a browser capability snapshot plus normalized diagnostic warning flags, so permission state, recorder codec support, secure-context status, and Web Audio / OfflineAudioContext support can be audited per environment.
- Upload processing creates canonical audio plus waveform preview artifacts and keeps retry paths for failed processing.
- Read-only sharing is implemented as a frozen snapshot link, which matches the current safe assumption in the master plan's open decision area.
- A browser-level release-gate smoke path now exists for the main studio journey:
  project creation, guide and take attachment, chord timeline save, post-recording analysis, and chord-aware note-feedback visibility.
- A browser-level sharing gate now also exists:
  create a read-only share link, open the frozen snapshot viewer, and verify access is removed after deactivation.
- A browser-level arrangement export gate now also exists:
  extract a melody draft, generate A/B/C candidates, and verify MusicXML, arrangement MIDI, and guide WAV export artifacts are reachable from the score view.
- A browser-level recording transport gate now also exists:
  request microphone access, save a DeviceProfile, start a take, stop it, and verify the uploaded take returns to the studio list through the browser recorder flow.
- A browser-level arrangement playback gate now also exists:
  start the preview engine, observe transport progress leaving zero, and stop playback back to the ready state.
- A browser-level long-session stability gate now also exists:
  record repeated takes, switch take context, rerun analysis, regenerate arrangements, replay transport, and create a share link in one continuous session without page errors.
- A browser-level ops diagnostics export gate now also exists:
  open the ops overview, download the environment diagnostics report, and confirm warning-flag data is present in the exported JSON.
- Browser release-gate coverage is now split honestly by engine:
  Chromium runs the full suite, while Firefox now also verifies the safer seeded paths for studio smoke, sharing, arrangement export, and arrangement playback.
  WebKit now also verifies the seeded studio smoke, sharing, and arrangement export paths, while its playback path remains blocked in this Windows automation environment because Web Audio is unavailable there.
- The arrangement preview engine now also checks the legacy `webkitAudioContext` constructor so Safari-family browsers can use the same playback path when that legacy bridge exists.
- The browser audio stack is now complete in product code across `AudioWorklet`, `Web Worker`, `OfflineAudioContext`, and `WASM`:
  live recording uses an `AudioWorklet` input meter, waveform and contour preview generation runs through a `Web Worker`, that worker uses a small `WASM` math helper for peak processing, and local mixdown still renders through `OfflineAudioContext`.
- One real HTTPS alpha staging environment is now verified on the chosen stack instead of existing only as repo-side deployment scaffolding:
  `uv run pytest tests/test_config.py` passed, the remote Neon migration completed through the Cloud Run Job fallback, the backend is deployed on Cloud Run, and the frontend is deployed on Cloudflare Pages.
- The deployed alpha frontend now resolves to the live Cloud Run backend instead of the old localhost fallback, and live browser/API smoke has already passed for frontend load, backend health, project creation, guide and take upload, and one analysis run without CORS errors on the alpha origin.
- The deployed Studio route has now been browser-reviewed again on desktop and narrow mobile widths, closing the mixed-content export-link regression, replacing broken preview duration fallbacks with readable unknown-state copy, and keeping Korean inspector headings, status pills, and mini-card content from colliding or forcing horizontal overflow.

## Reinforcement Added In This Pass

- User-facing copy on the default Home, Studio, Arrangement, and Ops surfaces has been tightened again so internal labels like `DeviceProfile`, `AudioWorklet`, raw environment names, generation ids, and JSON-first wording no longer lead the interface.
- Home no longer leads with API address or environment-first diagnostics in the main entry card, and the default Arrangement workspace now prefers Korean task language such as `악보와 미리듣기` and `세부 조정`.
- Ops language now treats browser environment evidence as "장치 기록" and "브라우저 재생 경로" instead of exposing raw implementation labels in the default view.
- 사용자에게 노출되는 핵심 화면의 기본 문구는 이제 한국어를 우선하도록 정리되었고, Home, Studio, Arrangement, Shared Review, Ops에서 내부 개발 단계명이나 백로그 번호 노출을 걷어냈다.
- Studio와 Arrangement의 기본 작업면은 이제 `가이드 겹치기`, `다시 확인`, `악보와 미리듣기`처럼 단순한 한국어 작업명을 쓰고, 직접 붙여넣는 원시 데이터는 `고급` 펼침 안으로만 노출한다.
- Studio의 상단 작업면은 이제 `준비물 랙 -> 듣고 보는 면 -> 시간선 -> 오른쪽 판단 패널` 구조로 더 분명하게 나뉘며, 가이드/테이크 선택과 현재 보고 있는 대상이 한 번에 읽히도록 정리되었다.
- Studio의 핵심 작업면 문구도 더 생활 언어에 가깝게 다듬었다:
  `메인 캔버스`, `트랜스포트 + 트랙 레인`, `인스펙터` 중심 설명 대신 `준비물 랙`, `듣고 보는 면`, `시간선`, `바로 확인할 내용`처럼 실제 한국 사용자가 바로 이해할 표현을 우선한다.
- Verification for this copy-cleanup pass: `npm run lint:web`, `npm run build:web`, and `npm run test:e2e` all passed again (`34 passed / 5 skipped` in Playwright).
- 영어는 `MusicXML`, `MIDI`, `WAV`, `DeviceProfile`, `AudioWorklet`, `AudioContext`처럼 실제로 관용적으로 쓰이는 기술 용어에만 제한적으로 남기고, `note-level`, `signed cents`, `guide WAV`, `Phase`, `FE/BE` 같은 사용자 문구는 자연스러운 한국어 표현으로 바꿨다.
- Post-recording analysis now uses `librosa.pyin` contour support plus onset-envelope alignment.
- Melody draft extraction now uses `librosa.pyin` pitch frames instead of the earlier heuristic frame estimator.
- Upload processing now stores a dedicated `FRAME_PITCH` artifact with frame-level `f0`, `voiced_prob`, and RMS data instead of relying only on the 64-point preview contour.
- Analysis responses now expose `pitch_quality_mode` and `harmony_reference_mode`, and a dedicated frame-pitch inspection API exists for processed tracks.
- Analysis now generates a `NOTE_EVENTS` artifact, note-level signed-cent feedback, and a note-event-based `pitch_score` path for processed tracks.
- Runtime scoring now applies `voiced_prob` + RMS-based confidence weighting to take frames before note scoring.
- Projects can now store a chord timeline, and `harmony_fit_score` uses a chord-aware reference when that timeline exists while still labeling key-only fallback honestly.
- The studio now renders note-level correction UI with a clickable timeline, per-note sharp/flat direction, attack vs sustain cues, timing offsets, confidence badges, and explicit pitch/harmony mode labels.
- The analysis regression suite now includes vocal-like synthetic fixtures for sharp attack, flat sustain, overshoot then settle, breathy onset, centered vibrato, and portamento toward center.
- A calibration report now records provisional threshold bands and a claim gate for what the scorer can and cannot promise today.
- The studio now includes a lightweight chord timeline authoring and JSON import flow, so `CHORD_AWARE` harmony is reachable from the main workflow instead of only through preloaded project metadata.
- The studio now also shows current browser audio capability warnings before save and the stored DeviceProfile warnings after save, which turns the remaining browser-hardware gap into something we can inspect instead of guess.
- Browser capability snapshots now also capture `audio_worklet`, `web_worker`, and `web_assembly` readiness, so missing browser-audio stack pieces surface as first-class warning flags instead of staying implicit.
- The ops overview now aggregates those DeviceProfile diagnostics into a browser matrix, warning-flag counts, and recent environment cards, which is the first foundation step from capture toward real hardware validation.
- The ops overview can now also export an environment diagnostics report JSON, and the foundation now includes a dedicated browser-environment validation protocol for native Safari and real-hardware rounds.
- The ops overview now also lets a reviewer save a structured PASS / WARN / FAIL validation run with browser, device, permission, playback, and follow-up notes, which turns the protocol into an actual product workflow.
- The ops overview can now also export an environment validation packet, so diagnostics, manual validation runs, matrix coverage, compatibility notes, and release-claim guardrails can be packaged into one release-review artifact.
- The ops overview can now also export a browser compatibility release-note draft, so the stored validation evidence can be translated into publishable compatibility notes without rewriting the same unsupported-path caveats by hand.
- The ops overview can now also export a browser and hardware claim gate, so the team can evaluate whether current native-browser evidence is strong enough to even begin a support-claim review.
- The ops overview now also surfaces the current browser and hardware claim gate inline, so blockers and next evidence-collection steps are visible before anyone exports the Markdown artifact.
- The ops overview now also supports CSV preview/import for external validation evidence, so spreadsheet-based QA or hardware logs can be reviewed and imported without falling back to a CLI-only path.
- The ops overview now also exposes a Korean-first environment validation starter-pack download, so testers can begin from a ready CSV template plus short README without searching repo paths before a native-browser or hardware round.
- The repo now also has a spreadsheet-friendly environment-validation intake template plus importer, so native browser or hardware evidence collected outside the app can still be normalized before it reaches ops.
- The evidence-round scaffold now also seeds the browser and hardware validation CSV template into that same external round folder, so Phase 9 and Phase 10 collection can start from one shared round id instead of separate ad hoc prep steps.
- The foundation now also has a reviewed alpha deployment target, and the currently recommended low-cost stack remains `Cloudflare Pages + Cloud Run + Neon + R2` with explicit repo-specific caveats for monorepo build settings, backend containerization, and direct-to-object-storage uploads.
- The repo now also includes a Cloud Run-targeted backend container at `apps/api/Dockerfile`, and that image is designed to carry both Python and Node so the FastAPI service and the Basic Pitch helper can run inside the same service image once Docker build verification is available.
- Browser upload init routes now switch between two verified paths: local development keeps the existing API upload proxy, while S3-compatible storage backends now return presigned direct-upload targets plus required headers for guide, take, and mixdown audio.
- The browser release-gate harness now also cleans `.e2e-storage` more defensively on Windows before booting the API fixture server, which removes one file-deletion race that could previously break otherwise healthy Playwright runs.
- The Cloud Run backend container is now verified rather than only scaffolded: the image builds locally, contains working `node` and `python` runtimes, carries the repo-local Basic Pitch helper and package, and serves `/api/health` successfully when started on port `8080`.
- The API now has a first-class storage backend abstraction with local and S3-compatible object storage backends, and the upload, processing, melody export, arrangement export, and download routes now run through that shared storage contract instead of hard-coded local file paths.
- The backend runtime now also includes first-class PostgreSQL and S3-compatible client drivers (`psycopg` and `boto3`), and the repo includes a local PostgreSQL + MinIO bootstrap compose file for production-like storage rehearsals.
- The production stack path is now operational instead of aspirational: the repo includes a production env example, automatic MinIO bucket bootstrap, and a repeatable smoke script that runs the core project → guide → take → analysis → melody → arrangement → export flow against PostgreSQL plus S3-compatible storage.
- Melody draft extraction now runs through the official `@spotify/basic-pitch` helper by default, then continues through the existing quantize, phrase split, key estimation, and editable draft path in the API.
- The Basic Pitch integration is now operational in this Python 3.12 environment through a repo-local Node helper, while the previous `librosa.pyin` melody path remains as an explicit fallback when that helper is unavailable.
- Melody MIDI export now runs through `note-seq`, and arrangement MIDI export now also uses `note-seq` instead of the local hand-rolled MIDI serializer.
- Arrangement MusicXML export now runs through `music21`, so the runtime export path now uses a standard music notation library instead of only the local custom MusicXML builder.
- The backend now also has a repeatable intonation calibration runner with a manifest-driven synthetic vocal baseline, so Phase 9 evidence can be re-run through the real upload and analysis path instead of living only inside one-off test functions.
- The calibration runner now also supports note-level human-rating comparison summaries plus optional agreement thresholds, so the repo can attach real-rater evidence without inventing a separate evaluation path later.
- The repo now also has a human-rating intake builder with metadata and sheet templates, so future real-vocal rounds can turn raw per-rater labels into a calibration corpus without hand-editing final manifests.
- The repo now also has a repeatable evidence-round scaffold script, so real-vocal WAV collection and native-browser spreadsheet intake can start in one named folder outside `PROJECT_FOUNDATION` instead of scattering ad hoc files through the repo.
- The human-rating and environment-validation CLIs can now also target one named evidence round directly through `--round-root`, so corpus build, calibration, threshold fit, claim gate, evidence bundle generation, and validation-sheet import no longer need repeated manual file-path wiring.
- The repo now also has an evidence-round audit path, so one command can summarize which human-rating and browser-validation artifacts are present, which generated outputs still need to be run, and what the next collection step is for that round.
- The repo now also has an evidence-round refresh path, so one command can rebuild the generated human corpus, human-rating support reports, environment-validation preview JSON, and round audit back into the same round before review.
- The evidence-round refresh path now also regenerates a round-local environment validation packet preview plus browser/hardware claim-gate preview from the external CSV, so reviewers can inspect matrix coverage and checklist blockers before anything is imported into ops.
- The repo now also has a project-to-round export path, so real guide/take pairs that already exist in GigaStudy can be copied into an evidence round as canonical WAV files without hand-curating those files first.
- That export path also replaces the seeded placeholder metadata case and placeholder rating-sheet rows on first use, so a fresh round can pivot into real collection mode without dragging template noise into the builder or claim-gate flow.
- The project-to-round export path now also writes neutral note-reference CSV / JSON files when note-event artifacts are available, so raters can align `note_index`, note windows, and target pitch labels without being biased by the scorer's own verdict text.
- The round audit now also reports whether those neutral note-reference files exist, so a collection round can warn when raters are being asked to label notes without a stable index guide.
- The same export path now also writes note-level guide/take clip WAV files for analyzed cases, so human raters can review one note at a time instead of repeatedly scrubbing the full recordings.
- The round audit now also counts note-level clip WAV files, so the collection loop can tell whether a round has only metadata or also the faster per-note listening assets.
- The export path now also writes a self-contained review packet HTML for analyzed cases, so raters can open one page that includes the full guide/take plus the per-note clip table instead of assembling those files manually.
- The round audit now also counts review packet HTML files, so a round can distinguish between having raw assets and having a ready-to-open rater handoff package.
- Human-rating collection materials are now Korean-first as well: the review packet copy is localized for local raters, and the rating-sheet builder now normalizes Korean labels back into canonical calibration values.
- The Studio route now also exposes a Korean-first human-rating packet download for the selected take, so guide / take audio, note clips, the review packet HTML, and the seeded rating sheet can be handed to raters without falling back to a CLI-only export step first.
- The Studio route now also exposes a one-shot real-evidence batch download for the selected take, so the same handoff can include human-rating assets plus the browser / hardware validation starter materials when the later real-data sprint begins.
- The Studio route now also exposes a project-level real-evidence batch download, so every ready take in the current project can be handed to a later human-rating and browser / hardware collection round as one zip instead of one selected-take export at a time.
- The repo now also has a real-vocal corpus inventory tool, so future collection rounds can verify audio-path integrity, WAV metadata, and rating coverage before they spend time on calibration or threshold fitting.
- The repo now also has a threshold-fit report path for candidate `strict / basic / beginner` cent bands, so future human-rated corpora can produce a repeatable recommendation report instead of ad hoc threshold notes.
- The repo now also has a human-rating evidence-bundle path, so calibration summary, threshold-fit output, and claim guardrails can be exported together as release-review artifacts instead of being assembled by hand.
- The repo now also has a claim-gate evaluator for human-rated corpora, so the team can repeatably decide whether current evidence is strong enough to even begin threshold-closure review.
- The evidence-round scaffold now also writes a `REAL_EVIDENCE_PLAN.md` plus `REAL_EVIDENCE_CHECKLIST.md`, so the later real-data sprint can combine singer/rater collection and native browser-hardware validation in one coordinated round instead of being rediscovered from chat history.
- Calibration manifest loading is now also UTF-8 BOM-safe, so Windows-edited human-rating corpus files do not break the runner or evidence-bundle flow.
- The foundation now also has a canonical UI design direction document, so future visual refactors can converge on one product identity instead of drifting between ops-heavy utility screens and ad hoc studio styling.
- The foundation now also has a reference-led wireframe pack for Home, Studio, Arrangement, Shared Review, and Ops, so the next UI refactor has one canonical screen set instead of relying on scattered implementation screenshots.
- The foundation now also has a first-class mockup track: editable design files are now the preferred visual source of truth, and repo-visible mockup exports are required so implementation can target concrete screens instead of only prose wireframes.
- The Home page now follows the `home-v1` mockup closely enough to act like a product-facing studio entry screen instead of an environment-validation dashboard, while still preserving the real project-creation flow and API status check.
- The Studio page now follows the `studio-v1` mockup closely enough to stop reading as stacked tools: a top utility strip, central waveform canvas, lower transport and track lane rail, right-side inspector, and anchored deep-work sections now behave like one rehearsal workspace instead of a phase-by-phase card stack.
- The Arrangement screen now exists as a dedicated `/projects/:projectId/arrangement` workspace and follows the `arrangement-v1` mockup closely enough to read as one score-first comparison and export surface instead of another subsection buried in the studio page.
- The Shared Review screen now follows the `shared-review-v1` mockup closely enough to read like a frozen review desk instead of a generic read-only detail page: selected take on the left, frozen score canvas in the center, and score summary plus note highlight on the right.
- The Shared Review screen now also behaves more like one read-only review workspace than one stacked detail page:
  `테이크 보기`, `악보 보기`, and `결과 읽기` switches keep the left rail focused on review entry points while the center and right panels act like one frozen review desk.
- The Ops screen now follows the `ops-v1` mockup closely enough to read like a dense release desk instead of a generic stack of admin cards: KPI strip on top, validation and recovery work areas in the middle, and diagnostics plus recent environment capture at the bottom.
- The repo now also includes seeded mockup exports for all five canonical screens under `PROJECT_FOUNDATION/DESIGN/UI_MOCKUPS/`, so the remaining visual work can anchor against visible design files inside the repo even before a shared Figma source is fully established.
- The foundation now also has an equivalent editable design source under `PROJECT_FOUNDATION/DESIGN/UI_EDITABLE_SOURCE/`, so the product no longer depends on frozen SVG exports alone when updating canonical screen mockups.
- The Home page now also uses one curated non-identifying ambient photo from the user-owned external library as a supporting visual layer, and the selected source `C:\my_project\DCIM\102_PANA\IMG_9729.JPG` has been copied into the repo-owned path `apps/web/public/photography/home-ambient-quiet-hall.jpg` without modifying `C:\my_project\DCIM`.
- The web app now also route-splits the heavy non-home workspaces (`Studio`, `Arrangement`, `Shared Review`, and `Ops`), and the score stack is chunked so the home entry does not load the full notation workspace upfront.
- Backend model versions now report:
  - analysis: `librosa-pyin-note-events-v4`
  - melody: `librosa-pyin-melody-v2`
  - arrangement engine: `rule-stack-v1`

## Verified Today

- Backend test suite: `uv run pytest`
- Result: `104 passed`
- Scope verified by tests includes analysis, melody, arrangements, processing, project history, studio snapshot, ops, and schema coverage.
- Targeted take-download regression:
  `uv run python -m pytest tests/test_tracks_api.py`
- Result:
  passed with `5 passed`, including the existing human-rating packet download, the selected-take real-evidence batch zip, and the new multi-take project-level real-evidence batch zip.
- Web verification for this pass:
  `npm run lint:web`,
  `npm run build:web`,
  `npx playwright test -g "release gate smoke path reaches chord-aware note feedback through the studio"`
- Result:
  all passed, and the targeted release gate completed with `3 passed` across Chromium, Firefox, and WebKit while exercising the Studio-side download surface.
- Cloud Run backend container verification:
  `docker build -f apps/api/Dockerfile -t gigastudy-api-cloudrun:test .`
- Result:
  blocked in this local session because Docker Desktop was installed but the Docker daemon was not available, so the container implementation exists but checklist closure remains open.
- Scope now also includes environment-validation intake parsing and request-shape generation from CSV evidence sheets.
- Scope now also includes an object-storage regression path that runs the guide upload and processing lifecycle against a fake S3-compatible backend.
- Scope now also includes a calibration-runner regression path that executes the synthetic vocal baseline manifest through isolated upload and analysis flows.
- Alembic upgrade: `uv run alembic upgrade head`
- Result: passed through `20260408_0010`.
- Intonation calibration runner:
  `uv run python scripts/run_intonation_calibration.py`
- Result:
  passed with `4/4` cases on `apps/api/calibration/synthetic_vocal_baseline.json`.
- Verified flow:
  manifest load, isolated project creation, guide upload, take upload, post-recording analysis, note-feedback expectation checks, and Markdown summary generation all succeeded through the real API path.
- Calibration workflow regression:
  `uv run pytest apps/api/tests/test_calibration_runner.py`
- Result:
  passed with human-rating agreement coverage for note-level comparison summaries and Markdown output.
- Human-rating builder regression:
  `uv run pytest apps/api/tests/test_human_rating_builder.py`
- Result:
  passed with coverage for consensus aggregation, CSV loading, Korean label normalization, and unknown-case validation.
- Human-rating builder CLI:
  `uv run python scripts/build_human_rating_corpus.py`
- Result:
  passed against the seeded metadata and sheet templates, emitting a final-shape calibration corpus JSON with consensus labels and rater counts.
- Real-vocal corpus inventory regression:
  `uv run pytest apps/api/tests/test_real_vocal_corpus.py`
- Result:
  passed with coverage for missing-audio detection, fixture-vs-real-audio classification, WAV metadata inspection, and human-rating coverage aggregation.
- Real-vocal corpus inventory CLI:
  `uv run python scripts/inspect_human_rating_corpus.py --metadata calibration/human_rating_cases.template.json`
- Result:
  passed against the seeded metadata template, rendering an inventory report that distinguishes fixture-backed cases from real-audio-ready corpus entries.
- Threshold-fit regression:
  `uv run pytest apps/api/tests/test_threshold_fitting.py`
- Result:
  passed with coverage for tier recommendation ordering, Markdown rendering, and empty-corpus handling.
- Threshold-fit CLI:
  `uv run python scripts/fit_human_rating_thresholds.py --manifest ...`
- Result:
  passed on a named-fixture generated corpus, producing candidate `strict / basic / beginner` cent bands from human-rating labels.
- Evidence-round scaffold CLI:
  `uv run python scripts/create_evidence_round.py --round-id smoke-batch --output-root output/tmp_evidence_rounds`
- Result:
  passed and wrote the round-local `REAL_EVIDENCE_PLAN.md` plus `REAL_EVIDENCE_CHECKLIST.md`, confirming that a later real-data sprint can start from one self-guided round root instead of rebuilding the plan from chat history.
- Claim-gate regression:
  `uv run pytest apps/api/tests/test_calibration_claim_gate.py`
- Result:
  passed with coverage for synthetic/template rejection, review-ready positive cases, and custom policy thresholds.
- Claim-gate CLI:
  `uv run python scripts/evaluate_human_rating_claim_gate.py --manifest calibration/human_rating_seeded_fixture.json`
- Result:
  passed on the seeded fixture manifest, producing a `not ready` gate with explicit reasons instead of leaving threshold-closure review as an ad hoc judgment.
- Human-rating evidence-bundle regression:
  `uv run pytest apps/api/tests/test_calibration_evidence.py`
- Result:
  passed with coverage for bundle guardrails, overview aggregation, and Markdown rendering.
- Human-rating evidence-bundle CLI:
  `uv run python scripts/build_human_rating_evidence_bundle.py --manifest ...`
- Result:
  passed on a named-fixture generated corpus, emitting calibration summary, threshold report, and bundle outputs into `apps/api/calibration/output/`.
- Production-stack smoke:
  `uv run python scripts/production_stack_smoke.py`
- Result:
  passed against `postgresql+psycopg://gigastudy:gigastudy@127.0.0.1:5432/gigastudy` plus MinIO `gigastudy` bucket on `http://127.0.0.1:9000`.
- Verified flow:
  project creation, guide upload, take upload, post-recording analysis, Basic Pitch melody draft extraction, arrangement generation, studio snapshot read, and MusicXML/MIDI/guide-WAV artifact download all succeeded on PostgreSQL + S3-compatible storage.
- Web lint: `npm run lint:web`
- Web build: `npm run build:web`
- Result: passed, with the remaining chunk-size warning isolated to the lazy-loaded `osmd-vendor` notation chunk during `vite build`.
- Current pass API config hardening: `uv run pytest tests/test_config.py`
- Result: `2 passed`
- Current pass targeted browser review:
  `npx playwright test e2e/release-gate.spec.ts -g "release gate arrangement workspace presents a score-first compare and export screen"`
- Result: `3 passed`
- Scope for the current pass:
  the dedicated Arrangement route now keeps the Filmora-informed v2 workspace structure reachable in Chromium, Firefox, and WebKit, and the e2e API harness now accepts both comma-separated and JSON-list CORS origin input.
- Browser release-gate smoke path: `npm run test:e2e`
- Result: `37 passed`, `5 skipped`
- Scope now also verifies that the Korean-first product copy still holds through the main user-facing routes, including Home, Studio, Arrangement workspace, Shared Review, Ops validation forms, and environment-validation CSV import flows.
- Scope now also includes the Filmora-informed Studio v2 workspace pass across Chromium, Firefox, and WebKit, verifying that the source rack, preview canvas, lower time rail, right-side inspector, and the new `녹음 / 리뷰 / 편곡` workspace switch remain reachable without breaking the seeded studio journey.
- Web route-split hardening:
  non-home routes now load through `React.lazy` + `Suspense`, and Vite manually splits `opensheetmusicdisplay`, `vexflow`, and router vendor chunks.
- The Studio integrated-console refactor now also keeps the browser release gate green after the shell and workbench split, so the visual restructuring did not break the seeded product paths.
- Mockup export render check:
  `npx playwright screenshot --device="Desktop Chrome" "file:///.../UI_MOCKUPS/home-v1.svg"`
  plus the matching `studio-v1.svg`, `arrangement-v1.svg`, `shared-review-v1.svg`, and `ops-v1.svg` captures.
- Result:
  the seeded mockup exports for all canonical screens render cleanly as browser-visible design files inside the repo and are usable as a concrete visual baseline.
- Visual browser review:
  `npx playwright screenshot --device="Desktop Chrome" --wait-for-timeout=1600 --full-page http://127.0.0.1:4173 output/playwright/home-wireframe.png`
  plus the matching `iPhone 13` capture.
- Result:
  the refactored Home page was visually reviewed in desktop and mobile layouts against `DESIGN/UI_WIREFRAMES_V1.md`, and the first screen now matches the intended poster-like product entry much more closely than the previous utility dashboard.
- Visual browser review:
  `npx playwright screenshot --device="Desktop Chrome" --full-page http://127.0.0.1:5173/ops output/playwright/ops-loaded.png`
- Result:
  the refactored Ops page was visually reviewed against `ops-v1` after wiring a real API-backed preview, and the screen now reads like a utility-only release desk without dictating the product-wide visual tone.
- Editable source render check:
  `npx playwright screenshot --device="Desktop Chrome" --full-page file:///.../UI_EDITABLE_SOURCE/quiet-studio-console-v1.html output/playwright/ui-editable-source.png`
- Result:
  the repo-local editable source renders all five canonical artboards in one browser-visible file and is now a valid equivalent editable source for the mockup track.
- Scope verified by the browser run includes cross-browser coverage for project creation, studio entry, seeded guide/take attachment, chord timeline save, post-recording analysis, note-level chord-aware feedback visibility, read-only share creation, shared viewer load, share deactivation behavior, melody draft extraction, arrangement candidate generation, and score-export artifact reachability in Chromium, Firefox, and WebKit.
- The same browser release gate now also proves the Home entry still works after adding the curated ambient photo layer, because project creation still starts from the Home surface in every browser run.
- Scope now also includes the dedicated Arrangement workspace route across Chromium, Firefox, and WebKit, verifying that the score-first compare surface, export actions, and studio deep-edit handoff are reachable as their own product workspace.
- Scope now also includes the Filmora-informed Arrangement v2 workspace pass across Chromium, Firefox, and WebKit, verifying that the updated candidate rack, score/player stage, and inspector export flow remain reachable after the live implementation refactor.
- Scope now also includes the refactored Shared Review layout across Chromium, Firefox, and WebKit, verifying the selected-take rail, frozen review canvas, and explicit read-only warning language on the shared viewer.
- Arrangement playback progress plus stop/reset behavior is now verified in Chromium and Firefox.
- Ops overview export is now verified in Chromium, Firefox, and WebKit.
- Ops overview manual validation-run capture is now also verified in Chromium, Firefox, and WebKit.
- Ops overview environment-validation-packet export is now also verified in Chromium, Firefox, and WebKit.
- Ops overview browser-compatibility release-note export is now also verified in Chromium, Firefox, and WebKit.
- Ops overview browser-environment claim-gate export is now also verified in Chromium, Firefox, and WebKit.
- Ops overview CSV preview/import is now also verified in Chromium, Firefox, and WebKit.
- Ops overview now also verifies the inline browser-environment claim-gate summary across Chromium, Firefox, and WebKit before export is triggered.
- Ops overview now also verifies the new triage-workspace switch (`문제 확인`, `환경 검증`, `복구 처리`) across Chromium, Firefox, and WebKit before the diagnostics export path is exercised.
- Environment-validation intake regression:
  `uv run pytest apps/api/tests/test_environment_validation_import.py`
- Result:
  passed with coverage for UTF-8 BOM-safe CSV loading, warning-flag parsing, latency conversion, and API request-shape generation.
- Environment-validation intake CLI:
  `uv run python scripts/import_environment_validation_runs.py --csv environment_validation/environment_validation_runs.template.csv`
- Result:
  passed against the seeded template CSV, emitting normalized JSON with blank-row skipping and import-time timestamp fallback for omitted `validated_at` values.
- Evidence-round scaffold regression:
  `uv run pytest apps/api/tests/test_evidence_rounds.py`
- Result:
  passed with coverage for DreamCatcher-root preference, repo-output fallback, template copying, and round-id validation.
- Project-to-round export regression:
  `uv run pytest apps/api/tests/test_evidence_round_project_export.py`
- Result:
  passed with coverage for canonical guide/take WAV export, seeded template replacement, expectation seeding from latest score metadata, neutral note-reference export, note-level clip export, Korean review packet HTML export, and duplicate-case protection.
- Project-to-round export CLI:
  `uv run python scripts/export_project_case_to_evidence_round.py --round-root <round> --project-id <project-id> --take-track-id <take-track-id>`
- Result:
  passed in a local smoke flow after creating a scaffolded round, exporting a processed guide/take pair, and verifying that the round metadata now points at round-local canonical WAV files, neutral note-reference files, note-level clip WAV files, and a review packet HTML instead of the seeded template placeholders.
- Evidence-round scaffold CLI:
  `uv run python scripts/create_evidence_round.py --round-id smoke-round --output-root ...`
- Result:
  passed against a temporary output root, creating a human-rating plus environment-validation round scaffold without touching `PROJECT_FOUNDATION`.
- Evidence-round `--round-root` workflow smoke:
  `uv run python scripts/refresh_evidence_round.py --round-root <round>`,
  `uv run python scripts/build_human_rating_corpus.py --round-root <round>`,
  `uv run python scripts/inspect_evidence_round.py --round-root <round>`,
  `uv run python scripts/inspect_human_rating_corpus.py --round-root <round>`,
  `uv run python scripts/inspect_human_rating_corpus.py --round-root <round> --source-kind manifest`,
  `uv run python scripts/run_intonation_calibration.py --round-root <round>`,
  `uv run python scripts/fit_human_rating_thresholds.py --round-root <round>`,
  `uv run python scripts/evaluate_human_rating_claim_gate.py --round-root <round>`,
  `uv run python scripts/build_human_rating_evidence_bundle.py --round-root <round>`,
  `uv run python scripts/import_environment_validation_runs.py --round-root <round>`
- Result:
  build and inventory commands passed directly against the fresh scaffold, while calibration, threshold-fit, claim-gate, and evidence-bundle commands were then re-run after replacing the round's generated corpus with the seeded fixture manifest. The round scaffold now acts as one reusable working root for both Phase 9 and Phase 10 support CLIs, and each command writes its generated outputs back into the round instead of relying on repeated ad hoc path arguments.
- Evidence-round refresh regression:
  `uv run pytest apps/api/tests/test_evidence_round_refresh.py`
- Result:
  passed with one placeholder-audio round that correctly skips calibration reports and one fixture-backed round that rebuilds generated corpus, human-rating reports, environment preview JSON, round-local environment packet / claim-gate previews, and round audit in place.
- Evidence-round audit regression:
  `uv run pytest apps/api/tests/test_evidence_round_audit.py`
- Result:
  passed with coverage for placeholder rounds that still point at missing real WAV files and for support-complete rounds that already have a generated corpus, report artifacts, environment-validation preview artifacts, and round-local claim-gate readiness state.
- Round-local environment preview regression:
  `uv run pytest apps/api/tests/test_environment_validation_round_preview.py`
- Result:
  passed with coverage for a not-ready two-row round and a review-ready three-row round, confirming packet summary and claim-gate preview are both derivable directly from the round CSV before ops import.
- Evidence-round refresh CLI smoke:
  `uv run python scripts/refresh_evidence_round.py --round-root <round>`
- Result:
  passed against a temporary scaffold, writing `environment_validation_packet.preview.json` and `environment_validation_claim_gate.preview.{json,md}` into the round before cleanup.
- Chromium additionally covers the browser recorder transport with fake-microphone permission plus DeviceProfile capture and the repeated in-session endurance workflow.
- Chromium recorder coverage now also verifies that the `AudioWorklet` live meter activates during browser take capture and that the resulting waveform preview reports the `Worker + WASM` path.
- The DeviceProfile path now also verifies capability snapshot capture and warning-flag persistence through the API and studio snapshot.
- Firefox intentionally skips the fake-microphone recorder path and the recorder-dependent endurance path because those currently depend on Chromium launch flags rather than portable browser behavior.
- WebKit also intentionally skips the fake-microphone recorder path and the recorder-dependent endurance path, and it currently skips arrangement playback in this Windows automation environment because Playwright WebKit does not expose Web Audio there.

## Intonation Assessment

- The recent intonation critique is mostly valid and is now accepted as foundation guidance.
- One nuance matters:
  alignment and rhythm do not rely only on the 64-point preview contour. They currently use a full-sample onset envelope from canonical audio.
- The first two corrective slices are now in place:
  fresh processed tracks store a `FRAME_PITCH` artifact, analysis produces `NOTE_EVENTS`, and processed tracks can return signed-cents note feedback instead of only contour-distance scores.
- The next corrective slice is now also in place:
  runtime scoring down-weights low-confidence frames, and harmony-fit switches to a chord-aware path whenever the project provides a chord timeline.
- The QA checkpoint is stronger than before:
  the scorer is now regression-tested against vocal-like synthetic cases instead of sine-only coverage, and the current threshold interpretation is written down in `QUALITY/INTONATION_CALIBRATION_REPORT.md`.
- The synthetic-vocal checkpoint is also more repeatable than before:
  the repo now carries a first-class calibration manifest plus runner, so the same baseline can be rerun after scorer changes instead of being inferred only from hand-written test assertions.
- The larger concern is still only partially resolved:
  the studio now exposes note-level correction feedback, but fallback analysis still exists for older tracks and the quality claim is still not calibrated against real human vocal fixtures.
- We should currently describe the system as an `MVP vocal practice scorer`, not as a `human-like intonation judge`.
- The detailed evaluation and next-step quality track now live in `QUALITY/INTONATION_ANALYSIS_ASSESSMENT.md`.
- The roadmap and actionable backlog for closing this gap now live in `ROADMAP.md` Phase 9 and `BACKLOGS/PHASE9_INTONATION_BACKLOG.md`.

## Remaining Gaps Against The Target Foundation Stack

- Coarse fallback remains for tracks that do not yet have `FRAME_PITCH` and `NOTE_EVENTS` artifacts, so not every historical track is guaranteed to use the newer scoring source.
- Projects without saved chord markers still fall back to `KEY_ONLY`, and the current chord authoring flow is intentionally lightweight rather than a full chart editor or import pipeline.
- Phase 9 still lacks the real-vocal fixture set and human-rating comparison needed to claim a human-trustworthy intonation judge.
- The new calibration runner closes the repeatability gap for synthetic evidence, but it does not close the evidence gap for real singer data or human-rating alignment.
- The new human-rating workflow closes the tooling gap for future human-rater comparison, but it still does not populate the corpus or prove release-quality human agreement by itself.
- The new intake builder removes the remaining manual-manifest bottleneck, but the evidence gap is still real singer data, real raters, and reviewed threshold tuning.
- The new corpus inventory tool removes another pre-calibration bottleneck, but it still does not populate a trusted real-vocal corpus or justify closing the human-trust checklist items by itself.
- The new threshold-fit report removes the last ad hoc step in proposing difficulty bands, but it still does not count as validated human-threshold evidence until a real corpus is run through it.
- The new claim gate removes another subjective review bottleneck, but it still evaluates the current evidence rather than creating that evidence; the real-human checklist items remain open until a trusted corpus actually passes it.
- The inline browser/hardware claim-gate summary removes another small review bottleneck inside ops, but it still does not create native Safari or broad real-hardware evidence by itself.
- The new ops CSV preview/import flow removes another intake bottleneck for external QA evidence, but it still does not replace the need for actual native Safari or broad real-hardware validation runs.
- The new evidence-round scaffold removes another prep bottleneck for real-human and real-hardware collection, but it still does not create the evidence by itself; the remaining open checklist items still require actual singers, raters, and native hardware runs.
- The new `--round-root` CLI defaults remove another workflow-friction bottleneck for evidence collection, but they still do not create real singer data or native-hardware logs by themselves.
- The new evidence-round audit removes another coordination bottleneck during collection, but it still does not replace real singer audio, human raters, or native Safari / real-hardware logs.
- The new evidence-round refresh removes another manual rebuild bottleneck during collection, but it still only regenerates support artifacts from whatever evidence is already in the round.
- The new round-local environment packet and claim-gate preview remove another pre-import review bottleneck, but they still only summarize the current CSV and do not replace native Safari or broad real-hardware evidence.
- The new curated home-photo layer improves atmosphere on the entry screen, but it is intentionally limited to one non-identifying ambient image and should not become a shortcut around the broader mockup discipline.
- The new evidence-bundle workflow removes the last ad hoc step in packaging human-rating release evidence, but it still does not populate the corpus or justify closing the human-trust checklist items on its own.
- The default development path still runs on SQLite and local filesystem storage for convenience, but the default product deployment path is now documented and verified on PostgreSQL + S3-compatible object storage.
- Browser-level automation now covers the main studio smoke path, the read-only sharing journey, and arrangement export reachability across Chromium, Firefox, and WebKit, plus arrangement playback behavior across Chromium and Firefox. Recorder transport and the longer endurance path are still only verified in Chromium with a fake microphone, and WebKit playback remains unavailable in this Windows automation environment. The new capability snapshot reduces blind spots, but the larger browser-side gap is still environment coverage: real hardware-specific recording variability, permission differences, and true Safari/WebKit audio validation on native environments.
- The new ops diagnostics surface helps triage those remaining gaps, but it does not replace native Safari/WebKit runs or real hardware recording validation yet.
- The new environment report export and validation protocol make those native runs operationally easier, but the runs themselves still need to happen.
- The new environment validation packet makes release-review evidence easier to package, but it still does not replace actual native Safari or real-hardware coverage.
- The new browser compatibility release-note draft makes publishing caveats easier, but it still depends on honest underlying validation evidence rather than creating that evidence itself.
- The new browser environment claim gate removes another subjective review bottleneck, but it still evaluates stored evidence rather than creating native Safari or broad real-hardware coverage by itself.
- The new environment-validation importer removes another manual bottleneck, but it still does not count as native Safari or real-hardware evidence until those runs are actually collected.
- The alpha deployment track now has one real verified HTTPS staging environment on the chosen stack rather than only repo-side container and script readiness.
- `https://gigastudy-alpha.pages.dev` now runs against the deployed Cloud Run backend `https://gigastudy-api-alpha-ajpmdzbrga-du.a.run.app` instead of local development defaults, and the live alpha path has already passed a frontend load, backend health, project creation, guide/take upload, and analysis smoke run.
- The operator path has now also confirmed the real GCP alpha project id as `gigastudy-alpha-493208`, and Cloud Run / Cloud Build / Artifact Registry are enabled for that project.
- The repo now also has alpha-specific env templates plus deploy scripts for the chosen stack: `apps/api/.env.alpha.example`, `apps/web/.env.alpha.example`, `scripts/deploy_alpha_backend.ps1`, `scripts/migrate_alpha_database.ps1`, and `scripts/deploy_alpha_frontend.ps1`.
- The alpha path now also has a remote Cloud Run Job fallback for Neon migration, because the current operator machine times out on outbound PostgreSQL traffic to Neon even though the GCP-side stack is otherwise ready.
- The alpha path now also has a repo-owned Cloud Build config for the monorepo backend image, so Cloud Build no longer assumes a root-level Dockerfile when building `apps/api/Dockerfile`.
- The alpha deployment scripts now also convert the local dotenv-style alpha env into a temporary Cloud Run YAML env file automatically, so staging operators do not have to keep one secret file for local tools and a second one for Cloud Run.
- The manual Pages staging script now also builds the web app in Vite `alpha` mode, so `apps/web/.env.alpha` is reflected in Wrangler-based redeploys instead of silently falling back to the local default API host.
- Those staging helpers are now verified not only through repo-level dry-run command generation, but also through a real alpha migration, backend deploy, frontend redeploy, and browser smoke pass on the chosen stack.
- The manual Wrangler fallback was also exercised again from a real Windows PowerShell shell without `pwsh`, and the resulting unique Pages deployment matched the current production `https://gigastudy-alpha.pages.dev` bundle after the redeploy completed.
- The web build now also ships a top-level `_redirects` file, so Cloudflare Pages can serve client-side routes through the SPA entry instead of breaking deep links.
- The foundation now also has a dedicated operator handoff document at `OPERATIONS/ALPHA_STAGING_RUNBOOK.md`, so the remaining real-cloud steps are explicit instead of living only in chat.
- The product now has one chosen visual direction, and all five canonical screens (`Home`, `Studio`, `Arrangement`, `Shared Review`, and `Ops`) have been brought into that system closely enough to stop the visual layer from drifting screen by screen.
- The product now also has a canonical wireframe pack plus frozen mockup exports for all five screens, and the implemented UI now has a concrete target for every first-wave route instead of leaving `Ops` as the remaining visual outlier.
- The new mockup track makes the design workflow more concrete, and the currently refactored screens now explicitly target `home-v1`, `studio-v1`, `arrangement-v1`, `shared-review-v1`, and `ops-v1`. The remaining design-system gap is now upgrading the repo-local editable source into a shared Figma workflow rather than creating the first editable source from scratch.
- Filmora is now documented as an accepted secondary reference for `Studio` and `Arrangement`, specifically for panel logic:
  source rack, preview/player hierarchy, timeline rail, and contextual property inspector.
  It is explicitly not accepted as a full-product style replacement for `Quiet Studio Console`.
- The design source now also includes a dedicated Filmora-informed workspace pass:
  `DESIGN/UI_EDITABLE_SOURCE/filmora-workspace-pass-v2.html`,
  `DESIGN/UI_EDITABLE_SOURCE/filmora-workspace-pass-v2.css`,
  `DESIGN/UI_MOCKUPS/studio-v2.svg`, and
  `DESIGN/UI_MOCKUPS/arrangement-v2.svg`.
  That closes the mockup-pass planning gap.
- The design source now also includes a stricter MyEdit-informed Studio waveform-editor pass:
  `DESIGN/MYEDIT_REFERENCE_REVIEW.md`,
  `DESIGN/UI_EDITABLE_SOURCE/myedit-wave-editor-pass-v3.html`,
  `DESIGN/UI_EDITABLE_SOURCE/myedit-wave-editor-pass-v3.css`, and
  `DESIGN/UI_MOCKUPS/studio-v3-wave-editor.svg`.
  That locks the next Studio refactor target to one dominant waveform stage, one slim tool rail, one lower trim-control strip, and one obvious save action.
- The first live implementation half of that pass is now complete on the dedicated Arrangement route:
  the page has been restructured around a candidate rack, central score/player stage, and export-first inspector, and the dedicated arrangement workspace release gate now passes again in Chromium, Firefox, and WebKit.
- The dedicated Arrangement route now also behaves more like one task-led compare desk instead of one long control stack:
  `후보 고르기`, `악보 보기`, and `내보내기` modes now keep the left rail focused on core candidate-flow entry points, while detailed generation controls stay behind one optional section.
- The second live implementation half of that pass is now complete on the Studio route as well:
  the page now exposes a dedicated source rack, a clearer preview canvas, a stronger lower time rail, and a right-side inspector without bringing developer-facing copy back onto the default surface.
- The live Studio route has now also adopted the stricter `studio-v3-wave-editor` pass closely enough to behave like a single-task waveform workspace:
  one slim left rail for core entry points, one dominant waveform stage, one lower range-and-action strip, and one dedicated listening / take rail.
- The deployed Studio route now also keeps one obvious playback surface for guide / take listening:
  the preview canvas stays focused on waveform review, while actual listening is centralized in the lower time rail so the same selected-take player does not appear twice.
- The deployed Studio route now also behaves more like a task-led rehearsal workspace instead of one long stacked board:
  `녹음`, `리뷰`, and `편곡` modes now change the visible shortcut rail and de-emphasize unrelated sections, so the user sees one focused slice of work at a time.
- The Shared Review route now also gets the same workspace discipline:
  the left rail focuses on take choice and mode switching, while the frozen score canvas and result summary stay visually separate enough to read like one review session rather than another settings page.
- The Ops route now also gets the same workspace discipline:
  `문제 확인`, `환경 검증`, and `복구 처리` modes keep the default surface focused on one operator task at a time, while recent runtime incidents now read as one selected issue plus a short queue instead of one flat card list.
- The Ops runtime panel now behaves more like a triage desk than a monitoring feed:
  one selected incident shows severity, scope, and next follow-up at full width, while the remaining incidents stay in a compact queue for fast scanning.

## Recommended Next Work

1. Upgrade the repo-local editable source into a shared Figma workflow when a write-capable design workflow is available, and record the frozen version id for each implemented screen.
2. Keep the implemented `Ops` surface subordinate to the rehearsal product tone by reviewing future ops-only additions against `ops-v1` instead of letting utility styles leak back into core screens.
3. Continue Phase 9 with real singer recordings or a cents-shifted vocal corpus, collect labels through the sheet/template builder workflow, then compare scorer output against human ratings.
4. When real data becomes available again, use `QUALITY/REAL_EVIDENCE_BATCH_PLAN.md` plus the round-local `REAL_EVIDENCE_PLAN.md` and `REAL_EVIDENCE_CHECKLIST.md` files as the default one-shot collection path instead of splitting human-rating and browser-hardware prep across separate ad hoc passes.
5. Deepen the harmony authoring path only where it improves reachability further: bulk import, timeline snapping, or chord templates if real users need them.
6. Move browser hardening from missing flow coverage toward environment coverage: validate the new capability snapshot and warning flags against real hardware-specific recording variability, native Safari/WebKit audio behavior, and richer endurance runs, then feed the findings back into ops diagnostics and release notes.
7. Use `OPERATIONS/BROWSER_ENVIRONMENT_VALIDATION.md` plus downloaded ops reports as the default workflow for native browser verification rounds.
8. Use the now-verified alpha environment as the default staging baseline, then spend the next browser-quality pass on real-device gaps: native Safari/WebKit audio behavior and broader microphone variability.
9. Re-review the dedicated Studio and Arrangement routes after any further export, playback, or inspector changes so they stay aligned with `studio-v2`, `studio-v3-wave-editor`, and `arrangement-v2` instead of drifting back toward generic tool surfaces.
10. Keep the `studio-v3-wave-editor` pass as the default Studio maintenance baseline, and reject future changes that reintroduce broad dashboard stacking, duplicate playback surfaces, or non-core shortcut clutter on the left rail.
