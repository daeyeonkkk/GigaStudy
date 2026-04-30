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
- Voice/audio track registration now has a pre-transcription extraction-plan
  layer. The deterministic plan uses the studio BPM, target voice slot, source
  kind, and sibling track context before pitch frames are converted into
  TrackNotes. If `GIGASTUDY_API_DEEPSEEK_EXTRACTION_PLAN_ENABLED=true` and a
  DeepSeek API key is configured, the LLM can choose only bounded extraction
  parameters such as quantization grid, segment strictness, confidence
  strictness, tiny slot-range widening, and unstable-note suppression. The LLM
  cannot write notes or change tempo; the selected plan is applied by Basic
  Pitch, librosa pYIN, and the local WAV engine and is stored in diagnostics.
- Scoring recordings now use the same pre-transcription planning principle.
  Answer scoring sends the registered target track as expected context, while
  harmony scoring sends the selected reference tracks as ensemble context.
  The resulting performance TrackNotes are still deterministic and aligned to
  the studio BPM/meter before scoring.
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
- Per-track browser recording now opens the microphone, shows a BPM/meter
  pulse count-in from the studio grid, and starts the take on the displayed
  `0` pulse. For a 4/4 studio the visible count-in is `3, 2, 1, 0`; faster BPM
  makes those pulses fall faster. The first audible count-in pulse is delayed
  by a small 100 ms preparation window, and microphone capture opens with a
  short preroll before `0` so slightly early entrances are not dropped. The
  metronome toggle only mutes/unmutes audible clicks; the internal score clock
  still drives TrackNote timing. The UI shows count-in, elapsed-time, and
  input-level feedback.
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
- Scoring separates "reference track" from "audible reference playback".
  Checked reference tracks remain the scoring criteria/context sent to the
  engine, while each reference track has an independent playback checkbox for
  whether it should be heard during the take.
- Scoring reference playback honors the scoring checklist's metronome setting,
  including metronome-only scoring sessions, and uses the same audio-or-score
  playback source selection as normal studio playback.
- Scoring uses the target track as the answer sheet, extracts/accepts
  performance notes, auto-aligns global sync, and reports quantitative errors.
- Scoring also has a harmony mode. It can run without a registered target
  answer when at least one selected registered reference track exists, then
  grades the new take for ensemble fit, rhythm-grid alignment, target range,
  and basic voice-leading.
- Track registration now has a final score-contract gate after extraction,
  import, LLM review, and ensemble validation. Every registered TrackNote is
  forced back onto the studio BPM/meter coordinate system with canonical
  seconds, measure metadata, voice_index, clef, and key spelling so all tracks
  remain parts of one a cappella score.
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
- Historical note: this gate first moved audio-mode playback back to retained
  source audio instead of silently falling back to synthesized score tones. That
  intermediate browser-media-element path was later superseded by the 2026-04-29
  Web Audio buffer clock path below.
- Global playback and scoring reference playback share the same source policy:
  recorded media is used when audio mode and an audio asset exist; score tone
  synthesis is used only for score mode or tracks without retained audio.
- Verification for this gate: web lint passed, production web build passed,
  browser E2E release gate passed 21/21, and a Playwright browser check against
  the live studio payload confirmed VexFlow renders without console errors and
  Tenor playback reached the retained source-audio path.

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

- Studio audio-mode playback uses retained recording/upload URLs as the audible
  source, then decodes them into `AudioBuffer` objects before scheduled
  playback. This keeps original takes, synthesized score notes, metronome
  clicks, and the smooth playhead on one Web Audio clock.
- There is no separate `HTMLMediaElement.play()` playback lane anymore. Even a
  single retained-audio track enters the same fetch/decode/schedule path, so
  later layering with other tracks does not switch timing models.
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
- Retained-audio playback now distinguishes source availability from shared
  start timing. If retained audio is combined with another retained-audio track,
  score-synthesized notes, or the metronome, every needed source waits at the
  readiness barrier and the whole set starts from one shared Web Audio clock
  point.
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
- Retained-audio track playback no longer depends on `canplay`/
  `canplaythrough` readiness events. Original recording/upload assets are still
  the audible source, but playback decodes them into Web Audio buffers so
  original takes, synthesized score tones, metronome clicks, and the smooth
  playhead share the same clock.
