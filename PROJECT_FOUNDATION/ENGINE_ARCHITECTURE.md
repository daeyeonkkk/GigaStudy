# GigaStudy Engine Architecture

Date: 2026-04-23

This document is the canonical engine contract for the current six-track
GigaStudy foundation.

## Core Engine Rule

GigaStudy stores and compares symbolic pitch/rhythm data, not generated human
voice audio.

The canonical unit is `TrackNote`.

The engine may ingest voice, MIDI, MusicXML, score images, or generated parts,
but each successful path must end by producing `TrackNote` objects for one or
more of the six fixed track slots.

Recorded or uploaded voice audio may be retained as a track playback asset, but
it is not the scoring or harmony truth source. The persisted `TrackNote` list
remains canonical for comparison, generation, notation, and export.

The product model is one six-track score. Each studio starts from a BPM/meter
clock and the user fills Soprano, Alto, Tenor, Baritone, Bass, and Percussion
as score tracks. Recording is one way to add material to that score; it is not a
free-tempo waveform timeline.

## Persistence And Asset Storage Contract

Studio metadata and stored binary assets are separate responsibilities.

- Studio metadata contains normalized TrackNote data, jobs, track status,
  source labels, and relative asset references.
- Large append-heavy metadata, especially scoring reports and extraction or AI
  candidates, is sidecar data. It is joined back into the API `Studio` response
  for compatibility, but it must not force every list/admin request to read or
  rewrite the full studio document.
- Stored assets contain upload files, retained recording/audio playback files,
  and generated OMR output files.
- Stored assets must also be tracked in an asset registry keyed by relative
  object path. The registry records studio id, kind, filename, byte size,
  update time, and deletion state so admin summary, storage caps, and cleanup
  operations do not need to list the entire bucket for every request.
- Local JSON and local filesystem storage are development fallbacks only.
- In the deployed alpha path, `GIGASTUDY_API_DATABASE_URL` should point metadata
  at Postgres/Neon, and `GIGASTUDY_API_STORAGE_BACKEND=s3` should point assets
  at an S3-compatible object store such as Cloudflare R2.
- Cloud Run local filesystem paths are allowed only as temporary parser,
  transcription, OMR, or object-cache paths. They must not be treated as the
  durable source of truth because Cloud Run instance files are ephemeral and
  memory-backed.
- Asset references stored in tracks, candidates, and OMR jobs should be
  relative storage keys such as `uploads/{studio_id}/{slot_id}/{file}` or
  `jobs/{studio_id}/{job_id}/{file}`.
- Per-track browser uploads should prefer the direct upload contract when the
  browser already has a concrete studio id and track slot:
  `POST /api/studios/{studio_id}/tracks/{slot_id}/upload-target`,
  binary `PUT` to the returned URL, then
  `POST /api/studios/{studio_id}/tracks/{slot_id}/upload` with `asset_path`.
  The final upload endpoint remains the only step that registers TrackNotes or
  review candidates. In local development the returned URL may be an API proxy
  endpoint; in S3/R2 deployments it should be a presigned object-store URL.
- Home-start uploads use a staged variant because the studio id does not exist
  yet: `POST /api/studios/upload-target`, binary `PUT`, then
  `POST /api/studios` with `source_asset_path`. The API must promote the staged
  object into the created studio's upload namespace before parsing, OMR, or
  voice extraction. Staged objects are not durable studio assets until that
  promotion succeeds. Expired staged objects are automatically cleaned by the
  API upload-target path according to `GIGASTUDY_API_STAGED_UPLOAD_RETENTION_SECONDS`
  and `GIGASTUDY_API_LIFECYCLE_CLEANUP_INTERVAL_SECONDS`. Operators can also
  delete only expired staged objects through `DELETE /api/admin/expired-staged-assets`
  or delete all abandoned staged objects through `DELETE /api/admin/staged-assets`.
- Object-store direct upload requires bucket CORS that permits the deployed web
  origin to `PUT` with the returned headers, especially `Content-Type`. The live
  alpha bucket policy is tracked in `ops/r2-cors.gigastudy-alpha.json`.
- Studio list endpoints must return summary rows with pagination. Studio detail
  endpoints must load only the requested studio id. Admin storage summaries
  must page studio rows and limit per-studio asset details so 1,000+ alpha
  studios do not require a full metadata scan on every request.
- Free-plan alpha limits are part of the engine contract: 300 studios is the
  soft warning line, 500 studios is the hard creation cap, 7 GiB of registered
  assets is the warning line, 8.5 GiB is the hard asset cap, individual base64
  uploads are capped at 15 MiB, and OMR/voice extraction is claimed through a
  durable engine queue while still limited to one active local engine lane by
  default.
- Studio access is scoped by a per-browser owner token by default. Studio
  create/list/detail/action APIs require `X-GigaStudy-Owner-Token` when
  `GIGASTUDY_API_STUDIO_ACCESS_POLICY=owner`; the server stores only a SHA-256
  hash of that token on the studio document and filters summary lists by the
  hash. This is alpha-grade privacy, not full user accounts, but it removes the
  previous public all-studio list/detail behavior. Explicit `public` policy is
  reserved for tests and local demos.
- Engine jobs are durable records, not only in-process Cloud Run background
  tasks. The queue uses Postgres when `GIGASTUDY_API_DATABASE_URL` is set and a
  local JSON queue as the development fallback. Queue records store job type,
  studio id, track slot, input asset key, payload, attempt count, max attempts,
  lock lease, and terminal status. Studio `jobs` expose the user-facing state.
  Studio `jobs` also persist replay-critical options such as OMR part parsing,
  review-before-register, overwrite allowance, and audio MIME type. A studio
  reload can reschedule queued or expired running jobs, and failed jobs can be
  retried from the UI while the original input asset is still retained, even if
  the queue record has to be rebuilt from studio metadata.
