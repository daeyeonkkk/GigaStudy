# Foundation Status

Date: 2026-04-22

## Current Decision

The foundation has been reset to the six-track a cappella studio direction.

The canonical product is:

1. Create or seed a six-track studio.
2. Fill, sync, and play Soprano, Alto, Tenor, Baritone, Bass, and Percussion.
3. Score a vocal attempt against the target track's registered answer notes
   while selected references play as context, then append a quantitative report.

The canonical engine rule is now documented in `ENGINE_ARCHITECTURE.md`.

The canonical work rule is now documented in `WORKING_PROTOCOL.md`: every task
must consult and update `PROJECT_FOUNDATION` when behavior, contracts, UI,
roadmap, or checklist state changes.

## What Was Removed

The following old foundation areas were removed because they either conflicted
with the new product direction or were not necessary to implement it:

- Legacy backlog documents
- Intonation calibration and human-rating operations documents
- Browser/environment validation and alpha deployment operation documents
- Old UI screen package for Launch, Studio, Arrangement, Shared Review, and Ops
- Frozen old mockup PNG/SVG exports

## What Remains

The root foundation now contains only:

- `README.md`
- `WORKING_PROTOCOL.md`
- `GigaStudy_master_plan.md`
- `ENGINE_ARCHITECTURE.md`
- `ROADMAP.md`
- `GigaStudy_check_list.md`
- `FOUNDATION_STATUS.md`
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/`

The design package now covers only the screens and interactions needed for the
new core flows.

## Implementation Reality

The current implementation has a working six-track vertical slice:

- Home creates blank or uploaded studios, with upload start and blank start
  treated as mutually exclusive UI flows.
- BPM and time signature are required only for blank start. Upload start can
  proceed from the selected source file without user-entered tempo/meter, using
  source metadata or an internal fallback clock for extraction timing.
- Studios carry BPM plus a time signature; blank studios default to 4/4 and
  symbolic imports can inherit source meter.
- Main studio shows six fixed tracks.
- Track upload can parse MusicXML/MXL/XML and MIDI into TrackNote data.
- MusicXML/MIDI imports preserve source time signature metadata when present.
- PDF/image OMR is wired as an Audiveris job path.
- Home-screen PDF score start now queues OMR instead of seeding fixture notes.
- Public registration endpoints no longer create fixture note data when no file
  or recording payload is supplied.
- Existing local JSON records with legacy `source="fixture"` notes are normalized
  on read so older development data does not block the current schema.
- Studio PDF/image upload exposes active OMR jobs, polls until completion or
  failure, and turns successful OMR output into reviewable candidates.
- OMR-generated notes are marked with `source="omr"` and
  `extraction_method="audiveris_omr_v0"`.
- OMR jobs that produce multiple mapped parts can be approved in one operation,
  registering candidates into their suggested tracks with overwrite protection.
- Registered TrackNote scores can be exported as a PDF from the studio toolbar.
  The export includes title, BPM, meter, track names, measure markers, and
  staff-like note placement.
- Single voice extraction exists as a local WAV MVP with adaptive voice
  thresholding, high zero-crossing rejection, normalized autocorrelation,
  confidence filtering, pitch-stability filtering, and median segment grouping.
- Noise-only or non-singing recordings are rejected instead of being registered
  as dense false notes.
- Browser upload normalizes browser-decodable MP3/M4A/OGG/FLAC audio into mono
  16-bit PCM WAV before sending it to the existing voice extraction path.
- NWC is not advertised as an accepted upload format until an NWC-to-TrackNote
  parser is connected.
- Per-track browser recording captures microphone audio, encodes WAV, and
  registers TrackNotes through the voice extraction path.
- Per-track browser recording plays the metronome when enabled and shows
  elapsed-time/input-level feedback while recording.
- Web studio responsibilities are split so upload detection, browser audio
  access, WAV encoding, recorder lifecycle, timing/meter math, and playback
  scheduling live in focused `apps/web/src/lib/audio/*` and
  `apps/web/src/lib/studio/*` modules instead of being
  embedded in `StudioPage.tsx`.
- Alpha API deployment is reproducible through `cloudbuild.api.yaml`; the Pages
  UI and Cloud Run API must expose the same `/api/studios` six-track contract.
- Studio UI presentation is split into dedicated components for the composer
  toolbar, track board, OMR job queue, candidate review queue, report feed, and
  scoring drawer. `StudioPage.tsx` now mainly coordinates data loading, user
  actions, playback/recording state, and API orchestration.
- Extraction results can be held as pending candidates and approved or rejected
  before registration.
- Candidate review supports target-track override, musical decision summaries
  (range, register fit, movement, rhythm density, start/end, confidence,
  contour preview), and explicit overwrite confirmation for occupied targets.
- Recording, direct upload, candidate approval, and AI generation have explicit
  overwrite guards for occupied tracks.
- AI generation is rule-based symbolic harmony/percussion generation.
- AI vocal generation uses multiple voice-leading profiles so the review queue
  exposes meaningfully different register, motion, and contour options instead
  of near-duplicate top-N search results.
- Playback uses TrackNote pitch/rhythm data.
- Registered tracks render as horizontally scrollable measure strips on the
  studio time-signature grid, with dense runs expanding the score width instead
  of overlapping.
- Browser score rendering now uses VexFlow SVG engraving from `TrackNote`
  pitch/rhythm data. Noteheads, stems, beams, dots, accidentals, ledger lines,
  and visible ties are produced by the engraving engine instead of CSS
  pseudo-elements.
- Visible tie arcs are drawn only as VexFlow note-to-note ties for
  display-split long notes or explicit adjacent same-pitch continuations.
- The renderer keeps a hidden layout-marker layer for regression checks and
  sync behavior, while the visible notation is the engraved SVG score.
- The score renderer gives each measure inner notation padding and keeps note
  centers inside their owning measure, so sync and same-onset clustering cannot
  push notes outside barlines.
- Track sync visually shifts the note layer while measure lines and measure
  labels remain fixed.
- Scoring reference playback honors the scoring checklist's metronome setting,
  including metronome-only scoring sessions.
- Scoring uses the target track as the answer sheet, extracts/accepts
  performance notes, auto-aligns global sync, and reports quantitative errors.
- Studio report feed shows compact report title/date links; full quantitative
  report details live on a separate report page.
- AI generation now creates multiple pending candidates first; approving one
  candidate registers it and rejects sibling candidates from the same
  generation group.
- The score renderer now uses VexFlow clefs and ledger lines so Soprano through
  Bass tracks can extend above or below the staff without being clamped into
  misleading positions. Key-signature marks are hidden until the notation layout
  can render them without clipping.

Remaining implementation gaps are now refinements of the six-track direction,
not legacy product surfaces.

## Next Required Work

1. Add score-image-aware OMR preview and page/part confidence indicators.
2. Add clearer failed-extraction recovery for browser recording.
3. Improve PDF score export engraving fidelity to match the browser VexFlow
   score display while preserving TrackNote as the source of truth.
4. Add visual PDF rendering checks to CI once Poppler or an equivalent renderer
   is available.
5. Add persistence/version boundaries only where they support the core flows.

## Status Summary

Foundation reset: complete.

Engine baseline: implemented.

Implementation alignment: core vertical slice complete; extraction quality and
UX hardening remain.
