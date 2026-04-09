# Project Foundation

Date: 2026-04-09

This folder is the product and delivery source of truth for GigaStudy.
It defines the MVP boundary, implementation order, release gate, and the checklist we use to decide what is actually done.

## Read In This Order

1. `GigaStudy_master_plan.md`
2. `ROADMAP.md`
3. `UI_DESIGN_DIRECTION.md`
4. `UI_WIREFRAMES_V1.md`
5. `INTONATION_ANALYSIS_ASSESSMENT.md`
6. `INTONATION_CALIBRATION_REPORT.md`
7. `PHASE1_BACKLOG.md`
8. `PHASE9_INTONATION_BACKLOG.md`
9. `GigaStudy_check_list.md`
10. `BROWSER_ENVIRONMENT_VALIDATION.md`
11. `FOUNDATION_STATUS.md`
12. `WORKING_PRINCIPLES.md`

## What Each Document Does

- `GigaStudy_master_plan.md`
  Product definition, MVP scope, stack target, architecture, risks, and release cut line.
- `ROADMAP.md`
  Phase-by-phase execution order and completion criteria.
- `UI_DESIGN_DIRECTION.md`
  Canonical visual direction for the product, including the chosen art direction, reference read, screen priorities, and hard UI rules for future visual refactors.
- `UI_WIREFRAMES_V1.md`
  Reference-led low-fidelity wireframe pack for the canonical home, studio, arrangement, shared, and ops screens.
- `PHASE1_BACKLOG.md`
  Build backlog for the first recording pipeline and studio foundation slice.
- `PHASE9_INTONATION_BACKLOG.md`
  Execution backlog for the note-level intonation quality track, including signed cents, note segmentation, confidence weighting, and calibration work.
- `INTONATION_CALIBRATION_REPORT.md`
  Current calibration evidence, provisional threshold bands, and the claim gate for what the intonation scorer can and cannot promise today.
- `GigaStudy_check_list.md`
  Live checklist for scope control, implementation readiness, and release gating. Check marks should map only to verified implementation, not to intent.
- `BROWSER_ENVIRONMENT_VALIDATION.md`
  Native browser and hardware validation protocol built on top of the ops diagnostics baseline.
- `FOUNDATION_STATUS.md`
  Current implementation audit against the foundation docs, including verified coverage, browser-environment diagnostics, and remaining gaps.
- `INTONATION_ANALYSIS_ASSESSMENT.md`
  Evaluation of the current scoring engine, what critique is accepted, and the approved quality track for a more human-trustworthy intonation analyzer.
- `WORKING_PRINCIPLES.md`
  Project working rules, storage conventions, and execution discipline.

## Working Rule

If implementation, backlog, or UI behavior drifts from these foundation docs, update the foundation first or in the same change.
