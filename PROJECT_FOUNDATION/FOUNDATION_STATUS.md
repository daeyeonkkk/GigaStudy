# Foundation Status

Date: 2026-04-17

## Sources Checked

- `GigaStudy_master_plan.md`
- `ROADMAP.md`
- `GigaStudy_check_list.md`
- `README.md`
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/README.md`
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/00_GLOBAL_UI_FIXED_SPEC.md`
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/01_ROOT_LAUNCH_SCREEN_SPEC.md`
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/02_STUDIO_SCREEN_SPEC.md`
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/03_ARRANGEMENT_SCREEN_SPEC.md`
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/04_SHARED_REVIEW_SCREEN_SPEC.md`
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/05_OPS_SCREEN_SPEC.md`
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/06_INTERACTION_CONNECTION_MATRIX.md`
- `OPERATIONS/WORKING_PRINCIPLES.md`
- `apps/web/src/App.tsx`
- `apps/web/src/index.css`
- `apps/web/src/App.css`
- `apps/web/src/pages/LaunchPage.tsx`
- `apps/web/src/pages/LaunchPage.css`
- `apps/web/src/pages/StudioPage.tsx`
- `apps/web/src/pages/ArrangementPage.tsx`
- `apps/web/src/pages/ArrangementPage.css`
- `apps/web/src/pages/SharedProjectPage.tsx`
- `apps/web/src/pages/SharedProjectPage.css`
- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/workspaceHistory.ts`
- `apps/web/src/components/ManagedAudioPlayer.tsx`
- `apps/api/src/gigastudy_api/api/routes/projects.py`
- `apps/api/src/gigastudy_api/api/schemas/projects.py`
- `apps/api/src/gigastudy_api/api/schemas/project_history.py`
- `apps/api/src/gigastudy_api/services/projects.py`
- `apps/api/src/gigastudy_api/services/project_history.py`
- `apps/api/tests/test_projects_api.py`
- `apps/api/tests/test_project_history_api.py`

## Foundation Reset Still In Force

- `PROJECT_FOUNDATION/DESIGN/` has one canonical UI source of truth:
  `UI_SCREEN_SPEC_PACKAGE/`.
- The canonical screen set is now fixed as `Launch`, `Studio`, `Arrangement`,
  `Shared Review`, and `Ops`.
- Legacy UI direction docs, reference-review docs, wireframes, editable-source files,
  and old mockup trees were intentionally removed and should not re-enter the foundation.

## What Changed In This Pass

- The live `/` route no longer serves the deleted poster-style root screen.
  It now serves `LaunchPage`.
- The live launch surface now implements the foundation entry contract structurally:
  recent-project list, search, `전체/최근 연 항목/고정` filters,
  new-project form, shared-review opener, and topbar jump actions.
- The launch surface now has a real data path behind it:
  `GET /api/projects` exists and returns recent-first project rows plus launch summaries
  (`has_guide`, `take_count`, `ready_take_count`, `arrangement_count`, `has_mixdown`).
- Recent-project rows now support last-workspace reopening through local workspace memory,
  plus local pinning and share-link copy.
- Local browser review of `Launch` was completed against the package at
  desktop `1440x1100` and mobile `390x844`, and the live route was tightened
  for utility-copy hierarchy, topbar density, row action density, mobile row compression,
  and command-rail line breaks.
- Local browser review can now use Vite preview/dev on `4173` without fetch failure,
  because the API dev CORS allowlist now includes `127.0.0.1:4173` and `localhost:4173`.
- Legacy root-entry product code and the old home-only photography asset were removed.
- During this pass, `apps/web/src/pages/StudioPage.tsx` had to be recovered from the last committed
  good state after a local encoding-corruption incident in the working copy.
  The damaged local copy was preserved for reference at
  `output/recovery/StudioPage.corrupt-20260417-1251.tsx`.
- On top of the recovered stable Studio route, one confirmed structural drift was fixed:
  the duplicate lower-workbench `track-lane` section was removed.
  The studio now keeps its `재생 / 트랙` surface only in the main timeline region instead of
  rendering the same track lane again inside the lower workbench.
- On top of that recovered route, core Studio control hierarchy was re-applied to the live surface:
  the visible recording actions now use one primary toggle instead of a visible start/stop pair,
  rail and next-action buttons default to disabled when their prerequisites are missing,
  evidence/export downloads now live under one collapsed `자료` surface,
  and per-track mute / solo / volume now live under compact `믹스` details surfaces instead of
  always staying inline.
- A fresh mobile browser check on the populated local audit project
  (`a216fd69-e316-40fd-8c60-4cdaca7fd82f`) confirmed that in `리뷰` mode the lower workbench now shows
  only `코드` and `분석`, without the duplicated `재생 / 트랙` section.
  Evidence was captured as `output/playwright/studio-review-no-tracklane-mobile-v1.png`.
- A fresh desktop + mobile browser pass on the same populated audit project also confirmed the
  re-applied control hierarchy on the recovered route:
  one visible recording toggle, disabled prerequisite actions, accessible `자료` details,
  and compact `믹스` row surfaces.
  Evidence was captured as `output/playwright/studio-control-hierarchy-desktop-v6.png`
  and `output/playwright/studio-control-hierarchy-mobile-v3.png`.
- On top of that recovered route, top utility actions are now connected to real surfaces again:
  `프로젝트 설정` opens a right-side drawer with editable project basics, and `공유` opens a modal
  with label, expiry, snapshot-version, and included-artifact controls.
  Evidence was captured as `output/playwright/studio-project-settings-drawer-v2.png`
  and `output/playwright/studio-share-modal-v2.png`.
- The lower `공유` tab no longer duplicates share-authoring inputs inline.
  It now keeps only the launcher summary and the share-link history list, while authoring lives
  only in `MODAL-STUDIO-SHARE`.
- The lower `버전` tab now keeps custom version-name and version-note fields collapsed by default
  instead of leaving dense authoring inputs always open.
- During the same truth pass, the persisted `project.mode` field was confirmed to be semantically
  ambiguous in live data and cannot be treated as a reliable user-facing `작업 목적` label.
  `Launch` therefore no longer exposes a workflow-purpose column or a create-form purpose dropdown
  until a dedicated product field exists for that intent.
- A fresh desktop + mobile browser capture on the live launch route confirmed that the `작업 목적`
  field no longer appears in the create form or in recent-project rows.
  Evidence was captured as `output/playwright/launch-live-no-goal-v1.png`
  and `output/playwright/launch-live-no-goal-mobile-v1.png`.
- A later launch truth pass normalized offline and service-unavailable states so raw platform
  exception text such as `Failed to fetch` no longer appears in the recent-list or create-project
  surface.
  The recent-list retry action now re-runs the request in place instead of forcing a full page reload.
  Evidence was captured as `output/playwright/launch-offline-error-v1.png`.
- A fresh compact-mobile browser pass on the populated Studio audit route confirmed that three dense
  Studio side surfaces now start collapsed by default instead of staying fully open:
  the left `프로젝트` rail, the right `선택 상태` inspector, and the `트랙 목록` region under
  `재생 / 트랙`.
  Evidence was captured as `output/playwright/studio-mobile-rail-summary-v1.png`,
  `output/playwright/studio-mobile-inspector-summary-v1.png`, and
  `output/playwright/studio-mobile-tracklist-summary-v1.png`.
- A follow-up compact-mobile browser pass confirmed that several lower-workbench surfaces now also
  default to summary rows instead of rendering dense bodies immediately:
  the populated `멜로디` note editor, the `편곡` preset summary, the `악보 / 재생` part-mix panel,
  and the `믹스다운` save-summary panel.
  Evidence was captured as `output/playwright/studio-mobile-melody-fold-populated-v1.png`,
  `output/playwright/studio-mobile-arrangement-folds-v1.png`,
  `output/playwright/studio-mobile-scoreplayback-fold-populated-v1.png`, and
  `output/playwright/studio-mobile-mixdown-fold-v1.png`.
- A later truth pass ran real post-recording analysis on the populated Studio audit project and
  confirmed that the three `분석` folds also stay collapsed by default on compact mobile when
  real note-feedback exists:
  `교정 타임라인`, `노트 교정 목록`, and `구간 진단`.
  Evidence was captured as `output/playwright/studio-mobile-analysis-folds-populated-v1.png`.
- The shared `ManagedAudioPlayer` surface no longer exposes native browser audio chrome.
  It now renders a product-styled transport with hidden media elements behind it, and a local
  browser pass confirmed the replacement on live `Studio` and `Shared Review` routes.
  Evidence was captured as `output/playwright/studio-audio-chrome-desktop-v1.png`
  and `output/playwright/shared-review-audio-chrome-desktop-v1.png`.
- A later package-vs-live browser audit re-checked the populated live `Studio` route against
  `studio-desktop-v1` on desktop `1440x1100` and mobile `390x844`.
  With the recovered shell, control hierarchy, compact-mobile folds, drawer / modal surfaces,
  and custom audio transport all visible together in one pass, the route now counts as aligned
  closely enough for this foundation round.
  Evidence was captured as `output/playwright/studio-live-desktop-audit-v4.png`
  and `output/playwright/studio-live-mobile-audit-v4.png`.
- A later arrangement truth pass replaced the dark hero/card workspace with a flat notation-first
  shell that now matches the fixed package much more closely:
  compact candidate top bar, left constraints rail, dominant center score paper, right playback /
  mixer / guide / export rail, plus a compare drawer and export modal.
  The same pass also normalized fetch-failure handling on the route by routing network exceptions
  through product copy instead of raw browser text.
  Evidence was captured as `output/playwright/arrangement-live-desktop-audit-v2.png`
  and `output/playwright/arrangement-live-mobile-audit-v2.png`.
- A follow-up browser audit on live `Shared Review` confirmed that this route is still materially
  off-package:
  it still leads with a large dark hero, tall review-order cards, and card-heavy left / center /
  right columns instead of the fixed compact header + summary strip + three-column read-only
  review canvas defined in `04_SHARED_REVIEW_SCREEN_SPEC.md`.
  Evidence was captured as `output/playwright/shared-review-live-desktop-audit-v1.png`
  and `output/playwright/shared-review-live-mobile-audit-v1.png`.
- A later shared-review truth pass replaced that hero/card stack with a compact read-only review
  surface:
  compact header, summary strip, left take summary rail, center review canvas with score / waveform
  mode dropdown, right score rail, plus a read-only note-detail drawer and guide-player reveal
  from header actions.
  Evidence was captured as `output/playwright/shared-review-live-desktop-audit-v2.png`,
  `output/playwright/shared-review-live-mobile-audit-v2.png`,
  `output/playwright/shared-review-note-drawer-v1.png`, and
  `output/playwright/shared-review-guide-player-v1.png`.
- A later ops truth pass replaced the long card-heavy monitoring stack with a dense utility screen
  that now follows the frozen package much more closely:
  compact `72px` header, `88px` KPI strip, two-column diagnostic grid, read-only detail drawers,
  and a dedicated validation-import modal instead of inline long-form authoring.
  Evidence was captured as `output/playwright/ops-live-desktop-audit-v2.png`,
  `output/playwright/ops-live-mobile-audit-v2.png`,
  `output/playwright/ops-release-drawer-v1.png`, and
  `output/playwright/ops-validation-import-modal-v1.png`.

## Verification Completed

- `npm run lint` in `apps/web`: passed.
- `npm run build` in `apps/web`: passed.
- `uv run python -m pytest tests/test_projects_api.py` in `apps/api`: passed.
- `uv run python -m pytest tests/test_project_history_api.py` in `apps/api`: passed.
- A local browser playback pass confirmed that the first custom audio transport on both live
  `Studio` and live `Shared Review` advances time without exposing `audio[controls]`.
- A local browser launch-offline pass confirmed that service-unavailable states show normalized
  product copy and keep `Failed to fetch` out of the live UI.
- A local browser Studio package audit re-checked the populated live route at desktop and mobile
  sizes against the frozen package mockup.
- A local browser Arrangement package audit re-checked the populated live route at desktop and
  mobile sizes against `arrangement-desktop-v1`.
- A local browser Shared Review package audit captured the current populated live route at desktop
  and mobile sizes to freeze the remaining drift against `04_SHARED_REVIEW_SCREEN_SPEC.md`.
- A later local browser Shared Review package audit re-checked the rebuilt live route at desktop
  and mobile sizes against `shared-review-desktop-v1`, then also verified the read-only note-detail
  drawer and the guide-player reveal wired from the compact header.
- A later local browser Ops package audit re-checked the rebuilt live route at desktop and mobile
  sizes against `ops-desktop-v1`, then also verified the release-gate detail drawer and the
  validation-import modal.

## Accepted Verification Warnings

- `npm run build` still emits one Vite chunk-size warning for `osmd-vendor`,
  the `opensheetmusicdisplay` payload.
  This remains accepted only while notation stays route-split away from the default entry path.
- The targeted API pytest run still emitted two environment warnings in this Windows Python 3.12 setup:
  `pydub` warned that `audioop` is deprecated ahead of Python 3.13 removal,
  and it also warned that no local `ffmpeg` or `avconv` binary was found.
  These warnings remain accepted only while the suite continues to pass
  and no release workflow begins to require a local media binary.

## Current Implementation Alignment

- `Launch`:
  the route, interaction flow, and browser-reviewed desktop/mobile layout now align closely enough
  with `01_ROOT_LAUNCH_SCREEN_SPEC.md` and `launch-desktop-v1` to count as closed for this pass.
  The launch surface now intentionally omits any `작업 목적` field or recent-row purpose column
  because the current persisted `project.mode` field is not a trustworthy product-level intent field.
  Offline and service-unavailable states are also normalized now, so recent-list and create-project
  errors no longer leak raw browser fetch text and recent-list retry happens in place.
- Global typography:
  the app now ships an `Instrument Sans` / `Manrope` / `Noto Sans KR` stack instead of
  `Segoe UI` and `Bahnschrift`, and the root canvas width now matches the wider package intent more closely.
  The browser-default audio control chrome blocker is now removed because live playback surfaces
  use a custom transport instead of native `<audio controls>`.
  This global item is materially aligned, and the current canonical route set has now also been
  re-reviewed against the frozen package mockups.
- `Studio`:
  after the route recovery, current truth is the recovered stable Studio shell plus the confirmed
  live cleanups that were re-audited together in the browser.
  Review mode no longer repeats the `재생 / 트랙` surface below the main timeline region.
  The visible recording flow now uses one toggle, export/evidence actions are reachable through one
  collapsed `자료` surface, and per-track mix utilities are collapsed under `믹스`.
  Note-list, arrangement, and other prerequisite-driven actions now stay disabled until they become meaningful.
  Top utility actions now open a real `프로젝트 설정` drawer and a real `공유` modal instead of
  jumping users into lower workbench sections.
  Share authoring now lives only in the modal, and version-note overrides stay collapsed by default.
  On compact mobile viewports, the left rail, right inspector, and `트랙 목록` now default to
  one-line summary rows and open on demand instead of rendering fully expanded by default.
  A later compact-mobile pass also confirmed that populated `멜로디` note editing,
  `편곡` preset explanation, `악보 / 재생` part mix, and `믹스다운` save summary now collapse
  behind summary rows by default.
  The same compact-mobile truth set now includes populated `분석` note-feedback folds with real
  analysis output, not only empty-state placeholders.
  Live audio playback surfaces on this route now use the shared custom transport instead of
  browser-default media chrome.
  A later package-vs-live browser audit on the populated live route now brings this screen close
  enough to `02_STUDIO_SCREEN_SPEC.md` and `studio-desktop-v1` to count as closed for this pass.
- `Arrangement`:
  the route now uses a flat notation-first workspace instead of the earlier dark hero/card shell.
  The top candidate bar is compact, the left side is now a fixed constraints + generation rail,
  the center region is again dominated by score paper, and the right rail now groups playback,
  part mixer, guide mode, and export quick actions as one vertical tool column.
  Candidate compare now opens in a drawer and export packaging now opens in a modal instead of
  living as scattered inline card actions.
  A later desktop + mobile package audit on the populated live route now brings this screen close
  enough to `03_ARRANGEMENT_SCREEN_SPEC.md` and `arrangement-desktop-v1` to count as closed
  for this pass, even though rehearsal-mark jump controls and deep score-view scoping are still
  shallow interactions rather than full notation tooling.
- `Shared Review`:
  the route now follows the compact read-only review contract closely enough for this pass.
  The earlier dark hero, large flow cards, and card-heavy dashboard body are gone.
  Live structure is now the package shape: compact header, summary strip, left take summary,
  center review canvas, and right score rail.
  Header actions now stay read-only and lead only to artifact playback/download surfaces.
  The note-detail surface now opens as a drawer with metrics and correction sentence only,
  without edit fields.
  This route now counts as closed against `04_SHARED_REVIEW_SCREEN_SPEC.md` and
  `shared-review-desktop-v1`, though multi-version snapshot switching remains latent because the
  current shared payload still carries one selected version at a time.
- `Ops`:
  the route now uses a dense utility shell instead of the earlier long card stack.
  The live screen now follows the package shape closely enough for this pass:
  compact header, KPI strip, runtime table with range/severity controls, release-gate block,
  validation-import block, validation log, failed-track recovery list, analysis-job list,
  and latest-audio-profile list.
  Low-priority detail surfaces now live in right drawers or a single import modal instead of
  inflating the default page height.
  This route now counts as closed against `05_OPS_SCREEN_SPEC.md` and `ops-desktop-v1`.
- Audio control chrome:
  native browser controls are no longer exposed on the live routes reviewed in this pass.
  This blocker is now fully behind the current route-alignment pass.

## Honest Readiness Statement

- The product remains a usable internal or pilot-stage vocal practice MVP.
- The root-entry experience is now browser-reviewed and materially aligned with the frozen screen-spec package.
- The studio route is now browser-reviewed closely enough against the frozen package to count as visually closed for this round.
- The arrangement route is now browser-reviewed closely enough against the frozen package to count as visually closed for this round.
- The shared-review route is now browser-reviewed closely enough against the frozen package to count as visually closed for this round.
- The ops route is now browser-reviewed closely enough against the frozen package to count as visually closed for this round.
- The five canonical routes are now visually closed for the current foundation round, and future re-opens
  should happen only when the package changes or live drift appears.

## Immediate Next Actions

1. Keep future browser-review notes pinned to `launch-desktop-v1`, `studio-desktop-v1`, `arrangement-desktop-v1`, `shared-review-desktop-v1`, and `ops-desktop-v1`.
2. Re-open route-level checklist items only when live drift or package changes are confirmed in a browser pass.
