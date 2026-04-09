# GigaStudy Live Checklist

Date: 2026-04-09
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
- [x] The default product storage path is production-ready PostgreSQL + S3-compatible object storage rather than SQLite + local filesystem.
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

## 10. Operations And Reliability

- [x] Processing failures can be retried.
- [x] Analysis failures can be retried.
- [x] Model versions are recorded.
- [x] Upload expiry and timeout policies exist.
- [x] Failure reasons are visible in product and ops views.
- [x] Ops monitoring exists for jobs, errors, and environment diagnostics.
- [x] Ops can store structured browser and hardware validation runs.

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
- [x] A threshold-fit report tool exists for future human-rated corpora, even though the evidence corpus is still open.
- [x] A human-rating evidence bundle workflow exists for packaging calibration, threshold-fit, and claim guardrails into release-review artifacts.
- [ ] Real human vocal fixtures or a trusted human-rating corpus are part of the release-quality evidence.
- [ ] Threshold calibration has been validated against human raters strongly enough to claim a human-trustworthy intonation judge.

## 13. Browser And Hardware Variability

- [x] Browser capability differences are captured in a normalized device profile snapshot.
- [x] Warning flags are surfaced in the studio and in ops.
- [x] Environment diagnostics can be exported from ops.
- [x] A release-review environment validation packet can be exported from ops with matrix coverage, guardrails, and compatibility notes.
- [x] A browser compatibility release-note draft can be exported from ops from the current validation evidence.
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

## 16. Visual Refactor Track

- [x] One canonical visual direction is locked in `DESIGN/UI_DESIGN_DIRECTION.md`.
- [x] A reference-led wireframe pack exists in `DESIGN/UI_WIREFRAMES_V1.md` for Home, Studio, Arrangement, Shared Review, and Ops.
- [x] The Home page implementation matches the canonical wireframe pack closely enough to stop acting like a generic utility dashboard.
- [x] The Studio page implementation matches the integrated console wireframe closely enough to stop reading as stacked tools.
- [x] The Arrangement page implementation matches the score-first wireframe closely enough to feel like one comparison and export workspace.
- [x] The Shared Review page implementation matches the frozen review wireframe closely enough to avoid edit ambiguity.
- [x] The Ops page implementation matches the utility-only wireframe closely enough to stay dense without becoming the visual default for the whole product.

## 17. Mockup Track

- [x] A canonical mockup workflow is documented in `DESIGN/UI_MOCKUP_TRACK.md`.
- [x] Repo-visible mockup exports exist for the first visual-priority screens in `DESIGN/UI_MOCKUPS/`.
- [x] A shared Figma file or equivalent editable design source exists for the canonical product mockups.
- [x] `Home`, `Studio`, and `Arrangement` each have a frozen mockup version that implementation can target directly.
- [x] `Shared Review` and `Ops` each have a frozen mockup version that implementation can target directly.
- [x] Each visually refactored screen references the mockup version it implements, rather than only the low-fidelity wireframe.

## 18. Foundation Hygiene

- [x] `PROJECT_FOUNDATION` root now contains only canonical core documents.
- [x] Supporting docs and assets are grouped under `BACKLOGS/`, `DESIGN/`, `QUALITY/`, and `OPERATIONS/`.
- [x] The root index defines document placement rules and expected read order.
- [x] Working rules now explicitly forbid dropping scratch files, screenshots, or generated evidence into the foundation root.