- Recording count-in and audible metronome now share the metronome session's
  first scheduled pulse timestamp. The one-measure count-in reaches visible `0`
  on the recording-start downbeat, then the `0` flash remains briefly while the
  microphone capture is already running. This makes the user's visual entry cue,
  audible metronome click, and internal BPM/meter grid land on the same beat.
- Verification for this patch: web lint passed, production web build passed,
  focused Chromium playback/count-in E2E passed 3/3, focused downbeat-zero
  count-in E2E passed, and full Chromium release gate passed 13/13 locally on
  2026-04-29.

## Live Queue And Playback Clock Patch - 2026-04-29

- Studio detail polling no longer wakes heavy OMR/voice extraction processing.
  Polling can still rebuild missing durable queue records from studio metadata,
  but actual work now starts from upload, retry, admin drain, or scheduler drain
  paths. This keeps frequent UI refreshes from occupying the limited Cloud Run
  request lanes.
- Upload/retry wake-ups drain a bounded batch of queue jobs instead of a single
  job, so a second recording that is queued while the first extraction is
  running can be picked up as soon as the lane is free.
- Retained audio playback now fetches the track audio endpoint, decodes the
  source to an `AudioBuffer`, and schedules it on the same `AudioContext` clock
  as score synthesis and metronome clicks. This replaces the previous
  `HTMLMediaElement.play()` path that could drift against the metronome and fail
  differently from score playback under load.
- Verification for this patch: API regression suite passed 129/129, web lint
  passed, production web build passed, and Playwright release gate passed 40/40
  with 2 browser-permission skips locally on 2026-04-29.

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

## Repository Structure Refactor - 2026-04-30

- The studio repository remains the write-boundary/orchestration facade, but
  repeated domain logic has been moved behind focused modules:
  sync-resolved TrackNote timeline calculation lives in
  `services/engine/timeline.py`, extraction candidate diagnostics and variant
  labels live in `services/engine/candidate_diagnostics.py`, and upload
  filename/type/base64 policy lives in `services/upload_policy.py`.
- Direct-upload token cryptography now lives in
  `services/direct_upload_tokens.py`; studio list/document shaping lives in
  `services/studio_documents.py`; shared asset path normalization lives in
  `services/asset_paths.py`; and OMR result annotation/summary writing lives in
  `services/engine/omr_results.py`.
- Studio ownership/access decisions now live in `services/studio_access.py`,
  and alpha capacity/admin-limit decisions now live in
  `services/alpha_limits.py`. This keeps storage orchestration from owning
  security and environment-limit policy text.
- Stored-asset I/O now has its own API service boundary:
  `services/studio_assets.py` owns direct/staged upload target creation,
  expiring upload-token validation, byte writes, asset-registry upserts,
  admin asset summaries, registry backfill from storage, staged-upload
  promotion, generated asset persistence, temporary scoring upload files,
  aligned-audio replacement, and lifecycle cleanup. The repository calls it as
  an orchestration dependency instead of performing low-level file and
  object-store work inline.
- Redundant repository-local copies of direct-upload token decoding, owner
  token hashing, admin limit building, studio hard-limit enforcement, candidate
  diagnostics, upload validation, OMR marking, and old list/payload helpers
  have been removed. Runtime `__pycache__` folders are treated as generated
  workspace noise and are not source artifacts.
- Browser playback helper logic that does not need React state now lives in
  `apps/web/src/lib/studio/playback.ts`, keeping `StudioPage.tsx` closer to
  page orchestration instead of low-level scheduling math.
- Repeated studio route loading/error shell markup now lives in
  `components/studio/StudioRouteState.tsx`, so `StudioPage.tsx` owns action
  orchestration while shared route-state UX has one edit point.
- The intended pattern is now explicit: pages/routes coordinate user actions,
  repositories enforce persistence/write boundaries, engine modules own music
  domain rules, storage modules own bytes, and small policy modules own
  validation. Future work should avoid adding new extraction, notation,
  upload, or playback rules directly into `studio_repository.py` or
  `StudioPage.tsx` unless they are pure orchestration.
