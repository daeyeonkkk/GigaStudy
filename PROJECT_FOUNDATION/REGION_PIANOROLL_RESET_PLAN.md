# GigaStudy Region/Piano Roll Reset Plan

Date: 2026-05-02

This document freezes the salvage map before the notation implementation
is removed. The new direction is not an engraved-arrangement studio. It is a
six-track vocal arrangement and practice workspace built around:

- Region view for macro arrangement
- Piano roll for pitch/timing editing
- Waterfall practice mode for playback and singing

The reset should preserve proven infrastructure and audio/pitch assets, then
delete the notation stack instead of trying to bend it into the new
product model.

## Product Reframe

Old center:

`Studio -> TrackSlot -> extracted event -> notation document`

New center:

`Studio -> Track -> Region -> PitchEvent/AudioClip -> practice playback`

The old extracted-event object is no longer the canonical product truth or internal type name.
The bounded internal event model is `TrackPitchEvent`, and public clients
consume `ArrangementRegion`/`PitchEvent` only.

## Assets To Preserve

### Keep With Minor Changes

- Root npm workspace, Vite app shell, FastAPI app shell, Playwright wiring.
- API configuration in `apps/api/src/gigastudy_api/config.py`.
- FastAPI middleware and router composition in `main.py` and `api/router.py`.
- Health/readiness endpoints.
- Upload size, CORS, owner-token, and admin configuration concepts.
- `StudioStore` abstraction in `studio_store.py`, but the stored document shape
  must change from track-level pitch-event arrays to explicit regions.
- `AssetStorage`, `AssetRegistry`, and `StudioAssetService` concepts:
  direct upload, staged upload, asset registry, local/S3 backend, cleanup, and
  retained audio asset resolution remain valuable.
- Durable engine queue concepts in `engine_queue.py`, including claim/lease,
  local/Postgres stores, retry, and admin drain.
- Browser audio primitives:
  `audioContext.ts`, `microphoneRecorder.ts`, `wavEncoding.ts`,
  `audioUpload.ts`.
- Count-in and meter helpers, with terminology moved away from engraved notation.
- Existing direct-upload browser flow in `apps/web/src/lib/api.ts`, but endpoint
  names and response types must be replaced.
- Admin storage concepts, especially storage summaries and cleanup operations.

### Keep As Extractable Logic

- Voice extraction in `services/engine/voice.py`: keep pitch/frame/segment
  extraction math, but output should become `PitchEvent` or
  `DetectedPitchSegment`.
- MIDI/MusicXML parsing in `services/engine/symbolic.py`: keep parser logic as
  an import adapter, but convert to piano-roll events instead of notation
  truth.
- Scoring alignment and pitch/timing comparison math in
  `services/engine/scoring.py`: keep the useful calculations, then rewrite
  reports around timeline/piano-roll coordinates.
- Harmony generation search in `services/engine/harmony.py`: keep the
  deterministic constrained generator only if it emits editable region events.
- DeepSeek bounded-planning pattern in `services/llm/*`: keep the contract that
  an LLM can plan or label, but cannot author canonical event data directly.
- Candidate diagnostics concepts: confidence, range fit, timing-grid fit,
  density, movement labels, and risk tags still matter for region candidates.

### Preserve As Reference Only

- Existing E2E release-gate scenarios as behavioral memory.
- `PROJECT_FOUNDATION` documents as historical reference, but most must be
  rewritten around region/piano-roll/waterfall.
- Old scoring report fields as a reference for what practice feedback should
  preserve: pitch drift, timing drift, matched/missing/extra, and alignment
  offset.

## Assets To Remove

These should not be carried into the new core:

- VexFlow engraved notation UI:
  `EngravedScoreStrip.tsx`, `scoreEngraving.ts`, `scoreRendering.ts`, VexFlow
  alias/chunk strategy.
- Engraved notation rendering tests:
  key-signature spacing, tie glyph, measure-owned notation layout, notation overflow.
- PDF export endpoint and `pdf_export.py`.
- Engraved notation fields as core data:
  clef, key signature, spelling, accidentals, rest/tie display, notation index,
  display octave policy, notation warnings.
- Legacy registration gate as previously designed:
  `notation.py`, `notation_quality.py`, and notation diagnostics.
  The surviving code should be event normalization, event quality, and
  registration review only.
- Ensemble arrangement must behave as region-event diagnostics, not as a
  pre-registration notation quality gate. Some range/crossing checks may
  remain as piano-roll diagnostics.
- document-recognition as a first-class core path:
  user-facing document-recognition labels, document-recognition-specific job UI, and document-shaped preview
  assumptions. PDF/MusicXML/MIDI ingestion may remain as a document extraction
  adapter that emits region candidates.
  Document import can return later as a lossy event importer, not as an engraved
  notation promise.
- Current `TrackBoard` timeline-grid UI and related CSS.
- Current report detail page if it remains tied to legacy notation language.
- Current foundation roadmap/checklist language that says GigaStudy is a
  six-track arrangement studio.

