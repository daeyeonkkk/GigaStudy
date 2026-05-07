# GigaStudy Operating Principles

Date: 2026-05-06

These principles are the working rules for GigaStudy while it is still a
one-person alpha product. They are strong defaults, not permanent law. Change
them when product learning shows a better path, but update the foundation in
the same change.

## Product Shape

- GigaStudy is a six-track a cappella arrangement and practice workspace.
- The product center is `Studio -> Track -> Region -> PitchEvent/AudioClip ->
  Playback/Practice/Scoring`.
- The core artifact is one shared musical timeline, not six unrelated takes.
- BPM and meter define the paper. Regions, pitch events, audio clips, and AI
  candidates are material placed on that paper.
- GigaStudy is not currently a print-grade engraved notation editor. Document,
  MIDI, MusicXML, and audio imports are valuable when they become editable
  region/piano-roll material.
- "Score-like" still matters. Even when the UI is region/piano-roll first,
  registered events must be placed by BPM, meter, measure, beat, duration,
  range, and ensemble context rather than by arbitrary visual spacing.
- If the product returns to engraved score output, reopen the foundation first
  instead of quietly rebuilding notation-specific UI paths.

## Foundation Discipline

- `PROJECT_FOUNDATION` is the source of truth.
- Before changing product behavior, engine contracts, UI flow, or tests, read
  the relevant foundation documents.
- If code and foundation disagree, either change the code to match the
  foundation or explicitly update the foundation to the better decision.
- Avoid adding roadmap, deployment, or marketing material to the foundation
  unless it directly affects the three product flows.

## Data Truth

- Public product data is `Studio.regions`, `ArrangementRegion`, and
  `PitchEvent`.
- `TrackPitchEvent` is an internal event model for extraction, registration,
  storage-shadow, generation, and scoring. It is not a legacy public adapter.
  Web product surfaces must not depend on it.
- New registered track material is persisted as explicit `ArrangementRegion`
  data. `TrackSlot.events` may remain only as an internal input, migration
  fallback, or short-lived storage shadow; it must not be the canonical
  registered arrangement after a save.
- Track material archives are inactive restore snapshots. They are not a second
  active timeline and playback, practice, scoring, candidate review, and AI
  generation must ignore them until the user explicitly restores one into
  `Studio.regions`.
- Archive storage must stay outside the base studio payload when it can grow.
  Public responses expose archive summaries only; restore loads the stored
  snapshots and writes them back into `Studio.regions`.
- Do not reintroduce old `notes` or pre-region compatibility paths unless a
  migration task explicitly requires them.
- Every playback, scoring, generation, candidate-review, and practice surface
  should consume the same region/event timeline.

## Alpha Access And Admin

- Studio entry uses a lightweight alpha password. The server stores only the
  owner-token hash derived from that password; the password itself is not part
  of the public studio payload.
- The public entry page lists active studios so testers can find them, but
  entering or deleting a password-protected studio requires the matching
  password.
- User-facing "delete" means deactivate: the studio disappears from the public
  list, but its metadata and assets remain available to admin recovery or
  cleanup.
- Admin surfaces may view active and inactive studios separately. Admin delete
  actions must distinguish deactivation, stored-file cleanup, and permanent
  metadata/assets deletion.
- Alpha admin login may configure explicit password aliases for keyboard-layout
  or IME fallback, but aliases are still server-side secrets and must not be
  inferred or exposed in public UI.

## Musical Normalization

- All input routes should converge through the same musical normalization path:
  raw source -> extracted events -> beat-grid quantization -> measure-aware
  cleanup -> range/role validation -> region registration.
- BPM and meter are fixed by the studio. Extraction may find where the
  performer entered against that grid, but it must not infer a new song tempo.
- Onsets and durations should be quantized to musically useful beat units, then
  simplified so the track reads as intentional phrases rather than frame-level
  detector noise.
- The studio can store and edit timing at 0.001-second precision. That is the
  product resolution, not the musical rhythm unit for automatic registration.
- Automatic track registration must publish regular rhythmic values derived
  from BPM and meter, such as eighth notes, sixteenth notes, and sixteenth
  rests. The shortest readable registration unit is the current meter's
  sixteenth-note subdivision. Timing cleanup must use beat-derived units, never
  arbitrary fixed seconds thresholds.
