# GigaStudy Engine Architecture

Date: 2026-04-20

This document is the canonical engine contract for the current six-track
GigaStudy foundation.

## Core Engine Rule

GigaStudy stores and compares symbolic pitch/rhythm data, not generated human
voice audio.

The canonical unit is `TrackNote`.

The engine may ingest voice, MIDI, MusicXML, score images, or generated parts,
but each successful path must end by producing `TrackNote` objects for one or
more of the six fixed track slots.

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
- Source, such as `musicxml`, `midi`, `voice`, `omr`, `ai`, or `fixture`
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

MusicXML and MIDI import should preserve the source time signature when present.
Voice extraction and rule-based AI generation inherit the studio time signature.
Measure numbers and beat-in-measure positions are derived from the same meter
contract, while `TrackNote.beat` remains the canonical timeline coordinate.
For the current MVP, imported MIDI tempo does not replace the studio BPM;
imported MIDI notes preserve beat positions and are normalized to studio BPM for
`onset_seconds` and `duration_seconds` so playback and scoring share one clock.

Track rendering, playback, AI generation, and scoring must consume this schema
rather than inventing separate note shapes.

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

The current MVP path is browser microphone capture or uploaded local WAV
transcription. The browser captures PCM audio, encodes a WAV data URL, and sends
it through the same upload/transcription path. During browser recording, the UI
may play a metronome loop and show input level feedback, but the persisted track
content remains symbolic `TrackNote` data.

The local WAV engine uses dynamic voice activity thresholding, normalized
autocorrelation pitch tracking, and median-based segment grouping. This is still
a single-voice MVP, but it is expected to handle leading silence, quiet takes,
and short note gaps better than a fixed-threshold frame detector.

Other audio formats should be accepted only when a real decoder/transcriber path
exists. Track upload UI should not advertise MP3/M4A/OGG/FLAC until that decoder
path is implemented.

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
4. The target track is not overwritten during generation.
5. Approving one candidate registers it into the selected target track.
6. Other pending candidates from the same generation group are rejected
   automatically.
7. If the selected target track already has content, approval requires explicit
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
- Browser recording and WAV upload:
  `apps/web/src/pages/StudioPage.tsx`
- Rule-based generation: `apps/api/src/gigastudy_api/services/engine/harmony.py`
- OMR adapter: `apps/api/src/gigastudy_api/services/engine/omr.py`
- Scoring and offline alignment:
  `apps/api/src/gigastudy_api/services/engine/scoring.py`
- Candidate approval orchestration:
  `apps/api/src/gigastudy_api/services/studio_repository.py`

If implementation changes, this document should be updated in the same work.
