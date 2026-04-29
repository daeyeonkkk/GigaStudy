# Foundation Status

Date: 2026-04-24

## Current Decision

The foundation has been reset to the six-track a cappella studio direction.

The canonical product is:

1. Create or seed a six-track studio.
2. Fill, sync, and play Soprano, Alto, Tenor, Baritone, Bass, and Percussion.
3. Score a vocal attempt either against the target track's registered answer
   notes or as a new harmony part against selected reference tracks, then append
   a quantitative report.

The canonical engine rule is now documented in `ENGINE_ARCHITECTURE.md`.

The a cappella arrangement fit audit is documented in
`ACAPPELLA_ARRANGEMENT_AUDIT.md`: the current shared-score/grid model is
directionally correct, but the next quality bar is ensemble-aware validation
and explicit arrangement roles.

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
- The API Docker image now installs the Audiveris 5.10.2 Linux `.deb` during
  image build and sets `GIGASTUDY_API_AUDIVERIS_BIN` to
  `/opt/audiveris/bin/Audiveris`, matching the official Linux package layout.
  Local development can still use an explicitly configured Audiveris binary or
  a PATH-discoverable `audiveris`/`Audiveris` command. The container build
  extracts the `.deb` with `dpkg-deb -x` instead of running the package
  post-install scripts so the headless Cloud Build image is not blocked by
  desktop menu registration.
- PDF upload now has a born-digital vector fallback for notation-program PDFs
  such as MuseScore exports. If Audiveris is unavailable or fails, the engine
  can inspect PDF vector staff lines, visible part labels, key-signature
  accidentals, and SMuFL notehead glyph positions to create reviewable
  `source="omr"` candidates. Audiveris subprocess timeouts are normalized into
  the same unavailable/failure path so vector fallback still runs instead of
  leaving the job as a hard failure.
- OMR execution is now configurable through `GIGASTUDY_API_OMR_BACKEND`.
  `auto` keeps the Audiveris-first path with vector-PDF fallback, while
  `audiveris`, `pdf_vector`, and `vector_first` allow targeted runtime testing
  or faster born-digital PDF validation without changing product code.
- Audiveris now performs a scan-oriented preprocessing retry when the primary
  pass fails. PDF/image input is rendered into a high-DPI grayscale PDF
  workspace and retried, controlled by `GIGASTUDY_API_OMR_PREPROCESS_MODE` and
  `GIGASTUDY_API_OMR_PREPROCESS_DPI`.
- The vector fallback now clamps detected note positions to the valid measure
  onset grid and caps inferred durations at the owning measure boundary. The
  previously supplied `Phonecert_-_10cm.pdf` was verified locally as a
  born-digital score that yields Soprano through Bass review candidates.
- Full-score OMR jobs are treated as score-wide extraction, not Soprano-only
  extraction. Empty Soprano through Bass tracks enter the extraction state,
  successful parsed parts become candidates, and unmapped vocal placeholders
  are cleared back to empty. If a four-part score is parsed, the parts map
  top-to-bottom into Soprano, Alto, Tenor, and Baritone while Bass remains
  empty.
- Home-screen PDF score start now queues OMR instead of seeding fixture notes.
- Public registration endpoints no longer create fixture note data when no file
  or recording payload is supplied.
- Existing local JSON records with legacy `source="fixture"` notes are normalized
  on read so older development data does not block the current schema.
- Studio PDF/image upload exposes active OMR jobs, polls until completion or
  failure, and turns successful OMR output into reviewable candidates.
- OMR and per-track voice extraction now create durable engine queue records
  before processing. The queue is Postgres-backed when `GIGASTUDY_API_DATABASE_URL`
  is configured and local-JSON backed in development. Studio reloads can
  reschedule queued or expired running jobs, and failed jobs can be retried from
  the studio UI while the original input asset remains available. Replay
  options such as OMR part parsing, review-before-register, overwrite allowance,
  and audio MIME type are stored on the studio job as well as the queue payload
  so recovery does not depend on hidden in-memory state.
- Admin can manually or scheduler-trigger drain the durable engine queue through
  `POST /api/admin/engine/drain`. The endpoint processes a bounded number of
  queued or expired OMR/voice jobs using the same one-active-lane claim logic,
  so Cloud Run no longer depends only on a studio page poll to wake extraction.
  The live alpha service has a Cloud Scheduler job named
  `gigastudy-engine-drain` in `asia-northeast3`, enabled every 5 minutes in the
  `Asia/Seoul` time zone with a 300 second attempt deadline.
- OMR-generated notes are marked with `source="omr"` and
  `extraction_method="audiveris_omr_v0"`.
- Vector-PDF fallback notes are marked with `source="omr"` and
  `extraction_method="pdf_vector_omr_v0"` so they stay distinguishable from
  Audiveris MusicXML output.
- OMR candidates now include diagnostic metadata used for review decisions:
  engine/candidate method, suggested track, note count, measure count, duration,
  range label, average note confidence, range-fit ratio, rhythm-grid ratio,
  density, confidence label, and review hint. Vector PDF fallback also records
  detected page/part/staff evidence where available.
- OMR jobs that produce multiple mapped parts can be approved in one operation,
  registering candidates into their suggested tracks with overwrite protection.
- Registered TrackNote scores can be exported as a PDF from the studio toolbar.
  The export includes title, BPM, meter, track names, measure markers, and
  staff-like note placement.
- Single voice extraction exists as a local WAV v2 MVP with high-pass rumble
  filtering, adaptive voice thresholding, high zero-crossing rejection,
  normalized autocorrelation, confidence filtering, octave/outlier pitch-frame
  stabilization, pitch-stability filtering, short-click rejection, and median
  segment grouping.
- Voice transcription is now backend-selectable through
  `GIGASTUDY_API_VOICE_TRANSCRIPTION_BACKEND`. The default `auto` path can use
  an installed Spotify Basic Pitch note-event adapter, then librosa pYIN, then
  the local WAV engine; `basic_pitch`, `librosa`/`pyin`, and `local` can be
  forced for focused tests. Basic Pitch and librosa output still flow through
  the same TrackNote, BPM-grid, range, and notation normalization policy.
