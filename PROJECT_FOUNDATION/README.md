# Project Foundation

Date: 2026-04-09

This folder is the product and delivery source of truth for GigaStudy.
It defines the MVP boundary, implementation order, release gate, and the checklist we use to decide what is actually done.

## Root Contract

Only canonical core documents should live at the root of `PROJECT_FOUNDATION`:

- `README.md`
- `GigaStudy_master_plan.md`
- `ROADMAP.md`
- `GigaStudy_check_list.md`
- `FOUNDATION_STATUS.md`

All supporting material must live under a categorized subfolder instead of being dropped into the root.
Screenshots, scratch notes, one-off exports, and generated evidence files do not belong at the root.

## Folder Structure

- `BACKLOGS/`
  Execution backlogs and implementation ticket breakdowns.
- `DESIGN/`
  Fixed screen specs, interaction contracts, and frozen mockup exports.
- `QUALITY/`
  Intonation assessment, calibration evidence, and human-rating workflow material.
- `OPERATIONS/`
  Operational validation protocols and working rules.

## Read In This Order

1. `GigaStudy_master_plan.md`
2. `ROADMAP.md`
3. `DESIGN/UI_SCREEN_SPEC_PACKAGE/README.md`
4. `DESIGN/UI_SCREEN_SPEC_PACKAGE/00_GLOBAL_UI_FIXED_SPEC.md`
5. `DESIGN/UI_SCREEN_SPEC_PACKAGE/01_ROOT_LAUNCH_SCREEN_SPEC.md`
6. `DESIGN/UI_SCREEN_SPEC_PACKAGE/02_STUDIO_SCREEN_SPEC.md`
7. `DESIGN/UI_SCREEN_SPEC_PACKAGE/03_ARRANGEMENT_SCREEN_SPEC.md`
8. `DESIGN/UI_SCREEN_SPEC_PACKAGE/04_SHARED_REVIEW_SCREEN_SPEC.md`
9. `DESIGN/UI_SCREEN_SPEC_PACKAGE/05_OPS_SCREEN_SPEC.md`
10. `DESIGN/UI_SCREEN_SPEC_PACKAGE/06_INTERACTION_CONNECTION_MATRIX.md`
11. `QUALITY/INTONATION_ANALYSIS_ASSESSMENT.md`
12. `QUALITY/INTONATION_CALIBRATION_REPORT.md`
13. `QUALITY/HUMAN_RATING_CALIBRATION_WORKFLOW.md`
14. `QUALITY/REAL_EVIDENCE_BATCH_PLAN.md`
15. `BACKLOGS/PHASE1_BACKLOG.md`
16. `BACKLOGS/PHASE9_INTONATION_BACKLOG.md`
17. `GigaStudy_check_list.md`
18. `OPERATIONS/BROWSER_ENVIRONMENT_VALIDATION.md`
19. `OPERATIONS/ALPHA_DEPLOYMENT_TARGET.md`
20. `OPERATIONS/ALPHA_STAGING_RUNBOOK.md`
21. `FOUNDATION_STATUS.md`
22. `OPERATIONS/WORKING_PRINCIPLES.md`

## What Each Document Does

- `GigaStudy_master_plan.md`
  Product definition, MVP scope, stack target, architecture, risks, and release cut line.
- `ROADMAP.md`
  Phase-by-phase execution order and completion criteria.
- `GigaStudy_check_list.md`
  Live checklist for scope control, implementation readiness, and release gating. Check marks should map only to verified implementation, not to intent.
- `FOUNDATION_STATUS.md`
  Current implementation audit against the foundation docs, including verified coverage and remaining gaps.
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/README.md`
  Entry point for the canonical UI package.
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/00_GLOBAL_UI_FIXED_SPEC.md`
  Global typography, spacing, color, button, modal, and interaction rules.
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/01_ROOT_LAUNCH_SCREEN_SPEC.md`
  Fixed contract for the `/` entry surface, which is now a launch screen rather than a marketing landing page.
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/02_STUDIO_SCREEN_SPEC.md`
  Fixed contract for the Studio workspace.
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/03_ARRANGEMENT_SCREEN_SPEC.md`
  Fixed contract for the Arrangement workspace.
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/04_SHARED_REVIEW_SCREEN_SPEC.md`
  Fixed contract for the read-only shared review workspace.
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/05_OPS_SCREEN_SPEC.md`
  Fixed contract for the operator and release-desk workspace.
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/06_INTERACTION_CONNECTION_MATRIX.md`
  Single source of truth for page, modal, drawer, popover, and dropdown connections.
- `DESIGN/UI_SCREEN_SPEC_PACKAGE/MOCKUPS/`
  Frozen SVG and PNG mockup exports for `Launch`, `Studio`, `Arrangement`, `Shared Review`, and `Ops`.
- `BACKLOGS/PHASE1_BACKLOG.md`
  Build backlog for the recording pipeline and studio foundation slice.
- `BACKLOGS/PHASE9_INTONATION_BACKLOG.md`
  Execution backlog for the note-level intonation quality track.
- `QUALITY/INTONATION_ANALYSIS_ASSESSMENT.md`
  Evaluation of the current scoring engine and the accepted critique.
- `QUALITY/INTONATION_CALIBRATION_REPORT.md`
  Current calibration evidence, provisional threshold bands, and claim gate.
- `QUALITY/HUMAN_RATING_CALIBRATION_WORKFLOW.md`
  Workflow for future real-vocal and human-rating evidence, including intake templates, corpus inventory, consensus building, threshold-fit reporting, claim-gate evaluation, and evidence-bundle packaging.
- `QUALITY/REAL_EVIDENCE_BATCH_PLAN.md`
  One-shot collection plan for the later real-data sprint, combining human-rating and browser-hardware evidence under one evidence round.
- `OPERATIONS/BROWSER_ENVIRONMENT_VALIDATION.md`
  Native browser and hardware validation protocol built on top of the ops diagnostics baseline, including round-local packet and claim-gate preview, intake/import, ops-side CSV preview, environment validation packet, claim-gate, and release-note draft workflows.
  Both workflows now start from the shared external evidence-round scaffold so real-world artifacts stay out of `PROJECT_FOUNDATION`.
- `OPERATIONS/ALPHA_DEPLOYMENT_TARGET.md`
  Reviewed recommendation for the low-cost alpha hosting stack, including official vendor constraints and the current repo-specific deployment gaps.
- `OPERATIONS/ALPHA_STAGING_RUNBOOK.md`
  Practical operator runbook for the remaining real-cloud staging steps, including what the user must prepare and what should happen before the last alpha checklist item can close.
- `OPERATIONS/WORKING_PRINCIPLES.md`
  Project working rules, storage conventions, and foundation hygiene discipline.

## Placement Rule

If a new file is:

- a canonical product plan, roadmap, checklist, or audit
  it may live at the root
- a design aid, mockup, or visual source file
  it belongs under `DESIGN/`
- a backlog or execution ticket breakdown
  it belongs under `BACKLOGS/`
- a calibration, scoring, or evidence workflow
  it belongs under `QUALITY/`
- an operational protocol or maintenance rule
  it belongs under `OPERATIONS/`

If a file is temporary, generated, or only useful for one local verification pass,
it should stay outside `PROJECT_FOUNDATION` or be ignored rather than promoted into the foundation tree.

If implementation, backlog, or UI behavior drifts from these foundation docs, update the foundation first or in the same change.

Legacy UI direction docs, reference reviews, wireframes, editable-source artboards, and old mockup-track files were intentionally removed after the screen-spec package reset.
Do not reintroduce them as canonical references.
