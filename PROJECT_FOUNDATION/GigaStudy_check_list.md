# GigaStudy Live Checklist

Date: 2026-04-16
Status rule: mark `[x]` only when implementation exists and the behavior has been verified by code paths, tests, or browser release-gate runs.

## 1. Product Alignment

- [x] The team uses one MVP definition: web-based guided vocal recording, post-recording alignment and scoring, editable melody draft extraction, arrangement candidates, score view, playback, and export.
- [x] The v1 non-goals are documented clearly: no real-time final scoring, no OMR, no Web MIDI-first workflow, no generative arrangement core, no high-precision free-form chord naming promise.
- [x] The product promise is anchored on trustworthy post-recording feedback, not on real-time certainty.
- [x] The input assumption is constrained to monophonic vocal or single-part recording for MVP.
- [x] The first release cut line is defined and still drives implementation order.

## 2. Foundation Stack And Storage

- [x] Frontend foundation exists on React + TypeScript + Vite.
- [x] The full planned browser audio stack is complete as originally envisioned across AudioWorklet + Web Worker + OfflineAudioContext + WASM.
- [x] Backend foundation exists on FastAPI with a tested API surface.
- [x] The planned analysis stack is fully adopted at runtime across Basic Pitch + `librosa.pyin` + `music21` + `note-seq`.
- [x] Score rendering and playback are separated so notation is not coupled to the playback engine.
- [x] A production-ready PostgreSQL + S3-compatible storage path exists and has a repeatable smoke path, even though local development still defaults to SQLite + local filesystem.
- [x] Job state, artifact metadata, model versions, and failure reasons are stored and inspectable.

## 3. Recording Pipeline

- [x] A user can create a project and enter the studio.
- [x] A guide track can be uploaded and attached to the project.
- [x] Microphone access can be requested from the browser.
- [x] Input device selection is available in the studio.
- [x] Requested constraints for `echoCancellation`, `autoGainControl`, and `noiseSuppression` are captured.
- [x] Applied browser settings from `getSettings()` are saved.
- [x] Multiple takes can be recorded, uploaded, listed, and reselected.
- [x] Mute, solo, and volume controls exist for guide and take context.
- [x] Count-in and metronome controls exist in the browser transport.
- [x] Waveform preview is visible after recording and after reload.
- [x] A mixdown preview and save path exist.

## 4. Device Profile And Alignment

- [x] Device profiles are stored by environment characteristics, not as a loose per-user preference only.
- [x] Sample rate, channel count, latency-related settings, and related device metadata are stored.
- [x] Browser capability snapshots and normalized warning flags are stored with the device profile.
- [x] Secure-context state, permission state, recorder MIME support, and Web Audio support are inspectable.
- [x] Current browser warnings and last saved device-profile warnings are shown in the studio.
- [x] Coarse alignment exists.
- [x] Fine alignment exists.
- [x] `alignment_confidence` is computed and returned.
- [x] Low-confidence analysis states are visible to the user.

## 5. Scoring Engine

- [x] `pitch_score`, `rhythm_score`, and `harmony_fit_score` are produced and stored.
- [x] Structured feedback JSON is produced and stored.
- [x] Alignment and analysis failure reasons are stored and exposed.
- [x] Note-level signed cents feedback exists for processed tracks.
- [x] Runtime scoring uses confidence weighting from `voiced_prob` and RMS-derived evidence.
- [x] Harmony scoring distinguishes `CHORD_AWARE` from `KEY_ONLY` fallback.
- [ ] Difficulty-tier cent thresholds are fully calibrated against human rating data.

## 6. Learning UI

- [x] User-facing default UI copy is written in natural Korean product language, leaving English only for conventional technical terms and avoiding developer-facing variable names or internal engine labels on the default surface.
- [x] The studio shows waveform and contour feedback.
- [x] The studio shows note-level correction cues with sharp/flat direction.
- [x] Attack, sustain, timing, and confidence are exposed separately in the UI.
- [x] Score panel and feedback panel are separated enough for learning use.
- [x] Wrong or weak regions are visually highlighted.
- [x] Retake flow is short enough to support practice loops.

## 7. Audio-To-Melody Draft

