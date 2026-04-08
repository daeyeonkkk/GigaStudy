# Intonation Analysis Assessment

Date: 2026-04-08

## Verdict

The assessment is largely valid.

The current backend is good enough for an MVP-style vocal practice scorer, but it is not yet a note-level intonation judge that a strong ear would reliably trust for sharp or flat direction, attack quality, sustain center, or expressive drift.

## Important Nuance

One statement needs tightening:

- It is not accurate to say that the entire analysis pipeline runs only on the 64-point preview contour.
- Alignment and rhythm currently use a full-sample onset envelope derived from canonical audio.
- Pitch scoring, harmony-fit scoring, and feedback generation still depend heavily on the preview contour path, which is compressed to 64 median-based points.

So the practical concern is still real, but the exact technical wording should separate:

- onset-envelope alignment and rhythm
- contour-based pitch, harmony, and feedback

## Confirmed Current Limits

These points match the current codebase and should be treated as accepted foundation guidance:

1. The product still assumes monophonic vocal or individual-part input for scoring.
2. Canonical audio is normalized to 16 kHz mono during processing.
3. Preview contour is compressed to 64 points and currently doubles as a scoring input for pitch and harmony logic.
4. Pitch distance uses absolute cents, so sharp versus flat direction is lost in the current score path.
5. The analysis API does not return signed cent deviation, note-level attack drift, sustain drift, or stability metrics.
6. Feedback is phrase-like but still coarse: the current scorer splits the take into 4 segments instead of note events.
7. `librosa.pyin` voiced outputs are not yet used for confidence weighting in the runtime path.
8. Harmony-fit is still key-scale based, not chord-aware.
9. Regression tests for analysis are still dominated by synthetic sine-wave fixtures rather than human vocal fixtures.

## Foundation Decision

We should explicitly treat the current scorer as:

- `MVP vocal practice scorer`

And we should not describe it as:

- `human-like intonation judge`
- `fine vocal tuner`
- `precise sharp/flat analyzer`

until the next quality track is implemented.

## Approved Next Quality Track

The next intonation quality phase should include these items in order:

1. Separate UI preview contour from scoring data.
   Store frame-level pitch data or note-event artifacts for analysis, and keep the 64-point contour only for UI preview.
2. Add signed cent outputs.
   Return note-level or event-level values such as `attack_signed_cents`, `sustain_median_cents`, `max_sharp_cents`, and `max_flat_cents`.
3. Replace 4-way segment scoring with note segmentation.
   Score by note onset, settle, sustain, and release instead of by coarse quarter-length windows.
4. Use pYIN voicing confidence in scoring.
   Down-weight or exclude low-confidence and unvoiced frames rather than treating all frames the same.
5. Move harmony-fit to a chord-aware path.
   Separate vertical harmony fit from melody intonation quality.
6. Calibrate thresholds with real vocal data.
   Use human-recorded or cents-shifted vocal fixtures instead of sine waves alone.

## Claim Policy

If product copy, demo copy, or roadmap copy claims that the system can say:

- how many cents sharp or flat a singer was
- whether the attack was sharp but the sustain settled
- whether vibrato stayed centered

then the note-level quality track above must be completed first.
