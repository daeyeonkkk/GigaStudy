# GigaStudy UI Mockup Track

Date: 2026-04-09
Status: Active foundation track.

## 0. Why This Exists

`UI_WIREFRAMES_V1.md` is still the canonical low-fidelity layout pack, but it is not enough by itself for high-confidence visual implementation.

From this point forward, GigaStudy treats explicit mockup files as the preferred visual source of truth for the key product screens.

## 1. Source Of Truth Order

1. Editable design source
   Preferred: shared Figma file with named frames and frozen version references.
2. Repo-visible mockup exports
   Required: exported PNG, SVG, or equivalent files under `PROJECT_FOUNDATION/UI_MOCKUPS/`.
3. Low-fidelity wireframe pack
   `UI_WIREFRAMES_V1.md` remains the layout and hierarchy fallback when the higher-fidelity source is still missing.

Rule:

- do not continue a major visual refactor from prose alone once a mockup export exists
- implementation should cite the mockup version it is targeting
- wireframe and mockup drift must be reconciled in foundation before more UI code is written

## 2. First Mockup Priority

The first screens that need frozen mockups are:

1. `Home`
2. `Studio`
3. `Arrangement`

The second wave is:

1. `Shared Review`
2. `Ops`

This order follows product impact, not implementation convenience.

## 3. Minimum Asset Contract

Each canonical mockup should have:

- one editable design source or a recorded gap saying it does not exist yet
- one repo-visible export
- a stable screen name
- a version label such as `v1`
- a short implementation note describing what code screen should target it

Recommended naming:

- `home-v1`
- `studio-v1`
- `arrangement-v1`
- `shared-review-v1`
- `ops-v1`

## 4. What Counts As Done

A screen can be considered visually locked only when:

- the screen has a frozen mockup version
- the implementation references that version in foundation status or checklist language
- browser review confirms the code still resembles that mockup closely enough

## 5. Current Decision

Because this repo already has working Home and Studio implementations, we will seed the mockup track with repo-visible exports first.

That is a bridge step, not the final state.

Preferred end state:

- shared editable Figma source
- exported PNG or SVG assets in the repo
- code implementation tied to a named mockup version

## 6. Immediate Work Pattern

1. Create or update the mockup export first.
2. Update `GigaStudy_check_list.md` and `FOUNDATION_STATUS.md`.
3. Implement or refactor the corresponding screen.
4. Verify in browser.
5. Only then mark the screen complete.

## 7. Current Seeded Assets

The repo now carries initial seeded exports for:

- `Home`
- `Studio`
- `Arrangement`

They live under `UI_MOCKUPS/` and should be treated as the first visible visual baseline for continuing the refactor.