- The old unused non-timeline metronome scheduling export was removed from the
  browser playback library. The remaining playback scheduler always works from
  the shared score timeline so metronome clicks, retained audio, synthesized
  score notes, and the playhead stay on one clock model.
- Scoring capture now only exposes `Stop` once the browser is actually
  listening, waits briefly for the first microphone buffer before closing the
  recorder, and treats an uploaded scoring take with no detected notes as a
  valid zero-performance report instead of dropping the report. This prevents
  fast start/stop races from silently losing the scoring flow.
- The release gate now verifies microphone-dependent scoring only in the
  Chromium project, which is the Playwright project configured with fake
  microphone permissions. Firefox/WebKit continue to cover the shared studio
  flow without pretending they have the same automated capture permissions.

## Studio UX, Readiness, And LLM Contract Polish - 2026-04-30

- The extraction queue panel now uses clean Korean labels and explicit state
  hints for queued, running, review-ready, completed, and failed jobs. Failed
  OMR/voice jobs explain whether the likely recovery path is a cleaner singing
  take, a better score source, or a retry of the retained input asset.
- Studio playback and scoring copy now uses user-facing shared beat language
  instead of internal "audio clock" wording. This keeps the UX aligned with the
  product principle that all retained audio, synthesized score notes,
  metronome clicks, and the playhead run against one BPM/meter timeline.
- The API now exposes `GET /api/health/ready` as a non-secret readiness
  contract. It reports environment, metadata/object-storage configuration
  booleans, engine lane settings, upload size limits, OMR/voice backend names,
  and which DeepSeek intervention points are effectively enabled, without
  returning API keys or object-storage secrets.
- The LLM intervention contract is now explicit in the engine foundation:
  notation review, ensemble registration review, and harmony generation
  planning are independent DeepSeek-enabled gates. The LLM may request bounded
  cleanup or planning instructions, but deterministic code still owns final
  TrackNote mutation, BPM/meter, validation, scoring numbers, and fallback
  behavior when the provider is unavailable.

## Web Loading And Playback Runtime Optimization - 2026-04-30

- Browser engraving no longer imports VexFlow's full package entry. The score
  strip imports only the VexFlow classes it uses and initializes the Bravura /
  Academico fonts explicitly. Production build output now splits engraving into
  `EngravedScoreStrip`, `vexflow-core`, and `vexflow-fonts` chunks instead of
  one oversized VexFlow vendor chunk.
- The previous production warning from a 1.1 MiB `vexflow-vendor` chunk is gone.
  Current measured chunks are roughly `vexflow-core` 268 KiB minified / 74 KiB
  gzip and `vexflow-fonts` 391 KiB minified / 295 KiB gzip. These chunks remain
  lazy-loaded behind the studio score board, so the home/admin/report routes do
  not pay the engraving cost up front.
- Vite now aliases the internal VexFlow ESM source under `vexflow-src`, with a
  matching TypeScript path and knip ignore rule so build, type-check, and dead
  code analysis agree on the same intentional import boundary.
- The looping metronome session no longer keeps every historical timer id and
  every completed click node for the whole recording session. It retains only
  the active timer and a bounded recent-node window, while the shared audio
  context still closes the entire session on stop/cancel. This keeps long
  count-in/recording/metronome use from accumulating avoidable browser-side
  references.
- Verification for this optimization: web lint passed, production web build
  passed with no chunk-size warning, API regression suite passed 138/138,
  Playwright release gate passed 40/40 with 2 browser-permission skips, knip
  passed, and `git diff --check` reported no whitespace errors locally on
  2026-04-30.

## Studio Flow UX Bottleneck Reduction - 2026-04-30

- The studio flow audit identified the main UX risk as unclear waiting and
  decision moments rather than missing core actions. Upload, recording,
  extraction, candidate approval, playback, and scoring now expose more precise
  state copy.
- The extraction queue panel now receives the full job history instead of only
  the newest four jobs. It provides filters for attention-needed jobs, failed
  jobs, and all jobs so older failures and completed jobs remain recoverable.