- The durable queue can also be drained through the admin/scheduler endpoint
  `POST /api/admin/engine/drain?max_jobs=N`. This endpoint uses the same queue
  claim/lease rules and the configured one-active-lane limit. It is the
  scheduler-compatible wake-up surface for Cloud Run. The live alpha deployment
  wires this to Cloud Scheduler job `gigastudy-engine-drain`, running every 5
  minutes in `Asia/Seoul` with a 300 second attempt deadline.
- Track audio playback resolves retained audio through the asset storage layer.
  In object-storage mode, a missing local file is downloaded into the local
  cache before `FileResponse` serves it.
- Scoring performance audio is not retained by default. It is temporary input
  for extraction and is deleted after TrackNote conversion.

## Canonical TrackNote Data

Each note event should carry:

- Stable note id
- `pitch_midi`
- `pitch_hz`
- Human-readable label, such as `C5` or `Kick`
- `onset_seconds`
- `duration_seconds`
- `beat`
- `duration_beats`
- Optional measure and beat-in-measure position
- Confidence
- Source, such as `musicxml`, `midi`, `voice`, `omr`, `ai`, `recording`, or
  `audio`
- Extraction method
- Rest/tie/staff/voice metadata when available
- Optional notation metadata, such as spelled pitch, accidental, clef, octave
  display policy, key signature, quantization grid, and warning flags

## Tempo And Meter Contract

`bpm` defines the seconds-per-quarter-beat conversion used for playback,
recording transcription, sync offsets, and scoring timing:

- `seconds_per_beat = 60 / bpm`
- `onset_seconds = (beat - 1) * seconds_per_beat` when a source does not carry
  explicit seconds
- `duration_seconds = duration_beats * seconds_per_beat` when a source does not
  carry explicit seconds

The studio time signature defines the measure grid:

- `time_signature_numerator`
- `time_signature_denominator`
- `quarter_beats_per_measure = numerator * (4 / denominator)`

Blank studio creation requires user-entered BPM and meter. Upload-start creation
does not require BPM or meter in the UI; the engine should preserve source
metadata when available and otherwise use an internal fallback BPM/meter only so
TrackNote timing can be normalized.

MusicXML and MIDI import should preserve the source time signature when present.
Voice extraction and rule-based AI generation inherit the studio time signature.
Measure numbers and beat-in-measure positions are derived from the same meter
contract, while `TrackNote.beat` remains the canonical timeline coordinate.
For the current MVP, imported MIDI tempo does not replace the studio BPM;
imported MIDI notes preserve beat positions and are normalized to studio BPM for
`onset_seconds` and `duration_seconds` so playback and scoring share one clock.

Voice extraction must not re-estimate or rewrite the studio BPM. Human timing
drift, device latency, and loose entrances are handled as sync offset and
beat-grid quantization problems. The BPM/meter grid is the paper; extracted
notes are fitted onto it.

Final track registration must pass through the shared notation registration
quality gate in `services/engine/notation_quality.py`. This applies to direct
registration, multi-track import application, extraction candidate approval,
bulk OMR approval, and AI candidate approval. Voice/audio/AI material is
rewritten onto the studio BPM/meter grid, noise-like micro-events are filtered,
dense voice measures are simplified into readable beat cells, and all notes
receive track display metadata before they become registered track content.
Symbolic score inputs preserve trusted source rhythm but still receive repaired
measure metadata, clef/key/spelling policy, and measure-boundary splitting.
When the target studio already has registered sibling tracks, final
registration may compare voice-like extracted material against those sibling
track beat positions and apply only a small deterministic whole-track beat
offset correction. This corrects capture/extraction latency that would make a
new track slightly early or late on the shared score grid. The correction must
not move barlines, change BPM, or force symbolic MusicXML/MIDI syncopation onto
another track's rhythm. Explicit symbolic score timing remains authoritative
unless later product policy adds a user-visible import repair mode.

After the single-track notation gate, registration must run an ensemble
arrangement gate against the full proposed six-track score context. Single
track approval compares the proposed track against already registered sibling
tracks. Multi-track import or bulk OMR approval must prepare all proposed parts
first, then validate each target against both existing registered tracks and
the other proposed tracks before any of them are committed. This prevents the
first imported part from being registered blindly while later parts receive
better context.

The ensemble gate validates whether the proposed track sits coherently inside
the six-track a cappella score: vocal range, voice crossing, adjacent voice
spacing, parallel perfect interval motion, over-thin chord coverage, singability
leaps, suspicious structural doubled leading tones, and bass foundation risks
are diagnosed before the notes are committed. The result is stored under
track/candidate registration diagnostics and target notes receive ensemble
warning flags when a concrete note causes the issue.

The gate remains conservative, but it is no longer purely passive for clear
extractable mistakes. For voice/audio/AI material, it may apply a bounded
contextual octave repair when a note obviously belongs in the target voice but
has been extracted or generated in the wrong octave. This repair preserves
pitch class, rhythm, measure ownership, ids, BPM, barlines, and source audio;
it does not compose new harmony. Trusted symbolic MusicXML/MIDI/OMR score
material is preserved and receives diagnostics only unless a future explicit
import-repair mode is added. The gate is still non-blocking in alpha because
contemporary a cappella may intentionally use unisons, open spacing,
counterpoint, syncopation, or dissonance.

When enabled, the LLM notation layer sits before final registration as a bounded
registration planner/conductor, not as a TrackNote author. The pipeline is:
source-specific extraction -> TrackNote candidates -> deterministic notation
quality first pass -> LLM registration-plan instruction -> deterministic repair
application -> ensemble validation -> track registration. The LLM receives the
target track summaries, deterministic candidate options, diagnostics, and any
already registered sibling-track summaries before the target is committed. It may
flag score readability issues such as excessive density, unnatural
micro-fragments, suspicious ties, unstable voice noise, or accidental clutter,
and it may use sibling-track context to choose cleanup direction, key spelling,
octave/range caution, and ensemble readability risk. It may only return bounded
repair directives, including `0.25` or `0.5` beat quantization, same-pitch
sustain merging, dense-measure simplification, unstable-note suppression,
isolated artifact removal, pitch-blip collapse, short-note-cluster collapse,
phrase/tail gap bridging, and preferred key signature. BPM, meter, final note
writing, pitch/rhythm validation, and all TrackNote mutations remain
deterministic engine responsibilities. If the LLM is disabled, times out,
returns invalid JSON, or lacks enough confidence, the pre-LLM deterministic
registration result is preserved.

