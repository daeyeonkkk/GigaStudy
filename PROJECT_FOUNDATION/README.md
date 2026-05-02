# GigaStudy Project Foundation

Date: 2026-05-02

This folder is the source of truth for the current GigaStudy product direction.

GigaStudy is now a six-track a cappella arrangement and practice studio built
around region arrangement, piano-roll editing, and waterfall practice playback.
It is no longer an engraved staff-score UI.

## Product Definition

GigaStudy lets a user create a studio, fill six vocal/percussion tracks by
upload, recording, or AI generation, synchronize those tracks, play them as an
ensemble, practice with a timing-focused waterfall view, and score a vocal
attempt against selected reference tracks.

The core artifact is one six-track timeline. BPM and time signature define the
shared musical clock. Recordings, document uploads, MIDI, MusicXML, and AI
generation are ways to add editable regions and pitch events onto that clock.

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

- Upload and start (`업로드 후 시작`)
- Start blank (`새로 시작`)

Upload and start appears only after a document or music source is selected. BPM and
time signature are requested only for Start blank.

If the user uploads a document, GigaStudy extracts track material into regions:

- A cappella source: register every identifiable part into the matching six
  tracks as region events.
- Non-a cappella source: register the main melody into the most appropriate
  track as region events.

If the user uploads music, GigaStudy extracts every usable part and registers
those into the six tracks where possible. Browser-decodable MP3/M4A/OGG/FLAC
input is normalized to WAV before the symbolic pitch/rhythm extraction engine
runs.

If the user starts blank, all six tracks are empty.

### 2. Six-Track Studio Assembly And Sync

The main studio is centered on the six tracks.

Each track can be filled by:

- Recording
- Uploading
- AI generation, once at least one track already exists

Each registered track has a region lane, playback controls, stop, scoring
(`채점`), and 0.01 second sync adjustment. The top transport plays, pauses, and
stops the whole six-track ensemble while preserving each track's sync offset.
The user can also shift all registered tracks by the current sync step so an
already-aligned ensemble can be moved together onto the metronome downbeat
without changing inter-track sync relationships.
The visible sync step is user-selectable; 0.01 seconds is only the default.
Sync is not only a visual playback tweak: every cross-track judgment, including
AI generation, scoring, harmony scoring, and playback, must use the
sync-resolved effective event timeline.

Voice recordings are interpreted against the studio BPM/meter clock. The
metronome toggle controls audible clicks only; the internal clock remains
active so extracted pitch events land on consistent timeline positions.

### 3. Scoring Session And Report

The user scores a recorded attempt from a registered track.

When scoring starts, the user chooses which reference tracks and metronome to
hear. Selected references play together while the microphone records. When the
user stops, GigaStudy extracts the performance into pitch events, aligns the
take offline to compensate latency, then checks pitch and rhythm at 0.01 second
resolution.

Reports appear at the bottom of the studio as compact title/date history items.
Clicking a report opens a separate detail page with quantitative pitch, rhythm,
sync, missing, and extra-note data. Each issue carries region/event IDs and
beat coordinates, and answer-side issues can deep-link back into the studio with
the matching region and piano-roll event focused.

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
2. `REGION_PIANOROLL_RESET_PLAN.md`
3. `CURRENT_ARCHITECTURE.md`
4. `ACAPPELLA_ARRANGEMENT_AUDIT.md`
5. `AI_HARMONY_GENERATION_DESIGN.md`

## Foundation Rule

If a requirement does not help a user create a six-track studio, fill/sync/play
the six tracks, or score a recorded attempt with a useful report, it does not belong
in the current foundation.

If engine work changes the region/event contract, extraction strategy, AI
generation strategy, or scoring alignment rules, update
`CURRENT_ARCHITECTURE.md` in the same work.

Every task must follow `WORKING_PROTOCOL.md`: check the relevant foundation
documents before implementation and update foundation in the same task whenever
product behavior, engine contracts, UI flow, roadmap state, or checklist state
changes.