- Automatic registration policy is a server-side product contract. MIDI,
  MusicXML, PDF, voice/audio transcription, and AI-generated candidates must use
  the same policy object for rhythm grid, minimum note length, same-pitch merge
  gap, and micro-gap absorption before material becomes active regions.
- This rhythm grid is a registration/generation contract only. User sync
  editing, manual region/event editing, playback scheduling, and scoring read
  the already registered material and must preserve user-visible timing at
  studio precision unless the user explicitly asks to snap or overwrite it.
- Same-pitch event fragments that touch or overlap should be merged into one
  continuous event. Import/export articulation gaps shorter than the dynamic
  sixteenth-note unit may be absorbed during automatic registration; gaps at or
  above that unit remain empty time.
- Manual region editing is exempt from automatic same-pitch merging. If a user
  deliberately splits adjacent notes during editing, save/restore must preserve
  those fragments.
- Voice extraction may use a conservative rescue pass for short, weak, but
  stable sung contours. The rescue pass must still reject tonal clicks and room
  noise, and it must mark rescued events in diagnostics rather than hiding that
  confidence was lower than the strict path.
- Events that cross measure boundaries must be represented consistently for the
  current UI. If notation output is active, split or tie them correctly. If
  piano-roll output is active, keep the region continuous but preserve measure
  coordinates.
- Track-specific differences should come from role/range/display policy, not
  from six separate extraction rules. Soprano, alto, tenor, baritone, bass, and
  percussion must remain parts of one ensemble grid.
- The six visible slots are not the whole arrangement ontology. A track may
  later carry role metadata such as lead, pad, counterline, bass foundation, or
  percussion without changing the visible six-track workflow.
- Other registered tracks are context for registration. They can guide
  alignment, role assignment, density cleanup, harmony-risk flags, and AI
  candidate quality, but they must not silently rewrite a user's source
  material into a different melody.

## Clock, Count-In, And Timing

- Studio BPM and time signature are absolute.
- In alpha, studio BPM and meter are chosen only at studio creation. Score-file
  starts may suggest BPM/meter from MIDI/MusicXML metadata, but the user must
  confirm or edit those values before any track registration starts. After that
  approval there is no user BPM edit flow and no persisted per-measure tempo map.
- Recording analysis may estimate latency, drift, or entrance offset, but must
  not rewrite studio BPM or meter.
- The metronome toggle controls audible clicks only; the internal clock remains
  active for recording, extraction, scoring, and playback.
- Count-in is beat/pulse based, not fixed seconds. In 4/4, one-measure count-in
  should naturally land on `3 -> 2 -> 1 -> 0`.
- Track recording may choose audible reference tracks and the metronome per
  take. Registered reference tracks start on the shared scheduled timeline; the
  selected count-in still lands on the same downbeat.
- The microphone should open slightly before the downbeat so early entrances are
  captured, while backend alignment keeps the registered material on the shared
  beat grid.
- Recording metronome, playback metronome, scoring count-in, and practice
  playhead must share the same timing helpers.

## Sync

- Sync is a user-visible translation of a track/region/audio layer against the
  shared timeline.
- Sync is not a hidden second tempo system and must not move barlines.
- Cross-track operations must use a sync-resolved effective timeline: playback,
  AI generation, answer scoring, harmony scoring, and report focus.
- Avoid stacking multiple hidden offsets. If track sync, region start, and
  audio alignment coexist, calculate effective time in one clear boundary and
  document it.
- In browser playback, retained audio clips use the track sync offset as their
  clip start. Public `PitchEvent.start_seconds` is already sync-resolved and
  must not receive the track sync offset again.
- If users frequently need large sync corrections, improve automatic
  pre-registration alignment instead of relying on manual sync.
- "Shift all sync" is valid for moving an already-aligned ensemble onto the
  metronome downbeat without changing inter-track relationships.

## Registration And Import

- Track registration quality is the highest product priority.
- A user should never feel that a recording vanished into a black box. After a
  track recording stops, keep the take pending until the user chooses register
  or delete.
- Recording registration may be direct after user confirmation when the engine
  has enough confidence.
- Document, MIDI, MusicXML, audio, and AI imports may produce review candidates
  when track assignment or musical interpretation is ambiguous.
