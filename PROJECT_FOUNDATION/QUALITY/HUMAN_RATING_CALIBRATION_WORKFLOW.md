# Human Rating Calibration Workflow

Date: 2026-04-09
Status: Active Phase 9 support workflow.

## 0. Purpose

This workflow turns the open Phase 9 checklist gap into an operational process:

- collect real singer guide and take pairs
- record human note-level judgments
- compare GigaStudy note feedback against those judgments
- keep release claims honest until the evidence is strong enough

This workflow does **not** mean the gap is closed already.
It only means the repo now has a repeatable path for attaching human-rating evidence when that data is available.

## 1. Current Scope

The repo now supports:

- an evidence-round refresh CLI:
  `apps/api/scripts/refresh_evidence_round.py`
- an evidence-round audit CLI:
  `apps/api/scripts/inspect_evidence_round.py`
- a project-export CLI for seeding one round from real studio data:
  `apps/api/scripts/export_project_case_to_evidence_round.py`
- neutral note-reference CSV / JSON exports inside the round when note-event artifacts are already available for the exported take
- template inputs for the collection round:
  `apps/api/calibration/human_rating_cases.template.json`
  `apps/api/calibration/human_rating_sheet.template.csv`
- a manifest template for human-rated corpora:
  `apps/api/calibration/human_rating_corpus.template.json`
- a corpus inventory CLI:
  `apps/api/scripts/inspect_human_rating_corpus.py`
- a corpus builder CLI:
  `apps/api/scripts/build_human_rating_corpus.py`
- a threshold-fit CLI:
  `apps/api/scripts/fit_human_rating_thresholds.py`
- a claim-gate CLI:
  `apps/api/scripts/evaluate_human_rating_claim_gate.py`
- an evidence-bundle CLI:
  `apps/api/scripts/build_human_rating_evidence_bundle.py`
- UTF-8 BOM-safe manifest loading for Windows-edited calibration JSON files
- runner support for `human_ratings` and `minimum_human_agreement_ratio`
- Markdown and JSON summaries that include human-rating agreement
- Markdown and JSON release-review bundles that package calibration summary, threshold-fit output, and claim guardrails together
- synthetic test coverage proving the comparison path works

The repo does **not** yet include:

- a trusted real-vocal corpus inside version control
- calibrated difficulty thresholds validated by human raters
- release evidence strong enough to market the scorer as a human-level intonation judge

## 1a. Round Scaffold

Before collecting a real evidence round, create a dedicated scaffold outside `PROJECT_FOUNDATION`:

```bash
cd C:\my_project\GigaStudy\apps\api
uv run python scripts/create_evidence_round.py --round-id round-YYYYMMDD
```

Default behavior:

- prefer `C:\my_project\DreamCatcher\GigaStudyEvidenceRounds\...` when `DreamCatcher` exists in the workspace root
- otherwise fall back to `apps/api/output/evidence_rounds/`

This keeps real WAV files, rating sheets, and generated corpus artifacts out of the canonical docs tree.

## 2. Manifest Contract

Recommended intake path:

1. create a round scaffold and maintain case metadata in that round's `human-rating/human_rating_cases.json`
2. collect raw rater labels in that round's `human-rating/human_rating_sheet.csv`
3. build a generated corpus JSON with `build_human_rating_corpus.py`
4. run the calibration runner against that generated corpus

The direct `human_rating_corpus.template.json` file still exists as a final-shape reference.
For real collection rounds, the builder workflow is preferred over manual editing.

Each calibration case may include:

- `guide_source`
- `take_source`
- optional `expectation`
  Use this for hard system checks such as `NOTE_EVENT_V1` and `CHORD_AWARE`.
- optional `human_ratings`
  Use this for human consensus labels per note.
- optional `minimum_human_agreement_ratio`
  Use this only when the corpus is strong enough to gate release claims.

Current human-rating note fields:

- `note_index`
- `attack_direction`
  `sharp`, `centered`, `flat`, or `unclear`
- `sustain_direction`
  `sharp`, `centered`, `flat`, or `unclear`
- `acceptability_label`
  `in_tune`, `review`, `corrective`, or `unclear`
- `rater_count`
- `notes`

## 3. Agreement Logic

The runner currently compares the scorer against human labels on three note-level axes:

1. attack direction
2. sustain direction
3. sustain acceptability band

System acceptability is derived from the current Phase 9 provisional interpretation:

- `<= 8 cents`: `in_tune`
- `<= 20 cents`: `review`
- `> 20 cents`: `corrective`

This is a comparison workflow, not the final truth.
If these bands change after real-rater analysis, the runner and report should be updated together.

## 4. Recommended Collection Flow

1. Create the round scaffold.
2. Prefer exporting a real project take into that round:

```bash
uv run python scripts/export_project_case_to_evidence_round.py --round-root <round> --project-id <project-id> --take-track-id <take-track-id>
```

This copies the project's canonical guide/take WAV files into the round and replaces the seeded template case plus template rating rows when the round is still untouched.
When note-event artifacts already exist for that take, the export also writes neutral reference files under `human-rating/references/` with `note_index`, time windows, and target pitch labels, without copying the scorer's sharp / flat verdict text into the rater view.

3. If export is not possible yet, place the real guide/take WAV files into `human-rating/audio/guides/` and `human-rating/audio/takes/` manually.
4. Update the generated `human-rating/human_rating_cases.json` metadata file so each case points to the real WAV paths for that round.
5. Fill the generated `human-rating/human_rating_sheet.csv` file with per-rater note labels.
6. Inspect the metadata file or generated corpus before calibration:

```bash
uv run python scripts/refresh_evidence_round.py --round-root <round>
uv run python scripts/inspect_evidence_round.py --round-root <round>
uv run python scripts/inspect_human_rating_corpus.py --round-root <round>
```

Use `--require-real-audio --fail-on-missing` once the collection round has switched from fixtures to actual wav files.
For workflow smoke only, `apps/api/calibration/human_rating_seeded_fixture.json` is available as a seeded non-release manifest.

7. Hand the neutral note-reference CSV or JSON from `human-rating/references/` to raters so they can align note indices and target pitches without reading scorer verdict text first.
8. Confirm the note indexing that the scorer returns for that case.
9. Build the consensus corpus:

```bash
uv run python scripts/build_human_rating_corpus.py --round-root <round>
```

10. Inspect the generated corpus inventory:

```bash
uv run python scripts/inspect_human_rating_corpus.py --round-root <round> --source-kind manifest
```

11. Run the calibration CLI:

```bash
uv run python scripts/run_intonation_calibration.py --round-root <round>
```

12. Fit candidate difficulty thresholds:

```bash
uv run python scripts/fit_human_rating_thresholds.py --round-root <round>
```

13. Evaluate whether the current corpus is even strong enough to begin a closure discussion:

```bash
uv run python scripts/evaluate_human_rating_claim_gate.py --round-root <round>
```

14. Build the release-review evidence bundle:

```bash
uv run python scripts/build_human_rating_evidence_bundle.py --round-root <round>
```

This writes the calibration summary, threshold-fit report, claim gate, and combined evidence bundle back into the same round folder under `human-rating/reports/` and `human-rating/evidence-bundle/`.

15. Save those generated outputs as release evidence outside `PROJECT_FOUNDATION`.
16. Only after multiple real cases agree well should the team consider closing the human-trust checklist items.

## 5. What Closes The Checklist

This workflow alone closes only the support-path gap:

- the repo can now rebuild one round's generated corpus, calibration reports, claim gate, evidence bundle, environment preview JSON, and round audit in place
- the repo can now audit one evidence round and say what is present, missing, and next across human-rating and browser-validation collection
- the repo can now seed a round directly from real guide/take data that already exists inside the product workflow
- the repo can now seed neutral note-reference files for exported real project cases, which reduces note-index ambiguity during rater collection
- the repo can now compare scorer output against human note labels
- the repo can now inspect whether real-vocal source files and rating coverage are actually ready before calibration
- the repo can now evaluate whether the current corpus is even strong enough to start a threshold-closure review
- the repo can now package calibration summary, threshold recommendations, and claim guardrails into one release-review bundle

This workflow does **not** close:

- `Real human vocal fixtures or a trusted human-rating corpus are part of the release-quality evidence.`
- `Threshold calibration has been validated against human raters strongly enough to claim a human-trustworthy intonation judge.`

Those remain open until a real corpus, real raters, and reviewed agreement results exist.
