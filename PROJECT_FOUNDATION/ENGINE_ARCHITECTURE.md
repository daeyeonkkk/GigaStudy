# GigaStudy Engine Architecture

Date: 2026-04-22

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
- Object-store direct upload requires bucket CORS that permits the deployed web
  origin to `PUT` with the returned headers, especially `Content-Type`. The live
  alpha bucket policy is tracked in `ops/r2-cors.gigastudy-alpha.json`.
- Studio list endpoints must return summary rows with pagination. Studio detail
  endpoints must load only the requested studio id. Admin storage summaries
  must page studio rows and limit per-studio asset details so 1,000+ alpha
  studios do not require a full metadata scan on every request.
- Free-plan alpha limits are part of the engine contract until the upload/job
  architecture changes: 300 studios is the soft warning line, 500 studios is
  the hard creation cap, 7 GiB of registered assets is the warning line,
  8.5 GiB is the hard asset cap, individual base64 uploads are capped at
  15 MiB, and local OMR/voice extraction is serialized to one active engine job.
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

Track rendering, playback, AI generation, and scoring must consume this schema
rather than inventing separate note shapes.

Browser score display engraves the same `TrackNote` data into VexFlow SVG
notation. Timing helpers may prepare measure/sync layout metadata, but the
visible noteheads, stems, beams, dots, ledger lines, accidentals, and ties must
be produced by the engraving layer rather than CSS pseudo-elements. Display
ties are allowed only when the renderer can connect two concrete notes: either
measure-split segments of the same stored `TrackNote`, or adjacent same-pitch
notes whose timing and `is_tied` metadata indicate a true continuation.

Track playback has two user-selectable sources:

- `audio`: play the retained original recording/upload asset when a registered
  track has one, falling back to symbolic `TrackNote` synthesis for tracks
  without retained audio.
- `score`: synthesize the registered `TrackNote` data directly.

Individual playback, full-track playback, and scoring reference playback must
use the same scheduler so one singer can layer recorded takes and hear checked
reference parts during practice. Sync offsets shift each track as a whole in
that scheduler. The offset never changes stored note beats or measure
boundaries.

Metronome playback follows the same contract. The click interval is the
time-signature denominator pulse expressed in quarter beats:

- `pulse_quarter_beats = 4 / time_signature_denominator`
- `pulse_seconds = seconds_per_beat * pulse_quarter_beats`
- Downbeat accents occur when the pulse offset is on a measure boundary.

Playback metronome clicks and looping recording/scoring metronomes should be
scheduled from the Web Audio clock rather than accumulating plain timer drift.

## Input Extraction Strategy

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
recording, the UI may play a metronome loop and show input level feedback, but
the persisted track content remains symbolic `TrackNote` data.

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

Noise-only or non-singing recordings must fail with a recoverable extraction
error instead of registering dense false notes. A track should be registered
from voice only when the engine finds sustained, stable voiced pitch segments.

The server-side voice engine still expects WAV input. Non-WAV audio support is a
browser decode/normalize path, not a server MP3 decoder. If a browser cannot
decode a selected audio file, the upload must fail before sending unusable bytes
to the API.

### OMR

PDF and image score input should use Audiveris as an asynchronous job:

1. Save the uploaded source.
2. Create an extraction job.
3. Run Audiveris CLI.
4. Parse exported MusicXML/MXL.
5. Mark resulting `TrackNote` objects as `source="omr"` with
   `extraction_method="audiveris_omr_v0"`.
6. Create extraction candidates from resulting `TrackNote` objects.
7. Register only the candidates the user approves.

OMR output can be wrong, so it must be treated as reviewable extraction output,
not as unquestioned final track content.

Home-screen PDF/image score start must use the same OMR job path. It must not
silently fall back to fixture or placeholder notes. Studio-level PDF OMR should
parse all exported parts when possible; per-track PDF OMR may target the
selected track.

Public registration APIs must not create fixture note data when no file or
recording payload is supplied. Test helpers may construct TrackNotes directly,
but product endpoints must always use uploaded, recorded, OMR, symbolic, or AI
generated material.

The studio UI should show active OMR jobs and poll them until they become
review candidates or fail.

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
- Pending, approved, or rejected status

Approving a candidate writes its `TrackNote` list into the target track and
marks that track registered. Rejecting a candidate leaves the existing track
content unchanged, or returns an empty review-only track to empty.

