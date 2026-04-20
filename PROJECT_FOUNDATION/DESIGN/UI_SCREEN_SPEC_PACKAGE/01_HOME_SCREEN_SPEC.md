# 01 Home Screen Spec

Date: 2026-04-20

Screen ID: `HOME`

## Job

Let the user create a six-track studio either from uploaded material or from a
blank track set.

## Required Inputs

- Project name
- BPM
- Time signature, defaulting to 4/4
- Source method

Source methods:

- Upload and start (`업로드 후 시작`)
- Start blank (`새로 시작`)

## Upload And Start

When Upload and start is chosen, the user can upload one source file.

Supported source categories:

- Score
- Music

The UI must make the user understand that upload is used to seed the six tracks.

### Score Upload Behavior

If the uploaded score is an a cappella score:

- Try to identify Soprano, Alto, Tenor, Baritone, Bass, and Percussion parts.
- Register every identifiable part into the matching track.
- Leave unmatched tracks empty.

If the uploaded score is not an a cappella score:

- Extract the main melody.
- Register it into the most appropriate track.
- Leave the remaining tracks empty.

If extraction is uncertain:

- Show extracted candidates.
- Let the user choose target tracks before studio creation completes.

For PDF or image score input:

- Create the studio with empty six-track state.
- Queue an Audiveris OMR extraction job.
- Navigate to the studio so the user can watch the OMR queue and approve
  candidates when they are ready.
- Do not register placeholder fixture notes as if PDF extraction succeeded.

### Music Upload Behavior

If the uploaded source is music:

- Analyze the source for usable part candidates.
- Register every reliable candidate into an appropriate track.
- Leave uncertain or unavailable tracks empty.

The UI must not imply perfect source separation when only one reliable line was
found.

## Start Blank

Start blank creates a studio immediately.

All six tracks start empty:

- Soprano empty
- Alto empty
- Tenor empty
- Baritone empty
- Bass empty
- Percussion empty

## Primary Actions

- Upload and start (`업로드 후 시작`)
- Start blank (`새로 시작`)

## Failure States

Upload failure must leave the user on the home flow with:

- Reason for failure
- Retry action
- Start blank option still available

Unsupported files must fail before studio data is corrupted.

## Out Of Scope

The home screen must not expose:

- Share review
- Ops
- Recent project management as the primary task
- Marketing hero sections
- Arrangement-specific setup