- Candidate review now has a front-loaded verdict badge: recommended, review
  needed, or retry recommended. The badge is derived from confidence,
  diagnostics, overwrite risk, range fit, timing-grid fit, density, and LLM risk
  tags when present, while preserving the existing detailed metrics below it.
- Playback preparation messages now distinguish loading recorded audio,
  synthesized score-note playback, metronome inclusion, and synchronized start.
  Single original-audio playback is described as a near-immediate source load;
  multi-part playback explicitly says every prepared part starts from one
  shared timeline.
- Scoring mode selection now includes a compact current-mode summary that names
  whether the session is answer scoring or harmony scoring, how many reference
  tracks are involved, and whether the metronome is included.
- Scoring microphone capture now follows the same delayed-input principle as
  track recording. Starting a scoring session pre-arms the microphone, prepares
  any audible reference tracks first, then shows the same BPM/meter pulse
  count-in. Actual performance capture starts with the same short preroll, and
  audible reference tracks plus the scoring metronome are scheduled to the
  displayed `0` pulse. Silent count-in still preserves the internal studio
  clock.

## Structural Consistency Hardening - 2026-04-30

- Sync-resolved TrackNote views now preserve negative layer shifts instead of
  clamping early notes back to 0 seconds / beat 1. User sync remains a layer
  movement over the fixed BPM paper, so scoring, generation, ensemble review,
  and other cross-track judgments can see the true effective timeline.
- A Web/API contract regression test now checks that the main response schemas
  exposed by the API are covered by the TypeScript studio types. The first
  caught drift was `TrackSlot.diagnostics`, which is now present in the Web
  type.
- Track registration quality preparation moved out of `StudioRepository` into
  `TrackRegistrationPreparer`. Repository code still orchestrates persistence
  and user actions, while notation normalization, LLM review directives, and
  ensemble arrangement gates live behind a dedicated domain service.
- Repeated "commit this prepared material into a track" mutation now goes
  through `register_track_material` in `studio_documents.py`. Recording,
  upload, OMR, AI candidate approval, and seeded symbolic material therefore
  set status, source labels, audio references, notes, duration, diagnostics,
  and timestamps through one write helper instead of drifting through copied
  assignment blocks.
- Studio route loading, polling, registered-track derivation, active-job
  derivation, and candidate derivation moved into `useStudioResource`. The
  studio page now consumes a resource hook rather than owning both route data
  fetching and user-action orchestration in the same component body.
- Candidate review target selection, overwrite confirmation, approve/reject,
  bulk job approval, and retry behavior moved into `useCandidateReviewState`.
  The candidate panel remains a presentational decision surface, while API
  mutations and local review state have one focused owner.
- Studio playback state, selected-track playback, retained-audio decoding,
  synthesized score playback, metronome scheduling, playhead animation,
  seek/restart behavior, source switching, and active track gain updates moved
  into `useStudioPlayback`. `StudioPage.tsx` no longer owns the Web Audio
  scheduling state machine directly.
- Studio scoring state, answer/harmony mode transitions, scoring microphone
  capture, reference-track playback coordination, metronome-only scoring
  playback, and report submission moved into `useStudioScoring`. This keeps
  scoring UX orchestration separate from track-board upload/record/generate
  actions.
- Track recording state, one-measure count-in timers, recording metronome
  session ownership, microphone recorder lifecycle, recording review state, and
  register/delete actions moved into `useStudioRecording`. `StudioPage.tsx`
  now keeps only the cross-flow guard that prevents track recording while
  scoring capture is active.
- Track material actions moved into `useStudioTrackActions`. Track upload,
  direct-upload fallback, AI candidate generation, per-track sync, all-track
  sync shifting, track volume persistence, and PDF export now have one Web
  mutation owner instead of living inline in the studio route component.
- The pending recording review surface moved into `PendingRecordingDialog`.
  The page now passes the reviewed recording, busy state, and register/delete
  callbacks into a focused presentation component instead of keeping modal
  markup inline.
