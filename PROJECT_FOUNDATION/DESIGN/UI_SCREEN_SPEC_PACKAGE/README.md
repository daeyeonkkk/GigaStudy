# UI Screen Spec Package

Date: 2026-04-20

This package defines only the UI needed for the six-track a cappella studio.

It replaces the previous package that described launch, studio, arrangement,
shared review, ops, and old mockups.

## Screen Set

- `HOME`
- `MAIN_STUDIO`
- `SCORING_REPORT`

## Documents

1. `00_GLOBAL_UI_FIXED_SPEC.md`
2. `01_HOME_SCREEN_SPEC.md`
3. `02_MAIN_STUDIO_SCREEN_SPEC.md`
4. `03_TRACK_REGISTRATION_SPEC.md`
5. `04_SCORING_REPORT_SPEC.md`
6. `05_INTERACTION_MATRIX.md`

## Product Rule

Every screen element must support one of these user tasks:

- Create or seed the six-track studio.
- Fill, sync, and play the six tracks.
- Score a recorded attempt against the target track's answer notes and
  understand the quantitative report.

If it does not support one of those tasks, remove it from the primary UI.
