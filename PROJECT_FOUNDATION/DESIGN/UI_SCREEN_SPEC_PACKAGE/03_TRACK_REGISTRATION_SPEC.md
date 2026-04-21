# 03 Track Registration Spec

Date: 2026-04-20

## Job

Let the user put material into any of the six tracks.

All successful registration methods produce TrackNote pitch/rhythm data. The
current foundation does not require natural human voice audio generation.

## Registration Methods

Each track supports:

- Record (`녹음`)
- Upload (`업로드`)
- AI Generate (`AI 생성`)

## Record

When Record is clicked:

- Microphone turns on.
- The selected track enters recording state.
- If metronome is enabled, metronome plays.
- Record button becomes Stop.
- The track shows elapsed recording time and browser input level feedback.

When Stop is clicked:

- Recording stops.
- The captured browser audio is encoded as WAV.
- The WAV is sent through the single-voice extraction path.
- Usable voice material is extracted.
- TrackNote material is generated.
- The result is registered into the selected track.

If the track already had content:

- The user must explicitly confirm overwrite before recording starts.
- The new result replaces the previous track content only after confirmation.

## Upload

Upload opens a file picker or upload dialog.

Supported categories:

- Voice/audio file. Browser-decodable MP3/M4A/OGG/FLAC input is normalized to
  mono 16-bit PCM WAV before it reaches the server-side single-voice extraction
  path. Raw server-side voice extraction still expects WAV.
- MIDI file
- Score file

NWC score upload is deferred until a parser exists and should not be advertised
in the upload picker.

After upload:

- Detect file type.
- Reject unsupported formats.
- Extract required TrackNote material.
- For WAV voice input, use the single-voice transcription path with dynamic
  thresholding and note segmentation.
- For PDF/image score input, save the source, queue an Audiveris OMR job, poll
  job state in the studio UI, and turn successful OMR MusicXML output into
  reviewable `source="omr"` TrackNote candidates.
- Either register the result into the selected track, or create reviewable
  extraction candidates when the result is uncertain or the UI asks for user
  approval before changing track content.

When an extraction candidate is created:

- The suggested track enters a review-needed state.
- The candidate shows source, method, confidence, note count, and suggested
  target track.
- The candidate shows a compact symbolic preview, including duration, pitch
  range, and first note/beat events.
- The user can change the approval target to any of the six tracks.
- If the chosen target already has content, approval requires an explicit
  overwrite confirmation.
- Approve registers the candidate's TrackNote material into the target track.
- Reject leaves the current track content unchanged, or returns a review-only
  empty track to empty.

If upload fails:

- Keep existing track content unchanged.
- Show the failure reason.

If upload succeeds on an occupied track:

- Direct registration paths overwrite intentionally.
- Candidate approval paths require explicit overwrite confirmation before
  replacing existing track content.

## AI Generate

AI Generate is enabled only when at least one track is registered in the studio.

When clicked on tracks 1-5:

- Use existing tracks as musical context.
- Generate the selected vocal part as symbolic TrackNote data.
- Create multiple review candidates for the selected target track.
- Register only the candidate the user approves.

When clicked on track 6, Percussion:

- Use BPM, meter, and existing track rhythm as context.
- Generate beatbox or percussion-like rhythm material.
- Do not generate harmonic vocal notes as the primary result.
- Do not generate natural percussion audio as the primary result.

If AI Generate is clicked on an occupied track:

- Treat it as Regenerate.
- Generate review candidates without overwriting the current registered
  content.
- Require explicit overwrite confirmation only when the user approves a
  candidate into the occupied track.

## Track Statuses

Recommended statuses:

- Empty
- Recording
- Uploading
- Extracting
- Generating
- Needs review
- Registered
- Failed

The UI should show status per track, not only globally.
