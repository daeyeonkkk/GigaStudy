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

- template inputs for the collection round:
  `apps/api/calibration/human_rating_cases.template.json`
  `apps/api/calibration/human_rating_sheet.template.csv`
- a manifest template for human-rated corpora:
  `apps/api/calibration/human_rating_corpus.template.json`
- a corpus builder CLI:
  `apps/api/scripts/build_human_rating_corpus.py`
- a threshold-fit CLI:
  `apps/api/scripts/fit_human_rating_thresholds.py`
- runner support for `human_ratings` and `minimum_human_agreement_ratio`
- Markdown and JSON summaries that include human-rating agreement
- synthetic test coverage proving the comparison path works

The repo does **not** yet include:

- a trusted real-vocal corpus inside version control
- calibrated difficulty thresholds validated by human raters
- release evidence strong enough to market the scorer as a human-level intonation judge

## 2. Manifest Contract

Recommended intake path:

1. maintain case metadata in `human_rating_cases.template.json`
2. collect raw rater labels in `human_rating_sheet.template.csv`
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

1. Record or curate a real singer guide and take pair.
2. Confirm the note indexing that the scorer returns for that case.
3. Ask multiple raters to label attack direction, sustain direction, and acceptability in the rating sheet CSV.
4. Build the consensus corpus:

```bash
uv run python scripts/build_human_rating_corpus.py --output calibration/human_rating_corpus.generated.json
```

5. Run the calibration CLI:

```bash
uv run python scripts/run_intonation_calibration.py --manifest calibration/human_rating_corpus.generated.json
```

6. Fit candidate difficulty thresholds:

```bash
uv run python scripts/fit_human_rating_thresholds.py --manifest calibration/human_rating_corpus.generated.json
```

7. Save the JSON and Markdown outputs as release evidence outside the template file.
8. Only after multiple real cases agree well should the team consider closing the human-trust checklist items.

## 5. What Closes The Checklist

This workflow alone closes only the support-path gap:

- the repo can now compare scorer output against human note labels

This workflow does **not** close:

- `Real human vocal fixtures or a trusted human-rating corpus are part of the release-quality evidence.`
- `Threshold calibration has been validated against human raters strongly enough to claim a human-trustworthy intonation judge.`

Those remain open until a real corpus, real raters, and reviewed agreement results exist.
