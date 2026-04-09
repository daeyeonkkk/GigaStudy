# Environment Validation Intake

This folder holds reusable intake assets for native browser and hardware validation rounds.

Use these files when testers collect evidence outside the ops UI and later import it into GigaStudy:

- `environment_validation_runs.template.csv`
  Spreadsheet-friendly capture sheet for browser and hardware validation runs

Typical workflow:

1. copy the template CSV for a validation round
2. fill it with native Safari, Chrome, Firefox, or real-hardware observations
3. run `uv run python scripts/import_environment_validation_runs.py`
4. review the preview JSON or submit the rows into the API

Generated previews should stay outside `PROJECT_FOUNDATION` and should not be committed.