- Candidate approval is a product tool, not an excuse for weak extraction.
  Candidate cards should explain musical role, fit, risk, and overwrite impact.
- Any registration path that can overwrite an existing track must archive the
  currently active material first. The first MIDI/MusicXML/PDF seeded material
  for that slot is pinned as the original score; later recording, audio upload,
  AI generation, or import overwrites keep bounded non-pinned snapshots for
  restore.
- One failed extraction part must not block all other parts. Multi-part import
  should try every identifiable track and report per-track results.
- Studio creation upload and per-track upload are different product contracts.
  The start page exposes score files as `PDF/MIDI/MusicXML` seeding input.
  Individual track rows expose `recording file upload` for user-recorded audio
  only. Backend adapters may still support additional import paths, but
  user-facing labels must not collapse them into one vague upload action.
- Studio-start score files must not make the create-studio request perform the
  full extraction/registration synchronously. Creation saves a usable studio and
  creates a `tempo_review_required` import job. The UI must show the suggested
  BPM/meter and evidence, let the user edit them, and only queue
  PDF/MIDI/MusicXML registration after approval. The approved BPM/meter is the
  studio clock used by the import; source-file tempo must not silently override
  it. A browser/network failure after upload must not create a hidden
  half-success state that only appears after refresh. Studio creation requests
  should carry an idempotency key so retrying the same start data returns the
  existing studio rather than creating a duplicate.
- Per-track recording-file upload accepts common audio containers
  (WAV/MP3/M4A/OGG/FLAC). Non-WAV input must be decoded server-side into an
  analysis WAV before voice transcription, and the retained playback asset must
  point at a valid WAV when conversion or metronome alignment changed the
  audio bytes. The low-level voice extractor may remain WAV-only; the upload
  pipeline owns format normalization.
- Studio-start MIDI may register directly when the internal parts behave like
  singer lines after characterization. Track names, channel numbers, and MIDI
  programs are hints, not the source of truth: pitched monophonic parts should
  be ordered by register so the highest suitable line becomes soprano and the
  lowest suitable line becomes bass, while missing or duplicated middle roles
  are placed into the closest available visible slots without inventing empty
  material. Channel-10 or clearly rhythmic/special parts map to percussion.
  Review candidates are reserved for parts that still look like accompaniment,
  overly broad special-purpose material, or otherwise ambiguous non-vocal
  content after this analysis.
- Bulk approval should register every unblocked valid candidate it can. If some
  parts would overwrite existing tracks or fail registration, keep those
  candidates reviewable, report the skipped/failed tracks, and return the studio
  to a normal usable state instead of failing the whole job.
- Mixed choral audio is not guaranteed to split cleanly into six tracks. Expose
  diagnostics and candidates rather than pretending separation is perfect.

## LLM Use

- LLMs are planners and reviewers, not canonical event authors.
- The deterministic engine owns final pitch events, timing, range validation,
  density cleanup, and persistence.
- Useful LLM outputs are bounded directives: extraction policy, quantization
  grid, noise suppression, registration cleanup, ensemble risk, harmony plan,
  candidate role, and selection hints.
- LLMs may request deterministic transformations, such as coarser quantization,
  repeated-note merging, suspicious-noise removal, range-display correction, or
  candidate rejection. They should not invent unseen pitch material during
  source registration.
- For MIDI studio-start imports, an LLM may review the deterministic
  singer-role assignment only when the file remains ambiguous enough to justify
  the call. The LLM may choose existing visible slots or mark an existing part
  for candidate review, but it must not create tracks, delete events, rewrite
  pitch material, or change BPM/meter.
- LLM failure must not break the product. Every LLM path needs deterministic
  fallback behavior.
- Use low-cost LLM calls where they can change a real engine decision. Do not
  call an LLM just to summarize obvious metadata or decorate UI.
- Keep prompts aligned with the current vocabulary: region, phrase, lane,
  pitch contour, timing grid, reference tracks, candidate, and practice report.

## AI Generation

- AI generation is symbolic timeline completion, not natural vocal audio
  synthesis.
- The target track should be generated from all usable registered context
  tracks, excluding the target's own current material unless the operation is an
  explicit revision.
