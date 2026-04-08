# Foundation Status

Date: 2026-04-08

## Sources Checked

- `GigaStudy_master_plan.md`
- `ROADMAP.md`
- `INTONATION_ANALYSIS_ASSESSMENT.md`
- `INTONATION_CALIBRATION_REPORT.md`
- `PHASE9_INTONATION_BACKLOG.md`
- `PHASE1_BACKLOG.md`
- `GigaStudy_check_list.md`

## Confirmed Implemented

- The P0 release line is implemented end-to-end:
  project creation, guide upload, take recording/upload flow, post-recording alignment and 3-axis scoring, editable melody draft extraction, rule-based arrangement candidates, score rendering, guide playback, and MIDI/MusicXML export.
- The P1 reinforcement line is also implemented:
  difficulty presets, voice-range presets, A/B/C candidate comparison, beatbox templates, project history, share links, and admin ops monitoring.
- Admin ops monitoring now also includes browser-audio environment diagnostics from saved DeviceProfiles, so capability warnings can be reviewed by browser and OS instead of staying buried in studio-only state.
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
- The ops overview now aggregates those DeviceProfile diagnostics into a browser matrix, warning-flag counts, and recent environment cards, which is the first foundation step from capture toward real hardware validation.
- The ops overview can now also export an environment diagnostics report JSON, and the foundation now includes a dedicated browser-environment validation protocol for native Safari and real-hardware rounds.
- Backend model versions now report:
  - analysis: `librosa-pyin-note-events-v4`
  - melody: `librosa-pyin-melody-v2`
  - arrangement engine: `rule-stack-v1`

## Verified Today

- Backend test suite: `uv run pytest`
- Result: `47 passed`
- Scope verified by tests includes analysis, melody, arrangements, processing, project history, studio snapshot, ops, and schema coverage.
- Web lint: `npm run lint:web`
- Web build: `npm run build:web`
- Result: passed, with the existing OSMD bundle-size warning still present during `vite build`.
- Browser release-gate smoke path: `npm run test:e2e`
- Result: `16 passed`, `5 skipped`
- Scope verified by the browser run includes cross-browser coverage for project creation, studio entry, seeded guide/take attachment, chord timeline save, post-recording analysis, note-level chord-aware feedback visibility, read-only share creation, shared viewer load, share deactivation behavior, melody draft extraction, arrangement candidate generation, and score-export artifact reachability in Chromium, Firefox, and WebKit.
- Arrangement playback progress plus stop/reset behavior is now verified in Chromium and Firefox.
- Ops overview export is now verified in Chromium, Firefox, and WebKit.
- Chromium additionally covers the browser recorder transport with fake-microphone permission plus DeviceProfile capture and the repeated in-session endurance workflow.
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
  the scorer is now regression-tested against vocal-like synthetic cases instead of sine-only coverage, and the current threshold interpretation is written down in `INTONATION_CALIBRATION_REPORT.md`.
- The larger concern is still only partially resolved:
  the studio now exposes note-level correction feedback, but fallback analysis still exists for older tracks and the quality claim is still not calibrated against real human vocal fixtures.
- We should currently describe the system as an `MVP vocal practice scorer`, not as a `human-like intonation judge`.
- The detailed evaluation and next-step quality track now live in `INTONATION_ANALYSIS_ASSESSMENT.md`.
- The roadmap and actionable backlog for closing this gap now live in `ROADMAP.md` Phase 9 and `PHASE9_INTONATION_BACKLOG.md`.

## Remaining Gaps Against The Target Foundation Stack

- Coarse fallback remains for tracks that do not yet have `FRAME_PITCH` and `NOTE_EVENTS` artifacts, so not every historical track is guaranteed to use the newer scoring source.
- Projects without saved chord markers still fall back to `KEY_ONLY`, and the current chord authoring flow is intentionally lightweight rather than a full chart editor or import pipeline.
- Phase 9 still lacks the real-vocal fixture set and human-rating comparison needed to claim a human-trustworthy intonation judge.
- `Basic Pitch` is still not wired into the runtime extraction path. Melody extraction is currently improved with `librosa.pyin`, but the final planned audio-to-MIDI stack is not fully adopted yet.
- `music21` and `note-seq` are not yet part of the runtime export or transform pipeline. Arrangement and melody export are still handled by local project utilities.
- The default development path still runs on SQLite and local filesystem storage. `database_url` is configurable, but a first-class PostgreSQL plus S3-compatible production adapter is still a follow-up hardening step.
- Browser-level automation now covers the main studio smoke path, the read-only sharing journey, and arrangement export reachability across Chromium, Firefox, and WebKit, plus arrangement playback behavior across Chromium and Firefox. Recorder transport and the longer endurance path are still only verified in Chromium with a fake microphone, and WebKit playback remains unavailable in this Windows automation environment. The new capability snapshot reduces blind spots, but the larger browser-side gap is still environment coverage: real hardware-specific recording variability, permission differences, and true Safari/WebKit audio validation on native environments.
- The new ops diagnostics surface helps triage those remaining gaps, but it does not replace native Safari/WebKit runs or real hardware recording validation yet.
- The new environment report export and validation protocol make those native runs operationally easier, but the runs themselves still need to happen.

## Recommended Next Work

1. Continue Phase 9 with real singer recordings or a cents-shifted vocal corpus, then compare scorer output against human ratings.
2. Deepen the harmony authoring path only where it improves reachability further: bulk import, timeline snapping, or chord templates if real users need them.
3. Wire the remaining planned music stack pieces where they materially improve output quality: `Basic Pitch`, then `music21` or `note-seq` where export and transformation become simpler or safer.
4. Add production-grade storage and deployment hardening: PostgreSQL migration guidance, S3-compatible storage adapter, and environment docs.
5. Move browser hardening from missing flow coverage toward environment coverage: validate the new capability snapshot and warning flags against real hardware-specific recording variability, native Safari/WebKit audio behavior, and richer endurance runs, then feed the findings back into ops diagnostics and release notes.
6. Use `BROWSER_ENVIRONMENT_VALIDATION.md` plus downloaded ops reports as the default workflow for native browser verification rounds.
