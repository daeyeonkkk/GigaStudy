# GigaStudy Checklist

Date: 2026-04-23

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
- [x] Studio toolbar has an explicit Home button back to the launch screen.
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
- [x] Registered track score display uses VexFlow SVG engraving rather than
  CSS pseudo-noteheads/stems/ties.
- [x] Registered track notes render duration-aware engraved notation for whole,
  half, quarter, eighth, sixteenth, and dotted values when the TrackNote rhythm
  supports it.
- [x] Long notes that cross measure boundaries render display-only tied
  segments without mutating the stored TrackNote.
- [x] Explicit `TrackNote.is_tied` metadata renders note-to-note ties only when
  adjacent same-pitch timing supports a real continuation.
- [x] Note centers remain inside their owning measure; downbeat notes use
  measure-internal notation padding rather than sitting outside the barline.
- [x] Soprano through Bass notation uses VexFlow clefs and ledger lines so high
  soprano and low bass notes are engraved instead of visually clamped.
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
- [x] Playback source can be switched between retained recording audio and
  synthesized score notes.
- [x] Global playback can layer all registered tracks together from retained
  recordings where available.

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
- [x] Voice extraction filters noisy frames with adaptive RMS thresholding,
  high zero-crossing rejection, autocorrelation confidence, pitch stability,
  and minimum segment duration.
- [x] Noise-only or non-singing recordings fail as recoverable extraction
  errors instead of registering dense false notes.
- [x] Browser upload decodes supported MP3/M4A/OGG/FLAC audio and normalizes it
  to WAV before server-side voice extraction.
- [x] Upload supports every advertised browser-decodable audio extension with a
  real decode path before extraction.
- [x] Registered voice/audio tracks retain the normalized source audio for
  playback while TrackNote data remains the scoring/generation truth source.
- [x] Upload accepts supported MIDI formats.
- [x] Upload accepts supported score formats.
- [x] PDF/image score upload is fully covered by OMR job tests.
- [x] API Docker image includes an Audiveris Linux runtime and configures the
  default CLI path for Cloud Run OMR execution.
- [x] Full-score PDF/image OMR attempts Soprano through Bass instead of
  surfacing the job as a Soprano-only extraction.
- [x] Born-digital notation PDFs have a vector fallback that can read staff
  rows, part labels, key signatures, and notehead glyph positions when
  Audiveris is unavailable or fails.
- [x] Audiveris timeout is treated as an OMR engine failure that still allows
  born-digital PDF vector fallback to run.
- [x] Four-part PDF score extraction maps top-to-bottom into Soprano, Alto,
  Tenor, and Baritone while leaving Bass empty.
- [x] Active OMR jobs are visible and auto-refreshed in the studio UI.
- [x] Active voice extraction jobs are visible and auto-refreshed in the same
  studio extraction queue.
- [x] Failed OMR/voice extraction jobs can be retried while the original input
  asset is still retained.
- [x] Failed extraction jobs show contextual retry guidance for noisy voice
  takes, vector fallback failure, and Audiveris timeout cases.
- [x] OMR candidates preserve `source="omr"` instead of looking like direct
  MusicXML imports.
- [x] OMR candidates carry decision diagnostics such as track name, note count,
  measure count, confidence, range fit, rhythm grid fit, density, and review
  hints.
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
- [x] Candidate review shows OMR/uncertain-extraction diagnostics so the user
  can compare candidates by musical and source-derived evidence rather than
  raw engine method names.
- [x] Candidate review can open the retained OMR source page as a first-page
  visual preview before approval.
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
- [x] Vocal AI generation uses distinct voice-leading profiles and similarity
  filtering so generated candidates differ by register, motion, and contour.
- [x] AI generation candidate labels summarize musical choice information
  instead of generic Candidate 1/2/3 labels.
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
- [x] Start plays selected reference tracks through speakers using the current
  audio-or-score playback source.
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

## Admin / Storage Operations

- [x] `/admin` page uses the lightweight alpha login `admin` / `대연123`.
- [x] `/admin` login accepts `대연123` plus alpha keyboard aliases
  `eodus123` and `daeyeon123`.
- [x] Admin API accepts the configured admin username/password headers.
- [x] Admin API still accepts `X-GigaStudy-Admin-Token` when
  `GIGASTUDY_API_ADMIN_TOKEN` is configured.
- [x] `/admin` page can inspect total metadata/file usage by studio.
- [x] `/admin` page can delete an entire studio and its stored upload/job
  asset directories.
- [x] `/admin` page can delete all stored files for one studio while keeping
  normalized TrackNote/report metadata.
- [x] `/admin` page can delete an individual stored file and clear track,
  candidate, or OMR job references to that file.
- [x] `/admin` page can delete abandoned staged direct-upload files that were
  never promoted into a studio.
- [x] `/admin` page can delete only expired staged direct-upload files.
- [x] Studio metadata storage can use Postgres/Neon through
  `GIGASTUDY_API_DATABASE_URL`, with local JSON kept as the development
  fallback.
- [x] Studio list API uses summary-only pagination instead of returning every
  full studio document.
- [x] Studio detail API loads one requested studio document instead of reading
  the entire studio list.
- [x] Admin storage summary pages studio rows and limits per-studio asset
  detail rows.
