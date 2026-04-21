# GigaStudy Checklist

Date: 2026-04-21

This checklist tracks the new six-track studio foundation only.

## Product Definition

- [x] Product is defined as a six-track a cappella practice studio.
- [x] The six canonical tracks are named.
- [x] The three core user flows are documented.
- [x] Legacy guide/arrangement/share/ops foundation material is removed.
- [x] Every task must follow `WORKING_PROTOCOL.md`.
- [x] Canonical engine contract is documented in `ENGINE_ARCHITECTURE.md`.
- [x] Track content is defined as TrackNote pitch/rhythm data.
- [x] Uncertain extraction can be held as a user-reviewable candidate before
  registration.

## Home Screen

- [x] User can enter project name.
- [x] User can enter BPM only for blank start.
- [x] User can enter or inherit a time signature only for blank start.
- [x] User sees Upload and start only after selecting a source file.
- [x] User sees Start blank only while no source file is selected.
- [x] Score upload path exists.
- [ ] Music upload path is production-grade beyond the current
  browser-normalized single-line extraction MVP.
- [x] Blank start creates six empty tracks.
- [x] Upload import can register track candidates into the six track slots.
- [x] Import failure is clear and recoverable.
- [x] Home-screen PDF upload queues real OMR instead of placeholder
  registration.
- [x] NWC is not advertised as supported until an NWC-to-TrackNote parser is
  connected.

## Track Workspace

- [x] Main studio centers six fixed tracks.
- [x] Track 1 is Soprano.
- [x] Track 2 is Alto.
- [x] Track 3 is Tenor.
- [x] Track 4 is Baritone.
- [x] Track 5 is Bass.
- [x] Track 6 is Percussion.
- [x] Empty tracks expose Record/Stop, Upload, and AI Generate.
- [x] AI Generate is disabled until at least one track is registered.
- [x] Registered tracks expose Play/Pause, Stop, and Scoring.
- [x] Each track has score display.
- [x] Registered track score display is horizontally scrollable by measure.
- [x] Registered track notes are positioned from `TrackNote.beat` on the studio
  time-signature grid.
- [x] Registered track notes render duration-aware glyph classes for whole,
  half, quarter, eighth, and sixteenth-note values.
- [x] Long notes that cross measure boundaries render display-only tied
  segments without mutating the stored TrackNote.
- [x] Explicit `TrackNote.is_tied` metadata renders tie arcs when adjacent
  same-pitch timing supports it.
- [x] Note centers remain inside their owning measure; downbeat notes use
  measure-internal notation padding rather than sitting outside the barline.
- [x] Soprano through Bass notation uses clef-aware staff anchors so high
  soprano and low bass notes remain inside the score viewport.
- [x] Key-signature marks are hidden in the current renderer to avoid clipped
  or misleading notation until reliable layout support is added.
- [x] MusicXML/MIDI import can preserve source time signature metadata.
- [x] Voice extraction and AI generation inherit the studio time signature.
- [x] Dense note runs expand score width instead of overlapping.
- [x] Same-onset cluster offsets never move notes outside fixed measure
  boundaries.
- [x] Each track has 0.01 second sync adjustment.
- [x] Sync adjustment keeps measure lines fixed and shifts only the note layer.

## Global Transport

- [x] Top Play/Pause controls all registered tracks together.
- [x] Top Stop returns all tracks to synced 0 seconds.
- [x] Top Stop does not reset per-track sync values.
- [x] Metronome toggle is visible globally.
- [x] Metronome participates in recording/scoring only when enabled.
- [x] Metronome uses the studio time-signature denominator pulse and accents
  measure downbeats.

## Track Registration

- [x] Recording turns on the microphone for track registration.
- [x] Recording respects metronome toggle.
- [x] Recording shows elapsed time and browser input level feedback.
- [x] Stop after recording extracts usable track material instead of fixture
  registration.
- [x] Recording into an occupied track overwrites intentionally.
- [x] Upload accepts a local WAV single-voice extraction path.
- [x] Local WAV extraction handles quiet takes, leading silence, and separated
  notes with short gaps.
- [x] Browser upload decodes supported MP3/M4A/OGG/FLAC audio and normalizes it
  to WAV before server-side voice extraction.
- [x] Upload supports every advertised browser-decodable audio extension with a
  real decode path before extraction.