- Studio UI CSS is now split by component ownership. `StudioPage.css` keeps the
  composer shell, page-level layout, shared buttons, status bar, route-state
  keyframes, and responsive overrides, while track board, extraction jobs,
  candidate review, pending-recording dialog, report feed, scoring drawer, and
  route-state styles live next to their components.
- Backend extraction job construction now lives in `studio_jobs.py`.
  `StudioRepository` still owns persistence, locking, and processing
  orchestration, but OMR/voice `TrackExtractionJob` creation and durable
  `EngineQueueJob` payload shaping have one source of truth.
- OMR backend execution selection now lives in `omr_pipeline.py`. The
  repository still owns job lifecycle, locking, failure marking, time-signature
  updates, and candidate registration, while the pipeline owns Audiveris vs.
  vector-PDF fallback execution and returns a typed result with candidate
  method, extraction method, confidence, and review copy.
- The OMR pipeline still receives the repository's Audiveris runner so the
  existing single-engine execution lock remains intact. Queue records now use
  their own `slot_id` instead of reloading the same job only to recover the
  target slot during OMR parsing.
- Voice queue execution now lives behind `voice_pipeline.py`. The repository
  still owns overwrite policy, candidate creation, direct registration, job
  completion, and failure semantics, while the pipeline owns transcription,
  metronome-aligned audio replacement, and the normalized result passed back to
  the repository. The repository's locked transcription runner is still
  injected so the existing single-engine lane and legacy test monkeypatch
  contract remain intact.
- Extraction job state transitions now live in `studio_jobs.py` as pure studio
  mutation helpers. Running, failed, completed, and unmapped full-score OMR
  placeholder cleanup rules have one implementation, while `StudioRepository`
  still owns locking, loading, saving, queue store updates, and HTTP error
  translation.
- Candidate construction and candidate state mutation now live in
  `studio_candidates.py`. Pending candidate creation, registration-quality
  diagnostic merging, approve/reject marking, sibling rejection, job-candidate
  deduplication, and review-track marking now have shared helpers, while
  `StudioRepository` still owns access checks, overwrite checks, registration
  preparation, track material commits, and persistence.
- Candidate approval/rejection, bulk job approval, initial audio candidates,
  extraction review candidates, and AI generation review candidates now live
  behind `studio_candidate_commands.py`. The repository keeps historical
  method names as thin orchestration hooks, while candidate workflow branching
  and review-queue mutation have one command owner.
- Score-track request preparation now lives in `studio_scoring.py`. Reference
  track selection, scoring-mode validation, performance-submission detection,
  and answer-vs-harmony report construction are pure helper responsibilities,
  while `StudioRepository` still owns owner access, temporary scoring-audio
  extraction, report persistence, and HTTP error translation.
- AI generation request preparation now lives in `studio_generation.py`.
  Registered-context collection, sync-resolved context note shaping, optional
  DeepSeek harmony planning, rule-based candidate generation, and generation
  method/copy selection are service helpers. `StudioRepository` keeps access
  checks, overwrite policy, candidate persistence, direct track material
  registration, and HTTP error translation.
- AI generation candidate review metadata also lives in
  `studio_generation.py`. LLM direction diagnostics, profile/risk hints, and
  candidate variant labels are generated next to the generation planning logic,
  leaving the repository to persist prepared candidates.
- AI generation route orchestration now lives behind
  `studio_generation_commands.py`. The command owns request-level generation
  branching, review-candidate vs direct-registration choice, overwrite
  translation, and use of the generation engine.
- Score-track route orchestration now lives behind `studio_scoring_commands.py`.
  The command owns scoring request validation, temporary performance-audio
  transcription, report construction, and report persistence. The repository
  keeps the historical `_extract_scoring_audio` hook as a thin compatibility
  wrapper.
- Admin studio summary and asset-reference cleanup rules now live in
  `studio_admin.py`. The repository still owns the admin command boundary,
  locking, asset-service calls, and persistence, while the helper owns which
  track/candidate/job references are counted or cleared.
- Admin API commands now live behind `studio_admin_commands.py`. The repository
  exposes the historical route-facing methods as a thin facade, while storage
  summary pagination, studio deletion, staged cleanup, and single-asset cleanup
  are owned by the admin command service.