- [x] Runtime melody extraction is fully wired through Basic Pitch as planned in the target stack.
- [x] A melody draft can be extracted from recorded audio.
- [x] Phrase split exists.
- [x] Quantization exists.
- [x] Key estimation exists.
- [x] The extracted melody draft is editable and can be exported as MIDI.

## 8. Semi-Automatic Arrangement

- [x] At least two arrangement candidates can be generated from the melody draft.
- [x] Voice-range constraints are applied.
- [x] Leap limits are applied.
- [x] Parallel motion avoidance penalties exist.
- [x] Difficulty presets exist.
- [x] Beatbox templates exist and can be enabled.
- [x] A user can compare, choose, and edit arrangement candidates.

## 9. Score, Playback, And Export

- [x] MusicXML score rendering exists.
- [x] Arrangement playback exists and is separate from the score renderer.
- [x] Part visibility, color, and solo-style focus controls exist.
- [x] Guide playback exists in the studio flow.
- [x] MIDI export exists.
- [x] MusicXML export exists.
- [x] Guide WAV export exists.
- [x] Heavy notation and arrangement workspace code is route-split so the default entry surface does not pay the full score-workspace cost upfront.

## 10. Operations And Reliability

- [x] Processing failures can be retried.
- [x] Analysis failures can be retried.
- [x] Model versions are recorded.
- [x] Upload expiry and timeout policies exist.
- [x] Failure reasons are visible in product and ops views.
- [x] Ops monitoring exists for jobs, errors, and environment diagnostics.
- [x] Ops can store structured browser and hardware validation runs.
- [x] Runtime logs now collect recent client-side errors, fetch failures, and server exceptions with request ids so UX regressions can be triaged from ops instead of only from ad hoc reproduction.

## 11. Release Gate For MVP

- [x] The project supports guide-backed project creation.
- [x] The project supports take recording and storage.
- [x] The project supports automatic alignment and 3-axis scoring.
- [x] The project supports melody extraction and arrangement candidate generation.
- [x] The project supports score view, guide playback, MIDI export, and MusicXML export.
- [x] Browser release-gate automation covers the main seeded studio path.
- [x] Product copy is now constrained so we do not oversell the current scorer as a human-level intonation judge.

## 12. Intonation Quality Gate

- [x] Preview contour and final scoring source are separated for fresh processed tracks.
- [x] Frame-level pitch artifacts are stored.
- [x] Note-event artifacts are stored.
- [x] Analysis APIs expose signed cents note feedback and quality-mode metadata.
- [x] The studio exposes note-level correction UI.
- [x] Confidence weighting exists in runtime scoring.
- [x] Chord-aware harmony scoring is reachable from the main workflow.
- [x] A calibration report documents what the scorer can and cannot claim today.
- [x] A repeatable synthetic-vocal calibration runner exists and can be rerun from a manifest.
- [x] A human-rating corpus comparison workflow exists, even though the real evidence corpus is not populated yet.
- [x] A human-rating intake template and consensus builder exist for preparing real-vocal evidence.
- [x] A repeatable external evidence-round scaffold exists so real-vocal and rater assets can be collected outside `PROJECT_FOUNDATION`.
- [x] One round-local real-evidence batch plan now exists so future real-data collection can run Phase 9 human-rating work and Phase 10 browser-hardware validation in one coordinated round instead of two separate rediscovery passes.
- [x] A real project guide/take pair can be exported into an evidence round to seed human-rating collection from actual studio data.
- [x] An exported real project case can also seed neutral note-reference files so raters can align note indices without reading the scorer's verdict text.
- [x] An exported analyzed case can also seed note-level guide/take clip WAVs so raters do not have to scrub the full take for every note judgment.
- [x] An exported analyzed case can also seed a self-contained review packet HTML so raters can open one page and work through the case.
- [x] Human-rating review packets and intake labels are Korean-first enough for local raters while still normalizing to canonical calibration values.
- [x] Human-rating CLIs can target one named evidence round directly instead of repeating per-file paths for corpus build, calibration, threshold fit, claim gate, and evidence bundle generation.
- [x] One evidence-round audit can summarize human-rating and browser-validation collection completeness before release-review prep.
- [x] One evidence-round refresh workflow can rebuild the current support artifacts in place before review.
- [x] A real-vocal corpus inventory and validation tool exists for checking audio-path integrity, WAV metadata, and rating coverage before calibration runs.
- [x] A threshold-fit report tool exists for future human-rated corpora, even though the evidence corpus is still open.
- [x] A human-rating evidence bundle workflow exists for packaging calibration, threshold-fit, and claim guardrails into release-review artifacts.
- [x] A human-rating claim gate evaluator exists for deciding whether threshold evidence is strong enough to begin checklist-closure review.
- [x] A selected take can be downloaded from the product as a Korean-first human-rating packet instead of leaving the first rater handoff as a CLI-only export step.
- [x] A selected take can now also be downloaded from the product as one combined real-evidence batch zip, so future human-rating work and browser / hardware validation can start from one handoff package instead of two separate prep paths.
- [x] A whole project can now also be downloaded from the product as one multi-take real-evidence batch zip, so later evidence collection can start from one project handoff instead of exporting each ready take separately.
- [ ] Real human vocal fixtures or a trusted human-rating corpus are part of the release-quality evidence.
- [ ] Threshold calibration has been validated against human raters strongly enough to claim a human-trustworthy intonation judge.