When enabled, the LLM ensemble reviewer runs after the deterministic ensemble
arrangement gate and before final commit. It receives compact summaries of the
target track, registered sibling tracks, other parts proposed in the same
multi-track import or OMR approval batch, and vertical beat snapshots. Its job
is to judge whether the target will read as one practical part inside the
six-track a cappella score. It may request only the same bounded notation
repair directives as the single-track reviewer. It must not author notes,
compose replacement harmony, move barlines, change BPM/meter, or override
trusted symbolic source rhythm. The deterministic engine still applies,
validates, and re-runs the ensemble gate before registration.

Track rendering, playback, AI generation, and scoring must consume this schema
rather than inventing separate note shapes.

## Voice-To-Score Normalization Contract

Voice-derived notation must pass through a musical normalization layer before a
track is considered registered or rendered as a score. The goal is not merely to
detect pitch frames; the goal is to create a readable track on the fixed studio
score.

The required pipeline is:

1. Capture or load a single-track voice/audio source.
2. Estimate stable voiced pitch frames and reject noise, breath, speech-like
   unstable material, clicks, and non-singing room artifacts.
3. Group frames into raw pitch segments.
4. Convert segment onset and duration to the immutable studio BPM/meter grid.
5. Quantize beat positions and durations with track-consistent rules.
6. Split or tie notes only at real measure/rhythm boundaries.
7. Choose pitch spelling, key signature, clef, and display octave policy.
8. Validate measure ownership, range fit, density, and confidence before
   registration or candidate review.

Voice-to-score output must obey these rules:

- Measure boundaries are derived only from studio BPM and time signature.
- A note belongs to one measure or is split into tied display segments across
  measures; it must not visually leak beyond its owning measure.
- Short noise fragments and unstable pitch changes should be removed or merged,
  not written as dense microscopic notes.
- Quantization must be consistent across tracks. Track differences come from
  range, clef, and display policy, not separate timing rules.
- Sync offset is a playback/display layer translation for note/audio layers. It
  never rewrites the stored `TrackNote.beat`, measure grid, or BPM.
- Key signature and enharmonic spelling should reduce accidental clutter and
  represent the local tonal center. Key signatures are not a pitch-correction
  mechanism and do not change stored MIDI pitch.
- Staff range problems are solved with clef, octave display policy, and ledger
  lines. The renderer must not clamp pitch into the staff or silently transpose
  stored notes just to make them look tidy.
- If a voice-derived take cannot be turned into a readable score under these
  rules, the engine should create a review candidate with warnings or fail
  recoverably rather than registering misleading notation.

Browser score display engraves the same `TrackNote` data into VexFlow SVG
notation. Timing helpers may prepare measure/sync layout metadata, but the
visible noteheads, stems, beams, dots, ledger lines, accidentals, and ties must
be produced by the engraving layer rather than CSS pseudo-elements. Display
ties are allowed only when the renderer can connect two concrete notes: either
measure-split segments of the same stored `TrackNote`, or adjacent same-pitch
notes whose timing and `is_tied` metadata indicate a true continuation.
Short rhythmic gaps must remain in the engraving timeline as hidden spacer
rests instead of being collapsed; this preserves beat spacing while avoiding
visual clutter from noisy micro-rests. Overlapping monophonic notes are trimmed
or confidence-filtered instead of shifted forward, so the renderer does not
invent extra timing movement. Auto-beams are conservative: they are flat,
measure-local, broken by rests/non-beamable values, and disabled for dense or
low-confidence voice measures that would otherwise produce misleading beam
forests. Duration decomposition should prefer real dotted and double-dotted
durations before splitting one note into tied fragments, so ties remain reserved
for measure crossings or true continuation.

Voice-like registration must also run a readability polish after pitch-frame
normalization. The engine should collapse short neighbor-tone blips when they
look like vibrato, attack scoop, or tracker jitter between two same-pitch
segments. Adjacent same-pitch fragments with only a tiny gap should be treated
as one sustained sung tone when that produces a more natural score. The engine
should remove short, low-confidence notes that are isolated from surrounding
sung material, because those are usually room noise, breath, clicks, or pitch
tracker artifacts rather than intentional melody. Tiny detector dropouts
between confident adjacent sung notes should be bridged into the previous note
duration when the gap is below the phrase-gap threshold, instead of becoming a
visible micro-rest. A confident sung note that ends just before a barline may be
extended to the barline when the phrase continues at or shortly after the next
measure, preventing tiny tail gaps from creating misleading end-of-measure
rests. Three or more low-confidence sixteenth-cell notes inside one beat may be
collapsed into one representative sung event when their pitch span is tiny,
because that pattern is more likely pitch-tracker chatter than intentional
melody. The engine may compare deterministic 0.25-beat and 0.5-beat grid
candidates and choose the more readable option when the finer grid produces
moderate micro-note clutter. This comparison must not change BPM, meter, stored
source audio, or final pitch validation; it only chooses a cleaner symbolic
representation of the same recorded evidence.

Each track has a stable notation display policy:

- Soprano and Alto prefer treble clef.
- Tenor uses treble-8vb display semantics: stored pitch remains sounding pitch,
  while browser engraving may display the note one octave higher with the clef
  annotation.
- Baritone and Bass prefer bass clef.
- Percussion uses percussion/rhythm notation when available, otherwise a
  clearly marked rhythm-track fallback.

Key signatures and accidentals must reserve engraving space and must not be
hidden merely to avoid clipping. First-measure widths and note-start positions
must include key-signature allowance before VexFlow formatting runs. If the
renderer cannot display a key signature cleanly, it should degrade to explicit
accidentals with a warning rather than cropping or corrupting the staff.

