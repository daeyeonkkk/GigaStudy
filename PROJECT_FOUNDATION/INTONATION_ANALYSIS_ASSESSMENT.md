# Intonation Analysis Assessment

Date: 2026-04-08

## Verdict

The assessment is largely valid.

The current system is now stronger than the original critique described.
It is a note-level MVP practice scorer with signed cents, note segmentation, confidence weighting, and chord-aware fallback labeling.
Even so, it is still not yet a note-level intonation judge that a strong ear would reliably trust as a final authority across real vocal material.

## Important Nuance

Several statements now need tightening:

- It is not accurate to say that the current analysis pipeline runs only on the 64-point preview contour.
- Alignment and rhythm currently use a full-sample onset envelope derived from canonical audio.
- Processed takes now use frame-pitch and note-event artifacts for the main signed-cent scoring path.
- The 64-point contour still exists for UI preview, and older tracks may still fall back to coarser scoring modes.

So the practical concern is still real, but the exact technical wording should separate:

- onset-envelope alignment and rhythm
- artifact-backed note-level pitch feedback
- fallback contour-based behavior on older or incomplete tracks

## Confirmed Current Limits

These points match the current codebase and should be treated as accepted foundation guidance:

1. The product still assumes monophonic vocal or individual-part input for scoring.
2. Canonical audio is normalized to 16 kHz mono during processing.
3. Preview contour is still compressed to 64 points, but it is no longer the intended primary source for note-level scoring on processed takes.
4. The analysis API now returns signed note-level outputs such as attack and sustain cents, but older tracks may still show fallback scoring modes.
5. Feedback is now note-aware as well as phrase-aware, but it is still only as trustworthy as the processed artifact path and the current calibration set.
6. `librosa.pyin` voiced outputs and RMS are now used for runtime confidence weighting, but the thresholds are still provisional.
7. Harmony-fit can now be chord-aware, but only when the project includes a chord timeline.
8. Regression tests now include vocal-like synthetic fixtures in addition to sine cases, but they still do not amount to a human-recorded vocal corpus.

## Foundation Decision

We should explicitly treat the current scorer as:

- `note-level MVP vocal practice scorer`

And we should not describe it as:

- `human-like intonation judge`
- `fine vocal tuner`
- `precise sharp/flat analyzer`

until the next quality track is implemented.

## Approved Next Quality Track

The next intonation quality phase should include these items in order:

1. Build the real-vocal calibration set.
   Replace the current vocal-like synthetic checkpoint with human-recorded or cents-shifted vocal fixtures.
2. Tune threshold bands with comparative ratings.
   Record how strong listeners rate attack, sustain center, and stability, then align thresholds to that evidence.
3. Add a chord-authoring or chord-import path.
   Chord-aware harmony should be reachable from the main workflow, not only from preloaded project metadata.
4. Reduce fallback ambiguity on older tracks.
   Keep coarse fallback visible, but make it easier to regenerate older takes onto the newer artifact path.
5. Add release-language review.
   Keep product copy, demo copy, and roadmap promises aligned with the calibrated evidence base.

## Claim Policy

If product copy, demo copy, or roadmap copy claims that the system can say:

- how many cents sharp or flat a singer was
- whether the attack was sharp but the sustain settled
- whether vibrato stayed centered

then the note-level quality track above must be completed first, and the evidence in `INTONATION_CALIBRATION_REPORT.md` must support that claim level.
