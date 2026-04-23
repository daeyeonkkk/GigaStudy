# Foundation Status

Date: 2026-04-23

## Current Decision

The foundation has been reset to the six-track a cappella studio direction.

The canonical product is:

1. Create or seed a six-track studio.
2. Fill, sync, and play Soprano, Alto, Tenor, Baritone, Bass, and Percussion.
3. Score a vocal attempt against the target track's registered answer notes
   while selected references play as context, then append a quantitative report.

The canonical engine rule is now documented in `ENGINE_ARCHITECTURE.md`.

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
- Noise-only or non-singing recordings are rejected instead of being registered
  as dense false notes.
- Browser upload normalizes browser-decodable MP3/M4A/OGG/FLAC audio into mono
  16-bit PCM WAV before sending it to the existing voice extraction path.
- NWC is not advertised as an accepted upload format until an NWC-to-TrackNote
  parser is connected.
- Per-track browser recording captures microphone audio, encodes WAV, and
  registers TrackNotes through the queued voice extraction path.
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
- Studio list/detail/action routes are owner-token scoped by default through
  `GIGASTUDY_API_STUDIO_ACCESS_POLICY=owner`. The browser stores a local
  per-device owner token and sends it as `X-GigaStudy-Owner-Token`; HTML audio
  playback uses a query-token URL because media elements cannot attach custom
  headers. Public mode remains available only by explicitly setting the policy
  to `public` for tests or local demos.
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
- Per-track browser recording plays the metronome when enabled and shows
  elapsed-time/input-level feedback while recording.
- Studio toolbar includes an explicit Home navigation control so users can
  leave a studio without relying on the small titlebar app mark.
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
- Studio report feed shows compact report title/date links; full quantitative
  report details live on a separate report page.
- AI generation now creates multiple pending candidates first; approving one
  candidate registers it and rejects sibling candidates from the same
  generation group.
- The score renderer now uses VexFlow clefs and ledger lines so Soprano through
  Bass tracks can extend above or below the staff without being clamped into
  misleading positions. Key-signature marks are hidden until the notation layout
  can render them without clipping.

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

## Status Summary

Foundation reset: complete.

Engine baseline: implemented.

Implementation alignment: core vertical slice complete; extraction quality and
UX hardening remain.
