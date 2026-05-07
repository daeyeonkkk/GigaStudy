# GigaStudy Working Protocol

Date: 2026-05-04

This protocol applies to every product, engine, UI, and test task in this
repository.

## Rule

Every task must use `PROJECT_FOUNDATION` as the source of truth.

Implementation and foundation must move together. If a task changes product
behavior, engine assumptions, UI flow, data contracts, roadmap status, or
completion state, the relevant foundation document must be updated in the same
task.

## Before Work

Before changing code or specs, check the relevant foundation documents:

1. `README.md` for product scope and canonical document order
2. `PRODUCT_PURPOSE_AND_FUNCTIONS.md` for the compact product purpose,
   functional scope, non-goals, and decision rules
3. `OPERATING_PRINCIPLES.md` for timing, sync, registration, LLM, UX,
   infrastructure, code, and verification defaults
4. `EVALUATION_METRICS.md` for release-blocking quality targets and evaluation
   cadence
5. `REGION_PIANOROLL_RESET_PLAN.md` for reset intent and preserved assets
6. `CURRENT_ARCHITECTURE.md` for code structure, data flow, and contracts
7. `OPERATIONS_RUNBOOK.md` for deployment, secrets, backup/restore, and PWA
   boundaries
8. `ACAPPELLA_ARRANGEMENT_AUDIT.md` for musical product constraints
9. `AI_HARMONY_GENERATION_DESIGN.md` for AI generation constraints

## During Work

Use the foundation to make implementation choices.

When code and foundation disagree:

- If the foundation is still correct, change the code.
- If implementation reveals a better product or engine decision, update the
  foundation explicitly and keep the code aligned with the new rule.
- If uncertainty remains, keep the implementation conservative and document the
  uncertainty in the relevant foundation document.

## After Work

Before finishing a task:

- Update `CURRENT_ARCHITECTURE.md` if region/event contracts, extraction, AI
  generation, scoring, or visible data flow changed.
- Update `OPERATING_PRINCIPLES.md` if default rules for timing, sync,
  registration, LLM use, playback, UX, infrastructure, code structure, or
  verification change.
- Update `EVALUATION_METRICS.md` if release gates, product quality targets,
  telemetry, or success criteria change.
- Update `REGION_PIANOROLL_RESET_PLAN.md` if the reset sequence or retained
  asset list changes.
- Update `ACAPPELLA_ARRANGEMENT_AUDIT.md` or
  `AI_HARMONY_GENERATION_DESIGN.md` when musical/AI assumptions change.

The final response should state whether foundation files were updated and name
the important files.

## Non-Goals

Do not add foundation material for unrelated operational, deployment, marketing,
or retired surfaces unless the user explicitly brings them back into scope.
