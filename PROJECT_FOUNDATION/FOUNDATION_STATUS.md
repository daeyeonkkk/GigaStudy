# Foundation Status

Date: 2026-04-16

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
- `apps/web/src/pages/LaunchPage.tsx`
- `apps/web/src/pages/LaunchPage.css`
- `apps/web/src/lib/workspaceHistory.ts`
- `apps/web/src/components/ManagedAudioPlayer.tsx`
- `apps/api/src/gigastudy_api/api/routes/projects.py`
- `apps/api/src/gigastudy_api/api/schemas/projects.py`
- `apps/api/src/gigastudy_api/services/projects.py`
- `apps/api/tests/test_projects_api.py`

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

## Verification Completed

- `npm run lint` in `apps/web`: passed.
- `npm run build` in `apps/web`: passed.
- `uv run python -m pytest tests/test_projects_api.py` in `apps/api`: passed (`8 passed`).

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
- Global typography:
  the app now ships an `Instrument Sans` / `Manrope` / `Noto Sans KR` stack instead of
  `Segoe UI` and `Bahnschrift`, and the root canvas width now matches the wider package intent more closely.
  This item is still not fully closed because browser-default audio control chrome remains,
  and the full app has not yet been re-reviewed screen by screen against the package.
- `Studio`:
  a strict browser re-audit pass was run again on the live route. The live shell now maps much more
  closely to `02_STUDIO_SCREEN_SPEC.md` on desktop: top strip, left rail, center stage,
  right inspector, and lower workbench are all now visible as separate surfaces instead of one long
  stacked page. `version` and `share` are now split into separate lower-workbench tabs on the live route.
  The route remains open because the workbench is still taller and denser than the fixed spec,
  the top utility actions still use in-page section focus instead of final drawer/modal surfaces,
  and mobile remains too tall.
- `Arrangement`, `Shared Review`, and `Ops`:
  route implementations still exist, but package-based browser alignment remains open.
- Native browser audio chrome still drifts from the package:
  `ManagedAudioPlayer.tsx` still renders native `<audio controls>`.

## Honest Readiness Statement

- The product remains a usable internal or pilot-stage vocal practice MVP.
- The root-entry experience is now browser-reviewed and materially aligned with the frozen screen-spec package.
- The studio route is materially closer to the frozen package than before, but it is not yet ready
  to count as visually closed.
- Visual closure is still deliberately open until package-based browser review is completed
  for `Studio`, `Arrangement`, `Shared Review`, and `Ops`.

## Immediate Next Actions

1. Finish the remaining `Studio` drift:
   compress the lower workbench further and replace section-jump utility actions with their final
   drawer/modal surfaces.
2. Replace native audio control chrome if it blocks typography and control-surface closure.
3. Re-audit `Arrangement`, `Shared Review`, and `Ops` against the new screen-spec package.
4. Update release-gate or screenshot notes only after they reference the package mockup IDs instead of deleted legacy names.
