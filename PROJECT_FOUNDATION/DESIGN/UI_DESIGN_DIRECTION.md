# GigaStudy UI Design Direction

Date: 2026-04-09
Status: Canonical design direction for the next visual refactor. This is a foundation decision, not a claim that every current screen already matches it.

## 0. Why This Document Exists

GigaStudy already has:

- product and screen-structure planning in `GigaStudy_master_plan.md`
- working UI implementation in `apps/web`

GigaStudy did not yet have:

- one canonical visual direction that every screen should converge toward

This document closes that gap.
From this point on, UI work should stop inventing new local styles and instead move toward one shared product aesthetic.

## 1. Chosen Direction

### Design Name

`Quiet Studio Console`

### One-Sentence Thesis

GigaStudy should feel like a modern rehearsal control room: calm, low-noise, musically literate, and precise enough for serious practice without looking like a generic SaaS dashboard.

### Product Fit

This direction matches the actual product promise:

- guided vocal practice
- post-recording analysis
- editable melody and arrangement workflow
- score, playback, and export

The UI should therefore feel:

- more like a studio tool than a marketing site
- more like an instrument workspace than a KPI dashboard
- more like a notation-aware editor than a card-based admin app

## 2. Reference Read

We are not copying any one product.
We are combining specific strengths from a few references and rejecting the parts that do not fit GigaStudy.

### Reference A. Linear

Sources:

- [Linear Brand Guidelines](https://linear.app/brand)
- [Linear Search](https://linear.app/docs/search)

Useful takeaways:

- calm, dense, low-noise product shell
- fast scanning through typography and spacing instead of heavy chrome
- strong hierarchy without loud color use
- keyboard-first speed and a calmer, more consistent interface are a useful north star for our studio shell

What we should borrow:

- restraint
- density with readability
- operational clarity

What we should not borrow literally:

- bug-tracker metaphors
- issue-list visual language as the main studio identity

### Reference B. Descript

Sources:

- [Studio Sound](https://help.descript.com/hc/en-us/articles/10327603613837-Studio-Sound)

Useful takeaways:

- multitrack material can be edited as one aligned object, then refined per-track when necessary
- a right-side properties panel is a strong pattern for focused, contextual adjustments
- track-level mute, solo, timing, and effects belong in a precise editor surface, not in scattered mini cards

What we should borrow:

- central workspace plus right inspector
- contextual controls
- an "edit together, inspect in detail" rhythm

What we should not borrow literally:

- transcript-first editing as the main metaphor
- video-scene mental model

### Reference C. Ableton Live

Sources:

- [Arrangement View](https://www.ableton.com/en/manual/arrangement-view/)
- [Session View](https://www.ableton.com/en/live-manual/12/session-view/)

Useful takeaways:

- linear arrangement is the right metaphor when users need fixed song structure and review
- session-style thinking is useful for trying takes and ideas without losing the main arrangement context
- musical timeline and transport should feel primary, not secondary

What we should borrow:

- timeline-first mental model for studio review
- strong transport identity
- clip and take thinking

What we should not borrow literally:

- dark DAW complexity
- pro-audio overload that intimidates practice users

### Reference D. Notion Calendar

Source:

- [Notion Calendar](https://www.notion.com/product/calendar)

Useful takeaways:

- "beautifully designed, fully integrated" is the right bar for cross-surface cohesion
- modern design can still stay utility-first
- shortcuts, command patterns, and integration clarity matter in dense tools

What we should borrow:

- integrated feel across pages
- modern but quiet polish
- clean surface transitions

What we should not borrow literally:

- productivity-calendar metaphors
- generic monochrome productivity UI without musical identity

## 3. Final Art Direction

### Mood

- calm
- focused
- rehearsal-room serious
- slightly editorial
- not playful, not flashy, not futuristic chrome

### Material Language

- graphite app shell
- warm paper-like score surfaces
- copper accent for action and transport
- soft teal or cyan only where audio contour or signal guidance benefits from it

### Core Contrast

- dark structure
- light content canvases

This contrast is important.
The application shell should feel controlled and technical, while the score and note-review surfaces should feel legible and musical.

## 4. Visual System

### Color Direction

Primary shell:

- deep graphite or ink blue

Primary accent:

- copper or burnt orange

Support accent:

- muted cyan for pitch and waveform overlays

State colors:

- green for stable or good
- amber for review or caution
- red for clear correction or failure

Avoid:

- rainbow palettes
- purple-heavy default SaaS gradients
- flat white productivity UI with weak musical atmosphere

### Typography

Use at most two families:

- UI sans: `Instrument Sans` or `Manrope`
- editorial display or emphasis: `Fraunces` or `Cormorant Garamond`

Rule:

- the app UI should mostly be sans
- the display face should be used sparingly on landing or section headlines, not inside dense controls

### Shape

- large-radius containers are allowed on overview or secondary surfaces
- the studio core should rely more on panels, rails, rows, and canvases than on floating cards

### Spacing

- more whitespace around the main canvas
- tighter spacing inside inspector and track rows
- fewer nested boxes

## 5. Screen Direction

### Screen 1. Home

Role:

- poster-like entry, not an ops bulletin

Structure:

- full-bleed hero
- one dominant promise
- one project-start action
- one supporting studio visual

Should feel like:

- "start a vocal session"

Should not feel like:

- "environment validation dashboard"

Design rule:

- the current engineering-heavy hero copy should be replaced in the visual refactor

### Screen 2. Studio

Role:

- the product's primary identity

Canonical layout:

- top strip: project metadata, tempo, key, chord marker, count-in, transport status
- center canvas: waveform, contour, target-note overlay, score-preview context
- lower lane: take and guide rows with transport-facing controls
- right inspector: score, note feedback, confidence, chord mode, correction detail

Design rule:

- the studio should stop reading as stacked panels and start reading as one integrated control surface

### Screen 3. Arrangement

Role:

- musical artifact view

Canonical layout:

- left rail: constraints and candidate controls
- center: score paper canvas
- right rail: playback, export, per-part guide controls

Design rule:

- the score must visually feel like the hero artifact
- export and compare UI must support the score, not compete with it

### Screen 4. Ops

Role:

- utilitarian control room

Canonical layout:

- dense
- low color
- fast scanning
- clearly grouped diagnostics and logs

Design rule:

- ops is the one place where Linear-like density should dominate
- it should not set the tone for the main product home or studio screens

### Screen 5. Shared View

Role:

- frozen review artifact

Canonical layout:

- compact summary
- score and audio focus
- no edit ambiguity

Design rule:

- simpler than Studio
- more editorial and presentation-like

## 6. Interaction Thesis

The product needs a few motions that change the feel without turning it into demo UI.

### Motion 1. Studio Load Reveal

- shell loads first
- canvas fades and rises in
- inspector metrics follow with a short stagger

### Motion 2. Transport Presence

- playhead movement should be visually deliberate
- playback should feel carried across the score and waveform

### Motion 3. Note-Focus Transition

- selecting a weak note should smoothly update inspector emphasis
- avoid abrupt panel jumps

## 7. Hard Rules

- No dashboard-card mosaic for the main studio.
- No engineering or ops language in the home hero.
- No more than one dominant accent color in the default app shell.
- No decorative gradient backgrounds behind routine studio content.
- No stacked "panel inside card inside card" composition in the critical workspace.
- The score surface must look like a musical artifact, not a generic white card.
- The note-feedback UI must privilege direction and correction over raw metric clutter.

## 8. Immediate Implementation Priorities

### Priority 1

Refactor the home page to match the new product identity.

### Priority 2

Restructure the studio page into a more integrated console layout:

- one primary canvas
- one transport strip
- one inspector

### Priority 3

Promote arrangement score view visually so it feels like a destination, not a sub-panel.

### Priority 4

Keep ops dense and useful, but visually separate it from the product-facing personality.

## 9. Foundation Decision

From this document forward:

- `Quiet Studio Console` is the canonical design direction for GigaStudy
- future UI work should be judged against this direction before implementation
- if we intentionally change direction later, this document must be updated first or in the same change
