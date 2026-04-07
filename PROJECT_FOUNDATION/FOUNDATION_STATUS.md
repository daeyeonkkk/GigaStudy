# Foundation Status

Date: 2026-04-07

## Sources Checked

- `GigaStudy_master_plan.md`
- `ROADMAP.md`
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
- Backend model versions now report:
  - analysis: `librosa-pyin-alignment-v2`
  - melody: `librosa-pyin-melody-v2`
  - arrangement engine: `rule-stack-v1`

## Verified Today

- Backend test suite: `uv run pytest`
- Result: `36 passed`
- Scope verified by tests includes analysis, melody, arrangements, processing, project history, studio snapshot, ops, and schema coverage.

## Remaining Gaps Against The Target Foundation Stack

- `Basic Pitch` is still not wired into the runtime extraction path. Melody extraction is currently improved with `librosa.pyin`, but the final planned audio-to-MIDI stack is not fully adopted yet.
- `music21` and `note-seq` are not yet part of the runtime export or transform pipeline. Arrangement and melody export are still handled by local project utilities.
- The default development path still runs on SQLite and local filesystem storage. `database_url` is configurable, but a first-class PostgreSQL plus S3-compatible production adapter is still a follow-up hardening step.
- There is no browser-level end-to-end automation yet. Current verification is strong on API and data flow coverage, but not on full UI playback/recording automation.

## Recommended Next Work

1. Wire the remaining planned music stack pieces where they materially improve output quality: `Basic Pitch`, then `music21` or `note-seq` where export and transformation become simpler or safer.
2. Add production-grade storage and deployment hardening: PostgreSQL migration guidance, S3-compatible storage adapter, and environment docs.
3. Add at least one release-gate smoke path that exercises the main studio journey from project creation to share link generation.
