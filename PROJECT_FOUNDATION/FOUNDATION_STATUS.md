# Foundation Status

Date: 2026-04-08

## Sources Checked

- `GigaStudy_master_plan.md`
- `ROADMAP.md`
- `PHASE9_INTONATION_BACKLOG.md`
- `PHASE1_BACKLOG.md`
- `GigaStudy_check_list.md`

## Confirmed Implemented

- The P0 release line is implemented end-to-end:
  project creation, guide upload, take recording/upload flow, post-recording alignment and 3-axis scoring, editable melody draft extraction, rule-based arrangement candidates, score rendering, guide playback, and MIDI/MusicXML export.
- The P1 reinforcement line is also implemented:
  difficulty presets, voice-range presets, A/B/C candidate comparison, beatbox templates, project history, share links, and admin ops monitoring.
- Device profile capture is stored with requested constraints and applied settings, and the studio snapshot includes the latest profile as the foundation docs require.
- Upload processing creates canonical audio plus waveform preview artifacts and keeps retry paths for failed processing.
- Read-only sharing is implemented as a frozen snapshot link, which matches the current safe assumption in the master plan's open decision area.

## Reinforcement Added In This Pass

- Post-recording analysis now uses `librosa.pyin` contour support plus onset-envelope alignment.
- Melody draft extraction now uses `librosa.pyin` pitch frames instead of the earlier heuristic frame estimator.
- Upload processing now stores a dedicated `FRAME_PITCH` artifact with frame-level `f0`, `voiced_prob`, and RMS data instead of relying only on the 64-point preview contour.
- Analysis responses now expose `pitch_quality_mode` and `harmony_reference_mode`, and a dedicated frame-pitch inspection API exists for processed tracks.
- Analysis now generates a `NOTE_EVENTS` artifact, note-level signed-cent feedback, and a note-event-based `pitch_score` path for processed tracks.
- Backend model versions now report:
  - analysis: `librosa-pyin-note-events-v3`
  - melody: `librosa-pyin-melody-v2`
  - arrangement engine: `rule-stack-v1`

## Verified Today

- Backend test suite: `uv run pytest`
- Result: `39 passed`
- Scope verified by tests includes analysis, melody, arrangements, processing, project history, studio snapshot, ops, and schema coverage.

## Intonation Assessment

- The recent intonation critique is mostly valid and is now accepted as foundation guidance.
- One nuance matters:
  alignment and rhythm do not rely only on the 64-point preview contour. They currently use a full-sample onset envelope from canonical audio.
- The first two corrective slices are now in place:
  fresh processed tracks store a `FRAME_PITCH` artifact, analysis produces `NOTE_EVENTS`, and processed tracks can return signed-cents note feedback instead of only contour-distance scores.
- The larger concern is still only partially resolved:
  runtime confidence weighting is still basic, harmony-fit remains key-only, and the frontend does not yet present the new note-level path as a first-class study UI.
- We should currently describe the system as an `MVP vocal practice scorer`, not as a `human-like intonation judge`.
- The detailed evaluation and next-step quality track now live in `INTONATION_ANALYSIS_ASSESSMENT.md`.
- The roadmap and actionable backlog for closing this gap now live in `ROADMAP.md` Phase 9 and `PHASE9_INTONATION_BACKLOG.md`.

## Remaining Gaps Against The Target Foundation Stack

- Confidence weighting is still only a light first-pass blend and does not yet apply the full `voiced_prob` + RMS down-weighting rules described in the foundation.
- `harmony_fit_score` is still key-only and not chord-aware.
- Coarse fallback remains for tracks that do not yet have `FRAME_PITCH` and `NOTE_EVENTS` artifacts, so not every historical track is guaranteed to use the newer scoring source.
- `Basic Pitch` is still not wired into the runtime extraction path. Melody extraction is currently improved with `librosa.pyin`, but the final planned audio-to-MIDI stack is not fully adopted yet.
- `music21` and `note-seq` are not yet part of the runtime export or transform pipeline. Arrangement and melody export are still handled by local project utilities.
- The default development path still runs on SQLite and local filesystem storage. `database_url` is configurable, but a first-class PostgreSQL plus S3-compatible production adapter is still a follow-up hardening step.
- There is no browser-level end-to-end automation yet. Current verification is strong on API and data flow coverage, but not on full UI playback/recording automation.

## Recommended Next Work

1. Continue Phase 9 with `IQ-BE-03` and `IQ-BE-04`: strengthen confidence weighting in runtime scoring and move harmony-fit to a chord-aware path.
2. Wire the remaining planned music stack pieces where they materially improve output quality: `Basic Pitch`, then `music21` or `note-seq` where export and transformation become simpler or safer.
3. Add production-grade storage and deployment hardening: PostgreSQL migration guidance, S3-compatible storage adapter, and environment docs.
4. Add at least one browser-level release-gate smoke path and note-level feedback presentation for the main studio journey.