- Final voice-like track registration now compares the prepared notes against
  already registered sibling tracks and can apply a small deterministic
  reference-grid offset before committing TrackNotes. This is a latency/drift
  correction for extracted audio/voice/OMR-like material on the shared score
  paper, not a tempo rewrite. MusicXML/MIDI-style symbolic syncopation is left
  untouched so imported rhythm is not destroyed by another track's grid.
- Final registration now also runs an ensemble arrangement gate before commit.
  The gate checks the proposed track against already registered sibling tracks
  for range, voice crossing, adjacent spacing, parallel perfect motion, and
  overly thin chord coverage. It stores diagnostics on registered tracks and
  candidates, and annotates concrete target notes with ensemble warning flags.
  The gate is diagnostic-first in alpha so intentional contemporary a cappella
  choices are not silently overwritten.
- Ensemble registration now evaluates multi-track imports as one proposed
  score. MusicXML/MIDI startup imports, direct multi-track application, and bulk
  OMR approval prepare all incoming parts first, then validate each part against
  both existing registered tracks and the other incoming parts before writing
  them. For voice/audio/AI material, the gate can apply a bounded contextual
  octave repair when a note clearly sits in the wrong octave relative to sibling
  voices; symbolic score material is preserved and receives diagnostics only.
  Additional diagnostics now cover melodic singability, doubled leading-tone
  risk, and bass foundation height on structural downbeats.
- Noise-only or non-singing recordings are rejected instead of being registered
  as dense false notes.
- Browser upload normalizes browser-decodable MP3/M4A/OGG/FLAC audio into mono
  16-bit PCM WAV before sending it to the existing voice extraction path.
- NWC is not advertised as an accepted upload format until an NWC-to-TrackNote
  parser is connected.
- Per-track browser recording captures microphone audio, encodes WAV, and
  holds the recorded take in a browser-side review state. The user must either
  register the take, which starts the queued voice extraction path, or delete
  it. A stopped recording must not silently become a TrackNote extraction job.
- Registered voice/audio tracks retain their normalized source audio as a
  playback asset while keeping TrackNote data as the canonical scoring and
  generation source.
- Admin storage controls exist at `/admin` with the lightweight alpha login
  `admin` / `대연123`; the API also still accepts `GIGASTUDY_API_ADMIN_TOKEN`
  when configured. The page can inspect studio/file usage, delete a whole
  studio, delete all stored files for a studio while keeping normalized
  TrackNote/report data, or delete an individual stored asset and clear its
  audio/job references. It also has cleanup operations for expired staged
  direct-upload objects and for all abandoned staged objects that were never
  promoted into a studio.
- Admin password validation also accepts the alpha keyboard aliases
  `eodus123` and `daeyeon123` so an English-keyboard entry does not block
  testers who are trying to enter `대연123`.
- Alpha deployment now defaults studio list/detail/action routes to public
  access through `GIGASTUDY_API_STUDIO_ACCESS_POLICY=public`, so the launch
  screen and `/admin` can inspect and reopen existing studios without a stored
  owner token. Owner-token headers and query-token URLs still remain in the
  client/API contract for future private mode restoration, but alpha browsing is
  intentionally public.
- Studio metadata persistence is now abstracted. Local JSON remains the
  development fallback, while `GIGASTUDY_API_DATABASE_URL` enables a
  Postgres/Neon-backed `studio_documents` store.
- Studio listing and admin storage summary now use paginated repository access.
  `list_studios` returns summary rows only, `get_studio` loads the requested
  studio document only, and admin file details are limited per page instead of
  forcing the API to build every studio/file summary for each request.
- Report and extraction/generation candidate payloads are stored as sidecar
  data outside the main studio document. The API still returns the same Studio
  shape after loading, but large reports/candidate queues no longer grow the
  primary studio row in the durable store.
- Stored asset persistence is now abstracted. Local filesystem remains the
  development fallback, while `GIGASTUDY_API_STORAGE_BACKEND=s3` enables
  S3-compatible storage such as Cloudflare R2 for upload, recording, and OMR
  job assets.
- Stored assets are indexed in an asset registry separate from studio
  documents, so admin totals and deletion state do not depend on scanning every
  object path on each request.
- When object storage is configured, the API still writes local temporary files
  for parser/transcription/OMR engines, but durable asset truth is the object
  store and the local Cloud Run filesystem is only a cache/workspace.
- Scoring performance audio is now temporary extraction input. It is deleted
  after TrackNote extraction and is not retained as an admin-listed asset.
- Upload payload size is capped by `GIGASTUDY_API_MAX_UPLOAD_BYTES`, defaulting
  to 15 MiB, to keep the current base64 JSON path inside the alpha free-plan
  request and memory envelope.
- Per-track uploads now have a signed/direct-upload compatible path:
  the browser requests an upload target, uploads the binary file with `PUT`,
  then finalizes registration by passing the stored relative `asset_path` to
  the existing track upload pipeline. Local development receives an API proxy
  upload URL; S3/R2 deployments receive a presigned object-store URL.
- The live `gigastudy-alpha` R2 bucket has CORS configured for the deployed
  Pages origin and local dev origins via `ops/r2-cors.gigastudy-alpha.json`,
  allowing browser `PUT` with `Content-Type` for direct track uploads.
- Home-screen upload start now has a staged direct-upload path:
  `POST /api/studios/upload-target`, binary `PUT`, then
  `POST /api/studios` with `source_asset_path`. The API promotes the staged
  object into `uploads/{studio_id}/0/...` before running the existing symbolic,
  audio, or OMR pipeline. The browser keeps a base64 fallback if target creation
  or binary PUT fails.
- Abandoned home-start staged uploads can be removed through
  `DELETE /api/admin/staged-assets` and the `/admin` cleanup control. Expired
  staged uploads are also automatically cleaned when new upload targets are
  created, using `GIGASTUDY_API_STAGED_UPLOAD_RETENTION_SECONDS` plus
  `GIGASTUDY_API_LIFECYCLE_CLEANUP_INTERVAL_SECONDS`, and can be manually
  removed through `DELETE /api/admin/expired-staged-assets`. Staged objects
  remain outside normal studio asset listings until promotion succeeds.