- Candidate cleanup rules now stay with candidate state helpers. A rejected or
  moved candidate releases its review placeholder through
  `release_review_track_if_no_pending_candidates`, so the repository no longer
  duplicates candidate-slot release policy.
- Track sync, all-track sync shift, volume, and time-signature mutation rules
  now live in `studio_track_settings.py`. Repository methods translate access
  and HTTP errors; track setting semantics have one small owner.
- Durable queue recovery payload shaping now lives in `studio_jobs.py`.
  Re-enqueue payload reconstruction and retry-attempt reset rules are job
  helpers instead of inline repository payload assembly.
- Engine queue lifecycle commands now live behind
  `studio_engine_queue_commands.py`. Claim/drain/schedule/repair/re-enqueue
  orchestration has a named command owner, while OMR/voice queue execution lives
  behind `studio_engine_job_handlers.py`. The repository keeps the persistence,
  track material mutation hooks, compatibility injection points used by tests,
  and HTTP-facing facade methods.
- New OMR/voice extraction job creation now lives behind
  `studio_extraction_job_commands.py`. It owns job construction, placeholder
  track state, queue-record enqueue, and scheduler wake-up calls. The repository
  still exposes the historical private enqueue methods as thin wrappers so
  upload and recovery paths keep one visible orchestration boundary.
- Home seed upload, staged/direct upload target creation, proxy upload writes,
  per-track symbolic/audio/score upload routing, and seed-file promotion now
  live behind `studio_upload_commands.py`. Upload policy and parser routing are
  no longer inline repository logic; repository upload methods are facade
  shims that keep route-facing names stable.
- Score PDF export, retained track-audio resolution, and OMR source preview
  lookup now live behind `studio_resource_commands.py`. The repository exposes
  the same route-facing methods, but file/preview/export HTTP translation no
  longer sits inline in the central repository body.
- Upload-start audio candidate extraction now lives in
  `studio_home_audio_import.py`, and seed score-to-OMR routing lives in
  `upload_policy.py`. The repository still owns upload asset persistence and
  HTTP translation, but import-specific track inference and routing policy have
  named owners.
- Playback preparation copy moved from the studio page into the playback
  library so the page no longer owns that reusable playback-state wording.

## Workspace Legacy Cleanup - 2026-04-29

- The current playback contract is now documented and implemented as one Web
  Audio scheduling path. Obsolete `HTMLAudioElement` helper functions and the
  corresponding browser-media E2E stub were removed so future playback work does
  not accidentally reintroduce the drift-prone media-element lane.
- Retained source audio remains first-class, but it is fetched, decoded, and
  scheduled on the shared audio clock with score synthesis and the metronome.
  User-facing copy now describes that shared-clock behavior instead of the old
  "same start point" wording.
- Compatibility readers for historical stored studio payloads remain
  intentionally. They are not product behavior, but deleting them would make old
  saved studios less recoverable while alpha data may still exist.
- The earlier CSS timeline score renderer surface was removed from the browser
  score-rendering module. The remaining browser score path is the VexFlow
  engraving model plus marker/playhead overlay used by the current studio UI.
- Frontend barrel exports were narrowed so unused historical helpers and
  incidental internal types are not exposed as callable project API.
- Generated local caches and disposable runtime artifacts are safe to clean from
  the workspace. Secrets, local virtualenvs, and package dependency directories
  are not treated as legacy cleanup targets.
- Verification for this cleanup: API regression suite passed 129/129,
  `uvx vulture apps/api/src apps/api/tests --min-confidence 80` passed, web
  lint passed, production web build passed, `npx --yes knip --workspace
  apps/web` passed, `git diff --check` passed, and Playwright release gate
  passed 40/40 with 2 browser-permission skips locally on 2026-04-29.

## Status Summary

Foundation reset: complete.

Engine baseline: implemented.

Implementation alignment: core vertical slice complete; extraction quality is
now centered on shared assignment, notation metadata, and source-specific OMR
or voice reliability improvements. Track registration quality is now enforced
at the repository write boundary rather than relying on each extraction source
to be correct by itself.
