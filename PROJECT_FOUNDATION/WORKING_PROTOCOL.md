# GigaStudy Working Protocol

Date: 2026-04-20

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
2. `GigaStudy_master_plan.md` for user flows and non-goals
3. `ENGINE_ARCHITECTURE.md` for TrackNote, extraction, AI generation, OMR, and
   scoring contracts
4. `DESIGN/UI_SCREEN_SPEC_PACKAGE/` for UI behavior and screen contracts
5. `ROADMAP.md` and `GigaStudy_check_list.md` for phase and completion state

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

- Update `ENGINE_ARCHITECTURE.md` if TrackNote, extraction, OMR, AI generation,
  or scoring changed.
- Update the UI screen spec if visible flows, controls, report layout, or user
  states changed.
- Update `ROADMAP.md` if phase scope or next work changed.
- Update `GigaStudy_check_list.md` when items become done, deferred, or newly
  required.
- Update `FOUNDATION_STATUS.md` when implementation reality materially changes.

The final response should state whether foundation files were updated and name
the important files.

## Non-Goals

Do not add foundation material for unrelated operational, deployment, marketing,
or legacy surfaces unless the user explicitly brings them back into scope.
