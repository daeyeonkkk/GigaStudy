# Foundation Status

Date: 2026-04-09

## Sources Checked

- `GigaStudy_master_plan.md`
- `ROADMAP.md`
- `QUALITY/INTONATION_ANALYSIS_ASSESSMENT.md`
- `QUALITY/INTONATION_CALIBRATION_REPORT.md`
- `QUALITY/HUMAN_RATING_CALIBRATION_WORKFLOW.md`
- `DESIGN/UI_DESIGN_DIRECTION.md`
- `DESIGN/UI_WIREFRAMES_V1.md`
- `DESIGN/UI_MOCKUP_TRACK.md`
- `DESIGN/UI_EDITABLE_SOURCE/README.md`
- `BACKLOGS/PHASE9_INTONATION_BACKLOG.md`
- `BACKLOGS/PHASE1_BACKLOG.md`
- `GigaStudy_check_list.md`

## Checklist Discipline

- `GigaStudy_check_list.md` is now maintained as a live progress board.
- An item should be marked `[x]` only when the implementation exists and the behavior has been verified by code paths, tests, or browser release-gate runs.
- This status document remains the audit narrative that explains why the checked items are considered done and which gaps are still open on purpose.

## Foundation Hygiene

- `PROJECT_FOUNDATION` root is now restricted to canonical core docs only: plan, roadmap, checklist, audit, and the root index.
- Supporting material now lives under `BACKLOGS/`, `DESIGN/`, `QUALITY/`, and `OPERATIONS/` instead of accumulating at the root.
- New foundation files should be placed in the correct category, linked from `PROJECT_FOUNDATION/README.md`, and kept out of the root unless they are canonical source-of-truth documents.

## Confirmed Implemented

- The P0 release line is implemented end-to-end:
  project creation, guide upload, take recording/upload flow, post-recording alignment and 3-axis scoring, editable melody draft extraction, rule-based arrangement candidates, score rendering, guide playback, and MIDI/MusicXML export.
- The P1 reinforcement line is also implemented:
  difficulty presets, voice-range presets, A/B/C candidate comparison, beatbox templates, project history, share links, and admin ops monitoring.
- Admin ops monitoring now also includes browser-audio environment diagnostics from saved DeviceProfiles, so capability warnings can be reviewed by browser and OS instead of staying buried in studio-only state.
- Admin ops monitoring now also includes manual environment validation runs, so native Safari and real-hardware checks can be stored next to the diagnostics baseline instead of living only in ad hoc notes.
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

## Reinforcement Added In This Pass

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
- The repo now also has a threshold-fit report path for candidate `strict / basic / beginner` cent bands, so future human-rated corpora can produce a repeatable recommendation report instead of ad hoc threshold notes.
- The repo now also has a human-rating evidence-bundle path, so calibration summary, threshold-fit output, and claim guardrails can be exported together as release-review artifacts instead of being assembled by hand.
- Calibration manifest loading is now also UTF-8 BOM-safe, so Windows-edited human-rating corpus files do not break the runner or evidence-bundle flow.
- The foundation now also has a canonical UI design direction document, so future visual refactors can converge on one product identity instead of drifting between ops-heavy utility screens and ad hoc studio styling.
- The foundation now also has a reference-led wireframe pack for Home, Studio, Arrangement, Shared Review, and Ops, so the next UI refactor has one canonical screen set instead of relying on scattered implementation screenshots.
- The foundation now also has a first-class mockup track: editable design files are now the preferred visual source of truth, and repo-visible mockup exports are required so implementation can target concrete screens instead of only prose wireframes.
- The Home page now follows the `home-v1` mockup closely enough to act like a product-facing studio entry screen instead of an environment-validation dashboard, while still preserving the real project-creation flow and API status check.
- The Studio page now follows the `studio-v1` mockup closely enough to stop reading as stacked tools: a top utility strip, central waveform canvas, lower transport and track lane rail, right-side inspector, and anchored deep-work sections now behave like one rehearsal workspace instead of a phase-by-phase card stack.
- The Arrangement screen now exists as a dedicated `/projects/:projectId/arrangement` workspace and follows the `arrangement-v1` mockup closely enough to read as one score-first comparison and export surface instead of another subsection buried in the studio page.
- The Shared Review screen now follows the `shared-review-v1` mockup closely enough to read like a frozen review desk instead of a generic read-only detail page: selected take on the left, frozen score canvas in the center, and score summary plus note highlight on the right.
- The Ops screen now follows the `ops-v1` mockup closely enough to read like a dense release desk instead of a generic stack of admin cards: KPI strip on top, validation and recovery work areas in the middle, and diagnostics plus recent environment capture at the bottom.
- The repo now also includes seeded mockup exports for all five canonical screens under `PROJECT_FOUNDATION/DESIGN/UI_MOCKUPS/`, so the remaining visual work can anchor against visible design files inside the repo even before a shared Figma source is fully established.
- The foundation now also has an equivalent editable design source under `PROJECT_FOUNDATION/DESIGN/UI_EDITABLE_SOURCE/`, so the product no longer depends on frozen SVG exports alone when updating canonical screen mockups.
- Backend model versions now report:
  - analysis: `librosa-pyin-note-events-v4`
  - melody: `librosa-pyin-melody-v2`
  - arrangement engine: `rule-stack-v1`

## Verified Today