- Scoring performance audio still uses the smaller existing base64/temporary
  path. It is deleted after extraction rather than retained as an admin-listed
  asset.
- Free-plan alpha operating limits are configurable and enforced in the API:
  studio soft warning 300, studio hard cap 500, asset warning 7 GiB, asset hard
  cap 8.5 GiB, file upload cap 15 MiB, and one active local engine job at a
  time.
- Live alpha verification on 2026-04-22 confirmed that Cloud Run is serving the
  API from Postgres-backed studio metadata and R2-backed stored assets, with
  `/api/admin/storage` reporting `s3://gigastudy-alpha` and the configured
  alpha limits.
- Per-track browser recording now opens the microphone, shows a one-measure
  count-in from the studio BPM/meter grid, and starts actual WAV capture on the
  following downbeat. The metronome toggle only mutes/unmutes audible clicks;
  the internal score clock still drives TrackNote timing. The UI shows count-in,
  elapsed-time, and input-level feedback.
- Voice-to-score is now a first-class engine contract, not merely raw pitch
  detection. Voice-derived notes must be fitted onto the immutable studio
  BPM/meter grid, cleaned for noise, assigned to measures, quantized
  consistently across tracks, and prepared with track-appropriate clef,
  key-signature, accidental, and range display policy before registration or
  review.
- Track assignment now uses a shared name-and-range scoring layer instead of a
  legacy average-pitch threshold. MusicXML/MIDI, OMR output, and home-start
  audio candidates are mapped by explicit labels when available and otherwise
  by duration/confidence-weighted pitch distribution, range fit, median/average
  pitch, percussion hints, and weak score-order tie-breaking. Multiple imported
  parts are assigned as one score-wide mapping so extracted tracks do not
  collide into the same slot.
- A backend notation normalization layer now implements that contract for
  voice-derived and rule-generated TrackNotes. It quantizes onto the studio grid,
  resolves monophonic overlaps, splits measure-crossing notes into tied pieces,
  estimates key signature, assigns spelling/accidentals, and applies the stable
  S/A treble, Tenor treble-8vb display, Baritone/Bass bass policy.
- Symbolic and OMR-derived notes now receive the same target-track notation
  metadata after assignment without rewriting trusted imported rhythm, so all
  six tracks render under the same clef/key/display policy.
- A synthetic voice-notation quality gate now runs before real singer testing.
  It generates WAV fixtures with human timing jitter, room noise, hum, vibrato,
  attack scoops, sustained notes crossing barlines, and tenor-range material, then
  verifies fixed-BPM quantization, measure-owned ties, clef/display metadata, and
  stable pitch labeling.
- Studio toolbar includes an explicit Home navigation control so users can
  leave a studio without relying on the small titlebar app mark.
- Launch now exposes the recent/public studio list as a first-class home-screen
  entry point, so alpha testers can reopen an existing studio directly from the
  homepage in addition to entering through `/admin`.
- Web studio responsibilities are split so upload detection, browser audio
  access, WAV encoding, recorder lifecycle, timing/meter math, and playback
  scheduling live in focused `apps/web/src/lib/audio/*` and
  `apps/web/src/lib/studio/*` modules instead of being
  embedded in `StudioPage.tsx`.
- Alpha API deployment is reproducible through `cloudbuild.api.yaml`; the Pages
  UI and Cloud Run API must expose the same `/api/studios` six-track contract.
- Production web builds default to the live alpha Cloud Run API when
  `VITE_API_BASE_URL` is not set, while development still defaults to
  `http://127.0.0.1:8000`. This prevents manual Pages builds from shipping a
  localhost API URL.
- Studio UI presentation is split into dedicated components for the composer
  toolbar, track board, extraction job queue, candidate review queue, report
  feed, and scoring drawer. `StudioPage.tsx` now mainly coordinates data loading, user
  actions, playback/recording state, and API orchestration.
- Extraction results can be held as pending candidates and approved or rejected
  before registration.
- Candidate review supports target-track override, musical decision summaries
  (range, register fit, movement, rhythm density, start/end, confidence,
  contour preview), and explicit overwrite confirmation for occupied targets.
- Candidate review now surfaces extraction diagnostics as first-class user
  evidence, so OMR and other uncertain candidates can be compared by page/part
  count, measure/note count, range fit, rhythm grid fit, density, and review
  hint instead of only raw engine method names.
- OMR score candidates can expose an authenticated first-page source preview in
  the candidate review panel. The API renders the original PDF/image input to a
  PNG from the retained job input asset so the user can visually compare the
  source page against the extracted candidate before approval.
- Failed extraction jobs show contextual retry guidance for noisy voice takes,
  vector fallback failure, and Audiveris timeout cases while preserving the
  retry action when the original input asset remains available.
- Recording, direct upload, candidate approval, and AI generation have explicit
  overwrite guards for occupied tracks.
- AI generation is rule-based symbolic harmony/percussion generation.
- AI vocal generation uses multiple voice-leading profiles so the review queue
  exposes meaningfully different register, motion, and contour options instead
  of near-duplicate top-N search results.
- Playback can use either retained recording audio or synthesized TrackNote
  pitch/rhythm data. In audio mode, tracks without retained audio fall back to
  score synthesis.
- Recorded tracks now play their retained normalized source recording through
  the Web Audio graph rather than a delayed HTML media-element path, which
  keeps browser autoplay behavior aligned with the score/metronome scheduler and
  restores audible playback for user-recorded tracks during single-track and
  full-studio playback.
- Score-mode melodic playback now uses a lightweight piano-like additive synth
  instead of the harsher plain sine tone, while percussion keeps the simpler
  synthetic click character.
- Engraved score strips now rely on the VexFlow stave as the visual staff truth
  instead of mixing a separately drawn CSS staff background, and the first
  measure reserves extra gutter space so clefs, accidentals, and opening notes
  stay visually attached to the staff instead of appearing clipped or detached.
- Global playback schedules all registered tracks together so stacked
  one-person recordings can be rehearsed as an ensemble.
