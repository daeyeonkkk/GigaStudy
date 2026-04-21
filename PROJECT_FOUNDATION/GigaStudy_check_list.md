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
- [ ] Music upload path is production-grade beyond fixture fallback.
- [x] Blank start creates six empty tracks.
- [x] Upload import can register track candidates into the six track slots.
- [x] Import failure is clear and recoverable.
- [x] Home-screen PDF upload queues real OMR instead of placeholder
  registration.

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
- [x] Soprano through Bass notation uses clef-aware staff anchors so high
  soprano and low bass notes remain inside the score viewport.
- [x] Score rendering includes inferred key-signature marks next to the clef.
- [x] MusicXML/MIDI import can preserve source time signature metadata.
- [x] Voice extraction and AI generation inherit the studio time signature.
- [x] Dense note runs expand score width instead of overlapping.
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
- [x] Track upload UI advertises WAV as the only production-ready local audio
  input.
- [ ] Upload supports every advertised audio extension with real decoding.
- [x] Upload accepts supported MIDI formats.
- [x] Upload accepts supported score formats.
- [x] PDF/image score upload is fully covered by OMR job tests.
- [x] Active OMR jobs are visible and auto-refreshed in the studio UI.
- [x] OMR candidates preserve `source="omr"` instead of looking like direct
  MusicXML imports.
- [x] OMR job results can be registered into all suggested tracks at once.
- [x] Unsupported upload fails without corrupting the track.
- [x] Upload can create pending extraction candidates instead of immediately
  overwriting a track.
- [x] Pending extraction candidates can be approved into a track.
- [x] Pending extraction candidates can be approved into a different target
  track.
- [x] Candidate approval into an occupied target requires overwrite
  confirmation.
- [x] Candidate review shows compact note preview data.
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

## Out Of Scope Until The Core Works

- [x] No standalone arrangement workspace is treated as a core requirement.
- [x] No standalone shared review workspace is treated as a core requirement.
- [x] No ops screen is treated as a core requirement.
- [x] No calibration/evidence process is treated as a core product flow.
- [x] No natural human voice audio generation is treated as a core requirement.
- [x] No mixed choir SATB source separation is promised as an MVP capability.
