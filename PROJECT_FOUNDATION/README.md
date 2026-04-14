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
  Visual direction, wireframes, mockup workflow, frozen exports, and editable design source.
- `QUALITY/`
  Intonation assessment, calibration evidence, and human-rating workflow material.
- `OPERATIONS/`
  Operational validation protocols and working rules.

## Read In This Order

1. `GigaStudy_master_plan.md`
2. `ROADMAP.md`
3. `DESIGN/UI_DESIGN_DIRECTION.md`
4. `DESIGN/FILMORA_REFERENCE_REVIEW.md`
5. `DESIGN/UI_WIREFRAMES_V1.md`
6. `DESIGN/UI_MOCKUP_TRACK.md`
7. `QUALITY/INTONATION_ANALYSIS_ASSESSMENT.md`
8. `QUALITY/INTONATION_CALIBRATION_REPORT.md`
9. `QUALITY/HUMAN_RATING_CALIBRATION_WORKFLOW.md`
10. `QUALITY/REAL_EVIDENCE_BATCH_PLAN.md`
11. `BACKLOGS/PHASE1_BACKLOG.md`
12. `BACKLOGS/PHASE9_INTONATION_BACKLOG.md`
13. `GigaStudy_check_list.md`
14. `OPERATIONS/BROWSER_ENVIRONMENT_VALIDATION.md`
15. `OPERATIONS/ALPHA_DEPLOYMENT_TARGET.md`
16. `OPERATIONS/ALPHA_STAGING_RUNBOOK.md`
17. `FOUNDATION_STATUS.md`
18. `OPERATIONS/WORKING_PRINCIPLES.md`

## What Each Document Does

- `GigaStudy_master_plan.md`
  Product definition, MVP scope, stack target, architecture, risks, and release cut line.
- `ROADMAP.md`
  Phase-by-phase execution order and completion criteria.
- `GigaStudy_check_list.md`
  Live checklist for scope control, implementation readiness, and release gating. Check marks should map only to verified implementation, not to intent.
- `FOUNDATION_STATUS.md`
  Current implementation audit against the foundation docs, including verified coverage and remaining gaps.
- `DESIGN/UI_DESIGN_DIRECTION.md`
  Canonical visual direction for the product.
- `DESIGN/FILMORA_REFERENCE_REVIEW.md`
  Accepted reference review describing what Filmora contributes to the Studio and Arrangement workspace structure, what should be rejected, and what the next mockup pass still needs to absorb.
- `DESIGN/UI_WIREFRAMES_V1.md`
  Reference-led low-fidelity wireframe pack for the canonical screens.
- `DESIGN/UI_MOCKUP_TRACK.md`
  Canonical mockup workflow and visual source-of-truth rules.
- `DESIGN/UI_MOCKUPS/`
  Repo-visible frozen mockup exports for canonical screens.
- `DESIGN/UI_EDITABLE_SOURCE/`
  Repo-local editable HTML and CSS artboards for the canonical mockups.
  The latest Studio and Arrangement workspace-pass source now lives in `filmora-workspace-pass-v2.html`.
  The first live implementation pass from that source is now reflected on the dedicated Arrangement route.
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
