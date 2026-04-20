# GigaStudy Master Plan

Date: 2026-04-20

## One Sentence

GigaStudy is a six-track a cappella studio where users build soprano, alto,
tenor, baritone, bass, and percussion tracks, synchronize them, rehearse against
selected references, and receive pitch/rhythm reports against the target
track's registered answer notes.

## Product Bet

The product should not feel like a generic recorder with many tools around it.
It should feel like a focused a cappella practice desk:

- Six named tracks are always visible as the main mental model.
- Empty tracks invite recording, upload, or AI generation.
- Registered tracks become playable, synchronizable, and scorable.
- Scoring produces a quantitative report that shows pitch, rhythm, sync,
  missing-note, and extra-note errors.

## Target User

The primary user is a singer or small vocal group member practicing a part in an
a cappella-style arrangement.

They need to:

- Put source material into the right part tracks.
- Hear multiple parts together.
- Adjust timing alignment between tracks.
- Sing one part while hearing selected references.
- See where pitch or rhythm drifted.

## Canonical Engine Model

Track content is `TrackNote` data: pitch, rhythm, onset, duration, source, and
confidence.

The studio BPM defines seconds-per-quarter-beat. The studio time signature
defines the measure grid. MusicXML and MIDI imports may update the studio time
signature when the source carries meter metadata.

GigaStudy does not currently generate natural human voice audio. Recording,
upload, OMR, MIDI, MusicXML, and AI generation all converge into TrackNote data.

Detailed engine rules live in `ENGINE_ARCHITECTURE.md`.

## Canonical Track Model

Every studio owns exactly six track slots:

| Slot | Name | Purpose |
| --- | --- | --- |
| 1 | Soprano | Upper melody or harmony |
| 2 | Alto | Mid/high harmony |
| 3 | Tenor | Mid/low harmony |
| 4 | Baritone | Low-mid harmony |
| 5 | Bass | Bass line |
| 6 | Percussion | Beatbox or rhythm part |

Track slots may be empty or registered.

An empty track shows:

- Record/Stop
- Upload
- AI Generate, disabled until at least one track is registered

A registered track shows:

- Score view with horizontally scrollable measures on the studio
  time-signature grid
- Track playback/pause
- Track stop
- Scoring
- Sync offset adjustment in 0.01 second steps

## Flow 1: Studio Creation And Track Seeding

The home screen asks for:

- Project name
- BPM
- Time signature, defaulting to 4/4 unless a symbolic upload provides meter
- Start method

Start methods:

- Upload and start (`업로드 후 시작`)
- Start blank (`새로 시작`)

Upload and start supports score or music input.

Score upload behavior:

- If the score is a cappella, register all identifiable parts into the six track
  slots where possible.
- If the score is not a cappella, extract the main melody and register it into
  the most appropriate track.
- If detection is uncertain, show the user the extracted track candidates before
  final registration.

Music upload behavior:

- Analyze the uploaded music.
- Extract every usable part candidate.
- Register candidates into the six track slots where possible.
- If only one reliable melodic line is found, register it as a melody track
  candidate instead of pretending full part separation succeeded.

Blank start behavior:

- Create the studio immediately.
- All six tracks start empty.

## Flow 2: Six-Track Studio Assembly And Sync

The main studio centers the six tracks.

Global transport:

- Play/Pause (`재생/일시정지`) plays or pauses all registered tracks together.
- Stop (`중지`) returns the ensemble to 0 seconds with each track's sync offset still
  applied.
- Metronome toggle (`메트로놈 토글`) controls whether the metronome participates in recording or
  scoring contexts.

Per-track sync:

- Each track has an offset value.
- The user can adjust by 0.01 seconds.
- The score view keeps measure lines fixed and shifts only the track's note
  layer by the sync offset.
- Measure lines are derived from the studio time signature, not from a hardcoded
  four-beat grid.
- Sync offset is preserved when stopping playback.
- Stop means returning to the synced start point, not resetting sync.

Track fill actions:

- Recording captures browser microphone audio, encodes WAV, and converts it
  into a registered TrackNote track. When the metronome is enabled, recording
  plays a click track and shows elapsed-time/input-level feedback.
- Upload accepts supported audio, MIDI, or score formats and converts them into
  registered track material or reviewable extraction candidates. In the current
  local MVP, track-level voice audio means WAV only; non-WAV audio should not be
  advertised until a decoder path exists.
- A pending extraction candidate becomes track content only after the user
  approves it.
- Candidate approval can be retargeted to another track, and occupied targets
  require explicit overwrite confirmation.
- AI Generate creates or overwrites the selected track using already registered
  tracks as context, then registers symbolic note material. Occupied tracks
  require explicit overwrite confirmation before replacement.

Percussion generation is special:

- It should generate a beat or rhythm part aligned to BPM and meter.
- It should complement existing tracks instead of generating harmonic notes.

## Flow 3: Scoring Session And Report

Scoring starts from a registered track.

The track where the user clicked Scoring is the target part the user will sing.
The checklist chooses what the user hears as reference during the attempt.

The target track's registered TrackNote list is the answer sheet. Reference
tracks and metronome are not the scoring truth source; they are playback
context.

Checklist items:

- Track 1
- Track 2
- Track 3
- Track 4
- Track 5
- Track 6
- Metronome

Checklist actions:

- Start (`시작`)
- Cancel (`취소`)

When Start is clicked:

- Checked reference tracks play together.
- Checked metronome plays as a reference, even when it is the only selected
  reference.
- The microphone turns on.
- The scoring session records the user's attempt.

When Stop is clicked:

- Playback and recording stop.
- GigaStudy extracts the user's performance into TrackNote data.
- GigaStudy automatically estimates and applies a global sync offset.
- GigaStudy analyzes pitch and rhythm at 0.01 second resolution after alignment.
- A report is created.

Report behavior:

- A compact report item is appended to the bottom of the studio feed with title
  and date/time only.
- Clicking the report item opens a separate full report page.
- The full report identifies where the performance drifted.
- The full report is quantitative: overall score, pitch score, rhythm score,
  detected sync offset, matched notes, missing notes, extra notes, and
  issue-level timing/pitch errors.
- The report should not depend on LLM-written coaching or correction
  explanations.

## Non-Goals For The Current Foundation

These are not foundation-level product requirements now:

- Standalone arrangement workspace
- Standalone shared review workspace
- Ops/release desk UI
- Marketing landing page
- Evidence-round and human-rating operations docs
- Generic project history as a primary product surface
- Mixdown as a primary flow
- Versioning as a primary flow
- Natural human voice audio generation
- Mixed choir SATB source separation as a promised MVP path
- LLM-written scoring feedback

Those can return only if they directly support the six-track studio flows.

## Implementation Principle

Every major UI decision should answer one of these:

1. How does the user create or seed the six-track studio?
2. How does the user fill, sync, and hear the six tracks?
3. How does the user score a recorded attempt and understand the report?