## 13. Browser And Hardware Variability

- [x] Browser capability differences are captured in a normalized device profile snapshot.
- [x] Warning flags are surfaced in the studio and in ops.
- [x] Environment diagnostics can be exported from ops.
- [x] A release-review environment validation packet can be exported from ops with matrix coverage, guardrails, and compatibility notes.
- [x] A browser compatibility release-note draft can be exported from ops from the current validation evidence.
- [x] A browser and hardware claim gate can be exported from ops to decide whether support-claim review should begin.
- [x] Ops overview surfaces the current browser and hardware claim-gate state inline without requiring an export step first.
- [x] An environment validation intake template and importer exist for preparing native browser and hardware evidence before it reaches ops.
- [x] The external evidence-round scaffold also seeds browser and hardware validation intake outside `PROJECT_FOUNDATION`.
- [x] Environment-validation intake CLIs can target one named evidence round directly instead of repeating CSV and preview-output paths.
- [x] One round-local browser and hardware packet plus claim-gate preview can be regenerated from an evidence-round CSV before ops import.
- [x] Ops can preview and import external environment-validation CSV evidence directly instead of relying on CLI-only intake.
- [x] Ops can download a Korean-first environment validation starter pack so testers can begin from a ready CSV and README instead of hunting for repo template paths.
- [x] A native browser and hardware validation protocol exists in `OPERATIONS/BROWSER_ENVIRONMENT_VALIDATION.md`.
- [x] Manual PASS / WARN / FAIL validation runs can be recorded from ops.
- [x] Chromium seeded release-gate coverage exists for recording, playback, export, sharing, and endurance.
- [x] Firefox seeded release-gate coverage exists for the safe browser paths.
- [x] WebKit seeded release-gate coverage exists for the safe browser paths.
- [ ] Native Safari / WebKit audio behavior has been validated on real Apple hardware and logged as release evidence.
- [ ] Real hardware microphone variability has been validated broadly enough to close the remaining environment risk.

## 14. Explicitly Not In MVP

- [x] Real-time final scoring is still outside the MVP commitment.
- [x] OMR is still outside the MVP commitment.
- [x] Web MIDI is not used as the core user flow.
- [x] High-precision free-form chord naming is not part of the MVP promise.
- [x] A generative arrangement model is not a core dependency.

## 15. Current Truth

- [x] The checklist is now treated as a live progress board, not just as a planning appendix.
- [x] `FOUNDATION_STATUS.md` is used as the audit narrative that explains why each checked area is considered done.
- [x] Remaining unchecked items are deliberate gaps, not silently deferred assumptions.
- [x] Verification commands that pass with warnings are now documented explicitly in `FOUNDATION_STATUS.md` with scope and re-review triggers instead of being treated as invisible green passes.

## 16. Visual Refactor Track

