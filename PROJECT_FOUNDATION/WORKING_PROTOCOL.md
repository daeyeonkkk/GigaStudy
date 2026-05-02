# GigaStudy Working Protocol

Date: 2026-05-02

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
2. `REGION_PIANOROLL_RESET_PLAN.md` for reset intent and preserved assets
3. `CURRENT_ARCHITECTURE.md` for code structure, data flow, and contracts
4. `ACAPPELLA_ARRANGEMENT_AUDIT.md` for musical product constraints
5. `AI_HARMONY_GENERATION_DESIGN.md` for AI generation constraints

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
- Update `REGION_PIANOROLL_RESET_PLAN.md` if the reset sequence or retained
  asset list changes.
- Update `ACAPPELLA_ARRANGEMENT_AUDIT.md` or
  `AI_HARMONY_GENERATION_DESIGN.md` when musical/AI assumptions change.

The final response should state whether foundation files were updated and name
the important files.

## Non-Goals

Do not add foundation material for unrelated operational, deployment, marketing,
or retired surfaces unless the user explicitly brings them back into scope.