- Registered tracks render as horizontally scrollable measure strips on the
  studio time-signature grid, with dense runs expanding the score width instead
  of overlapping.
- Browser score rendering now uses VexFlow SVG engraving from `TrackNote`
  pitch/rhythm data. Noteheads, stems, beams, dots, accidentals, ledger lines,
  and visible ties are produced by the engraving engine instead of CSS
  pseudo-elements.
- The engraving pipeline now keeps short timing gaps as hidden spacer rests,
  trims/filters overlapping monophonic notes instead of shifting them forward,
  and only draws conservative flat measure-local beams when the note density and
  confidence make beaming useful.
- Visible tie arcs are drawn only as VexFlow note-to-note ties for
  display-split long notes or explicit adjacent same-pitch continuations.
- The renderer keeps a hidden layout-marker layer for regression checks and
  sync behavior, while the visible notation is the engraved SVG score.
- The score renderer gives each measure inner notation padding and keeps note
  centers inside their owning measure, so sync and same-onset clustering cannot
  push notes outside barlines.
- Track sync visually shifts the note layer while measure lines and measure
  labels remain fixed.
- Registered track strips now share measure widths and draw a smooth scheduler
  playhead, keeping global playback progress vertically aligned across tracks
  while per-track sync moves only notes/audio.
- Scoring reference playback honors the scoring checklist's metronome setting,
  including metronome-only scoring sessions.
- Scoring reference playback uses the same audio-or-score playback source
  selection as normal studio playback, so checked tracks are audible practice
  context while the target take is recorded.
- Scoring uses the target track as the answer sheet, extracts/accepts
  performance notes, auto-aligns global sync, and reports quantitative errors.
- Scoring also has a harmony mode. It can run without a registered target
  answer when at least one selected registered reference track exists, then
  grades the new take for ensemble fit, rhythm-grid alignment, target range,
  and basic voice-leading.
- Studio report feed shows compact report title/date links; full quantitative
  report details live on a separate report page.
- AI generation now creates multiple pending candidates first; approving one
  candidate registers it and rejects sibling candidates from the same
  generation group.
- The score renderer now uses VexFlow clefs and ledger lines so Soprano through
  Bass tracks can extend above or below the staff without being clamped into
  misleading positions. The foundation no longer accepts hiding key signatures
  as the canonical solution; the target behavior is reserved key-signature
  spacing or explicit accidental fallback with warnings.
- Browser engraving consumes normalized key-signature, accidental, clef, and
  display-octave metadata when present. Baritone now falls under the bass-clef
  display policy, and Tenor can display an octave higher while retaining stored
  sounding pitch.

Remaining implementation gaps are now refinements of the six-track direction,
not legacy product surfaces.

## Next Required Work

1. Extend OMR source preview beyond the current first-page image: multi-page
   navigation, candidate-to-page focus, and eventually overlay/highlight
   alignment for scanned/image PDFs where Audiveris may still be slow or
   uncertain.
2. Continue improving failed-extraction recovery for browser recording and
   noisy single-voice takes with better preflight/noise feedback before retry.
3. Improve PDF score export engraving fidelity to match the browser VexFlow
   score display while preserving TrackNote as the source of truth.
4. Add visual PDF rendering checks to CI once Poppler or an equivalent renderer
   is available.
5. Add object storage lifecycle cleanup and a retention rule for abandoned
   upload/job assets. Manual admin cleanup exists for staged upload objects,
   but the bucket still needs an automatic lifecycle rule.
6. Add full user ownership/auth or private share boundaries before inviting
   broader traffic. Owner-token scoping is alpha privacy, not account auth.
7. Add optional direct/temporary handling for larger scoring takes if alpha
   scoring recordings become too large for the current base64 path.

## Live Test Gate - 2026-04-22

- API regression suite: 63 passed.
- Web lint: passed.
- Production web build: passed.
- Browser E2E release gate: 21 passed.
- Git state before deployment push: clean `main` aligned with `origin/main`.
- Current alpha limits remain intentional: 300 studio soft line, 500 studio
  hard line, 15 MB per file, 7 GiB asset warning line, 8.5 GiB asset hard line,
  and one active engine job lane by default.
- Dynamic behavior checked: repository pagination, per-studio reads, sidecar
  reports/candidates, durable queue replay options, admin storage pagination,
  configurable limits, and staged upload cleanup all follow settings or
  storage-backend abstractions rather than fixed in-page assumptions.

## Live Test Fix Gate - 2026-04-23

- Browser score engraving was reworked around a dedicated engraving adapter,
  not the old timeline renderer. `TrackNote` remains the source of truth, but
  visible notation now normalizes noisy/overlapping notes into measure-local
  events, quantizes to a sixteenth-note grid, keeps meaningful rests, expands
  dense measures, and lets VexFlow `Voice`/`Formatter`/`Beam` perform tick-based
  spacing instead of placing notes at fixed pixel-per-beat positions.
- Dotted note values are now passed to VexFlow as dotted durations, not only as
  visual dots, so spacing and beam/tie geometry use the correct rhythmic ticks.
- Visible ties are limited to adjacent split segments or explicit same-pitch
  continuations. The renderer no longer draws free-floating CSS tie arcs.
- Track playback in audio mode now uses the retained recording/upload URL as a
  browser media element. It no longer blocks on `fetch -> decodeAudioData` just
  to play a recorded file, and it no longer silently falls back to synthesized
  score tones when recorded audio playback is requested.
- Global playback and scoring reference playback share the same source policy:
  recorded media is used when audio mode and an audio asset exist; score tone
  synthesis is used only for score mode or tracks without retained audio.
- Verification for this gate: web lint passed, production web build passed,
  browser E2E release gate passed 21/21, and a Playwright browser check against
  the live studio payload confirmed VexFlow renders without console errors and
  Tenor playback calls the live track audio URL through
  `HTMLMediaElement.play()`.

## Full Process Audit Gate - 2026-04-23

- API regression suite passed locally: 65/65.
- Web lint passed locally.
- Production web build passed locally. The VexFlow vendor chunk still emits the
  expected large-chunk warning, but the build succeeds.
- Browser E2E release gate passed locally: 21/21 across Chromium, WebKit, and
  Firefox.
