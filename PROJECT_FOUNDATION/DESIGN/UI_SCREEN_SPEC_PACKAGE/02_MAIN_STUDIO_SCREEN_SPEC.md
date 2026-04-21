# 02 Main Studio Screen Spec

Date: 2026-04-20

Screen ID: `MAIN_STUDIO`

## Job

Let the user fill, play, synchronize, and score six fixed tracks.

## Primary Layout

The screen uses a composer-style app shell: title/menu bar at the top, compact
toolbar below it, a white score canvas in the center, and a status bar near the
bottom of the studio surface.

The center score canvas contains six track rows or lanes:

1. Track 1: Soprano
2. Track 2: Alto
3. Track 3: Tenor
4. Track 4: Baritone
5. Track 5: Bass
6. Track 6: Percussion

The tracks are the main workspace. No lower workbench, marketing hero, or ops
dashboard should compete with them as the primary surface.

## Global Transport

Top controls:

- Play/Pause (`재생/일시정지`)
- Stop (`중지`)
- Metronome toggle (`메트로놈 토글`)
- PDF Export

Play/Pause behavior:

- Plays all registered tracks together.
- Pauses all playing tracks together.
- Empty tracks are ignored.

Stop behavior:

- Stops all tracks.
- Returns playback to 0 seconds with each track's sync offset applied.
- Does not reset track sync values.

Metronome behavior:

- The toggle controls whether metronome participates in recording/scoring
  contexts.
- Metronome should be clearly visible as on/off.
- Metronome clicks use the studio denominator pulse and accent measure
  downbeats.

## Track Row: Empty State

An empty track shows:

- Track name
- Empty score area
- Record/Stop
- Upload
- AI Generate
- Sync control, disabled or visually inactive

AI Generate:

- Disabled when no track is registered anywhere in the studio.
- Enabled when at least one track is registered.
- Creates multiple review candidates instead of directly overwriting the track.
- The user approves one candidate to register it; sibling candidates from the
  same generation run are dismissed after approval.

## Track Row: Registered State

A registered track shows:

- Track name
- Score display
- Track Play/Pause
- Track Stop
- Scoring (`채점`)
- Upload or Replace
- AI Generate or Regenerate
- Sync control

Registered track playback:

- Plays only that track.
- Track Stop returns that track to its synced 0 second point.
- Track Stop does not reset sync.

## Sync Control

Each track has a sync offset control.

Required behavior:

- Step size: 0.01 seconds
- Display format: signed seconds, for example `+0.03s` or `-0.12s`
- Adjustments affect global playback and track playback
- Adjustments visually shift only the note layer on the time axis.
- Measure boundaries, beat guide lines, and measure numbers remain fixed when
  sync changes.
- The seconds-to-beat visual shift uses the studio BPM.
- Stop never clears the offset

## Score Display

Each track should show its score or an equivalent note/timing representation.

Registered track scores should be rendered as a horizontal, measure-based strip:

- The track row owns a horizontally scrollable score area.
- Measures are derived from `TrackNote.beat` on the studio time-signature grid,
  so voice-extracted notes cannot collapse into a single stored measure.
- A 4/4 studio has four quarter-beats per measure; a 3/4 studio has three; a
  6/8 studio has three quarter-beats per measure.
- The audible metronome follows the same time-signature grid as the visible
  score.
- Measure boundaries and measure numbers are visible.
- The first measure carries the appropriate clef signal for the track range.
- Soprano, Alto, and Tenor use treble staff anchoring; Baritone and Bass use
  bass staff anchoring.
- Key-signature marks are intentionally hidden until they can be rendered with
  reliable spacing and clipping behavior.
- Notes are positioned by beat within the measure, not simply listed in upload
  order.
- Each measure reserves an inner notation area, so downbeat notes sit inside
  the barline instead of on or outside it.
- Note centers must be clamped inside their owning measure; cluster offsets may
  separate same-onset notes but must not push notes outside measure boundaries.
- Dense notes expand the visual pixels-per-beat and score width instead of
  overlapping; horizontal scrolling is preferred over compressed notation.

The score area should make it clear when:

- Track is empty
- Track is being extracted
- Track is registered
- Track extraction failed

## Extraction Job Queue

The studio should expose active PDF/image OMR jobs near the track board.

Each job item should show:

- Source filename
- Suggested or originating track
- Status: queued, running, review ready, completed, or failed
- Method or failure message

The UI should poll active OMR jobs until they become review candidates or fail.
Successful OMR jobs must feed the same candidate approval queue as other
uncertain extraction paths.

When an OMR job produces multiple mapped track candidates, the job item should
offer a single register-all action. This action approves all pending candidates
from the job into their suggested tracks. If any destination track already has
content, the UI must require explicit overwrite confirmation before enabling
the register-all action.

## PDF Export

The main studio toolbar should expose PDF export when at least one track is
registered.

Export behavior:

- Download a PDF generated from registered TrackNote data.
- Include studio title, BPM, time signature, track names, measure markers, and
  staff-like note placement.
- Fail clearly when no registered track exists.

## Bottom Report Feed

The bottom of the studio is reserved for scoring reports.

Reports should feel like a chronological feed of practice attempts, but the
studio feed should stay compact. Each feed item should show only report title
and date/time, then link to the full report page.

## Out Of Scope

The main studio should not center:

- A single guide waveform as the primary object
- A separate arrangement workbench
- Share-link authoring
- Ops or release status
