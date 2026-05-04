# GigaStudy Current Architecture

Date: 2026-05-04

This is the current canonical architecture after the region/piano-roll rebuild.
GigaStudy is a six-track vocal arrangement and practice workspace, not an
engraved notation editor.

## Product Center

Canonical user-facing flow:

`Studio -> Track -> Region -> PitchEvent/AudioClip -> Playback/Practice/Scoring`

Internal engine flow:

`TrackPitchEvent` lives in `gigastudy_api.domain.track_events` as an internal
extraction, registration, storage-shadow, and scoring event type. It is not a
legacy adapter and is not exported as a public contract. Internal event records
are converted to `PitchEvent`/`ArrangementRegion` for the product UI, API
response, and submitted scoring event input. When a scoring path consumes
events that were derived from `ArrangementRegion`, `TrackPitchEvent` may carry
transient report-focus metadata for the source region/event IDs; that metadata
is excluded from persistence and remains an adapter detail.

## Runtime Shape

### Web

- `apps/web/src/pages/LaunchPage.tsx`
  Creates a blank studio or seeds one from document/music input.
- `apps/web/src/pages/StudioPage.tsx`
  Owns loaded studio state, transport state, recording state, candidate review
  state, and action status for the studio assembly surface. It is the place for
  track registration, upload/record/generate, sync, selected-track playback,
  candidate review, and report history. It does not render the piano-roll
  editor, practice waterfall, or scoring controls.
- `apps/web/src/pages/StudioEditPage.tsx`
  Dedicated region-editing surface for region selection, region structure
  actions, selected-region piano-roll editing, local draft save, and bounded
  revision restore. Report focus links land here when they carry answer
  region/event IDs.
- `apps/web/src/pages/PracticePage.tsx`
  Dedicated practice surface for selected-track playback controls, target
  selection, scoring setup/count-in, scoring capture, report feed, and the
  waterfall timing stage.
- `apps/web/src/components/studio/StudioPurposeNav.tsx`
  Shared purpose navigation for studio assembly, region editing, practice, and
  report detail surfaces. It keeps page transitions explicit and reinforces
  which work belongs on the current page.
- `apps/web/src/components/studio/StudioToolbar.tsx`
  Global transport, sync step, playback source, metronome, and selected-track
  playback controls. Playback source is now audio clips or region events, not
  notation rendering.
- `apps/web/src/components/studio/useStudioPlayback.ts` and
  `apps/web/src/components/studio/studioPlaybackHelpers.ts`
  Browser playback orchestration plus pure playback-planning helpers for
  region grouping, playable track selection, sustained event merging, and
  metronome beat coverage.
- `apps/web/src/lib/studio/instruments.ts`
  Browser event synthesis. The default melodic event voice is a warm guide
  synth tuned to sit beside human singing instead of a sampled organ or choir
  soundfont.
- `apps/web/src/components/studio/TrackBoard.tsx`
  Main six-track arrangement component. In studio mode it renders six shared
  timeline lanes with thin pitch-positioned event minis directly on the lane,
  plus track registration/playback/sync controls. Region hit areas remain
  selectable but are not visual cards. In editor mode it renders the same six
  visible lanes plus selected-region tools and piano-roll editing. Empty tracks
  remain visible as lanes with no event minis. Practice waterfall rendering
  belongs to `PracticePage`.
- `apps/web/src/components/studio/eventMiniLayout.ts`
  Shared event-mini presentation helper for filtering renderable events,
  positioning minis by pitch, and generating hover/accessibility labels with
  pitch name, start, and duration.
- `apps/web/src/components/studio/TrackBoardTimeline.tsx` and
  `apps/web/src/components/studio/TrackBoardTimelineLayout.ts`
  Waterfall practice preview rendering plus shared track-board timeline math
  and region lane positioning. TrackBoard uses these instead of owning timeline
  layout details inline.
- `apps/web/src/components/studio/TrackBoardEditor.tsx` and
  `apps/web/src/components/studio/TrackBoardEditorGrid.ts`
  Region and pitch-event editing controls for the selected arrangement region.
  The editor exposes direct numeric fields for region track/start/duration and
  selected-event pitch/start/duration, keeps detailed edits in a local draft,
  persists unsaved drafts in browser session storage across studio sub-page
  navigation, saves them through one region revision command, and reads bounded
  restore history from region diagnostics.
- `apps/web/src/lib/studio/regions.ts`
  Region utility helpers only. The web client consumes region payloads and must
  not rebuild product regions from internal storage event arrays. Timeline
  bounds can extend before 0 seconds so user-visible sync/early entrances are
  displayed rather than clamped onto the downbeat.

### API

- `apps/api/src/gigastudy_api/api/routes/studios.py`
  FastAPI studio command/query endpoints, including single-field region/event
  mutation endpoints and the batch region revision save/restore endpoints used
  by the region editor.
