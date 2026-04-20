# 05 Interaction Matrix

Date: 2026-04-20

## Home

| User action | Result |
| --- | --- |
| Enter project name | Updates pending studio metadata |
| Enter BPM | Updates pending studio tempo |
| Enter time signature | Updates pending studio meter |
| Choose Upload and start | Opens source upload path |
| Upload score | Extracts score parts and seeds tracks |
| Upload music | Extracts usable TrackNote material where possible |
| Choose Start blank | Creates studio with six empty tracks |

## Global Studio Transport

| User action | Result |
| --- | --- |
| Play/Pause | Plays or pauses all registered tracks together |
| Stop | Returns all tracks to synced 0 seconds |
| Toggle metronome | Enables/disables metronome for recording/scoring contexts |

## Empty Track

| User action | Result |
| --- | --- |
| Record | Starts microphone recording for that track, with metronome if enabled and visible input level feedback |
| Stop while recording | Encodes browser WAV, extracts pitch/rhythm, and registers TrackNote material |
| Upload | Opens upload dialog for WAV, MIDI, and score sources; may create a reviewable extraction candidate |
| AI Generate disabled | Shows that at least one existing track is required |
| AI Generate enabled | Generates symbolic TrackNote material for that target track |

## Needs Review Track

| User action | Result |
| --- | --- |
| Approve candidate | Writes the candidate TrackNotes into the target track and marks it registered |
| Change candidate target track | Changes where approval will register the candidate |
| Approve into occupied target without confirmation | Blocks approval and asks for overwrite confirmation |
| Confirm overwrite and approve | Replaces the target track with the candidate TrackNotes |
| Reject candidate | Rejects the candidate and leaves existing track content unchanged |
| Upload again | Creates a new extraction attempt for the selected track |

## Registered Track

| User action | Result |
| --- | --- |
| Track Play/Pause | Plays or pauses only that track |
| Track Stop | Returns that track to synced 0 seconds |
| Sync -0.01 | Moves track earlier by 0.01 seconds |
| Sync +0.01 | Moves track later by 0.01 seconds |
| Upload/Replace | Replaces the registered track through upload |
| Record/Replace | Requires overwrite confirmation, then records and replaces the track |
| AI Generate/Regenerate | Requires overwrite confirmation, then replaces the track through generation |
| Scoring | Opens scoring checklist for that target track |

## Scoring Checklist

| User action | Result |
| --- | --- |
| Check Track 1-6 | Includes that track as reference playback |
| Check Metronome | Includes metronome as reference, even with no checked tracks |
| Start | Starts selected references and microphone recording |
| Cancel | Closes checklist without scoring |
| Stop during scoring | Stops recording, aligns the take offline, and creates a report |

The target track's registered TrackNotes are the answer sheet. Checked tracks
and metronome are playback context only.

## Report Feed

| User action | Result |
| --- | --- |
| Scoring completes | Appends a compact report item to the bottom feed |
| View studio report feed | User sees report title and date/time only |
| Click report item | Opens a separate full report page |
| Read full report page | User sees scores, detected sync offset, matched/missing/extra notes, and issue-level pitch/rhythm errors |
| Start another scoring session | Creates another chronological report |