- [x] One canonical screen-spec package is locked in `DESIGN/UI_SCREEN_SPEC_PACKAGE/`.
- [x] The core product first screen is now defined as `Root Launch`, not a marketing landing page.
- [x] The package includes one single interaction source of truth in `DESIGN/UI_SCREEN_SPEC_PACKAGE/06_INTERACTION_CONNECTION_MATRIX.md`.
- [x] Legacy UI direction, reference-review, wireframe, editable-source, and old mockup-track docs have been removed from `PROJECT_FOUNDATION/DESIGN/`.
- [x] The live `/` route now follows `DESIGN/UI_SCREEN_SPEC_PACKAGE/01_ROOT_LAUNCH_SCREEN_SPEC.md` closely enough to count as aligned.
- [x] The live typography system now follows `DESIGN/UI_SCREEN_SPEC_PACKAGE/00_GLOBAL_UI_FIXED_SPEC.md` across headings, body copy, and default control chrome instead of shipping fallback system fonts or browser-default UI text.
- [x] The live Studio route now follows `DESIGN/UI_SCREEN_SPEC_PACKAGE/02_STUDIO_SCREEN_SPEC.md` closely enough to count as aligned.
- [x] The live Arrangement route now follows `DESIGN/UI_SCREEN_SPEC_PACKAGE/03_ARRANGEMENT_SCREEN_SPEC.md` closely enough to count as aligned.
- [x] The live Shared Review route now follows `DESIGN/UI_SCREEN_SPEC_PACKAGE/04_SHARED_REVIEW_SCREEN_SPEC.md` closely enough to count as aligned.
- [x] The live Ops route now follows `DESIGN/UI_SCREEN_SPEC_PACKAGE/05_OPS_SCREEN_SPEC.md` closely enough to count as aligned.
- [x] Compact mode-switch and workflow-handoff controls now match the package contract instead of reverting to tall card-like toggles.
- [x] Live workspace routes now follow the control-hierarchy contract: single-intent action consolidation, disabled-by-default prerequisite controls, collapsed low-priority tools, and no duplicate inline authoring surfaces.

## 17. Mockup Track

- [x] Repo-visible frozen mockup exports exist for `Launch`, `Studio`, `Arrangement`, `Shared Review`, and `Ops` in `DESIGN/UI_SCREEN_SPEC_PACKAGE/MOCKUPS/`.
- [x] Each canonical screen now has both a fixed spec document and a matching frozen mockup export.
- [x] The package mockups now exist as both SVG source and PNG review render.
- [x] The live routes are now re-reviewed against the package mockups rather than against deleted wireframe or legacy mockup names.
- [x] Release-gate and browser-review notes now reference `launch-desktop-v1`, `studio-desktop-v1`, `arrangement-desktop-v1`, `shared-review-desktop-v1`, and `ops-desktop-v1` instead of legacy mockup IDs.

## 18. Foundation Hygiene

- [x] `PROJECT_FOUNDATION` root now contains only canonical core documents.
- [x] Supporting docs and assets are grouped under `BACKLOGS/`, `DESIGN/`, `QUALITY/`, and `OPERATIONS/`.
- [x] The root index defines document placement rules and expected read order.
- [x] Working rules now explicitly forbid dropping scratch files, screenshots, or generated evidence into the foundation root.

## 19. Alpha Deployment Track

- [x] A low-cost alpha deployment target is documented against current official platform limits and the current repo shape.
- [x] A Cloud Run-ready backend container exists and includes both Python and Node for the Basic Pitch runtime.
- [x] Browser audio uploads can bypass the API service through direct object-storage upload URLs.
- [x] Repo-owned alpha env templates and deploy scripts exist for Cloud Run backend deployment, Neon migration, and Cloudflare Pages deployment.
- [x] A remote Cloud Run job fallback exists for Neon migration when local outbound PostgreSQL access is blocked.
- [x] The web build ships a Cloudflare Pages SPA fallback redirect file for client-side routes.
- [x] One real HTTPS staging environment has been verified end to end on the chosen alpha stack.
- [x] The deployed alpha frontend now points at the real HTTPS backend URL rather than local development defaults.
- [x] The live alpha Studio route has been browser-reviewed for mixed-content safety, export reachability, Korean text wrapping, and mobile horizontal-overflow regressions.