- The real `Phonecert_-_10cm.pdf` upload path was smoke-tested through the API
  with a temporary local store. The job completed as `needs_review` with
  `method="pdf_vector_omr"`, produced Soprano through Bass candidates, and left
  Percussion empty as intended. Candidate note counts were Soprano 255, Alto
  278, Tenor 392, Baritone 281, and Bass 332.
- Deployed alpha API read-only checks passed: Cloud Run root returned `ok`, and
  `/api/admin/storage` accepted the lightweight admin credentials. The live
  service reports `s3://gigastudy-alpha`, 2 studios, 3 active assets, about
  2.2 MB total usage, and no alpha limit warnings.
- The remaining notable process risk is still non-vector image/scanned-score
  OMR. Born-digital PDF fallback is practical for notation-program PDFs, but
  image/PDF scans depend on Audiveris or a future OMR worker path being
  available in the runtime.

## Runtime Hardening Gate - 2026-04-23

- API regression suite passed locally: 68/68.
- Web lint and production build passed locally.
- Browser E2E release gate passed locally: 24/24 across Chromium, WebKit, and
  Firefox. This now includes the `/admin` login with `admin` / `대연123` and
  the admin queue-drain control.
- Owner-token studio access is enabled by default in local E2E. Home creation,
  direct upload, candidate approval, PDF export, AI generation, sync, scoring,
  and admin storage continued to pass through the new access boundary.
- Audiveris 5.10.2 release asset URL for the Ubuntu 22.04 `.deb` was verified
  reachable. Cloud Build verified the API image with the Audiveris runtime, and
  the live alpha Cloud Run service was redeployed from that image.
- Cloud Scheduler now provides the external wake-up path for queued extraction
  jobs. The remaining process risks are narrower: scanned/image OMR quality,
  bucket-native lifecycle cleanup, and fuller failure-recovery UX.

## Live Runtime Deployment Gate - 2026-04-23

- Local verification before commit: API regression suite 68/68, web lint,
  production web build, and browser E2E release gate 24/24 all passed.
- Cloud Build succeeded for the API image: build
  `32460883-6a75-4de7-8cee-796212cf246f`, image
  `asia-northeast3-docker.pkg.dev/gigastudy-alpha-493208/gigastudy-alpha/gigastudy-api:latest`.
- Cloud Run now serves `gigastudy-api-alpha-00016-k5r` at 100 percent traffic.
- Cloud Scheduler job `gigastudy-engine-drain` is enabled in
  `asia-northeast3`, runs every 5 minutes in `Asia/Seoul`, and has a 300 second
  attempt deadline.
- Live root health returned `ok`; live admin storage reported
  `s3://gigastudy-alpha`, 2 existing studios, 3 active assets, about 2.2 MB
  stored asset usage, and no alpha limit warnings.
- Live `Phonecert_-_10cm.pdf` upload smoke completed after Audiveris timed out:
  the job fell back to `method="pdf_vector_omr"`, reached `needs_review`, and
  produced five candidates. Candidate note counts were Soprano 255, Alto 278,
  Tenor 392, Baritone 281, and Bass 332. The temporary smoke-test studio and
  uploaded/generated assets were deleted through admin cleanup.

## OMR Review Diagnostics Gate - 2026-04-23

- OMR and uncertain extraction candidates now carry diagnostic metadata in the
  API `ExtractionCandidate` contract. Audiveris and vector-PDF candidates expose
  track, note count, measure count, duration, range fit, timing grid fit,
  density, confidence label, and review hint; vector-PDF candidates can also
  expose detected document/candidate page counts, part count, and staff-row
  count.
- Candidate confidence is no longer a flat method constant for OMR. It is
  estimated from engine family, average note confidence, range fit, timing grid
  fit, note volume, and measure count, with penalties for tiny or suspicious
  outputs.
- Studio candidate review shows a dedicated diagnostic row for page/count/range
  and rhythm evidence, adds translated review-hint tags, and keeps raw engine
  details behind the technical disclosure.
- Extraction job rows show compact candidate summaries when review candidates
  exist and contextual recovery hints when a retryable OMR/voice job fails.
- Verification for this gate: API regression suite 68/68, web lint, production
  web build, and browser E2E release gate 24/24 all passed locally.

## OMR Source Preview Gate - 2026-04-23

- OMR job inputs retained in the asset store can be rendered to PNG through
  `GET /api/studios/{studio_id}/jobs/{job_id}/source-preview`.
- The route enforces the same owner-token studio access boundary as other studio
  asset reads and also accepts the owner token as a query parameter for browser
  image loading.
- Candidate review shows a collapsed "원본 악보 대조" preview for score/OMR
  candidates, letting users compare the source page with the extracted rhythm
  and pitch candidate before approval.
- Verification for this gate: focused API preview test, API regression suite
  68/68, web lint, production web build, and browser E2E release gate 24/24 all
  passed locally.

## DeepSeek Harmony Planner Gate - 2026-04-28

- DeepSeek V4 Flash is the selected single LLM model for alpha harmony planning
  when LLM assistance is enabled.
- The LLM is bounded to planning only. It may choose voice-leading profile
  order and provide compact candidate labels, roles, selection hints, and risk
  tags. It must not output TrackNote arrays or final score notation.
- Candidate review surfaces DeepSeek-provided direction, musical role,
  selection reason, phrase summary, confidence, and review points as
  user-facing choice evidence while keeping provider/model details in the
  technical disclosure.
- `GIGASTUDY_API_DEEPSEEK_HARMONY_ENABLED=true` and
  `GIGASTUDY_API_DEEPSEEK_API_KEY` are required before the API calls DeepSeek.
  Local and test environments remain deterministic unless explicitly enabled.
- DeepSeek requests use JSON mode and non-thinking mode by default to control
  latency and cost. Thinking mode is configurable but not the default alpha
  path.
- If DeepSeek times out, returns empty content, invalid JSON, or an unsupported
  profile, the API logs the failure and continues with deterministic
  rule-based harmony generation.
- The deterministic engine still owns BPM, time signature, measure boundaries,
  voice ranges, no-crossing constraints, candidate distinctness, and TrackNote
  normalization.
