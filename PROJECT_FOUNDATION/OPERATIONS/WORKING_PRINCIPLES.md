# GigaStudy Working Principles

Date: 2026-04-09

This document defines the working rules for keeping the repository, delivery flow, and
`PROJECT_FOUNDATION` clean enough to stay trustworthy over time.

## 1. Prefer Commits Over Local Copies

- Preserve work history with intentional `git commit`s, not with duplicate files.
- Do not create local copies such as `temp`, `backup`, `copy`, `final_final`, or date-stamped variants.
- If an intermediate state matters, commit it or keep it outside the repo in a local scratch area.

## 2. Keep The Repository Shape Deliberate

- Add folders only when they have a clear long-term role.
- Do not let temporary implementation convenience become permanent structure.
- When a directory starts collecting mixed responsibilities, stop and reorganize it before adding more files.

## 3. Treat `PROJECT_FOUNDATION` As Canonical, Not As Scratch Space

- Only canonical core docs may live at the root of `PROJECT_FOUNDATION`:
  `README.md`, `GigaStudy_master_plan.md`, `ROADMAP.md`, `GigaStudy_check_list.md`, and `FOUNDATION_STATUS.md`.
- Supporting docs must live under the right category:
  `BACKLOGS/`, `DESIGN/`, `QUALITY/`, or `OPERATIONS/`.
- Mockups, editable design sources, screenshots, exports, calibration notes, and protocols must never be dropped into the root.
- A new foundation document is not complete until it is linked from `PROJECT_FOUNDATION/README.md`.

## 4. Remove Or Ignore One-Off Artifacts Quickly

- Generated evidence, temporary reports, local browser captures, and ad hoc validation outputs should be deleted after use or ignored in `.gitignore`.
- Keep only artifacts that have a stable, documented role in the product or release workflow.
- If a generated file is needed repeatedly, define its canonical home and decide whether it belongs in version control.

## 5. Keep Checklists Honest

- Mark a checklist item done only when the implementation exists and has been verified by code, tests, or browser gates.
- If the work changes scope, update `PROJECT_FOUNDATION` in the same change instead of letting implementation drift ahead.
- If a new workstream is important enough to persist, add it to the checklist or roadmap before treating it as official.

## 6. Default Cleanup Rule

- Before ending a task, check whether the change created any document, mockup, report, or generated file that no longer needs to stay where it was created.
- If it is canonical, move it into the correct `PROJECT_FOUNDATION` category.
- If it is temporary, remove it or make sure it is ignored.
