# GigaStudy Project Foundation

Date: 2026-05-06

This folder is the source of truth for the current GigaStudy product direction.

GigaStudy is a six-track a cappella arrangement and practice studio built
around region arrangement, piano-roll editing, and waterfall practice playback.
It is not a print-grade notation-first editor, but every registered track must
still sit on one shared musical score clock.

## Product Definition

GigaStudy lets a user create a studio, fill six vocal/percussion tracks by
recording, recording-file upload, score-file seeding, or AI generation,
synchronize those tracks, play them as an ensemble, practice with a waterfall
view, and score a vocal attempt against selected reference tracks.

The core artifact is one six-track timeline. BPM and time signature define the
shared musical clock. Recordings, audio uploads, PDF/MIDI/MusicXML seed files,
and AI generation are ways to add editable regions and pitch events onto that
clock.

Canonical track slots:

1. Soprano
2. Alto
3. Tenor
4. Baritone
5. Bass
6. Percussion

## Core User Flows

### 1. Studio Creation And Track Seeding

The user starts from the home screen.

They enter a project name, then choose one of two starts:

- Start with PDF/MIDI/MusicXML
- Start blank

The score-file start appears only after a PDF, MIDI, or MusicXML source is
selected. Start blank asks for BPM and time signature up front. Score-file
starts create a tempo-review step: GigaStudy suggests BPM/meter when possible,
then the user confirms or edits those values before registration begins.

After creation, BPM can be corrected deliberately when the studio is idle. That
repair keeps audio/event seconds in place and recalculates beat/measure
coordinates. Existing scoring reports are not recalculated; after a BPM
correction they are reference history until the user scores again.

If the user uploads a score file, GigaStudy extracts track material into
regions:

- A cappella source: register every identifiable part into the matching six
  tracks as region events.
- Non-a cappella source: register the main melody into the most appropriate
  track as region events, or hold ambiguous material for candidate review.

The canonical source kind for this flow is `document`; deprecated
document-source aliases are invalid. Track-level audio stays in studio track
rows as recording-file upload, not in the studio creation seeding flow.

If the user starts blank, all six tracks are visible and empty.

### 2. Six-Track Studio Assembly And Sync

The main studio is centered on the six tracks.

Each track can be filled by:

- Recording
- Recording-file upload
- AI generation, once at least one context track already exists

Each registered track has a region lane, recording controls, recording-file
upload, AI generation when context exists, playback controls, and sync
adjustment. Scoring belongs to Practice, not to individual studio track rows.
The top transport plays, pauses, and stops the six-track ensemble while
preserving each track's sync offset.

The user can shift all registered tracks by the current sync step so an
already-aligned ensemble can be moved together onto the metronome downbeat
without changing inter-track relationships. The visible sync step is
user-selectable; 0.01 seconds is only the default. Sync is not only a visual
playback tweak: every cross-track judgment, including AI generation, scoring,
harmony scoring, and playback, must use the sync-resolved effective event
timeline.

Voice recordings are interpreted against the studio BPM/meter clock. The
metronome toggle controls audible clicks only; the internal clock remains
active so extracted pitch events land on consistent timeline positions.

### 3. Practice Scoring Session And Report

The user scores a recorded attempt from the Practice page.

When scoring starts, the user chooses which reference tracks and metronome to
hear. Selected references play together while the microphone records. When the
user stops, GigaStudy extracts the performance into pitch events, aligns the
take offline to compensate latency, then checks pitch and rhythm against the
registered region/event timeline. Report evidence carries studio-precision
seconds plus beat coordinates; scoring is not defined by a fixed 0.01 second
grid.

Reports appear as compact studio history items and open into a separate detail
page with quantitative pitch, rhythm, sync, missing, and extra-event data. Each
issue carries region/event IDs and beat coordinates, and answer-side issues can
deep-link back into the editor with the matching region and piano-roll event
focused.

Scoring requests submit recorded audio or `performance_events`. Deprecated
performance payloads are not compatibility inputs; remaining track-level event
arrays are internal event state inside extraction, persistence, and scoring
engines.

The web client treats `Studio.regions` and `ExtractionCandidate.region` as the
only product event contract. Studio routes return a public response model that
omits internal event shadows from tracks and candidates. Old pre-region storage
aliases and deprecated document-source aliases are not compatibility inputs
anymore; they are rejected. Region `PitchEvent` objects carry source,
extraction method, measure position, and quality warnings for product and
diagnostic use.

## Support Layers

The following are supporting capabilities only when they directly serve the
three core flows:

- File import and extraction
- Pitch and rhythm analysis
- Region, piano-roll, and waterfall rendering
- Audio playback and sync
- AI part generation as timeline event generation
- Report history
- Basic project persistence

Anything that does not directly support the three core flows is out of the
foundation for now.

## Canonical Documents

Read in this order:

1. `WORKING_PROTOCOL.md`
2. `PRODUCT_PURPOSE_AND_FUNCTIONS.md`
3. `OPERATING_PRINCIPLES.md`
4. `EVALUATION_METRICS.md`
5. `REGION_PIANOROLL_RESET_PLAN.md`
6. `CURRENT_ARCHITECTURE.md`
7. `OPERATIONS_RUNBOOK.md`
8. `ACAPPELLA_ARRANGEMENT_AUDIT.md`
9. `AI_HARMONY_GENERATION_DESIGN.md`

## Foundation Rule

If a requirement does not help a user create a six-track studio, fill/sync/play
the six tracks, or score a recorded attempt with a useful report, it does not
belong in the current foundation.

If engine work changes the region/event contract, extraction strategy, AI
generation strategy, or scoring alignment rules, update
`CURRENT_ARCHITECTURE.md` in the same work.

If a task changes the default rules for timing, sync, registration, LLM use,
playback, UX, infrastructure, code structure, or verification, update
`OPERATING_PRINCIPLES.md` in the same work.

If a task changes release gates, quality targets, product telemetry, or the
definition of success for registration, playback, scoring, AI generation, UX,
or alpha operations, update `EVALUATION_METRICS.md` in the same work.

Every task must follow `WORKING_PROTOCOL.md`: check the relevant foundation
documents before implementation and update foundation in the same task whenever
product behavior, engine contracts, UI flow, roadmap state, or checklist state
changes.