- Verification for this gate: API regression suite 87/87, web lint, and
  production web build passed locally on 2026-04-28.

## Plan-Aware Harmony Generation Gate - 2026-04-28

- The DeepSeek planner has moved beyond profile ordering. It can now return
  measure-level harmony intent, candidate goals, register/motion/rhythm policy,
  chord-tone priority, and bounded review metadata.
- The API can run a limited DeepSeek draft-review-revision cycle through
  `GIGASTUDY_API_DEEPSEEK_REVISION_CYCLES` before handing a sanitized plan to
  the deterministic engine.
- The deterministic harmony engine now consumes the plan in key resolution,
  chord ranking, pitch cost, transition cost, melodic connector allowance, and
  candidate rhythm shaping. Final TrackNote output is still deterministic code,
  not model-authored notes.
- Candidate review diagnostics expose the candidate goal, rhythm policy,
  revision cycle count, measure intent count, role, selection reason, and risk
  tags so users can compare practical harmony choices.
- Verification for this gate: focused DeepSeek/harmony tests 13/13, API
  regression suite 89/89, web lint, and production web build passed locally on
  2026-04-28.

## Track Registration Quality Gate - 2026-04-28

- A backend registration quality gate now runs at the final write boundary for
  direct track registration, multi-track import application, extraction
  candidate approval, bulk OMR approval, and AI candidate approval.
- Voice/audio/recording material is treated as noisy evidence until it passes
  BPM-locked score normalization. The gate filters low-confidence micro-events,
  snaps notes to the studio beat grid, simplifies over-dense voice measures
  into readable cells, splits measure-crossing notes, and reapplies the
  Soprano/Alto/Tenor/Baritone/Bass clef/key/display policy.
- Symbolic score material keeps imported rhythm where possible, but the gate
  repairs measure metadata, seconds derived from the studio BPM, clef/key
  annotation, and measure-boundary ownership before registration.
- Candidate diagnostics now carry a `registration_quality` block so review and
  admin/debug paths can see the note count, range fit, timing-grid fit, density,
  measure ownership, and repair actions that produced the final candidate.
- DeepSeek/OpenRouter configuration is explicit: local keys belong in ignored
  `apps/api/.env`; deployed keys belong in Cloud Run env vars or Secret
  Manager. The OpenRouter route uses
  `GIGASTUDY_API_DEEPSEEK_BASE_URL=https://openrouter.ai/api/v1` and
  `GIGASTUDY_API_DEEPSEEK_MODEL=deepseek/deepseek-v4-flash`; the `:free`
  variant is not assumed to be available for production routing.
- OpenRouter requests omit the native DeepSeek `thinking` field by default,
  while native DeepSeek requests keep the existing non-thinking JSON-mode
  payload. This keeps the single DeepSeek model choice compatible with both
  provider routes.
- DeepSeek notation review is now wired into the final registration path as a
  bounded registration planner. It receives compact original/prepared TrackNote
  summaries, deterministic quality options, current diagnostics, meter, BPM,
  source kind, target track policy, and any registered sibling-track summaries
  before the target is committed. It may return only validated repair
  instructions such as coarser quantization, sustain merging, dense-measure
  simplification, unstable-note suppression, and key-spelling preference.
- The local notation quality gate applies those instructions deterministically
  and preserves the pre-LLM registration result when the LLM is disabled,
  unavailable, invalid, low-confidence, or gives no repair directive. The LLM
  never writes final TrackNotes directly.
- Voice-like registration now has an additional readability polish stage. It
  collapses short neighbor-pitch blips between same-pitch notes, merges tiny-gap
  same-pitch fragments into sustained sung tones, and compares deterministic
  0.25-beat versus 0.5-beat grid candidates when fine quantization creates
  moderate micro-note clutter.
- Voice-like registration now removes short, low-confidence notes that are
  isolated from surrounding sung material, reducing false notation from room
  noise, breath, clicks, or pitch tracker artifacts before the result reaches
  the visible score.
- The DeepSeek notation reviewer receives deterministic quality-option
  summaries, including the current prepared result and a coarser 0.5-beat
  candidate for voice-like sources, plus isolated-artifact counts, so its
  instructions can choose among concrete engine repairs instead of issuing vague
  prose feedback.
- Verification for this gate: API regression suite 98/98, web lint,
  production web build, and Chromium release gate 10/10 passed locally on
  2026-04-28.

## Score Engraving Quality Gate - 2026-04-28

- Browser score engraving now gives key signatures a first-measure width
  allowance and a note-start gutter before VexFlow `Formatter` placement, so
  clef/key modifiers do not collide with the first note.
- Tenor rendering now uses actual treble-8vb clef annotation in the VexFlow
  stave while retaining the stored sounding pitch plus display-octave policy.
- Measure-local note normalization now prevents notes rounded to the right
  barline from being placed on or outside the measure boundary. The latest
  valid onset is the final sixteenth-cell inside the owning measure.
- Beaming now uses contiguous beamable note groups only. Rests, quarter-or-
  longer values, and hidden spacer rests break beam groups before VexFlow beam
  generation, reducing misleading beam forests from noisy voice material.
- E2E regression now checks the visible VexFlow SVG itself, not only the hidden
  layout marker layer: dense noteheads must remain inside their owning measure,
  VexFlow ties must be produced for tied material, and key signatures must
  appear before the first note with reserved space.
- Verification for this gate: web lint passed, production web build passed,
  API regression suite passed 98/98, focused notation/voice API tests passed
  16/16, and Chromium browser E2E release gate passed 10/10.

## Voice Artifact Cleanup Gate - 2026-04-28

- Voice-like registration now treats isolated short low-confidence notes as
  likely artifacts when they are separated from surrounding sung material. This
  catches common non-singing noise such as breath, clicks, room tones, and pitch
  tracker false positives before they become visible notes.
- Voice-like registration now bridges tiny detector dropouts between confident
  adjacent sung notes by extending the previous note up to the next onset. This
  keeps short extraction gaps from becoming visible micro-rests when the singer
  is effectively continuing one phrase.
