# 00 Global UI Fixed Spec

Date: 2026-04-20

## Product Shape

GigaStudy is a tool UI, not a marketing site.

The interface should prioritize:

- Clear track state
- Fast recording/upload/generation actions
- Accurate timing feedback
- Scannable scoring reports

## Layout Principles

- The six tracks are the primary object.
- Controls should be placed where the user expects to act.
- Global transport belongs above the track stack.
- Per-track actions belong on the track row.
- Reports belong below the studio as a feed/history area.

## Composer Shell Reference

The visual reference is a classic score viewer/composer, similar in spirit to
NoteWorthy Composer:

- App title bar, menu bar, compact toolbar, white score paper, and bottom status
  bar are appropriate.
- The reference should guide hierarchy and affordance, not become a literal skin.
- The score canvas stays central; decorative dashboards, marketing hero blocks,
  and unrelated side workbenches should not compete with the tracks.
- Use familiar symbols for transport and tools where they improve scanning.

## Tone

Use practical studio language.

Good labels:

- Upload and start / `업로드 후 시작`
- Start blank / `새로 시작`
- Record / `녹음`
- Stop / `중지`
- Upload / `업로드`
- AI Generate / `AI 생성`
- Scoring / `채점`
- Sync / `싱크`
- Report / `리포트`

Avoid broad product language such as:

- Workspace intelligence
- Arrangement journey
- Share-ready artifact pipeline
- Ops readiness

## Track Colors

The UI may use subtle track identity colors, but color must not be the only
state indicator.

Suggested track accents:

- Soprano: rose
- Alto: amber
- Tenor: teal
- Baritone: blue
- Bass: indigo
- Percussion: gray

## Button Rules

- Primary action on home: Upload and start or Start blank.
- Primary action on an empty track: Record.
- Secondary actions on an empty track: Upload and AI Generate.
- AI Generate stays disabled until at least one track is registered.
- Primary action in scoring checklist: Start.
- Destructive overwrite must be explicit when replacing existing track content.

## Timing Rules

- Sync values are displayed in seconds with two decimal places.
- Sync step size is 0.01 seconds.
- Stop returns playback to the synced start point.
- Stop must not reset sync values.

## Empty State Rules

An empty track should explain the next action through controls, not long copy.

Required empty track actions:

- Record
- Upload
- AI Generate

## Report Rules

Reports must be readable as practice notes.

Every report should include:

- Target track
- Reference tracks heard during scoring
- Time range or timestamp for each issue
- Pitch result
- Rhythm result
- Plain-language correction hint