- [x] Reports and extraction/generation candidates are stored as sidecar data
  outside the primary studio document while preserving the API response shape.
- [x] Upload, recording, and OMR job assets can use S3-compatible object
  storage such as Cloudflare R2 through `GIGASTUDY_API_STORAGE_BACKEND=s3`,
  with local filesystem storage kept as the development fallback.
- [x] Per-track uploads can use a signed/direct-upload compatible flow before
  finalizing TrackNote extraction with a stored `asset_path`.
- [x] Home-start uploads can use staged direct upload before a studio id exists,
  then create the studio with `source_asset_path`.
- [x] R2 bucket CORS is configured to allow browser `PUT` plus `Content-Type`
  from the deployed Pages origin for the presigned upload path.
- [x] Cloud Run local filesystem is treated as temporary engine/cache space
  when object storage is configured, not as the durable source of truth.
- [x] Scoring performance audio is temporary extraction input and is deleted
  after TrackNote extraction instead of being listed as a retained admin asset.
- [x] API upload payloads have a configurable byte limit for the free-plan
  memory/request envelope.
- [x] Stored assets are indexed in an asset registry instead of relying on
  whole-bucket scans for admin totals and cleanup state.
- [x] Admin storage summary exposes alpha operating limits and warnings.
- [x] Studio creation is blocked at the configured alpha hard cap.
- [x] Upload/generated asset writes are blocked at the configured alpha hard
  storage cap.
- [x] OMR and voice extraction use a durable engine queue with Postgres/Neon
  backing in deployed alpha and local JSON fallback in development.
- [x] Queued extraction jobs persist replay-critical options in studio metadata
  so retry/recovery does not rely on a surviving queue payload alone.
- [x] OMR and voice extraction still honor the free-plan one-active-engine-job
  lane by default.
- [x] Studio list/detail/action APIs are scoped by a hashed per-browser owner
  token by default, so the alpha UI no longer exposes every studio to every
  visitor.
- [x] Live deployment sets the Postgres/R2 environment variables and verifies
  admin storage summary against the deployed service.
- [x] Staged object cleanup has an app-level lifecycle policy driven by
  retention and cleanup-interval settings.
- [x] Browser-to-R2 direct upload/signed URL flow is implemented for existing
  studio track uploads and staged home-start uploads.
- [x] Manual admin cleanup exists for abandoned and expired staged upload
  objects.
- [x] OMR/voice extraction has a durable queue before Cloud Run maxScale is
  raised above one instance.
- [x] Admin/scheduler endpoint can drain a bounded number of queued or expired
  OMR/voice extraction jobs without requiring a studio page poll.
- [x] 2026-04-23 런타임 보강 게이트를 통과했다: API 68/68, 웹
  lint/build, 브라우저 E2E 24/24.
- [x] External unattended scheduler configuration exists for alpha:
  Cloud Scheduler job `gigastudy-engine-drain` calls the admin queue drain
  endpoint every 5 minutes with a 300 second attempt deadline.
- [x] 2026-04-23 live Cloud Run OMR smoke passed: API revision
  `gigastudy-api-alpha-00016-k5r` converted `Phonecert_-_10cm.pdf` into
  Soprano through Bass `pdf_vector_omr` review candidates after Audiveris timed
  out.

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
- [x] Production web builds default to the live alpha Cloud Run API unless
  `VITE_API_BASE_URL` explicitly overrides it.
- [x] Studio page presentation is split into dedicated toolbar, track board,
  extraction queue, candidate review, report feed, and scoring drawer
  components.
- [x] Score rendering math is isolated from the page component.
- [x] Visible browser score engraving is isolated in
  `components/studio/EngravedScoreStrip.tsx`.
- [x] Browser score notation has a dedicated `scoreEngraving` adapter that
  converts normalized `TrackNote` data into measure-local VexFlow events with
  variable measure widths, real dotted durations, beam groups, rests, and
  adjacent-segment ties.
- [x] Studio playback in audio mode uses retained recording/upload media URLs
  directly instead of decoding recorded files into Web Audio buffers before
  playback.
- [x] Track, global, and scoring-reference playback all follow the same
  audio-first/source-toggle policy.
- [x] 2026-04-23 실사용 재생/악보 이슈 재검증: 웹 lint/build 통과,
  브라우저 E2E 21/21 통과, Playwright 로컬 브라우저에서 라이브
  스튜디오 payload 기준 VexFlow 렌더 콘솔 오류 없음, Tenor 재생 버튼이
  실제 track audio URL을 `HTMLMediaElement.play()`로 호출함을 확인.
- [x] 2026-04-23 전체 프로세스 점검: API 65/65, 웹 lint, 프로덕션
  빌드, 브라우저 E2E 21/21 통과. 실제 `Phonecert_-_10cm.pdf`는
  `pdf_vector_omr` 경로로 Soprano~Bass 후보를 모두 생성했고, live
  alpha admin/storage 읽기 전용 확인도 성공했다.

## Out Of Scope Until The Core Works

- [x] No standalone arrangement workspace is treated as a core requirement.
- [x] No standalone shared review workspace is treated as a core requirement.
- [x] No ops screen is treated as a core requirement.
- [x] No calibration/evidence process is treated as a core product flow.
- [x] No natural human voice audio generation is treated as a core requirement.
- [x] No mixed choir SATB source separation is promised as an MVP capability.