Track playback has two user-selectable sources:

- `audio`: play the retained original recording/upload asset when a registered
  track has one, falling back to symbolic `TrackNote` synthesis for tracks
  without retained audio.
- `score`: synthesize the registered `TrackNote` data directly.

Recorded/uploaded audio playback must use the retained media URL directly via
browser media-element playback. It must not fetch and decode the original
recording into an `AudioBuffer` before playback, because that adds avoidable
preparation latency and can fail differently from normal browser media
playback. Web Audio synthesis remains the fallback for symbolic score playback
and tracks without retained audio.

Individual playback, full-track playback, and scoring reference playback must
use the same scheduler so one singer can layer recorded takes and hear checked
reference parts during practice. Sync offsets shift each track as a whole in
that scheduler. The offset never changes stored note beats or measure
boundaries.

Full-track playback must exclude empty tracks from the playback set. When
multiple retained audio tracks are included, or when retained audio must start
with score-synthesized tracks or the metronome, the browser prepares all required
media elements to a playable state first, then starts the whole playback set from
one scheduler start point. A not-yet-ready retained source must delay the whole
group rather than starting late by itself. A single retained-audio track without
score/metronome companions may use a lighter readiness barrier for low latency.
Symbolic score-only tracks join the same start point through Web Audio
scheduling. Pre-rendered mixdown is a future optimization path for higher
precision or export-like playback, not the default interactive path.

For generated, OMR, MIDI, MusicXML, and other score-only registrations, playback
is a clocked score-rendering operation: every audible `TrackNote` is converted
to frequency and scheduled on one shared Web Audio context. Notes with the same
canonical beat across tracks must receive the same scheduled start time so the
tracks form a chord, not a sequence of near-simultaneous button sounds. BPM,
meter, sync offset, and `TrackNote.beat` are the only timing inputs; engraving
positions and playback start times must therefore remain mutually consistent.

Browser playback feedback uses a single smooth playhead time derived from the
same scheduler. Registered tracks share measure widths for a common score
grid, so global playback lines align vertically across all visible staves. A
track sync change translates only that track's note/audio layer; barlines,
measure labels, beat guides, and the global playhead remain locked to the
studio meter.

Metronome playback follows the same contract. The click interval is the
time-signature denominator pulse expressed in quarter beats:

- `pulse_quarter_beats = 4 / time_signature_denominator`
- `pulse_seconds = seconds_per_beat * pulse_quarter_beats`
- Downbeat accents occur when the pulse offset is on a measure boundary.

Playback metronome clicks and looping recording/scoring metronomes should be
scheduled from the Web Audio clock rather than accumulating plain timer drift.

Per-track microphone recording is anchored to the studio clock, not to the
button-click instant. Pressing record opens the microphone, shows a one-measure
count-in based on the studio BPM and meter, then starts the actual retained WAV
capture on the next downbeat. The metronome toggle controls only audible click
sound during that count-in/recording window; even with sound muted, the
internal BPM/meter grid remains the source used to normalize extracted
`TrackNote.beat` and `duration_beats` values.

## Input Extraction Strategy

### Common Track Assignment

Every extraction path that produces one or more melodic parts must pass through
the same track assignment policy before registration or candidate creation.
Legacy average-pitch-only slot inference is not sufficient.

The current assignment policy ranks each extracted part against the six fixed
tracks using:

- explicit part/track labels, such as Soprano, Alto, Tenor, Baritone, Bass, or
  Percussion;
- duration- and confidence-weighted pitch distribution;
- range-fit ratio against each vocal track's expected range;
- median and average pitch distance from each track's comfort center;
- percussion label hints such as kick, snare, hat, drum, or percussion; and
- original score order only as a weak tie-breaker when name/range evidence is
  otherwise close.

When multiple parts are imported at once, the engine solves the assignment as a
score-wide mapping so two extracted parts do not silently occupy the same fixed
track. A generic or badly named part is therefore placed by its major pitch
range, while a clearly named part keeps its explicit identity unless the user
overrides it in candidate review.

After assignment, each part receives the shared notation display metadata for
its target track: clef, tenor display octave policy, key signature, accidental
spelling, and range warnings. This applies to MusicXML/MIDI, Audiveris OMR,
vector-PDF fallback, AI generation, and voice/audio extraction candidates.

### First-Class Symbolic Inputs

MusicXML/MXL and MIDI are the preferred import formats.

Reasons:

- Part separation is explicit or highly recoverable.
- Pitch and rhythm are already symbolic.
- Mapping to Soprano, Alto, Tenor, Baritone, Bass, and Percussion is reliable
  when part names or pitch ranges are available.

Symbolic imports may register immediately when the user explicitly wants direct
registration. They may also be routed through the extraction candidate workflow
when the UI needs user approval before changing a track.

### Single Voice Audio

Single-track voice input is supported as an extraction problem:

1. Capture or upload voice audio.
2. Estimate pitch over time.
3. Quantize note onsets and durations.
4. Produce `TrackNote` objects.

The current MVP path is browser microphone capture or browser-normalized audio
upload into local WAV transcription. The browser captures PCM audio or decodes
browser-supported MP3/M4A/OGG/FLAC input, encodes a mono 16-bit PCM WAV data URL,
and sends it through the same upload/transcription path. During browser
recording, the UI opens the microphone before capture, displays the one-measure
count-in, optionally plays audible metronome clicks, then captures from the
downbeat. Input-level feedback is shown in both the count-in and recording
states, but the persisted track content remains symbolic `TrackNote` data plus
an optional retained source-audio asset for playback.

Per-track voice upload and microphone recording must create durable `voice`
engine jobs before extraction runs. The request may return while the job is
queued; the studio UI polls the shared extraction queue and either registers
the resulting TrackNotes, creates review candidates, or exposes a failed job
with retry. Scoring performance audio remains a temporary synchronous path for
now because it is not a retained track-registration asset.