- Percussion generation is rhythm-section generation, not pitched vocal
  harmony. Slot 6 uses a deterministic percussion rhythm engine on the same
  BPM/meter-derived grid, with hit labels such as Kick, Snare, Clap,
  HatClosed, HatOpen, and Rim. LLMs may later suggest pattern intent, but they
  must not author percussion hit events.
- Candidates should be meaningfully different by role, such as stable blend,
  counterline, open support, upper blend, or active motion.
- The deterministic generator should search a slightly larger candidate pool
  than the UI needs, then expose the most distinct normalized candidates. If
  post-normalization candidates are similar, diagnostics should say so instead
  of pretending they are three independent musical ideas.
- Generated candidates must pass the same normalization, event-quality, range,
  and ensemble checks as imported or recorded material.
- AI generation requests should be accepted quickly as generation jobs. The UI
  should show queued/running/completed state through activity polling, and
  candidate detail should be fetched only when the review surface needs it.
- LLM harmony planning belongs inside the generation job with timeout,
  deterministic fallback, and cache opportunities; it should not hold the
  user's command request open.
- User-facing candidate information should lead with musical decision evidence,
  not raw engine internals.

## Scoring

- Scoring has two product modes:
  - Answer scoring: compare a performance against a registered target track.
  - Harmony scoring: judge a new part against selected reference tracks without
    a target answer sheet.
- Scoring is part of the Practice workflow. Studio may show report history, but
  it should not open track-row scoring controls from the assembly surface.
- A reference track can be a scoring criterion without being audible. Playback
  selection is UX support; scoring reference selection is evaluation input.
- Scoring should prefer offline alignment and clear reports over realtime
  strictness.
- Scoring takes should use direct upload when available so large microphone
  recordings do not travel as base64 JSON. Base64 is a compatibility fallback,
  not the default web path.
- Scoring analysis should run as a scoring job after the take is accepted. The
  command response should return quickly with job state, then reports appear
  after activity polling observes completion.
- Report feeds should carry summaries. Full issue/evidence detail belongs on
  the report detail endpoint and page.
- Harmony scoring should separate useful tension from true collisions. It
  should be helpful, not punishing for every non-triad color.

## Playback And Practice

- Recorded tracks should prefer retained original audio when playback source is
  audio.
- AI, MIDI, MusicXML, document, and other non-audio tracks should remain
  playable through event synthesis.
- Default event synthesis should use a voice-friendly warm guide tone: clear
  pitch center, soft attack, restrained upper harmonics, and no vocal/organ
  character that competes with the user's recorded or live voice.
- Symbolic repeated notes should produce explicit new onsets even when adjacent
  events have the same pitch. Only measure-boundary fragments that share the
  same split-event root should sustain without a new attack. Melodic synthesis
  envelopes should derive attack, decay, and release from the current
  BPM/meter-based event grid and the next same-track event gap, not from fixed
  second thresholds that blur short rhythmic repetitions.
- Admin may replace the guide tone with a custom audio file for alpha testing.
  Playback should use that sample only as an event-synthesis source and fall
  back to the built-in warm guide synth if the file is missing or unsupported.
- Selected-track playback must prepare all required audio buffers, synthesized
  instruments, and metronome scheduling before starting together.
- Retained audio buffers may be decoded into a bounded browser memory cache so
  repeated playback of the same track does not refetch and redecode unchanged
  audio. The cache key must include studio, slot, source path, and track update
  time so stale audio is not reused after registration changes.
- Single-track audio playback may be fast, but if it is part of a synchronized
  session it should wait for the rest of the session and start on the shared
  scheduled time.
- Track volume is part of live mix control. It may be saved during playback and
  should update the active gain immediately without stopping synchronized
  playback.
- Playback status messages should say what is happening: loading original
  audio, preparing guide tones, aligning synchronized start, or waiting for
  selected tracks.
- Playhead movement should be smooth and tied to the same scheduled timeline as
  audio.
- General playback may support pause/resume by stopping the active browser
  playback session, preserving the current shared-timeline position, and
  rescheduling from that position. Track recording reference playback and
  scoring reference playback do not pause; those take flows use cancel/stop so
  microphone capture and the shared downbeat stay unambiguous.