- Voice-like registration now extends confident sung notes to a nearby barline
  when they end just before the measure boundary and the phrase continues in the
  next measure. This removes misleading end-of-measure micro-rests without
  changing BPM, meter, or source audio.
- The cleanup is bounded and conservative: it does not remove the only pitched
  material in a take, and it only runs inside the final deterministic notation
  quality gate for voice-like evidence.
- DeepSeek notation review now sees isolated-artifact, short-phrase-gap, and
  measure-tail-gap counts in its compact quality summaries and may request
  `remove_isolated_artifacts`, `bridge_short_phrase_gaps`, or
  `bridge_measure_tail_gaps`, but the actual note cleanup is still performed by
  deterministic engine code.
- LLM-directed voice repairs now pass back through the deterministic readability
  optimizer, so a model instruction cannot bypass the same 0.25/0.5 grid
  comparison and polish checks used by the base registration path.
- Verification for this gate: focused notation/voice API tests passed 19/19,
  API regression suite passed 101/101, web lint passed, production web build
  passed, `git diff --check` passed, and Chromium browser E2E release gate
  passed 10/10.

## Short-Cluster Notation Cleanup Gate - 2026-04-28

- Voice-like registration now detects three-or-more note clusters of
  low-confidence sixteenth-cell fragments inside one beat when their pitch span
  is tiny. Those clusters are collapsed into one representative sung event
  before registration, reducing pitch-tracker chatter from becoming visibly
  mechanical notation.
- DeepSeek notation review now receives `short_note_cluster_count` in the same
  compact quality summaries as isolated artifacts, phrase gaps, and measure-tail
  gaps. It may request `collapse_short_note_clusters`, but the actual TrackNote
  rewrite remains deterministic engine code.
- Browser engraving now includes double-dotted half and quarter duration
  candidates and attaches the correct number of augmentation dots in VexFlow.
  This reduces avoidable intra-measure ties for 3.5-beat and 1.75-beat values.
- Verification for this gate: focused notation/voice API tests passed 20/20,
  API regression suite passed 102/102, web lint passed, production web build
  passed, `git diff --check` passed, and Chromium browser E2E release gate
  passed 10/10.

## Direct Audio Playback And Playhead Gate - 2026-04-28

- Studio audio-mode playback now uses retained recording/upload URLs directly
  through browser media elements. Recorded takes no longer block on
  `fetch -> decodeAudioData -> AudioBufferSource` before the user hears the
  source; score synthesis remains the fallback for AI/generated tracks and
  audio-less tracks.
- Pure original-audio playback no longer opens a Web Audio context just to play
  retained media. Web Audio is only required when score synthesis or the
  metronome is part of the scheduled playback.
- Full-track audio playback now has a media readiness barrier: empty tracks are
  excluded, retained-audio tracks are all prepared to browser-playable state,
  and only then are they scheduled from one shared start point. This prevents
  one already-loaded track from starting while another retained take is still
  buffering.
- The smooth score playhead remains scheduler-driven and updates through the
  browser animation frame loop. Shared measure widths keep global playback
  lines vertically aligned across tracks, while per-track sync shifts only that
  track's note/audio layer.
- Score-only playback for generated/OMR/MIDI/MusicXML registrations is
  verified against a fake Web Audio clock: same-beat notes across tracks are
  scheduled at the exact same clock time, so stacked TrackNotes sound as a
  chord.
- Retained-audio playback now distinguishes low-latency single-source playback
  from synchronized playback. If retained audio is combined with another retained
  audio track, score-synthesized notes, or the metronome, the original audio
  waits at the readiness barrier and the whole set starts from one shared point.
- Verification for this gate: web lint passed, production web build passed,
  targeted Chromium audio playback E2E passed, and Chromium browser E2E
  release gate passed 13/13 on 2026-04-28.

## A Cappella Ensemble Polish Gate - 2026-04-28

- Final registration now validates against the whole proposed ensemble context.
  Single-track approval compares against registered sibling tracks; multi-track
  import and bulk OMR approval prepare all incoming parts first, then validate
  each part against the other incoming parts before any track is committed.
- Voice/audio/AI material can receive conservative contextual octave repair
  when a note clearly sits in the wrong octave relative to sibling voices. The
  repair preserves pitch class, rhythm, measure ownership, BPM, barlines, ids,
  and source audio. Symbolic score material is preserved and receives
  diagnostics only.
- Ensemble diagnostics now include melodic singability, structural doubled
  leading-tone risk, and bass foundation height in addition to crossing,
  adjacent spacing, parallel perfect motion, range, and thin chord coverage.
- Verification for this gate: arrangement tests 6/6, focused notation/API tests
  15/15, API regression suite 111/111, py_compile, and `git diff --check`
  passed locally on 2026-04-28.

## LLM Ensemble Registration Gate - 2026-04-28

- DeepSeek now has two bounded review roles around final track registration:
  single-track notation readability and six-track a cappella ensemble fit.
- The ensemble reviewer receives registered sibling tracks, other parts from
  the same proposed import/OMR batch, and compact vertical beat snapshots. This
  lets it judge the target as part of one a cappella score instead of as an
  isolated melody.
- The LLM still cannot write TrackNotes. It can only request validated repair
  directives such as coarser quantization, same-pitch sustain merging, dense
  measure simplification, noise cleanup, gap bridging, and key-spelling
  preference. The deterministic engine applies the instruction and re-runs the
  ensemble arrangement gate before registration.
- DeepSeek harmony planning prompts now explicitly include six-track a cappella
  arrangement rules: singability, independent motion, candidate diversity,
  voice-crossing/parallel-perfect avoidance, and bass-foundation awareness.
- AI-generated candidates therefore flow through the same a cappella
  registration contract as uploaded, recorded, symbolic, and OMR material.
- Verification for this gate: py_compile passed for the modified LLM,
  repository, harmony-plan, and config modules; focused DeepSeek/notation/
  harmony/arrangement tests passed 32/32, API regression suite passed 113/113,
  web lint passed, production web build passed, and Chromium release gate
  passed 13/13 locally on 2026-04-28.

## Track Registration LLM Planning Patch - 2026-04-29

