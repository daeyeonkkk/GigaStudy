# Foundation Status

Date: 2026-04-22

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
- OMR-generated notes are marked with `source="omr"` and
  `extraction_method="audiveris_omr_v0"`.
- OMR jobs that produce multiple mapped parts can be approved in one operation,
  registering candidates into their suggested tracks with overwrite protection.
- Registered TrackNote scores can be exported as a PDF from the studio toolbar.
  The export includes title, BPM, meter, track names, measure markers, and
  staff-like note placement.
- Single voice extraction exists as a local WAV MVP with adaptive voice
  thresholding, high zero-crossing rejection, normalized autocorrelation,
  confidence filtering, pitch-stability filtering, and median segment grouping.
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
- Visible tie arcs are drawn only as VexFlow note-to-note ties for
  display-split long notes or explicit adjacent same-pitch continuations.
- The renderer keeps a hidden layout-marker layer for regression checks and
  sync behavior, while the visible notation is the engraved SVG score.
- The score renderer gives each measure inner notation padding and keeps note
  centers inside their owning measure, so sync and same-onset clustering cannot
  push notes outside barlines.
- Track sync visually shifts the note layer while measure lines and measure
  labels remain fixed.
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

1. Add score-image-aware OMR preview and page/part confidence indicators.
2. Add clearer failed-extraction recovery for browser recording.
3. Improve PDF score export engraving fidelity to match the browser VexFlow
   score display while preserving TrackNote as the source of truth.
4. Add visual PDF rendering checks to CI once Poppler or an equivalent renderer
   is available.
5. Add object storage lifecycle cleanup and a retention rule for abandoned
   upload/job assets. Manual admin cleanup exists for staged upload objects,
   but the bucket still needs an automatic lifecycle rule.
6. Add user ownership or private share boundaries before inviting broader
   traffic; public list/detail endpoints are still alpha-only.
7. Add optional direct/temporary handling for larger scoring takes if alpha
   scoring recordings become too large for the current base64 path.
8. Add a scheduler or worker wake-up path for queued extraction jobs before
   relying on unattended long-running batch processing. The queue itself is
   durable; the current alpha wake-up path is still request/poll driven.

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

## Status Summary

Foundation reset: complete.

Engine baseline: implemented.

Implementation alignment: core vertical slice complete; extraction quality and
UX hardening remain.