- During general playback, horizontally scrollable studio and practice
  timelines should follow the playhead and keep it close to the left side of
  the visible timeline. This is a viewport behavior only; it must not change
  event timing, sync, or playback scheduling.

## UX

- Build the actual workflow, not a landing page around it.
- The desktop-composer aesthetic is useful, but it must serve the region and
  practice workflow rather than resurrecting notation UI by habit.
- Keep major surfaces separated by user purpose:
  - Studio assembly for track registration, sync, playback, candidate review,
    and report history.
  - Region editing for precise region/event edits. Region track, start,
    duration, volume, label, and selected event pitch/start/duration should be
    adjustable by direct values as well as small musical nudges.
  - Practice for selected-reference playback, target selection, count-in,
    microphone scoring, and waterfall timing.
  - Report detail for scoring evidence and deep-links back to region editing.
- Every studio sub-page should expose the same purpose navigation, but
  non-admin copy must stay user-facing and action-oriented. Do not show
  meta labels such as internal model names, engine evidence names, "this
  screen's role" explanations, or implementation vocabulary when a plain
  musical/workflow phrase can say the same thing. Raw engine/job/candidate
  messages should be translated into product guidance or kept out of the UI.
- Every studio sub-page should keep the six visible track slots visible.
  An empty track is a real lane with no MIDI/event material, not a missing UI
  row.
- Piano-roll, studio lane, and practice waterfall event minis should read as
  thin duration bars positioned by pitch where MIDI pitch exists. Exact pitch
  name, start, and duration belong in hover/accessibility labels rather than
  permanent text inside each mini.
- Event minis must not use minimum visual sizes that imply false overlaps or
  false durations. Dense imported material should get more lane height and
  scroll space before the UI lies about the timeline.
- Event-mini width is the event duration divided by the visible shared timeline
  duration. Pitch changes are shown by vertical position, not by changing the
  bar thickness.
- Studio lanes, region piano roll, and practice waterfall use a fixed visual
  rhythm scale of 50 pixels per quarter-note beat. A 4/4 measure is therefore
  200 pixels wide, and faster BPM makes the playhead move faster on screen
  instead of shrinking the measure.
- Playback and UI previews must use the persisted event start and duration
  exactly, within studio time precision. They may not stretch short events to
  the registration rhythm unit just to make them easier to hear or see.
- Studio and region-editing lanes should not draw region cards behind event
  minis. Regions are selectable time spans, but the visible material should be
  the individual pitch bars on the shared lane.
- Region editing should use a local draft and a single explicit save for detailed
  region/event changes. Do not send a server mutation for every small pitch or
  timing adjustment. Each saved material change should keep a small bounded
  restore point scoped to that region so the user can recover from a bad edit
  without treating the whole studio as disposable. Unsaved region-editor drafts
  may survive page navigation in browser session storage, but practice/studio
  pages must keep showing the last saved product timeline until the user
  explicitly saves.
- Lightweight UI choices should stay local whenever they do not change product
  truth. Candidate target choices, overwrite checkboxes, tempo drafts, playback
  selection, recording reference selection, and live volume preview are client
  state until the user commits an approval, save, registration, scoring, or
  restore action. Track volume may update the active browser gain immediately,
  but persistence happens only on commit.
- Active extraction/import polling should use a lightweight activity endpoint
  while work is in progress and fetch the full studio only when jobs finish or
  visible counts change. Small committed settings may return minimal patches
  when the client can safely merge them into the current studio state.
- Studio/Edit/Practice pages should load view-specific studio responses. Large
  candidate regions and report issues should be lazy detail fetches instead of
  being bundled into every navigation.
- Do not merge region editing and practice waterfall previews back into the
  studio assembly page unless the foundation is reopened first.
- The home flow has two distinct starts:
  - PDF/MIDI/MusicXML and start appears only after a supported score file is
    selected.
  - Start blank asks for BPM and meter and requires no upload.
- Queue, upload, extraction, and registration states must be visible enough that
  users do not think the app froze.
- Public Studio/Edit/Practice status notices should be deterministic,
  user-facing copy. They must not expose implementation terms such as API,
  server, engine, LLM, polling, diagnostics, payload, or queue internals.
- Busy notices may show a percent only when the job reports real completed and
  total units, such as registered parts in a multi-part score import. Jobs
  without a meaningful denominator should show stage, elapsed time, and a
  conservative expected range instead of invented progress.
