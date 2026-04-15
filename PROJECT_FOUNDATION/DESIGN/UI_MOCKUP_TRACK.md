# GigaStudy UI Mockup Track

Date: 2026-04-09
Status: Active foundation track.

## 0. Why This Exists

`DESIGN/UI_WIREFRAMES_V1.md` is still the canonical low-fidelity layout pack, but it is not enough by itself for high-confidence visual implementation.

From this point forward, GigaStudy treats explicit mockup files as the preferred visual source of truth for the key product screens.

## 1. Source Of Truth Order

1. Editable design source
   Preferred: shared Figma file with named frames and frozen version references.
   Current equivalent: repo-local HTML and CSS artboards under `DESIGN/UI_EDITABLE_SOURCE/`.
2. Repo-visible mockup exports
   Required: exported PNG, SVG, or equivalent files under `PROJECT_FOUNDATION/DESIGN/UI_MOCKUPS/`.
3. Low-fidelity wireframe pack
   `DESIGN/UI_WIREFRAMES_V1.md` remains the layout and hierarchy fallback when the higher-fidelity source is still missing.

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

If a canonical mockup uses real photography, it should also record:

- the approved source image identifier
- the repo-owned copied asset path used by implementation
- the reason that image is safe to use, such as `non-identifying ambient environment`

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

Current bridge state:

- repo-local editable source under `DESIGN/UI_EDITABLE_SOURCE/`
- exported SVG assets in the repo
- code implementation tied to a named mockup version

Preferred future upgrade:

- shared editable Figma source
- exported PNG or SVG assets in the repo
- code implementation tied to a named mockup version

## 6. Immediate Work Pattern

1. Create or update the mockup export first.
2. Update `GigaStudy_check_list.md` and `FOUNDATION_STATUS.md`.
3. Implement or refactor the corresponding screen.
4. Verify in browser.
5. Only then mark the screen complete.

For the next Studio and Arrangement mockup iteration, the accepted secondary reference is now Wondershare Filmora.
That means the mockup pass should explicitly test:

- a clearer source rack
- a more obvious preview/player hierarchy
- a stronger timeline or take rail
- a contextual property inspector

It does not mean importing Filmora's template-marketplace density or generic video-editor chrome.

For the stricter next Studio-only pass, the accepted direct structural reference is now the attached MyEdit waveform editor.
That pass should explicitly test:

- one dominant waveform stage
- one left tool rail with short Korean labels
- one lower trim-control strip for `시작`, `끝`, and `방식`
- one obvious primary action area for `적용` and `저장`

It does not mean copying MyEdit branding, mixed image/audio product chrome, or English-first consumer downloader language.

## 7. Current Seeded Assets

The repo now carries seeded exports for:

- `Home`
- `Studio`
- `Arrangement`
- `Shared Review`
- `Ops`

They live under `UI_MOCKUPS/` and should be treated as the first visible visual baseline for continuing the refactor.

## 8. Current Editable Source

The repo now also carries an equivalent editable source at:

- `DESIGN/UI_EDITABLE_SOURCE/quiet-studio-console-v1.html`
- `DESIGN/UI_EDITABLE_SOURCE/quiet-studio-console-v1.css`

This source is now sufficient to close the "shared Figma file or equivalent editable design source exists" checklist item.
It does not remove the preference for a future shared Figma file.