When a voice upload or microphone take successfully registers a track, the
server also stores a relative pointer to the original normalized audio asset.
The browser may fetch that asset for playback, while scoring continues to
compare the extracted `TrackNote` answer sheet against newly extracted
performance `TrackNote` data.

The local WAV engine uses adaptive RMS voice activity thresholding, high
zero-crossing rejection, normalized autocorrelation pitch tracking, confidence
flooring, stable-pitch segment filtering, and median-based segment grouping.
This is still a single-voice MVP, but it is expected to handle leading silence,
quiet takes, moderate room noise, and short note gaps better than a
fixed-threshold frame detector.

The voice transcription backend is configurable through
`GIGASTUDY_API_VOICE_TRANSCRIPTION_BACKEND`:

- `auto` uses an installed Basic Pitch adapter when available, then tries
  librosa pYIN, then falls back to the lightweight local WAV engine.
- `basic_pitch` requires the optional Spotify Basic Pitch package and fails
  recoverably when it is not installed or cannot produce in-range note events.
- `librosa`, `pyin`, or `librosa_pyin` forces librosa pYIN. This is the
  preferred free-plan server path for actual monophonic singing because it gives
  probabilistic voiced/unvoiced pitch frames without bringing in TensorFlow.
- `local` forces the lightweight built-in autocorrelation engine.

Basic Pitch and librosa pYIN are treated as automatic music transcription
providers, not as sources of truth by themselves. Their events/frames must still
pass through the same BPM grid, track range, and notation normalization layer
before becoming TrackNotes.

Noise-only or non-singing recordings must fail with a recoverable extraction
error instead of registering dense false notes. A track should be registered
from voice only when the engine finds sustained, stable voiced pitch segments.

The server-side voice engine still expects WAV input. Non-WAV audio support is a
browser decode/normalize path, not a server MP3 decoder. If a browser cannot
decode a selected audio file, the upload must fail before sending unusable bytes
to the API.

### OMR

PDF and image score input should use Audiveris as the primary durable
asynchronous job:

1. Save the uploaded source.
2. Create an `omr` extraction job and matching durable queue record.
3. Run Audiveris CLI.
4. Parse exported MusicXML/MXL.
5. Mark resulting `TrackNote` objects as `source="omr"` with
   `extraction_method="audiveris_omr_v0"`.
6. Create extraction candidates from resulting `TrackNote` objects.
7. Register only the candidates the user approves.

The containerized API path must include an Audiveris runtime. The current
Dockerfile installs the Audiveris 5.10.2 Linux `.deb` by extracting it with
`dpkg-deb -x` and configures
`GIGASTUDY_API_AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris`, which is the binary
path documented for the Linux package. The build deliberately avoids the
package post-install scripts because they try to register desktop menu entries,
which can fail in a headless container build. Local development may provide
another binary path through `GIGASTUDY_API_AUDIVERIS_BIN` or through a
PATH-discoverable `audiveris`/`Audiveris` command.

The OMR backend is configurable through `GIGASTUDY_API_OMR_BACKEND`:

- `auto` runs Audiveris first and falls back to vector-PDF extraction for PDF
  inputs when Audiveris is unavailable, times out, or produces unusable output.
- `audiveris` runs only the Audiveris path and fails recoverably on errors.
- `pdf_vector` skips Audiveris and runs only the born-digital PDF geometry
  extractor.
- `vector_first` tries born-digital PDF geometry extraction first for PDFs,
  then falls back to Audiveris if the vector path cannot read the score.

Audiveris OMR also has a scan-oriented preprocessing retry. When the first
Audiveris pass fails and `GIGASTUDY_API_OMR_PREPROCESS_MODE` is not `off`, the
engine renders PDF/image input into a high-DPI grayscale PDF workspace, then
retries Audiveris against that normalized input. The default DPI is controlled
by `GIGASTUDY_API_OMR_PREPROCESS_DPI` and should stay conservative on the free
plan because higher DPI improves scan legibility at the cost of memory and job
time.

OMR output can be wrong, so it must be treated as reviewable extraction output,
not as unquestioned final track content.

Home-screen PDF/image score start must use the same OMR job path. It must not
silently fall back to fixture or placeholder notes. Studio-level PDF OMR should
parse all exported parts when possible; per-track PDF OMR may target the
selected track.

When the source is a born-digital PDF generated by notation software, such as a
MuseScore PDF, the engine may use a vector-PDF fallback after Audiveris fails or
is unavailable. Audiveris subprocess timeouts must be normalized into the same
failure class so the fallback still executes. This fallback is not a general
scanned-score OMR replacement. It reads PDF vector staff rows, visible part
labels, key-signature accidental glyphs, barline geometry, and SMuFL notehead
glyph positions, then normalizes those positions into reviewable `TrackNote`
candidates with `extraction_method="pdf_vector_omr_v0"`. The intended behavior
is:

1. Detect labelled score staves and track count from the PDF page layout.
2. Extract every detected vocal staff row in one pass.
3. Map visible parts from top to bottom into Soprano, Alto, Tenor, Baritone,
   and Bass.
4. If fewer than five vocal parts are present, leave the remaining lower slots
   empty instead of reporting them as failed.
5. Keep all fallback output in the candidate-review path because PDF geometry
   extraction can still misread rhythm, accidentals, or dense notation.

Detected vector-note positions must be clamped to the valid measure onset grid,
and inferred note durations must be capped at the owning measure boundary. A
note near the right barline may become the final sixteenth-position onset, but
it must not spill into the next measure unless a concrete next note or measure
split supports that timing.

Vector-PDF and Audiveris OMR candidates must carry diagnostics that help the
user decide whether to approve the result. At minimum, OMR candidates should
surface candidate method, track name, note count, measure count, confidence,
range-fit ratio, timing-grid ratio, density, and a review hint such as
`few_notes`, `range_outliers`, `rhythm_grid_review`, or
`review_accidentals_and_rhythm`. These diagnostics are advisory decision aids,
not hidden auto-approval rules.