## New Canonical Model

Draft server model:

```text
Studio
  studio_id
  title
  bpm
  meter
  tracks: Track[6]
  regions: Region[]
  candidates: RegionCandidate[]
  reports: PracticeReport[]

Track
  track_id / slot_id
  name
  color
  volume_percent
  muted / solo

Region
  region_id
  track_id
  start_seconds
  duration_seconds
  source_kind: recording | audio | midi | document | music | ai
  source_label
  audio_asset_path?
  pitch_events: PitchEvent[]
  diagnostics

PitchEvent
  event_id
  start_seconds
  duration_seconds
  pitch_midi | pitch_hz | percussion_label
  confidence
  velocity?
  source
  locked?

RegionCandidate
  candidate_id
  target_track_id
  source_kind
  source_label
  regions: Region[]
  confidence
  diagnostics
  status: pending | approved | rejected

PracticeReport
  report_id
  target_track_id
  reference_track_ids
  created_at
  alignment_offset_seconds
  pitch_score
  timing_score
  harmony_score?
  issues: timeline markers
```

Important rule:

`Region.start_seconds + PitchEvent.start_seconds` is the shared timeline. There
is no hidden notation grid truth.

## New UI Data Flow

### Arrange Mode

```text
GET /api/studios/{id}
-> Studio with tracks and regions
-> Region lanes render six tracks
-> user trims/moves/splits/copies regions
-> PATCH region operations
-> server persists region positions and references
```

### Piano Roll Mode

```text
double-click region
-> load region events
-> drag pitch event vertically/horizontally
-> snap to beat grid if enabled
-> PATCH event edits
-> playback uses edited events immediately
```

### Practice Mode

```text
select references + target
-> open waterfall route
-> server state is read-only during playback
-> Web Audio schedules audio clips and/or synthesized pitch events
-> waterfall visual consumes the same region/event timeline
-> recording submission creates temporary audio
-> scoring returns PracticeReport
```

## Rewrite Sequence

1. Freeze this preservation map.
2. Create a safety branch or commit before deletion.
3. Replace foundation docs with region/piano-roll/waterfall contract.
4. Replace API schema with `Region`, `PitchEvent`, `RegionCandidate`,
   `PracticeReport`.
5. Keep storage/assets/queue, but adapt repository commands to the new schema.
6. Remove VexFlow, engraved notation, PDF export, document-recognition-specific UI, and
   notation-specific tests. Preserve PDF/MusicXML/MIDI ingestion only as document
   extraction into region candidates.
7. Build minimal web shell:
   home -> studio arrange view -> piano roll panel -> practice waterfall route.
8. Reconnect microphone recording and direct upload as region creation.
9. Reconnect voice extraction as pitch-event candidate generation.
10. Reconnect scoring as timeline/pitch-event report generation.

## Side Effects

- Old studios need a compatibility importer or must be intentionally abandoned.
- Current tests will mostly fail after the schema cut; the test suite should be
  replaced in phases instead of kept red for long.
- Route contracts, TypeScript types, and API schemas all change together.
- Candidate review becomes region review, not hidden track-event registration.
- Sync becomes region/event movement. Avoid keeping both old track sync offsets
  and new region offsets as active truth.
- Export scope changes. PDF export should be replaced by project JSON,
  MIDI, or audio export later.
- LLM prompts and diagnostics need new vocabulary: region, phrase, lane, pitch
  contour, timing grid, reference tracks.

## Collision Risks

- Dual-truth risk: keeping internal `TrackPitchEvent` arrays and public
  `PitchEvent` regions as parallel canonical models would recreate the current
  complexity.
- Audio alignment risk: retained audio and pitch events must share one region
  origin. Do not add hidden per-event or per-audio offsets without exposing
  them in the region model.
- Import expectation risk: MusicXML/PDF users may expect notation rendering. The
  product must state that imports become editable piano-roll regions.
- Document extraction scope risk: retaining PDF/MusicXML/MIDI ingestion is useful,
  but any document-recognition-specific UI or document-shaped preview can drag the old notation model
  back into the core.
- Candidate approval risk: approving a candidate must insert/replace regions
  atomically, not mutate invisible track-level event lists.
- Report interpretation risk: old issue types based on answer events and notation
  measures need timeline-marker equivalents.
- Test churn risk: E2E tests should be rewritten around visible region blocks,
  pitch-event dragging, waterfall timing, upload, recording, and scoring.

## First Safe Cut

The first implementation cut should be intentionally small:

- Blank studio with six tracks.
- Region timeline with mock/fixture regions.
- Piano roll view for one region.
- Waterfall read-only playback visual from the same events.
- No VexFlow.
- No PDF export.
- No document-recognition-specific UI. Document ingestion may exist only as a region candidate
  adapter.
- No notation quality gate; only event registration quality.

Once that vertical slice exists, reconnect upload, recording, extraction, AI,
and scoring one at a time.
