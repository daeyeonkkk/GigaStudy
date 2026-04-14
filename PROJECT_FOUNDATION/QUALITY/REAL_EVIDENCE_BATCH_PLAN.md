# Real Evidence Batch Plan

Date: 2026-04-14
Status: Active support workflow for the still-open real-evidence gaps.

## Purpose

Real usage data is currently hard to collect on demand.
That means the best near-term move is not to pretend the evidence exists, but to make sure the eventual collection round can run once, cleanly, and without rediscovering the workflow from scratch.

This document defines that one-shot batch plan.

It exists to close the coordination gap around these still-open checklist items:

- `Real human vocal fixtures or a trusted human-rating corpus are part of the release-quality evidence.`
- `Threshold calibration has been validated against human raters strongly enough to claim a human-trustworthy intonation judge.`
- `Native Safari / WebKit audio behavior has been validated on real Apple hardware and logged as release evidence.`
- `Real hardware microphone variability has been validated broadly enough to close the remaining environment risk.`

This plan does **not** claim those items are closed now.

## Principle

When real evidence becomes available again, collect Phase 9 and Phase 10 evidence under **one named evidence round** and treat that round as the working root for:

- real guide / take WAV exports
- human rater sheets
- native browser and hardware CSV evidence
- generated calibration reports
- threshold-fit recommendations
- human-rating claim gates
- browser / hardware claim gates
- release-review bundle artifacts

The round should be created outside `PROJECT_FOUNDATION`, preferably under `DreamCatcher`, so canonical docs stay clean.

## Recommended Batch Shape

One good first real batch should include:

### Human Rating Cases

- 2 to 4 real guide / take pairs
- at least one mostly stable take
- at least one obviously sharp or overshooting take
- at least one flat or recovery take
- optionally one vibrato-heavy or expressive case

### Human Raters

- ideally 2 to 3 raters per case
- Korean-first instructions and labels
- neutral note references only
- no scorer verdict text in the rater prompt

### Browser / Hardware Matrix

- Windows + Chrome + USB mic + wired headphones
- Windows + Firefox + built-in mic + speakers
- macOS + Safari + built-in mic + speakers
- macOS + Safari + Bluetooth output

More cells are welcome.
The first batch does not need to be perfect, but it should be explicit about what is missing.

## Batch Order

### 1. Create The Round

```bash
cd C:\my_project\GigaStudy\apps\api
uv run python scripts/create_evidence_round.py --round-id round-YYYYMMDD
```

The scaffold now also writes:

- `REAL_EVIDENCE_PLAN.md`
- `REAL_EVIDENCE_CHECKLIST.md`

inside the round itself, so the collection folder is self-guiding.

### 2. Seed The Round With Real Product Data

Export selected real takes from the product workflow first:

```bash
uv run python scripts/export_project_case_to_evidence_round.py --round-root <round> --project-id <project-id> --take-track-id <take-track-id>
```

This keeps the round aligned with canonical guide / take audio and gives raters:

- guide / take WAV files
- neutral note references
- note-level clips
- review packet HTML

### 3. Collect Human Ratings

- share the seeded packet materials with raters
- collect note-level labels in the round's CSV
- keep the wording Korean-first for local raters

Then build and inspect:

```bash
uv run python scripts/build_human_rating_corpus.py --round-root <round>
uv run python scripts/inspect_human_rating_corpus.py --round-root <round>
```

### 4. Collect Native Browser / Hardware Evidence

- use the same round's `environment-validation/environment_validation_runs.csv`
- fill native Safari and real microphone rows there
- prefer ops import later, but keep CSV collection round-local first

Before import, regenerate the round-local previews:

```bash
uv run python scripts/refresh_evidence_round.py --round-root <round>
uv run python scripts/inspect_evidence_round.py --round-root <round>
```

### 5. Build The Release Evidence

For the same round, run:

```bash
uv run python scripts/run_intonation_calibration.py --round-root <round>
uv run python scripts/fit_human_rating_thresholds.py --round-root <round>
uv run python scripts/evaluate_human_rating_claim_gate.py --round-root <round>
uv run python scripts/build_human_rating_evidence_bundle.py --round-root <round>
uv run python scripts/import_environment_validation_runs.py --round-root <round>
```

Then use ops exports for:

- environment validation packet
- browser compatibility release-note draft
- browser / hardware claim gate

## Review Rules

Do not close checklist items just because:

- a round exists
- a CSV exists
- a report exists
- one manual run succeeded

Only begin closure review when the round contains actual evidence for the open claims and the generated gates can be reviewed against that evidence.

## Relationship To Existing Docs

This is the batching layer that sits on top of:

- `QUALITY/HUMAN_RATING_CALIBRATION_WORKFLOW.md`
- `OPERATIONS/BROWSER_ENVIRONMENT_VALIDATION.md`

Those documents define the domain-specific workflows.
This document defines how to run them together in one later real-data sprint.