OMR review must also keep the original score input inspectable. A retained OMR
job input asset can be rendered as a PNG source preview through
`GET /api/studios/{studio_id}/jobs/{job_id}/source-preview`. The route must use
the same studio owner-token access rule as other studio asset reads. The current
UI exposes the first page in a collapsed source-preview block for OMR
candidates; future work may add page navigation and note-overlay alignment.

LLM or local-LLM assistance is allowed only as a secondary repair/classification
aid around OMR output. It must not replace a score-specific OMR or vector
geometry parser as the primary source of pitch/rhythm truth.

Public registration APIs must not create fixture note data when no file or
recording payload is supplied. Test helpers may construct TrackNotes directly,
but product endpoints must always use uploaded, recorded, OMR, symbolic, or AI
generated material.

The studio UI should show active extraction jobs and poll them until they
become review candidates, register the target track, complete, or fail.
Failed OMR jobs expose retry if the original input asset still exists.

When an OMR job produces multiple mapped parts, the user must be able to
register all pending candidates from that job into their suggested tracks in one
operation. If any target track already has content, the bulk approval operation
requires explicit overwrite confirmation.

### Mixed Audio And Source Separation

Do not promise clean SATB separation from a single mixed choir audio file as a
core MVP capability.

For mixed audio, the product should either:

- Extract a single reliable melodic line, or
- Mark the result as an extraction candidate, or
- Ask the user for a more structured input format.

## Extraction Candidate Workflow

Any pipeline that is uncertain, asynchronous, or likely to overwrite useful
track content should produce `ExtractionCandidate` records before registration.

Each candidate carries:

- Stable candidate id
- Optional candidate group id for multi-candidate generation runs
- Suggested track slot
- Source kind and label
- Extraction method
- Optional variant label
- Confidence
- Candidate `TrackNote` list
- Optional job id
- Diagnostic metadata for uncertain extraction, such as measure count,
  note count, range fit, rhythm grid fit, engine name, and review hint
- Pending, approved, or rejected status

Approving a candidate writes its `TrackNote` list into the target track and
marks that track registered. Rejecting a candidate leaves the existing track
content unchanged, or returns an empty review-only track to empty.

The approval target may differ from the suggested track slot. If the selected
target track already has registered content, approval must require explicit
overwrite confirmation from the user/API request.

Candidate review should show enough symbolic preview data for a decision:
source, method, confidence, note count, duration, pitch/rhythm preview,
diagnostic review hints, page/part or measure counts when available, and the
currently selected target track. For OMR candidates, review should additionally
offer the original score-page preview when the retained source asset can be
rendered.

Candidate review is the required path for OMR results and the recommended path
for mixed or low-confidence audio extraction. It is also allowed for
MusicXML/MIDI import when the UI chooses safety over immediate registration.

## AI Generation Strategy

AI generation currently means symbolic part generation.

Detailed next-generation quality design is tracked in
`PROJECT_FOUNDATION/AI_HARMONY_GENERATION_DESIGN.md`. That document is the
working contract for making DeepSeek affect generated notes through
measure-level harmony intent, candidate goals, and plan-aware constrained
search while keeping final `TrackNote` creation deterministic.

Current MVP:

- Tracks 1-5: symbolic vocal harmony generation from registered context notes.
- Track 6: rule-based percussion pattern generation from BPM, meter, and rhythm
  context. Percussion patterns must reset on each measure downbeat and use the
  studio denominator pulse, so non-4/4 studios do not inherit a hardcoded 4/4
  groove.

The vocal generator is still deterministic at the TrackNote layer. When
configured, DeepSeek V4 Flash may run before generation as a bounded harmony
planning layer. DeepSeek does not output TrackNote arrays, MIDI pitches, beats,
or final notation. It may propose key/mode, measure-level harmonic intent,
candidate goals, voice-leading profile order, rhythm policy, and short review
metadata. The deterministic symbolic engine remains responsible for all notes,
BPM alignment, meter boundaries, ranges, voice-leading constraints, rhythm
normalization, and validation.

The LLM harmony planner must treat the requested part as one voice inside a
six-track a cappella score. Its prompt contract includes singability, contrary
or oblique motion where useful, candidate diversity by musical role, avoidance
of voice crossing and repeated parallel perfect intervals, and bass-foundation
risk. These are planning constraints only; candidate `TrackNote` data still
comes from the deterministic constrained generator and then passes through the
same notation and ensemble registration gates as uploaded or recorded material.

Without a DeepSeek API key, or if the DeepSeek response fails JSON/schema
validation, generation falls back to the same deterministic profile order.

The pipeline:

1. Build harmony events from the union of context note onsets.
2. Preserve known context slot ids when the API can provide them.
3. Optionally ask DeepSeek V4 Flash for a JSON-only harmony plan containing
   measure-level function/cadence intent, candidate goals, rhythm policies,
   candidate profile directions, short labels, and bounded warnings. The
   request can run one bounded draft-review-revision cycle before returning the
   final plan.
4. Estimate a major/minor key from pitch-class duration weights and blend in a
   high-confidence DeepSeek key suggestion only when it passes validation.
5. Score diatonic triad candidates against active context notes, structural
   phrase position, and the current measure's planned harmonic function or
   preferred degrees.
6. Bias first, penultimate, and final events toward a phrase-aware tonic to
   dominant to tonic cadence shape when the source material supports it.
7. Run beam search over chord tones and weak-beat scale connector tones inside
   the target vocal range. Candidate goals influence register center, chord-tone
   priority, non-chord-tone allowance, and motion preference.
8. Penalize voice crossing, poor spacing, exact pitch duplication, large leaps,
   unresolved leading tones, weak chord-tone coverage, and parallel perfect
   fifth/octave motion against known context voices.
9. Apply candidate rhythm policy, such as context-following, readable
   simplification, melodic answer, or sustained support, without changing the
   studio BPM/meter grid.
10. Produce review candidates through distinct voice-leading profiles rather
   than returning the top-N near-duplicates. The current profiles bias toward
   balanced voicing, lower support, moving counterline, upper blend, and open
   voicing, then reject overly similar pitch sequences before exposing them to
   the user.