- `apps/api/src/gigastudy_api/services/studio_repository.py`
  Facade over storage, asset, queue, upload, candidate, generation, scoring,
  and resource services.
- `apps/api/src/gigastudy_api/api/schemas/studios.py`
  Internal storage plus public response contracts. `Studio.regions` is the
  product arrangement truth. New registration writes explicit
  `ArrangementRegion` data and clears `TrackSlot.events`; track event shadows
  are retained only as migration fallbacks for older payloads and as bounded
  internal inputs before registration. `ExtractionCandidate.events` remains a
  candidate-review shadow until approval. They accept only the current event
  shape; obsolete pre-region payloads are rejected with the rest of the obsolete
  storage shape. Studio routes return `StudioResponse`, whose tracks and
  candidates omit internal event arrays.
  `StudioResponse.regions` and `ExtractionCandidateResponse.region` expose the
  arrangement data flow. Document imports use `source_kind: "document"`;
  `"score"` is no longer accepted as a source-kind alias. `PitchEvent` carries
  timing, source, extraction method, measure position, and quality warnings so
  consumers do not need storage shadows for product behavior. Scoring reports
  expose event IDs and event counts only.
- `apps/api/src/gigastudy_api/domain/track_events.py`
  Internal pitch-event adapter for extraction, registration, persistence, and
  scoring. `TrackPitchEvent` belongs here instead of the API schema module.
- `apps/api/src/gigastudy_api/services/engine/event_normalization.py`
  Internal pitch-event preparation helpers for timing quantization, range
  metadata, spelling, and measure positions.
- `apps/api/src/gigastudy_api/services/engine/event_quality.py`
  The registration quality gate before extracted material becomes product
  regions. It replaces the old notation quality layer.
- `apps/api/src/gigastudy_api/services/engine/voice.py`
  Voice pitch extraction with Basic Pitch/librosa/local fallback, fixed-BPM
  metronome phase alignment, strict sung-segment cleanup, and a narrow rescue
  pass for short stable sung contours. Rescued material is marked in event
  warnings and diagnostics.
- `apps/api/src/gigastudy_api/services/registration_context.py`
  The single provider for region-aware registration context. Registration
  cleanup, LLM review, and ensemble gates use this instead of reading
  `TrackSlot.events` directly.
- `apps/api/src/gigastudy_api/services/engine/report_focus.py`
  Maps internal scoring events back to public region/event IDs for report
  deep-links.
- `apps/api/src/gigastudy_api/services/llm/registration_review.py`
  Optional bounded LLM review for registration cleanup; the model can only
  choose deterministic repair directives and cannot author canonical events.
- `apps/api/src/gigastudy_api/services/studio_store.py`
  Studio persistence abstraction.
- `apps/api/src/gigastudy_api/services/studio_assets.py`
  Asset path, local/S3 storage, and direct-upload lifecycle.
- `apps/api/src/gigastudy_api/services/engine_queue.py`
  Durable local/Postgres queue for extraction work.

## Data Flow

```mermaid
flowchart TD
  User["User"]
  Launch["Launch Page"]
  StudioPage["Studio Page"]
  StudioEditPage["Studio Edit Page"]
  PracticePage["Practice Page"]
  TrackBoard["TrackBoard: Region View + Piano Roll"]
  Waterfall["Waterfall Practice Stage"]
  API["FastAPI Studio API"]
  Store["StudioStore"]
  Assets["StudioAssets"]
  Queue["Engine Queue"]
  Engines["Document / Voice / MIDI Engines"]
  Candidates["Review Candidates"]
  Regions["ArrangementRegion + PitchEvent"]
  Playback["Browser Playback Engine"]
  Scoring["Scoring Pipeline"]
  Reports["Practice Reports"]

  User --> Launch
  User --> StudioPage
  User --> StudioEditPage
  User --> PracticePage
  Launch --> API
  StudioPage --> API
  StudioEditPage --> API
  PracticePage --> API
  API --> Store
  API --> Assets
  API --> Queue
  Queue --> Engines
  Engines --> Candidates
  Candidates --> API
  Store --> Regions
  API --> Regions
  Regions --> TrackBoard
  Regions --> StudioEditPage
  Regions --> Waterfall
  StudioPage --> Playback
  PracticePage --> Playback
  Playback --> TrackBoard
  Playback --> Waterfall
  PracticePage --> Scoring
  Scoring --> API
  API --> Reports
  Reports --> StudioPage
  Reports --> PracticePage
  Reports --> StudioEditPage
```

### Studio Load

1. Web calls `GET /api/studios/{studio_id}`.
2. API loads a `Studio` from `StudioStore`.
3. API builds a `StudioResponse`, stripping internal event shadows from tracks
   and candidates.
4. `StudioResponse.regions` uses persisted explicit regions and derives a
   fallback region from registered track event shadows only for older payloads
   that have not yet been saved through the explicit-region path.