- Reports should appear as compact history items in the studio and open into a
  detail view.
- Admin and public studio listing can remain alpha-simple, but the code should
  not assume privacy that does not exist.

## Infrastructure And Performance

- The alpha target is small-scale and cost-aware.
- Favor pagination, direct upload, asset cleanup, and queue visibility over
  pretending a single Cloud Run lane is unlimited.
- Free-plan alpha deployment should keep Cloud Run stateless: min instances is
  `0`, max instances is `1` while R2 metadata is the active store, and no
  always-on scheduler should wake the API every few minutes just to drain work.
- R2/S3 metadata mode is a supported alpha persistence mode for new studios.
  Existing Postgres/file-store studios are not implicitly migrated into it; a
  deliberate reset or migration must choose that.
- Temporary recordings are browser-side pending takes. If the user has not
  registered or deleted one within 30 minutes, the client may discard it.
- Inactive studio metadata can remain for admin recovery, but its stored audio
  and generated assets should be cleaned after 7 days. Orphan direct uploads
  that were never registered follow the pending recording retention window.
- Non-pinned track material archives are bounded to the latest 3 snapshots per
  slot. Pinned original score material remains until an explicit admin cleanup
  or permanent studio deletion.
- Large audio payloads should prefer direct upload. The browser should not
  decode and re-encode MP3/M4A/OGG/FLAC just to submit a recording file; server
  audio normalization owns analysis WAV creation.
- Repeated playback should avoid unnecessary refetch/decode work through
  bounded caches for original audio buffers and short-lived playback-instrument
  configuration.
- `/activity` should be a true read model: read base studio job state and
  sidecar counts without loading region/candidate/report detail.
- `/activity` must not repair queue records, schedule background work, or run
  engine processing. Job recovery belongs only to explicit mutations,
  retries, creation approval, or admin maintenance actions.
- Direct upload endpoints should stream local uploads to disk/object storage
  rather than buffering the entire request body in API memory.
- Track audio and playback-instrument sample responses should expose cache
  validators such as ETag/Last-Modified plus conservative private caching.
- API and web requests should produce enough timing telemetry in development
  and server logs to identify slow routes before optimizing by guesswork.
- Local developer tools are global conveniences. Runtime engines and heavy ML
  dependencies should be pinned in project dependencies, Docker, or worker
  images when they become product requirements.
- Measure performance claims with `hyperfine`, browser tooling, or project
  tests before treating them as facts.

## Code Structure

- Split code by responsibility, not by aesthetics.
- File names should describe ownership clearly: schema, domain adapter, engine,
  command service, hook, component, or utility.
- Avoid dual truth, hidden compatibility layers, and broad orchestration files
  that know every subsystem detail.
- Keep abstractions only when they remove real duplication or isolate a changing
  boundary.
- Delete legacy paths when the foundation has replaced them and tests cover the
  new path.
- In a one-person alpha, prefer understandable, reversible code over elaborate
  enterprise patterns.

## Git And Verification

- Local changes are valuable. Do not reset, checkout, or revert unrequested
  work.
- Before pulling, inspect local status. Prefer `git pull --ff-only` when the
  branch can fast-forward.
- Prefer small, intention-revealing commits. After each coherent slice is
  implemented and its targeted checks pass, commit it instead of accumulating a
  large mixed diff. Do not create noisy micro-commits that cannot stand alone.
- Before pushing or handing off meaningful changes, run the smallest useful
  verification set. For GigaStudy this usually means:
  - `git diff --check`
  - `npm run lint:web`
  - `npm run build:web`
  - `cd apps/api; uv run pytest`
- For larger changes, stabilize locally first: implementation, foundation
  updates, tests, and verification should agree before publishing. Once stable,
  the preferred finish is to push the reviewed commits and, when the change is
  meant to be released, deploy the verified build instead of leaving a large
  finished change only on the local machine.
- Browser release gates should run against e2e-owned ports by default. Reuse
  local dev servers only when explicitly requested so tests do not validate a
  stale web/API/storage process.
- Distinguish "pushed to main" from "deployed and live bundle updated." Always
  say which happened, and do not describe a push as a deployment.