This matches the current 2026-04-20 technical decision:

- Modern symbolic harmonization research still depends heavily on constraints,
  controllability, and search/sampling rather than plain text generation.
- Chord-constrained transformer work is relevant later, but the product's
  immediate need is low-latency, auditable TrackNote output.
- General LLM prose is not part of generation or scoring. DeepSeek metadata is
  decision support for candidate review, not a coaching report.

Reference material considered for this decision:

- DeepBach: steerable chorale generation with positional constraints
  (`https://arxiv.org/abs/1612.01010`)
- Coconet / Counterpoint by Convolution: non-linear blocked Gibbs score
  completion (`https://research.google/pubs/counterpoint-by-convolution/`)
- MelodyT5: score-to-score symbolic processing including harmonization
  (`https://arxiv.org/abs/2407.02277`)
- 2025 chord-constrained symbolic transformer harmonization
  (`https://arxiv.org/abs/2512.07627`)
- music21 voice-leading analysis utilities for parallel fifth/octave/crossing
  concepts (`https://music21.org/music21docs/moduleReference/moduleVoiceLeading.html`)

Excluded from the current engine:

- Natural human voice audio generation
- Singing voice conversion
- Suno/Udio-style full-song generation
- LLM-generated explanatory feedback

Any LLM or model-based generation must stay behind the same `TrackNote`
contract. It may guide candidate strategy, but deterministic code must own the
final symbolic pitch/rhythm data.

LLM assistance is valuable only where it reduces the musical review work a
human arranger or copyist would otherwise do after extraction:

1. Notation review: inspect extracted `TrackNote` candidates and request
   deterministic cleanup instructions such as coarser quantization, repeated-note
   sustain merging, noise-note pruning, rest simplification, key/accidental
   normalization, and measure-boundary tie repair.
2. Ensemble review: inspect the proposed track against registered sibling
   tracks and request deterministic registration hints for octave repair,
   crossing/spacing warnings, chord coverage, singability, and downbeat bass
   support.
3. Harmony planning: before AI generation, summarize the existing six-track
   context into a bounded plan for target role, register, motion profile, chord
   tones to prefer/avoid, rhythm density, and candidate variety. The rule engine
   still produces the final notes and validates them before registration.
4. Candidate ranking: label and order candidates with user-meaningful musical
   differences, not opaque system metadata.

The model must not directly commit notes to a track. It returns structured
instructions/diagnostics; deterministic normalization, arrangement gates, and
schema validation decide whether those instructions are applied.

For the alpha LLM path, local API keys belong in `apps/api/.env`, which is
ignored by git. Deployed keys belong in Cloud Run environment variables or
Secret Manager. The current low-cost route can use OpenRouter with:
`GIGASTUDY_API_DEEPSEEK_BASE_URL=https://openrouter.ai/api/v1` and
`GIGASTUDY_API_DEEPSEEK_MODEL=deepseek/deepseek-v4-flash:free`. Native
DeepSeek remains supported through `https://api.deepseek.com`. Provider-specific
payload fields must stay compatible: native DeepSeek may receive `thinking`,
while OpenRouter omits that native field by default.

AI generation is candidate-first by default:

1. The API generates up to three symbolic candidates for the target track.
2. Each candidate is stored as an `ExtractionCandidate` with `source_kind="ai"`.
3. Candidates in the same generation run share a candidate group id.
4. Each candidate carries a decision-oriented variant label summarizing
   register, motion, contour, and average pitch for vocal parts, or groove feel
   for percussion.
  When DeepSeek planning is enabled, the variant label and diagnostics may use
  the model's bounded candidate title, role, selection hint, profile name,
  candidate goal, rhythm policy, revision-cycle count, and risk tags.
5. The target track is not overwritten during generation.
6. Approving one candidate registers it into the selected target track.
7. Other pending candidates from the same generation group are rejected
   automatically.
8. If the selected target track already has content, approval requires explicit
   overwrite confirmation.

Direct AI registration is still allowed only when an API caller sets
`review_before_register=false`; the product UI should use the candidate-first
path.

## Scoring Contract

Scoring has two explicit product modes.

### Answer Scoring

Answer scoring requires an answer sheet.

The answer sheet is the registered `TrackNote` list on the target track. It can
come from user upload, user recording, OMR, MIDI, MusicXML, or AI generation.
The engine aligns the user's extracted performance to that target answer and
evaluates pitch/rhythm accuracy.

Selected reference tracks and the metronome are playback context only. They are
not the truth source for judging answer accuracy.

### Harmony Scoring

Harmony scoring does not require a registered target-track answer. It requires
at least one registered reference track. The user records a new part while the
selected reference tracks play, and the engine judges whether the extracted
performance fits the existing ensemble.

Harmony scoring evaluates:

- Vertical harmonic fit against active or nearest reference notes
- Chord-tone fit against an inferred vertical sonority instead of only pairwise
  intervals
- Rhythm/grid fit against the studio BPM/meter and reference entrances
- Target vocal range fit
- SATB-like upper-voice spacing and low-register crowding
- Voice-leading continuity, obvious voice crossing, and repeated parallel
  perfect fifth/octave motion against reference parts
- Structural tension resolution: sustained strong-beat non-chord tones should
  either be explainable as usable color tones or resolve stepwise into the
  inferred sonority
- Structural chord coverage: strong beats with enough active voices should not
  collapse into only one or two pitch classes unless the user intentionally
  accepts a sparse contemporary texture
- Bass foundation: a Bass target part that stays high on structural beats is
  reported as a foundation risk even when it is technically inside the bass
  range

Harmony scoring is deterministic and quantitative in alpha. It should behave
like a conservative arranger review pass: strong-beat dissonance is penalized
more heavily, short weak-beat passing dissonance is tolerated, and spacing or
parallel-perfect issues are surfaced separately from the raw harmony score. An
LLM may later provide bounded diagnostic labels or reviewer-style cautions, but
it must not become the numeric authority, invent notes, move the BPM/meter
grid, or produce user-facing coaching prose.