5. Web passes `studio.regions` into `TrackBoard`, `StudioEditPage`, playback,
   report focus, and practice waterfall surfaces.
6. Studio assembly, region editing, playback, candidate review, practice
   waterfall, and practice scoring consume pitch events from the same region
   payload while staying on separate purpose-specific pages. All three visible
   track surfaces keep the six track slots present; empty tracks have lanes
   without event minis.
7. The region editor may keep unsaved draft edits in browser session storage
   while the user moves between studio sub-pages. Only `Save` mutates
   `Studio.regions`, so other pages continue to reflect the last saved product
   timeline; the API records the pre-save region material as a bounded restore
   point in `ArrangementRegion.diagnostics.region_editor`.

### Upload / Import

1. Web requests an upload target.
2. Browser sends the file via direct upload or inline fallback.
3. API creates an extraction job.
4. Engine queue runs document/audio/MIDI extraction.
5. Extracted material becomes reviewable candidates with candidate-region
   previews.
6. User approval registers the candidate into an explicit target-track region
   and clears the target track event shadow.
7. Reloaded studio response exposes the registered track from `Studio.regions`.

### Recording

1. Browser records audio with a count-in tied to the studio clock.
2. API stores retained audio and starts voice extraction.
3. Extracted pitch material becomes a candidate or registered track.
4. Region and pitch-event views update from the studio response.

### Scoring

1. User opens scoring from the Practice page after choosing the target part.
2. Reference tracks and metronome are selected in the scoring drawer; reference
   selection is scoring input, while audible reference playback is practice UX.
3. Browser records a take while selected audible references play on the shared
   scheduled timeline.
4. Browser submits recorded audio or `performance_events`.
5. API converts submitted performance events to the internal pitch-event adapter.
6. Scoring compares those events with registered arrangement regions, preserving
   public answer-region focus IDs through the internal adapter boundary.
7. Report issues include region/event IDs and expected/actual beat coordinates.
8. Report detail links can reopen the region editor with query parameters that
   focus the matching region and piano-roll event.

### AI Generation

1. User asks a target track to generate from registered context tracks.
2. API uses deterministic harmony generation plus optional bounded LLM planning.
3. The generator searches a slightly larger candidate pool, normalizes the
   results, selects the most distinct candidates for review, and records context
   and diversity diagnostics.
4. Generated candidates remain reviewable until approved.
5. Approved material becomes a region in the target track.

### Playback

1. Toolbar or track controls choose source mode.
2. Audio mode prefers retained audio clips when present.
3. Event mode synthesizes playable events from `ArrangementRegion.pitch_events`
   with the warm guide tone by default; sampled organ assets are not part of
   the default playback path.
4. Sync offset and volume are applied per track. Negative sync is preserved as
   a user-visible timeline translation; barlines stay on the shared grid.
5. Audio clips are scheduled from `TrackSlot.sync_offset_seconds`. Region pitch
   events are scheduled from public `PitchEvent.start_seconds`, which is already
   sync-resolved at the API boundary.
6. Playhead state drives region lane timing on the studio surface and
   waterfall visual timing on the practice surface.

## Removed Surface

- Browser VexFlow rendering.
- Engraved notation strip components.
- Notation-specific rendering helpers.
- PDF export endpoint and reportlab dependency.
- Foundation documents that described the old notation UI as canonical.

## Preserved Assets

- FastAPI/Vite application shells.
- Upload, asset, owner-token, admin, storage, direct-upload, and queue systems.
- Audio recording and playback primitives.
- Voice pitch extraction math.
- MIDI/MusicXML/PDF import adapters as extraction inputs.
- Candidate review, diagnostics, AI generation, scoring, and report history.

## Architecture Fitness Check

The rebuild now follows the intended separation:

- Product truth: `Studio.regions`, `ArrangementRegion.pitch_events`, and
  `CandidateRegion.pitch_events`.
- Product surfaces: region lanes, selected-region piano roll, waterfall
  practice, playback, and report focus consume region/event payloads only.
- Bounded adapters: document, MIDI, PDF, voice, AI generation, registration,
  and scoring can use `TrackPitchEvent` internally, then publish explicit
  regions. Saved registered material should not keep a parallel
  `TrackSlot.events` truth.
- No obsolete compatibility path: obsolete pre-region storage arrays, deprecated document source aliases,
  and old report comparison IDs/counts are rejected
  rather than translated.
- Responsibility split: schemas own public/private contracts; repository and
  command services orchestrate persistence and workflows; engines own
  extraction, normalization, registration quality, generation, and scoring;
  web consumes the public region contract.

## Remaining Boundaries

These are accepted residuals, not legacy UI anchors:

- Report focus targets persisted answer regions. Performance-take focus remains
  report-local until recorded takes become explicit persisted performance
  regions.
- PDF/MusicXML/MIDI ingestion should stay behind document-extraction naming and
  never reintroduce notation rendering as a product surface.
