# GigaStudy Operating Principles

Date: 2026-05-04

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
- Do not reintroduce old `notes` or pre-region compatibility paths unless a
  migration task explicitly requires them.
- Every playback, scoring, generation, candidate-review, and practice surface
  should consume the same region/event timeline.

## Musical Normalization

- All input routes should converge through the same musical normalization path:
  raw source -> extracted events -> beat-grid quantization -> measure-aware
  cleanup -> range/role validation -> region registration.
- BPM and meter are fixed by the studio. Extraction may find where the
  performer entered against that grid, but it must not infer a new song tempo.
- Onsets and durations should be quantized to musically useful beat units, then
  simplified so the track reads as intentional phrases rather than frame-level
  detector noise.
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
- Recording analysis may estimate latency, drift, or entrance offset, but must
  not rewrite studio BPM or meter.
- The metronome toggle controls audible clicks only; the internal clock remains
  active for recording, extraction, scoring, and playback.
- Count-in is beat/pulse based, not fixed seconds. In 4/4, one-measure count-in
  should naturally land on `3 -> 2 -> 1 -> 0`.
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
- One failed extraction part must not block all other parts. Multi-part import
  should try every identifiable track and report per-track results.
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
- Candidates should be meaningfully different by role, such as stable blend,
  counterline, open support, upper blend, or active motion.
- Generated candidates must pass the same normalization, event-quality, range,
  and ensemble checks as imported or recorded material.
- User-facing candidate information should lead with musical decision evidence,
  not raw engine internals.

## Scoring

- Scoring has two product modes:
  - Answer scoring: compare a performance against a registered target track.
  - Harmony scoring: judge a new part against selected reference tracks without
    a target answer sheet.
- A reference track can be a scoring criterion without being audible. Playback
  selection is UX support; scoring reference selection is evaluation input.
- Scoring should prefer offline alignment and clear reports over realtime
  strictness.
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
- Selected-track playback must prepare all required audio buffers, synthesized
  instruments, and metronome scheduling before starting together.
- Single-track audio playback may be fast, but if it is part of a synchronized
  session it should wait for the rest of the session and start on the shared
  scheduled time.
- Playback status messages should say what is happening: loading original
  audio, preparing guide tones, aligning synchronized start, or waiting for
  selected tracks.
- Playhead movement should be smooth and tied to the same scheduled timeline as
  audio.

## UX

- Build the actual workflow, not a landing page around it.
- The desktop-composer aesthetic is useful, but it must serve the region and
  practice workflow rather than resurrecting notation UI by habit.
- The home flow has two distinct starts:
  - Upload and start appears only after a supported file is selected.
  - Start blank asks for BPM and meter and requires no upload.
- Queue, upload, extraction, and registration states must be visible enough that
  users do not think the app froze.
- Reports should appear as compact history items in the studio and open into a
  detail view.
- Admin and public studio listing can remain alpha-simple, but the code should
  not assume privacy that does not exist.

## Infrastructure And Performance

- The alpha target is small-scale and cost-aware.
- Favor pagination, direct upload, asset cleanup, and queue visibility over
  pretending a single Cloud Run lane is unlimited.
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
- Distinguish "pushed to main" from "deployed and live bundle updated." Always
  say which happened, and do not describe a push as a deployment.
