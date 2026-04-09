# UI Editable Source

Date: 2026-04-09

This folder holds the editable design-source baseline for the canonical GigaStudy screens.

Why it exists:

- `UI_MOCKUPS/` contains frozen exports that implementation can compare against
- `UI_EDITABLE_SOURCE/` contains the editable source that those exports can be regenerated from
- the current source is repo-local HTML and CSS so the product still has an editable mockup baseline even before a shared Figma source is connected

Current source:

- `quiet-studio-console-v1.html`
- `quiet-studio-console-v1.css`

Screen mapping:

- `Home` -> `home-v1`
- `Studio` -> `studio-v1`
- `Arrangement` -> `arrangement-v1`
- `Shared Review` -> `shared-review-v1`
- `Ops` -> `ops-v1`

Editing rule:

- update the editable source first
- export or adjust the corresponding file under `UI_MOCKUPS/`
- then update `FOUNDATION_STATUS.md` and `GigaStudy_check_list.md`

This is the current equivalent editable design source accepted by the foundation.
Preferred future upgrade:

- connect a shared Figma file and keep this repo-local source as a fallback or export companion