- [x] Upload accepts supported MIDI formats.
- [x] Upload accepts supported score formats.
- [x] PDF/image score upload is fully covered by OMR job tests.
- [x] Active OMR jobs are visible and auto-refreshed in the studio UI.
- [x] OMR candidates preserve `source="omr"` instead of looking like direct
  MusicXML imports.
- [x] OMR job results can be registered into all suggested tracks at once.
- [x] Unsupported upload fails without corrupting the track.
- [x] Public registration APIs reject missing upload content instead of creating
  fixture notes.
- [x] Legacy stored fixture note sources are normalized on read rather than
  remaining part of the current TrackNote source contract.
- [x] Upload can create pending extraction candidates instead of immediately
  overwriting a track.
- [x] Pending extraction candidates can be approved into a track.
- [x] Pending extraction candidates can be approved into a different target
  track.
- [x] Candidate approval into an occupied target requires overwrite
  confirmation.
- [x] Candidate review shows decision-oriented musical summaries instead of
  only method/confidence system fields.
- [x] Candidate review shows compact note preview data and contour-style flow
  cues when pitch data is available.
- [x] Pending extraction candidates can be rejected without registering notes.
- [x] Upload into an occupied track overwrites intentionally.
- [x] AI generation uses registered tracks as context.
- [x] Vocal AI generation estimates key/chord context and uses voice-leading
  constraints rather than fixed interval cloning.
- [x] Vocal AI generation avoids known-slot voice crossing and penalizes
  parallel perfect fifth/octave motion where context voices are known.
- [x] Vocal AI generation has phrase-aware cadence bias and weak-beat scale
  connector support so generated lines are less mechanically chord-only.
- [x] AI generation creates multiple pending candidates by default.
- [x] Approving one AI candidate registers it and rejects sibling candidates
  from the same generation run.
- [x] AI candidate approval into an occupied track requires overwrite
  confirmation.
- [x] Percussion generation creates rhythm/beat material, not harmonic vocals.
- [x] Percussion generation resets rhythm patterns on each studio measure
  downbeat.
- [x] AI generation produces symbolic TrackNote data, not natural voice audio.

## Scoring

- [x] Scoring is enabled only after a track is registered.
- [x] Scoring requires the target track's TrackNotes as the answer sheet.
- [x] Other tracks are references, not the scoring truth source.
- [x] Scoring opens a checklist.
- [x] Checklist includes Track 1 through Track 6.
- [x] Checklist includes Metronome.
- [x] Checklist has Start.
- [x] Checklist has Cancel.
- [x] Start plays selected references together.
- [x] Start plays the checked metronome, including metronome-only scoring.
- [x] Start attempts microphone capture.
- [x] Stop ends recording and begins scoring.
- [x] Scoring auto-aligns global sync before comparing notes.
- [x] Scoring checks pitch at 0.01 second resolution.
- [x] Scoring checks rhythm at 0.01 second resolution.
- [x] Report says where the user drifted.
- [x] Report says how the user drifted using quantitative error fields.
- [x] Compact report title/date appears at the bottom of the studio as a feed
  item.
- [x] Full report opens on a separate report detail page.
- [x] Report does not depend on LLM-written coaching text.

## Export

- [x] Registered six-track score can be exported as a PDF.
- [x] PDF export uses registered TrackNote data, studio BPM, and studio meter.
- [x] PDF export refuses empty studios instead of generating a misleading file.

## Implementation Structure

- [x] Studio upload file-type routing is isolated from the page component.
- [x] Browser AudioContext access is isolated from upload, recording, and
  playback features.
- [x] WAV encoding is shared by browser upload normalization and microphone
  recording.
- [x] Microphone recording lifecycle is isolated from studio UI state.
- [x] Studio BPM/meter timing helpers are isolated from rendering and playback
  callers.
- [x] TrackNote playback and metronome scheduling are isolated from studio UI
  state.
- [x] Browser audio infrastructure and studio-domain helpers are grouped under
  separate `lib/audio` and `lib/studio` module boundaries.
- [x] Studio page presentation is split into dedicated toolbar, track board,
  OMR queue, candidate review, report feed, and scoring drawer components.
- [x] Score rendering math is isolated from the page component.

## Out Of Scope Until The Core Works

- [x] No standalone arrangement workspace is treated as a core requirement.
- [x] No standalone shared review workspace is treated as a core requirement.
- [x] No ops screen is treated as a core requirement.
- [x] No calibration/evidence process is treated as a core product flow.
- [x] No natural human voice audio generation is treated as a core requirement.
- [x] No mixed choir SATB source separation is promised as an MVP capability.