- Single-track registration planning now sends registered sibling-track context
  to DeepSeek before the target track is committed. This applies to recording,
  per-track upload, extraction candidate approval, and any other repository path
  that passes through the shared final registration boundary.
- The LLM remains bounded to plan directives only. It may use sibling context to
  choose cleanup direction, key spelling, octave/range caution, and score
  readability risk, but deterministic code still owns all TrackNote mutation,
  BPM/meter invariants, validation, and fallback behavior.

## Live Recording Playback And Count-In Patch - 2026-04-29

- Live studio smoke data showed old Tenor voice registrations can be missing
  `display_octave_shift` metadata. Browser engraving now treats a Tenor track
  with missing display metadata as treble-8vb by default, so stored sounding
  pitch remains unchanged while the rendered notes sit on the intended Tenor
  staff instead of falling below it.
- Single retained-audio track playback no longer fails just because the browser
  delays `canplay`/`canplaythrough` readiness events. The player still prepares
  media optimistically, but for a single original recording it proceeds to
  `HTMLMediaElement.play()` and lets the browser buffer normally. Multi-track
  retained-audio playback keeps the stricter readiness barrier so simultaneous
  ensemble starts remain protected.
- Recording count-in and audible metronome now share the metronome session's
  first scheduled pulse timestamp. The one-measure count-in reaches visible `0`
  on the recording-start downbeat, then the `0` flash remains briefly while the
  microphone capture is already running. This makes the user's visual entry cue,
  audible metronome click, and internal BPM/meter grid land on the same beat.
- Verification for this patch: web lint passed, production web build passed,
  focused Chromium playback/count-in E2E passed 3/3, focused downbeat-zero
  count-in E2E passed, and full Chromium release gate passed 13/13 locally on
  2026-04-29.

## Dual Scoring Mode Patch - 2026-04-29

- Studio scoring is now product-mode explicit: Answer Scoring uses the target
  track's registered notes as the answer sheet, while Harmony Scoring records a
  new part against selected registered reference tracks without requiring a
  target answer.
- The harmony scoring engine evaluates deterministic ensemble fit: vertical
  consonance against active/nearest references, chord-fit against inferred
  vertical sonority, rhythm-grid/reference entrance fit, target vocal range,
  SATB-like spacing, voice-leading continuity, obvious voice crossing, and
  repeated parallel perfect fifth/octave motion. LLMs remain optional
  planning/review support, not numeric scoring authority.
- The studio scoring drawer exposes the two modes, disables impossible choices,
  and sends `score_mode` to the API. Report feed/detail views label the mode and
  show mode-appropriate metrics.
- Verification for this patch: API regression suite passed 118/118, focused
  scoring engine/API tests passed 7/7, web lint passed, production web build
  passed, and Playwright release gate passed 40/40 with 2 browser-permission
  skips locally on 2026-04-29.

## Arranger-Grade Harmony Scoring Patch - 2026-04-29

- Harmony Scoring now separates raw interval consonance from chord-fit,
  spacing, voice-leading, and arrangement scores. This makes the report closer
  to a practical a cappella arranger review instead of a single dissonance
  detector.
- The engine infers a compact vertical sonority at each performed note, scores
  whether the new part can be explained as a normal chord tone, tolerates short
  weak-beat passing dissonance, and penalizes strong-beat unresolved clashes.
- The engine now detects upper-voice spacing problems, low-register crowding,
  obvious voice crossing, and repeated parallel perfect fifth/octave motion
  against selected reference tracks.
- Harmony reports now expose Chord, Spacing, and Arrangement metrics and can
  emit `chord_fit`, `spacing`, and `parallel_motion` issues with specific
  timestamps.
- Verification for this patch: focused scoring engine tests passed 7/7, API
  regression suite passed 121/121, web lint passed, and production web build
  passed locally on 2026-04-29.

## Harmony Scoring Calibration Patch - 2026-04-29

- Harmony Scoring is now less eager to warn when there is not enough musical
  evidence. Sparse one-note reference context uses a lower chord-fit warning
  threshold, and strong chord-fit warnings are reserved for clearer vertical
  sonorities.
- The chord-fit pass now treats short weak-beat connector tones and common color
  tones over a stable triad as practical a cappella material rather than
  immediate errors.
- Spacing and voice-leading penalties were softened for usable contemporary
  arrangements, while extreme upper/lower separation and out-of-range leaps still
  surface as warnings.
- Parallel fifth/octave warnings now require sustained structural notes in both
  the new part and the reference part, so quick passing motion does not create
  noisy arranger warnings.
- Verification for this patch: focused scoring engine tests passed 10/10, API
  regression suite passed 124/124, web lint passed, production web build passed,
  and Playwright release gate passed 40/40 with 2 browser-permission skips
  locally on 2026-04-29.

## Structural Harmony Scoring Push - 2026-04-29

- Harmony Scoring now includes structural arranger checks beyond raw vertical
  consonance: unresolved sustained non-chord tensions, overly thin strong-beat
  chord coverage, and Bass parts that sit too high to support the ensemble.
- These checks affect `arrangement_score` with capped penalties and appear as
  separate report issue types: `tension_resolution`, `chord_coverage`, and
  `bass_foundation`.
- The guardrails remain intentionally bounded. Resolved stepwise tensions,
  common color tones over a clear triad, short weak-beat connectors, and quick
  non-structural parallel motion are tolerated.
- This pushes the deterministic engine to the current useful limit. The next
  meaningful quality jump needs real singing data and human arranger labels,
  because further tuning would start deciding stylistic preference rather than
  clear structural risk.
- Verification for this push: focused scoring engine tests passed 14/14, API
  regression suite passed 128/128, web lint passed, production web build passed,
  and Playwright release gate passed 40/40 with 2 browser-permission skips
  locally on 2026-04-29.

## Status Summary

Foundation reset: complete.

Engine baseline: implemented.

Implementation alignment: core vertical slice complete; extraction quality is
now centered on shared assignment, notation metadata, and source-specific OMR
or voice reliability improvements. Track registration quality is now enforced
at the repository write boundary rather than relying on each extraction source
to be correct by itself.
