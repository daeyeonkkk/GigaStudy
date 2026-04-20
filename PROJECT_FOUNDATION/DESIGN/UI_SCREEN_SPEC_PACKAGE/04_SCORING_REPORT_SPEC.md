# 04 Scoring Report Spec

Date: 2026-04-20

## Job

Let the user sing a target track while hearing selected references, then receive
a useful pitch/rhythm report.

## Entry

Scoring is available only on a registered track.

The clicked track is the target part the user will sing.

The target track must already have registered TrackNote data. That data is the
answer sheet for scoring.

## Checklist

When Scoring is clicked, show a checklist.

Checklist items:

- Track 1
- Track 2
- Track 3
- Track 4
- Track 5
- Track 6
- Metronome

Actions:

- Start (`시작`)
- Cancel (`취소`)

The checklist controls what the user hears as reference, not which track is
being scored. The target track is determined by the Scoring button that opened
the checklist.

Reference tracks and the metronome are playback context only. They are not used
as the answer key for the target part.

## Start Behavior

When Start is clicked:

- Checked tracks play together.
- Checked metronome plays if selected.
- If no tracks are checked but Metronome is checked, the metronome plays by
  itself as the timing reference.
- Microphone turns on.
- The user's attempt starts recording.

## Stop Behavior

When Stop is clicked:

- Reference playback stops.
- Microphone recording stops.
- The performance is converted to TrackNote data.
- Scoring begins after offline sync alignment.

The analysis checks:

- Pitch
- Rhythm
- Missing notes
- Extra notes
- Global timing offset

Resolution:

- 0.01 second timing resolution

## Report Feed

When scoring completes, append a report at the bottom of the studio.

Studio feed item style:

- Feed item
- Chronological
- Compact and scannable
- Shows report title and date/time only
- Opens a separate report detail page when clicked

The full report detail page includes:

- Target track
- Reference tracks
- Whether metronome was used
- Answer note count
- Performance note count
- Matched note count
- Missing note count
- Extra note count
- Detected sync offset
- Overall score
- Pitch score
- Rhythm score
- Mean absolute pitch error
- Mean absolute timing error
- Issue list with timestamps, expected/actual labels, timing error, and pitch
  error

The studio page must not render the full issue list inline at the bottom of the
studio. Full metrics and issue details belong on the report detail page.

## Report Language

Reports must answer:

- Where did the user drift?
- Was the drift pitch, rhythm, or both?
- Did the user sing high, low, early, or late?

Reports must not require:

- LLM-written narrative summaries
- User-facing explanations of why a correction helps
- Long coaching paragraphs

## Failure States

Scoring can fail if:

- Microphone permission is denied
- No reference is selected and metronome is off, if the product requires a
  timing reference
- The target track has no answer TrackNotes
- Target track material is invalid
- Analysis fails

Failures should not create misleading reports.
