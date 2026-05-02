# A Cappella Arrangement Fit Audit

Date: 2026-04-28

This note evaluates whether GigaStudy's six-track region/timeline model matches
practical a cappella arranging principles.

## Arrangement Principles

A cappella arranging is not six unrelated solo tracks. It is one shared
timeline where parts have complementary roles:

- Lead or top-line material is the road map for form, lyric rhythm, and phrase
  placement.
- Bass is a structural second melody: it carries root motion, groove, and
  tuning gravity.
- Upper/background voices may act as a unit through block harmony, counterpoint,
  arpeggiation, rhythmic textures, or instrumental imitation.
- Vocal percussion is rhythm-section material, not pitched choral harmony.
- Every voice must remain singable: comfortable range, smooth melodic motion,
  breathing room, and manageable articulation matter as much as chord spelling.
- Vertical sonority and horizontal line quality must be checked together. Good
  output cannot be judged only by each track's local note cleanliness.

## Fit Check

GigaStudy is currently aligned with the foundational region model:

- The product artifact is one six-track timeline with a shared BPM and meter.
- Region/PitchEvent coordinates are canonical for rendering, playback, and
  scoring; `TrackPitchEvent` is only an internal import/storage/scoring adapter
  until persistence moves fully to explicit regions.
- Per-track recording uses the studio clock and count-in instead of estimating
  a new tempo from every take.
- Final registration can nudge extracted voice/audio material onto the existing
  sibling-track beat grid without moving barlines or rewriting BPM.
- AI generation considers registered context tracks, avoids known voice
  crossing, penalizes parallel perfect fifth/octave motion, and generates
  multiple reviewable candidates.
- Percussion is treated separately as rhythmic material.

## Gaps And Risks

The current model is musically plausible but not yet a full a cappella arranger:

- There is no explicit lead/solo role. Soprano is not always the melody in
  contemporary a cappella; melody may move between voices or exist as a
  separate lead. The fixed S/A/T/Baritone/Bass/Percussion map is useful for
  practice, but incomplete as an arrangement ontology.
- Reference-grid alignment is intentionally small and global. This is correct
  for device latency and loose entrances, but it cannot solve section-level
  rubato, swung feel, pickups, anticipations, or call-and-response rhythms.
- Registration quality is mostly local to one track plus a timing reference.
  It does not yet validate vertical chords at every beat after registration.
- Harmony generation has voice-leading costs, range checks, and LLM planning,
  but it is still chord-grid driven. It does not yet reason deeply about form,
  lyrics, syllables, vowel blend, breath points, or texture changes across
  verse/chorus/bridge.
- Bass generation is only one of the vocal slots. A cappella bass should be
  judged with special rules for roots, groove, articulation speed, breathing,
  and tuning support.
- Region and pitch-event data do not yet model lyric/syllable alignment, which
  is central to vocal arrangements.

## Product Direction

The current registration rule is directionally right:

- Keep BPM/meter as the score paper.
- Keep barlines fixed across all tracks.
- Quantize new material onto that paper.
- Correct only small whole-track capture/extraction drift automatically.
- Preserve intentional symbolic rhythm and syncopation.
- Treat sync controls as playback/display translation, not score mutation.

The ensemble-aware registration bar is now implemented for registration:

1. Before final commit, compute an ensemble snapshot against registered sibling
   tracks.
2. For multi-track import and bulk OMR approval, prepare all incoming parts
   first and validate each part against the whole proposed score, not only
   against the tracks that happened to be committed earlier.
3. Check range, voice crossing, adjacent spacing, chord coverage, parallel
   perfect intervals, singability leaps, doubled tendency tones, and bass
   foundation risks.
4. Apply safe deterministic repairs only when the issue is clearly an
   extractable octave/latency/noise problem. The new contextual octave repair
   is limited to voice/audio/AI material and preserves pitch class, rhythm,
   measure ownership, BPM, and barlines.
5. Persist diagnostics and note warning flags when the issue may be an
   intentional arrangement choice.

Remaining improvement areas are deeper bass groove quality, lyric/syllable
alignment, breath/articulation feasibility, and section-level form or texture
changes.

The strongest next product move is to introduce explicit arrangement roles:

- Lead or Melody
- Soprano/Alto/Tenor/Baritone/Bass harmony voices
- Vocal percussion

This can coexist with the current six visible tracks, but the engine should
know whether a track is acting as melody, bass foundation, block-harmony upper,
counterline, pad, or percussion.
