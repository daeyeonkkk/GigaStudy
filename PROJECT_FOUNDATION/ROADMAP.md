# GigaStudy Roadmap

Date: 2026-04-22

This roadmap replaces the previous guide-recording, arrangement, sharing, ops,
and calibration roadmap.

Engine decisions are tracked in `ENGINE_ARCHITECTURE.md` and should be updated
with any implementation change that affects TrackNote, extraction, AI
generation, OMR, or scoring alignment.

## Current Baseline

The current implementation has a working vertical slice for:

- Six-track studio creation
- BPM and time-signature studio metadata for blank start, with upload start
  able to rely on source metadata or an internal fallback clock
- Main six-track studio shell
- TrackNote schema
- MusicXML/MXL/XML and MIDI parsing
- MusicXML/MIDI source time-signature preservation
- Local WAV single-voice extraction MVP with adaptive thresholding, noisy-frame
  rejection, stable-pitch filtering, and median-based note segmentation
- Browser MP3/M4A/OGG/FLAC audio normalization to WAV before voice extraction
- Browser microphone recording to WAV TrackNote registration
- Retained recording/audio track assets for playback while TrackNote remains
  canonical for scoring, notation, export, and AI generation
- Browser recording metronome playback and input level feedback
- Audiveris OMR job adapter
- PDF/image score upload is treated as asynchronous OMR input, not as fixture
  registration.
- Public registration endpoints reject missing upload content instead of
  creating fixture note data.
- Home-screen PDF score start queues OMR instead of seeding placeholder notes.
- Studio UI polls active OMR jobs and exposes their queued/running/review/failed
  state.
- OMR job review can register all mapped candidates into their suggested tracks
  in one operation.
- Extraction candidate queue with approve/reject registration
- Candidate target override, compact preview, and overwrite guard
- AI generation produces multiple reviewable candidates and rejects sibling
  candidates when one is approved
- Rule-based symbolic vocal harmony generation with key estimation, chord
  candidate scoring, phrase-aware cadence bias, weak-beat scale connectors,
  voice range/spacing constraints, beam-search voice leading, and
  parallel-perfect penalties
- AI vocal candidates are selected from distinct voice-leading profiles so the
  approval queue contains different register/motion/contour choices rather than
  near-duplicate top-N search outputs.
- AI generation writes multiple reviewable candidates before registration
- Rule-based symbolic percussion generation
- Ensemble playback from either retained recording audio or TrackNote synthesis
- Scoring playback honors the scoring checklist's metronome selection
- Answer-sheet scoring with offline sync alignment
- Horizontally scrollable VexFlow SVG track score engraving with fixed measure
  lines, sync-shifted note markers, and `TrackNote` as the source of truth
- Compact report feed with separate quantitative report detail pages
- Registered score PDF export from the main studio toolbar
- Lightweight alpha admin storage console for inspecting studios/assets and
  deleting whole studios, all assets for a studio, or individual stored files.
- Optional durable alpha storage: studio metadata can be stored in
  Postgres/Neon, while upload/recording/OMR assets can be stored in an
  S3-compatible bucket such as Cloudflare R2. Local filesystem storage remains
  the development fallback and the Cloud Run filesystem becomes only temporary
  engine/cache space when object storage is enabled.
- Stored assets are indexed through a registry so admin storage totals,
  per-studio file pages, cleanup actions, and alpha capacity checks can be
  handled without scanning every object path on each request.
- Per-track uploads use a direct-upload compatible flow: request an upload
  target, `PUT` the binary to the API proxy in local mode or presigned R2/S3 URL
  in object-storage mode, then finalize extraction/registration with the stored
  `asset_path`.
- Home-start uploads use the same direct-upload idea with a staged object:
  request an upload target before the studio exists, `PUT` the binary, then
  create the studio with `source_asset_path` so the API can promote the object
  into that studio's upload namespace.
- Paginated studio/admin metadata reads: studio lists return summary rows,
  studio detail loads one document, admin storage pages studios and limits
  per-studio asset details, and report/candidate payloads are split out as
  sidecar data so they do not bloat the primary studio row.
- Scoring performance audio is temporary extraction input and is deleted after
  TrackNote extraction instead of being retained as a stored asset.
- Alpha free-plan guardrails are enforced: 500 studio hard cap, 8.5 GiB stored
  asset hard cap, 15 MiB file-upload cap, and one active OMR/voice extraction
  job at a time.

## Phase 0: Foundation Reset

Goal: lock the product definition around the six-track studio.

Done when:

- The foundation documents describe only the new six-track a cappella direction.
- Legacy screen specs and mockups are removed.
- The implementation gap is explicitly acknowledged.

## Phase 1: Home Studio Creation

Goal: make the home screen create the correct studio shape.

Required:

- Project name input
- BPM input only for blank start
- Time signature input only for blank start, defaulting to 4/4
- Upload and start appears only after a source file is selected
- Start blank appears only while no source file is selected
- Score upload path
- Music upload path
- Blank six-track studio creation
- Home-screen PDF score start queues the OMR workflow instead of seeding
  placeholder notes.
- Import status and failure messaging

Cut line:

- The user can create a studio with six empty tracks.
- The user can start an upload import and see whether it registered tracks or
  failed.

## Phase 2: Six-Track Main Studio Shell

Goal: replace the old studio mental model with the six fixed tracks.

Required:

- Central six-track layout
- Track names: Soprano, Alto, Tenor, Baritone, Bass, Percussion
- Empty track state
- Registered track state
- Top global Play/Pause
- Top global Stop
- Top metronome toggle
- Metronome clicks follow the studio meter and accent each measure downbeat
- Per-track sync controls in 0.01 second steps

Cut line:

- The six tracks are the primary visible workspace.
- Stop returns to the synced 0 second point without clearing sync offsets.

## Phase 3: Track Registration

Goal: let each track be filled by user action.

Required:

- Per-track recording
- Recording metronome playback and input level feedback
- Per-track upload
- Canonical TrackNote persistence
- MusicXML/MXL/XML parser
- MIDI parser
- Symbolic parser preserves source time signature when available
- Single voice WAV extraction path
- Audiveris OMR job path for PDF/image score input
- Studio UI polls active OMR jobs until they become review candidates or fail.
- Supported format validation
- Audio/MIDI/score extraction pipeline
- Review candidate state for uncertain or user-confirmed extraction
- Approve/reject actions that register only approved candidates
- Candidate target override across the six track slots
- Explicit overwrite confirmation for candidate approval into occupied tracks
- Explicit overwrite confirmation for recording, direct upload, and generation
  into already registered tracks
- AI Generate disabled until at least one track exists
- AI Generate creates review candidates for the selected target track

Cut line:

- A user can fill any one track by at least one reliable method.
- Overwrite is explicit and predictable.

## Phase 4: AI Part Generation

Goal: make missing tracks creatable from existing tracks.

Required:

- Existing-track context selection
- Vocal part generation for tracks 1-5
- Vocal generation uses TrackNote-only symbolic output, not generated voice
  audio.
- Vocal generation preserves known context slot ids so it can avoid crossing
  and obvious SATB-style voice-leading errors.
- Percussion rhythm generation for track 6
- Meter-aware percussion downbeats for non-4/4 studios
- Clear generation status
- Generated TrackNote candidates can be approved into the target track
- Approving one candidate rejects sibling candidates from the same generation
  run

Cut line:

- With one registered track, AI generation can create a plausible second track.
- Percussion generation follows BPM and meter rather than harmony-note
  behavior.
- Natural voice audio generation is not required.

## Phase 5: Ensemble Playback And Sync

Goal: make the six-track studio usable as an ensemble desk.

Required:

- Simultaneous playback of registered tracks
- Playback source toggle between retained recording audio and synthesized score
  notes
- Audio-mode playback falls back to score synthesis for tracks without retained
  audio
- Per-track playback/pause
- Per-track stop
- Global stop
- Sync offset applied to global and per-track playback
- Stable visual timing feedback
- Measure-based horizontal VexFlow SVG score engraving per track on the studio
  time-signature grid
- Duration-aware browser notation for whole, half, quarter, eighth, sixteenth,
  and dotted values, plus note-to-note ties for long or explicitly tied notes.
- Dense note runs expand the score timeline instead of overlapping.
- Measure strips reserve inner notation padding and clamp note centers inside
  their owning measure.
- Sync changes move notes across the fixed grid without moving barlines.
- Soprano/Alto/Tenor use treble engraving, Baritone/Bass use bass engraving,
  and high/low notes rely on ledger lines instead of visual clamping.
- Key-signature marks are hidden until the score renderer can guarantee
  reliable spacing and clipping behavior.

Cut line:

- The user can align tracks by ear using 0.01 second sync changes.

## Phase 6: Scoring Session

Goal: let the user sing one target part while hearing selected references.

Required:

- Scoring enabled only for registered tracks
- Checklist with Track 1-6 and Metronome
- Start/Cancel actions
- Selected references play together
- Selected references are audible through the same audio-or-score playback
  source used by normal studio playback
- Checked metronome plays, including when no reference tracks are selected
- Microphone recording starts with the session
- Stop starts analysis
- Target track's registered TrackNotes are the answer sheet
- Selected references and metronome are playback context only
- Performance input is converted to TrackNote data

Cut line:

- The scoring flow is understandable without reading documentation.
- Scoring refuses to behave as if other voices alone define the answer.

## Phase 7: Report Feed

Goal: make analysis useful for practice.

Required:

- Pitch drift results
- Rhythm drift results
- 0.01 second sync alignment and timing references
- Detected global sync offset
- Matched, missing, and extra-note counts
- Issue rows with expected/actual note labels, timing error, and pitch error
- Compact report links appended to the bottom of the studio
- Separate full report detail page
- Reports remain associated with target track and scoring context

Cut line:

- The user can read a report and know where pitch/rhythm diverged without
  relying on LLM-written coaching text.

## Phase 7.5: Score Export

Goal: let the user export the registered six-track score.

Required:

- PDF export action from the main studio.
- Server-side PDF generation from registered TrackNote data.
- Export includes studio title, BPM, time signature, track names, staff-like
  note timelines, and measure markers.
- Empty studios cannot export misleading blank PDFs.

Cut line:

- A user with at least one registered track can download a readable PDF score.

## Phase 7.75: Admin Storage Cleanup

Goal: keep alpha storage controllable and move the API away from relying on
Cloud Run's ephemeral filesystem for durable data.

Required:

- Lightweight `/admin` login with `admin` / `대연123`.
- Admin API accepts username/password headers and keeps optional token support.
- Storage summary by studio and stored asset.
- Delete an entire studio plus its upload/job asset folders.
- Delete only stored files for a studio while keeping TrackNote/report
  metadata.
- Delete one stored file and clear track/candidate/job file references.
- Metadata repository abstraction with local JSON fallback and Postgres/Neon
  implementation.
- Asset repository abstraction with local filesystem fallback and
  S3/R2-compatible implementation.
- OMR outputs are persisted through the asset repository after successful
  extraction.
- Retained track audio uses the asset repository for playback resolution.
- Scoring performance audio is treated as temporary extraction input.
- Configurable max upload size keeps base64 JSON uploads inside the free-plan
  Cloud Run memory/request envelope.
- Per-track upload-target API and browser direct upload orchestration.
- Home-start staged upload-target API and browser orchestration.
- Admin cleanup operation for staged upload objects that were abandoned before
  studio creation/promotion.
- R2/S3 bucket CORS must allow direct browser `PUT` from the deployed Pages
  origin before the presigned path can carry production traffic without falling
  back to base64.

Cut line:

- An operator can remove accidental or heavy alpha-test data from `/admin`, and
  a deployed alpha service can preserve metadata/assets across Cloud Run
  instance restarts when Postgres/R2 environment variables are configured.

## Phase 8: Extraction Quality Hardening

Goal: improve extraction quality without changing the product model.

Required:

- Harden browser microphone recording beyond the current level meter and
  metronome loop with clearer failed-extraction recovery.
- Continue improving noisy-room voice extraction, especially for distinguishing
  sustained singing from speech, breath, keyboard clicks, and other unstable
  room noise.
- Harden browser audio decoding failure messages for codec-specific failures.
- Harden OMR review with score-image-aware visual preview and page/part
  confidence indicators.
- Add mixed-audio fallback behavior that does not overpromise SATB separation.
- Keep candidate review decision-first: musical character, confidence,
  register fit, movement, rhythm density, and contour should stay more
  prominent than raw engine method names.
- Add NWC parsing only after a reliable NWC-to-TrackNote conversion path is
  chosen.
- Verify the live Cloud Run service is using Postgres/R2 instead of local JSON
  and local files.
- Add object lifecycle/retention cleanup before production-scale recording
  tests.
- Add optional direct/temporary handling for larger scoring takes if alpha
  scoring recordings outgrow the current temporary base64 path.

## Deferred Until Needed

These should not be implemented as primary surfaces until the core flows are
stable:

- Share links
- Version history
- Mixdown export
- Ops dashboards
- Full deployment/runbook documentation inside `PROJECT_FOUNDATION`
- Standalone arrangement route
- Natural human voice audio generation
- LLM-written scoring reports
- Mixed choir SATB source separation as a promised MVP feature
- NWC upload support before a parser is connected