The approval target may differ from the suggested track slot. If the selected
target track already has registered content, approval must require explicit
overwrite confirmation from the user/API request.

Candidate review should show enough symbolic preview data for a decision:
source, method, confidence, note count, duration, pitch/rhythm preview, and the
currently selected target track.

Candidate review is the required path for OMR results and the recommended path
for mixed or low-confidence audio extraction. It is also allowed for
MusicXML/MIDI import when the UI chooses safety over immediate registration.

## AI Generation Strategy

AI generation currently means symbolic part generation.

Current MVP:

- Tracks 1-5: symbolic vocal harmony generation from registered context notes.
- Track 6: rule-based percussion pattern generation from BPM, meter, and rhythm
  context. Percussion patterns must reset on each measure downbeat and use the
  studio denominator pulse, so non-4/4 studios do not inherit a hardcoded 4/4
  groove.

The vocal generator is `rule_based_voice_leading_v1`.

It does not call a general-purpose LLM. It runs a deterministic symbolic
pipeline:

1. Build harmony events from the union of context note onsets.
2. Preserve known context slot ids when the API can provide them.
3. Estimate a major/minor key from pitch-class duration weights.
4. Score diatonic triad candidates against active context notes.
5. Bias first, penultimate, and final events toward a phrase-aware tonic to
   dominant to tonic cadence shape when the source material supports it.
6. Run beam search over chord tones and weak-beat scale connector tones inside
   the target vocal range.
7. Penalize voice crossing, poor spacing, exact pitch duplication, large leaps,
   unresolved leading tones, weak chord-tone coverage, and parallel perfect
   fifth/octave motion against known context voices.
8. Produce review candidates through distinct voice-leading profiles rather
   than returning the top-N near-duplicates. The current profiles bias toward
   balanced voicing, lower support, moving counterline, upper blend, and open
   voicing, then reject overly similar pitch sequences before exposing them to
   the user.

This matches the current 2026-04-20 technical decision:

- Modern symbolic harmonization research still depends heavily on constraints,
  controllability, and search/sampling rather than plain text generation.
- Chord-constrained transformer work is relevant later, but the product's
  immediate need is low-latency, auditable TrackNote output.
- General LLM prose is not part of generation or scoring.

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

Future LLM or model-based generation may be added only behind the same
`TrackNote` contract. It must return symbolic pitch/rhythm data first.

AI generation is candidate-first by default:

1. The API generates up to three symbolic candidates for the target track.
2. Each candidate is stored as an `ExtractionCandidate` with `source_kind="ai"`.
3. Candidates in the same generation run share a candidate group id.
4. Each candidate carries a decision-oriented variant label summarizing
   register, motion, contour, and average pitch for vocal parts, or groove feel
   for percussion.
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

Scoring requires an answer sheet.

The answer sheet is the registered `TrackNote` list on the target track. It can
come from user upload, user recording, OMR, MIDI, MusicXML, or AI generation.

Selected reference tracks and the metronome are playback context only. They are
not the truth source for judging the target part.

When scoring starts, checked reference tracks must be audible through the same
playback-source choice used by normal studio playback. In `audio` mode this
means retained recordings are played where available; in `score` mode the
symbolic notes are synthesized.

## Offline Alignment

Scoring is not real-time.

The engine must handle microphone/browser/user latency by aligning after the
take:

1. Extract the user's performance into `TrackNote` objects.
2. Estimate the global timing offset between answer notes and performance
   notes.
3. Apply that offset.
4. Compare pitch and rhythm.

The report should expose the detected alignment offset so the user can
understand that global latency was compensated.

## Report Contract

Reports are quantitative practice records, not prose coaching.

Each scoring report should include:

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
- Mean absolute pitch error
- Mean absolute timing error
- Issue list with timestamps, expected/actual labels, timing error, and pitch
  error

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
- Symbolic import: `apps/api/src/gigastudy_api/services/engine/symbolic.py`
- Voice extraction: `apps/api/src/gigastudy_api/services/engine/voice.py`
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
- Browser direct-upload orchestration:
  `apps/web/src/lib/api.ts` and `apps/web/src/pages/StudioPage.tsx`
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
- OMR adapter: `apps/api/src/gigastudy_api/services/engine/omr.py`
- Scoring and offline alignment:
  `apps/api/src/gigastudy_api/services/engine/scoring.py`
- Candidate approval orchestration:
  `apps/api/src/gigastudy_api/services/studio_repository.py`

If implementation changes, this document should be updated in the same work.