The scoring pass must not over-warn when the musical evidence is thin. A single
reference note is treated as a weak context, short weak-beat connector tones are
accepted as passing material, and common color tones over a clear triad are not
reported as chord-fit failures. Chord-fit warnings become stricter only when
there are enough simultaneous reference parts to infer a useful sonority.
Parallel fifth/octave warnings are reserved for structural sustained notes, not
for short ornamental motion.

The current deterministic line should be pushed until it needs real singing data:
it may flag structural unresolved tension, thin downbeat chord coverage, and high
bass foundation, but it must not claim human-level arrangement judgment. Once
these diagnostics start deciding between plausible stylistic choices rather than
clear structural risks, the next improvement requires live a cappella test
recordings and human arranger ratings.

When scoring starts, checked reference tracks must be audible through the same
playback-source choice used by normal studio playback. In `audio` mode this
means retained recordings are played where available; in `score` mode the
symbolic notes are synthesized.

## Offline Alignment

Scoring is not real-time.

The engine must handle microphone/browser/user latency by aligning after the
take:

1. Extract the user's performance into `TrackNote` objects.
2. Estimate the global timing offset between answer/reference note anchors and
   performance notes.
3. Apply that offset.
4. Compare pitch/rhythm in answer mode, or ensemble fit/range/voice-leading in
   harmony mode.

The report should expose the detected alignment offset so the user can
understand that global latency was compensated.

## Report Contract

Reports are quantitative practice records, not prose coaching.

Each scoring report should include:

- `score_mode` (`answer` or `harmony`)
- Target track
- Reference tracks and metronome flag
- Answer note count
- Performance note count
- Matched note count
- Missing note count
- Extra note count
- Detected alignment offset
- Overall score
- Pitch score
- Rhythm score
- Harmony score, chord-fit score, range score, spacing score, voice-leading
  score, arrangement score, and harmony summary when `score_mode="harmony"`
- Mean absolute pitch error
- Mean absolute timing error
- Issue list with timestamps, expected/actual labels or harmony/chord/spacing/
  range/voice issue messages, timing error, and pitch error

Do not require:

- Long natural-language report generation
- User-facing explanation of why a correction helps
- LLM-written coaching text

## Export Contract

PDF export is a symbolic score export, not an audio mixdown.

The export must:

- Use registered `TrackNote` data from the six fixed tracks.
- Include studio title, BPM, and time signature.
- Render each registered track on a staff-like timeline with measure markers.
- Refuse to export when no track has registered notes.

The export may use simplified engraving in the MVP, but it must remain derived
from the same TrackNote, BPM, and meter contract used by playback and scoring.

## Current Implementation Anchors

These code paths currently implement the contract:

- API schema: `apps/api/src/gigastudy_api/api/schemas/studios.py`
- Measure-owned notation normalization:
  `apps/api/src/gigastudy_api/services/engine/notation.py`
- Registration notation quality gate:
  `apps/api/src/gigastudy_api/services/engine/notation_quality.py`
- Symbolic import: `apps/api/src/gigastudy_api/services/engine/symbolic.py`
- Voice extraction: `apps/api/src/gigastudy_api/services/engine/voice.py`
- Durable extraction queue:
  `apps/api/src/gigastudy_api/services/engine_queue.py`
- Browser audio primitives:
  `apps/web/src/lib/audio/audioContext.ts`
- Browser WAV encoding:
  `apps/web/src/lib/audio/wavEncoding.ts`
- Browser audio-to-WAV upload normalization:
  `apps/web/src/lib/audio/audioUpload.ts`
- Browser track/scoring recorder lifecycle:
  `apps/web/src/lib/audio/microphoneRecorder.ts`
- Browser upload type routing:
  `apps/web/src/lib/studio/uploadRouting.ts`
- Browser timing and meter helpers:
  `apps/web/src/lib/studio/timing.ts`
- Browser TrackNote playback and metronome scheduling:
  `apps/web/src/lib/studio/playback.ts`
- Track audio asset endpoint:
  `apps/api/src/gigastudy_api/api/routes/studios.py`
- Studio metadata persistence:
  `apps/api/src/gigastudy_api/services/studio_store.py`
- Stored upload/recording/OMR asset persistence:
  `apps/api/src/gigastudy_api/services/asset_storage.py`
- Track upload target/finalize API:
  `apps/api/src/gigastudy_api/api/routes/studios.py`
- Home and track direct-upload orchestration:
  `apps/web/src/lib/api.ts`, `apps/web/src/pages/LaunchPage.tsx`, and
  `apps/web/src/pages/StudioPage.tsx`
- Browser TrackNote score rendering math and hidden layout markers:
  `apps/web/src/lib/studio/scoreRendering.ts`
- Browser VexFlow SVG engraving:
  `apps/web/src/components/studio/EngravedScoreStrip.tsx`
- Home upload flow:
  `apps/web/src/pages/LaunchPage.tsx`
- Studio orchestration:
  `apps/web/src/pages/StudioPage.tsx`
- Studio presentation components:
  `apps/web/src/components/studio/*`
- Rule-based generation: `apps/api/src/gigastudy_api/services/engine/harmony.py`
- DeepSeek/OpenRouter harmony planner:
  `apps/api/src/gigastudy_api/services/llm/deepseek.py`
- OMR adapter: `apps/api/src/gigastudy_api/services/engine/omr.py`
- Born-digital PDF vector fallback:
  `apps/api/src/gigastudy_api/services/engine/pdf_vector_omr.py`
- OMR source preview renderer:
  `apps/api/src/gigastudy_api/services/engine/score_preview.py`
- Scoring and offline alignment:
  `apps/api/src/gigastudy_api/services/engine/scoring.py`
- Candidate approval orchestration:
  `apps/api/src/gigastudy_api/services/studio_repository.py`

If implementation changes, this document should be updated in the same work.
