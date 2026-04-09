# Intonation Calibration Report

Date: 2026-04-08

## Purpose

This report records the current evidence behind GigaStudy's note-level intonation scoring.
It is the Phase 9 calibration checkpoint for deciding what we can responsibly claim about the scorer today.

## Current Evidence Base

The analysis regression suite now includes:

- sine-wave sanity cases for obvious match and mismatch behavior
- vocal-like synthetic fixtures for `sharp attack`
- vocal-like synthetic fixtures for `flat sustain`
- vocal-like synthetic fixtures for `overshoot then settle`
- vocal-like synthetic fixtures for `breathy onset`
- vocal-like synthetic fixtures for `vibrato centered`
- vocal-like synthetic fixtures for `portamento toward center`
- low-confidence quiet-take comparison coverage

Reference implementation:

- `apps/api/src/gigastudy_api/services/audio_fixture_library.py`
- `apps/api/src/gigastudy_api/services/calibration.py`
- `apps/api/calibration/synthetic_vocal_baseline.json`
- `apps/api/calibration/human_rating_corpus.template.json`
- `apps/api/scripts/run_intonation_calibration.py`
- `HUMAN_RATING_CALIBRATION_WORKFLOW.md`
- `apps/api/tests/audio_fixtures.py`
- `apps/api/tests/test_calibration_runner.py`
- `apps/api/tests/test_analysis_api.py`

Important limit:

- these are `vocal-like synthetic fixtures`, not yet a human-recorded vocal corpus

So this report is a meaningful Phase 9 checkpoint, but it is not the final calibration gate for a human-trustworthy intonation judge.

## Repeatable Synthetic Runner

The repo now has a repeatable synthetic calibration path:

- manifest-driven corpus definition in `apps/api/calibration/synthetic_vocal_baseline.json`
- a runner service that evaluates each case through the real upload and analysis API flow
- a CLI entry point: `uv run python scripts/run_intonation_calibration.py`
- regression coverage in `apps/api/tests/test_calibration_runner.py`

Current synthetic baseline result:

- `4/4` baseline cases pass on the current note-event scorer
- the runner checks `NOTE_EVENT_V1` mode and case-level note feedback expectations

This is now strong enough to claim that synthetic-vocal calibration is reproducible.
It is still not strong enough to claim human-level intonation trustworthiness.

## Human Rating Workflow

The repo now also has a first-class workflow for future human-rating comparison:

- manifest support for note-level `human_ratings`
- input templates plus a builder for turning raw rater labels into a corpus manifest
- per-case and per-run human-agreement summaries
- a threshold-fit report path for candidate difficulty bands
- optional `minimum_human_agreement_ratio` gating
- a dedicated workflow note in `HUMAN_RATING_CALIBRATION_WORKFLOW.md`

This is an operational bridge, not the evidence itself.
It means the repo can now ingest and compare human consensus labels cleanly once real singer data is available.

## Provisional Interpretation Bands

These bands are aligned with the current scorer behavior and studio UI language.

### Signed Cents

- `abs(sustain_median_cents) <= 8`
  Treat as centered for normal practice feedback.
- `8 < abs(sustain_median_cents) <= 20`
  Treat as review-worthy drift.
- `abs(sustain_median_cents) > 20`
  Treat as clearly sharp or flat for correction guidance.

### Confidence

- `confidence >= 0.80`
  Stable enough for strong note-level guidance.
- `0.45 <= confidence < 0.80`
  Usable, but still present as practice guidance rather than exact cent truth.
- `confidence < 0.45`
  Mark as rough guidance only and tell the user to verify by ear.

### Harmony Reference

- `CHORD_AWARE`
  Safe to describe as harmony checked against project chord markers.
- `KEY_ONLY`
  Must be described as fallback guidance, not as chord-aware harmony judgment.

## Provisional Claim Gate

Allowed today:

- `note-level vocal practice feedback`
- `sharp or flat direction on supported processed takes`
- `attack versus sustain correction hints`
- `confidence-aware guidance`
- `chord-aware harmony only when the project includes a chord timeline`

Blocked today:

- `human-like intonation judge`
- `precise vocal tuner`
- `cent-accurate truth for every note`
- `reliable judgment on arbitrary noisy or unsupported takes`
- `chord-aware harmony` when the score is still labeled `KEY_ONLY`

## Release Copy Rule

If release copy, landing-page copy, or demo narration claims:

- exact cent precision as a general guarantee
- human-level pitch judgment
- stable verdicts across real-world vocal noise and expressive singing

then we must first add:

1. a human-recorded vocal fixture set or cents-shifted vocal corpus
2. a threshold comparison against human ratings
3. a refreshed claim review against that larger evidence base

## Next Calibration Work

1. Replace or supplement the vocal-like synthetic fixtures with real singer recordings.
2. Record side-by-side human ratings for attack, sustain center, and confidence acceptability.
3. Tune threshold bands by difficulty mode instead of using one shared reading band.
4. Re-run the product-language audit after that larger calibration set is in place.