- Backend test suite: `uv run pytest`
- Result: `70 passed`
- Scope verified by tests includes analysis, melody, arrangements, processing, project history, studio snapshot, ops, and schema coverage.
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
  passed with coverage for consensus aggregation, CSV loading, and unknown-case validation.
- Human-rating builder CLI:
  `uv run python scripts/build_human_rating_corpus.py`
- Result:
  passed against the seeded metadata and sheet templates, emitting a final-shape calibration corpus JSON with consensus labels and rater counts.
- Threshold-fit regression:
  `uv run pytest apps/api/tests/test_threshold_fitting.py`
- Result:
  passed with coverage for tier recommendation ordering, Markdown rendering, and empty-corpus handling.
- Threshold-fit CLI:
  `uv run python scripts/fit_human_rating_thresholds.py --manifest ...`
- Result:
  passed on a named-fixture generated corpus, producing candidate `strict / basic / beginner` cent bands from human-rating labels.
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
- Result: passed, with the existing OSMD bundle-size warning still present during `vite build`.
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
- Browser release-gate smoke path: `npm run test:e2e`
- Result: `28 passed`, `5 skipped`
- Scope verified by the browser run includes cross-browser coverage for project creation, studio entry, seeded guide/take attachment, chord timeline save, post-recording analysis, note-level chord-aware feedback visibility, read-only share creation, shared viewer load, share deactivation behavior, melody draft extraction, arrangement candidate generation, and score-export artifact reachability in Chromium, Firefox, and WebKit.
- Scope now also includes the dedicated Arrangement workspace route across Chromium, Firefox, and WebKit, verifying that the score-first compare surface, export actions, and studio deep-edit handoff are reachable as their own product workspace.
- Scope now also includes the refactored Shared Review layout across Chromium, Firefox, and WebKit, verifying the selected-take rail, frozen review canvas, and explicit read-only warning language on the shared viewer.
- Arrangement playback progress plus stop/reset behavior is now verified in Chromium and Firefox.
- Ops overview export is now verified in Chromium, Firefox, and WebKit.
- Ops overview manual validation-run capture is now also verified in Chromium, Firefox, and WebKit.
- Ops overview environment-validation-packet export is now also verified in Chromium, Firefox, and WebKit.
- Ops overview browser-compatibility release-note export is now also verified in Chromium, Firefox, and WebKit.
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
- The new threshold-fit report removes the last ad hoc step in proposing difficulty bands, but it still does not count as validated human-threshold evidence until a real corpus is run through it.
- The new evidence-bundle workflow removes the last ad hoc step in packaging human-rating release evidence, but it still does not populate the corpus or justify closing the human-trust checklist items on its own.
- The default development path still runs on SQLite and local filesystem storage for convenience, but the default product deployment path is now documented and verified on PostgreSQL + S3-compatible object storage.
- Browser-level automation now covers the main studio smoke path, the read-only sharing journey, and arrangement export reachability across Chromium, Firefox, and WebKit, plus arrangement playback behavior across Chromium and Firefox. Recorder transport and the longer endurance path are still only verified in Chromium with a fake microphone, and WebKit playback remains unavailable in this Windows automation environment. The new capability snapshot reduces blind spots, but the larger browser-side gap is still environment coverage: real hardware-specific recording variability, permission differences, and true Safari/WebKit audio validation on native environments.
- The new ops diagnostics surface helps triage those remaining gaps, but it does not replace native Safari/WebKit runs or real hardware recording validation yet.
- The new environment report export and validation protocol make those native runs operationally easier, but the runs themselves still need to happen.
- The new environment validation packet makes release-review evidence easier to package, but it still does not replace actual native Safari or real-hardware coverage.
- The new browser compatibility release-note draft makes publishing caveats easier, but it still depends on honest underlying validation evidence rather than creating that evidence itself.
- The product now has one chosen visual direction, and all five canonical screens (`Home`, `Studio`, `Arrangement`, `Shared Review`, and `Ops`) have been brought into that system closely enough to stop the visual layer from drifting screen by screen.
- The product now also has a canonical wireframe pack plus frozen mockup exports for all five screens, and the implemented UI now has a concrete target for every first-wave route instead of leaving `Ops` as the remaining visual outlier.
- The new mockup track makes the design workflow more concrete, and the currently refactored screens now explicitly target `home-v1`, `studio-v1`, `arrangement-v1`, `shared-review-v1`, and `ops-v1`. The remaining design-system gap is now upgrading the repo-local editable source into a shared Figma workflow rather than creating the first editable source from scratch.

## Recommended Next Work

1. Upgrade the repo-local editable source into a shared Figma workflow when a write-capable design workflow is available, and record the frozen version id for each implemented screen.
2. Keep the implemented `Ops` surface subordinate to the rehearsal product tone by reviewing future ops-only additions against `ops-v1` instead of letting utility styles leak back into core screens.
3. Continue Phase 9 with real singer recordings or a cents-shifted vocal corpus, collect labels through the sheet/template builder workflow, then compare scorer output against human ratings.
4. Deepen the harmony authoring path only where it improves reachability further: bulk import, timeline snapping, or chord templates if real users need them.
5. Move browser hardening from missing flow coverage toward environment coverage: validate the new capability snapshot and warning flags against real hardware-specific recording variability, native Safari/WebKit audio behavior, and richer endurance runs, then feed the findings back into ops diagnostics and release notes.
6. Use `OPERATIONS/BROWSER_ENVIRONMENT_VALIDATION.md` plus downloaded ops reports as the default workflow for native browser verification rounds.
