# Filmora Reference Review

Date: 2026-04-14
Status: Accepted as a targeted workspace reference for Studio and Arrangement. Not a whole-product style replacement.

## 0. Why This Exists

GigaStudy already has a canonical design direction in `DESIGN/UI_DESIGN_DIRECTION.md`.
The user requested an explicit review of Wondershare Filmora as a possible UX/UI reference because the current product still needs substantial UX/UI improvement.

This document records:

- what Filmora is good at
- what is relevant to GigaStudy
- what should not be copied
- what the next mockup pass should change

## 1. Source Check

Primary official sources reviewed:

- [Filmora official homepage](https://filmora.wondershare.com/)
- [Navigating Filmora](https://filmora.wondershare.com/guide/filmora-navigating-filmora.html)
- [Filmora Panel Layout](https://filmora.wondershare.com/guide/panel-layout.html)
- [Color Comparison View](https://filmora.wondershare.com/guide/color-comparison-view.html)

Observed official product signals:

- Filmora positions itself as an intuitive editor that stays approachable for non-experts while still exposing advanced tools.
- The editing workspace is anchored around four stable objects:
  media library, preview/player, timeline, and contextual property panel.
- Filmora explicitly supports multiple layout modes rather than forcing one rigid arrangement.
- Filmora treats comparison and before/after review as first-class editing moments.

## 2. High-Level Judgment

Filmora is a strong reference for GigaStudy's `Studio` and `Arrangement` workspaces.
It is not a good reference for `Home`, and it should only partially influence `Shared Review`.

Why it fits:

- GigaStudy is also a media workspace with repeated preview, correction, and export loops.
- We already need a clearer distinction between source assets, the main listening/viewing surface, the timeline lane, and the selected-item inspector.
- Filmora solves "power without expert-only intimidation" better than most pro-audio or pro-video tools.

Why it should not dominate the whole product:

- Filmora is still a general-purpose video editor.
- GigaStudy is a vocal practice and arrangement product.
- If we copy too much, the app will drift toward template/effects shopping and generic creator-tool clutter.

## 3. What To Borrow

### A. Stable Workspace Split

Adopt a clearer four-part workspace model:

- left source rack
- center preview or score surface
- bottom timeline or take rail
- right contextual inspector

This is the most valuable Filmora pattern for us.

### B. Selection-Driven Inspector

Filmora keeps clip properties in a side property panel instead of scattering controls across the whole surface.
GigaStudy should do the same more consistently:

- select take -> show take quality, gain, device-profile warnings
- select note -> show attack, sustain, timing, confidence
- select arrangement part -> show part-specific playback and export controls

### C. Preview-First Feedback Loop

Filmora's player panel is the main truth surface while editing.
For GigaStudy, the equivalent is:

- waveform + contour + target overlay in Studio
- rendered score + playback cursor in Arrangement

The user should always know what they are hearing and what they are adjusting.

### D. Timeline As Primary Structure

Filmora treats the timeline as the editing backbone.
GigaStudy should push this further in a music-native way:

- guide and take rows must feel like real aligned lanes
- note and phrase issues should relate back to time clearly
- arrangement playback should feel anchored to a musical timeline, not to floating cards

### E. Layout Modes, But Fewer

Filmora exposes several layout modes.
We should borrow the idea, but simplify it to product-safe modes only:

- Record focus
- Review focus
- Arrange focus

We do not need six modes.
We do need one clearer way to reduce clutter based on task.

### F. Before/After Comparison Thinking

Filmora's comparison view is a useful mental model.
For GigaStudy this should become:

- guide vs take listening
- before-correction vs after-retake review
- candidate A vs B vs C arrangement comparison

## 4. What To Reject

### A. Effects-Marketplace Clutter

Filmora's toolbar includes stock media, effects, stickers, transitions, templates, and similar creative inventory.
GigaStudy should not copy that density.

Reject:

- sticker-like chrome
- busy top-tab shopping surfaces
- large effect/template browsing as a default workspace state

### B. Video-Editor Jargon

Do not turn the product into a generic editor through labels like:

- asset center
- transition
- clip effect
- template browser

Keep music-practice language primary.

### C. Too Many Independent Panels

Filmora can get busy because many tabs compete for attention.
GigaStudy should keep the Filmora structural split while staying quieter and more musically literate than Filmora itself.

### D. Video-First Visual Identity

Filmora's center of gravity is still video production.
GigaStudy must keep:

- note correctness
- vocal take review
- score readability
- arrangement export

as the dominant identity.

## 5. Screen-By-Screen Call

### Home

Do not use Filmora as the primary reference.

Keep:

- poster-like entry
- calm editorial feel
- musical trust and seriousness

Filmora can inform feature-strip clarity, but not the main visual personality.

### Studio

Filmora is a valid second reference next to Ableton and Descript.

Apply it to:

- clearer left source rack for guide, takes, and related assets
- more obvious center preview hierarchy
- more timeline-like lower lane
- stronger right inspector behavior

Do not apply it to:

- effects-heavy toolbars
- marketplace-like tab bars

### Arrangement

Filmora is useful for layout discipline, not for visual identity.

Apply it to:

- clearer candidate/source rail
- stronger transport and preview hierarchy
- more obvious contextual properties on the right

But keep the score as the hero artifact.

### Shared Review

Use only lightly.

Borrow:

- focused preview and summary grouping

Reject:

- editor-like density

### Ops

Do not use Filmora as the primary reference.
Linear is still the better ops reference.

## 6. Concrete Next Changes

The next visual pass should introduce these changes:

1. Studio v2 should distinguish `source rack / preview canvas / take timeline / inspector` more explicitly.
2. Arrangement v2 should distinguish `candidate rail / score canvas / transport strip / inspector` more explicitly.
3. We should prototype a lightweight workspace mode toggle:
   `녹음`, `리뷰`, `편곡`.
4. We should add one mockup pass that tests stronger Filmora-like panel resizing and hierarchy, while keeping GigaStudy's quieter shell and musical language.

## 7. Final Decision

Accepted decision:

- Filmora is now an approved reference for workspace structure in `Studio` and `Arrangement`.
- Filmora is not an approved replacement for the overall `Quiet Studio Console` direction.
- GigaStudy should borrow Filmora's panel logic, not its template-marketplace personality.

## 8. Foundation Follow-Up

This review requires:

- `DESIGN/UI_DESIGN_DIRECTION.md` to list Filmora as a reference
- `DESIGN/UI_WIREFRAMES_V1.md` to acknowledge Filmora-informed workspace improvements
- `GigaStudy_check_list.md` to track a Filmora-informed Studio/Arrangement mockup pass as unfinished work
