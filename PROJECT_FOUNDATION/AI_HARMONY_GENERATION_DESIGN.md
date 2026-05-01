# AI Harmony Generation Quality Design

Last updated: 2026-04-28

## 2026-04-28 Implemented Slice

- `HarmonyPlan` V2 models now exist in the API engine layer.
- DeepSeek V4 Flash can return measure-level harmony intent, candidate goals,
  register/motion/rhythm policy, chord-tone priority, and user-facing review
  evidence.
- The selected low-cost API route is compatible with OpenRouter's
  `deepseek/deepseek-v4-flash:free` model id. Local keys belong in ignored
  `apps/api/.env`; deployed keys belong in Cloud Run env vars or Secret
  Manager.
- The DeepSeek path can run a bounded draft-review-revision loop before the plan
  is passed to the generator.
- The deterministic harmony engine now uses the plan in key resolution, chord
  ranking, candidate pitch cost, transition cost, melodic connector allowance,
  and candidate rhythm shaping.
- Candidate diagnostics now expose plan goal, rhythm policy, revision cycles,
  measure intent count, and the usual user-facing title/role/selection hints.
- DeepSeek harmony prompts now include explicit six-track a cappella
  arrangement constraints: singability, useful contrary/oblique motion,
  candidate diversity, voice-crossing/parallel-perfect avoidance, and bass
  foundation.
- Approved AI candidates pass through the shared event quality gate,
  deterministic ensemble arrangement gate, and optional LLM ensemble
  registration review before they become registered track content.
- Regression coverage proves that a supplied plan can change both generated
  pitches and rhythmic density while the DeepSeek-disabled path remains
  deterministic.

## Decision

GigaStudy should keep DeepSeek V4 Flash as the single low-cost LLM planner, but
the planner must move from "candidate profile ordering" to "measure-level
harmony intent." The LLM still must not write final `PitchEvent` arrays. The
deterministic engine remains the only layer allowed to create, normalize, and
validate persisted notes.

This keeps the product auditable and cheap while giving the LLM enough leverage
to change the actual generated music.

## Product Contract

AI generation is symbolic timeline completion:

- Input is registered region/pitch-event material from any subset of Soprano,
  Alto, Tenor, Baritone, Bass, and Percussion.
- Output is one or more candidate event lists for the requested target track.
- BPM and time signature are immutable studio truth. The AI must not infer or
  rewrite tempo.
- The target track is not overwritten until the user approves one candidate.
- Natural vocal audio generation is out of scope. Playback may synthesize score
  events or use retained recordings, but AI generation produces timeline data.

## Current Gap

The current DeepSeek integration can affect generation only by choosing the
order of broad voice-leading profiles:

- `balanced`
- `lower_support`
- `moving_counterline`
- `upper_blend`
- `open_voicing`

That is useful but weak. If the deterministic search space is narrow, three
candidates can still sound and look too similar. DeepSeek can explain candidate
intent, but it does not yet tell the engine what each measure should do
harmonically.

## Research-Informed Direction

Relevant evidence:

- DeepBach shows that useful chorale generation is steerable when users or
  upstream systems can impose positional constraints such as fixed notes,
  rhythms, and cadences.
- SymPAC highlights constrained symbolic generation with finite-state-machine
  style controls as a practical way to keep generated music controllable.
- FIGARO argues that high-level descriptions plus domain knowledge can improve
  controllable symbolic generation.
- music21 exposes explicit voice-leading and verticality concepts, which is a
  good model for validation even if we keep our runtime dependency small.
- DeepSeek V4 Flash supports JSON output and configurable non-thinking mode,
  which fits our bounded planner use case.
- OpenRouter compatibility matters for the alpha cost target. When
  `GIGASTUDY_API_DEEPSEEK_BASE_URL=https://openrouter.ai/api/v1`, the API uses
  the same chat-completions JSON-mode shape but omits native DeepSeek
  `thinking` fields by default.

Design conclusion: use the LLM for high-level musical planning and let a
constraint/search engine realize that plan.

## Target Pipeline

1. Build a canonical score context.

   - Merge all registered vocal tracks by fixed studio beat grid.
   - Preserve known slot ids.
   - Build measure summaries: active notes, downbeat notes, cadential moments,
     density, sustained tones, and missing voices.
   - Estimate key/mode locally first; expose uncertainty to DeepSeek.

2. Ask DeepSeek for a bounded `HarmonyPlan`.

   DeepSeek returns JSON only:

   - global key and mode suggestion;
   - phrase sections;
   - measure-level chord/function intent;
   - candidate-level goals;
   - rhythmic policy for the target part;
   - register and motion targets;
   - warnings and review hints.

3. Validate and sanitize the plan.

   - Reject unsupported keys, impossible target ranges, invalid beats, or
     unsafe profile names.
   - Clamp all plan references to real studio measures.
   - Fill missing measures with deterministic fallback intent.
   - Keep a `plan_used=false` fallback path if JSON/schema validation fails.

4. Generate candidates with plan-aware constrained search.

   - Search state must include chord, pitch, motion, previous target pitch,
     previous chord, and candidate goal.
   - Candidate cost must include plan costs, not only generic profile costs.
   - Voice crossing, range, spacing, and parallel perfect penalties remain hard
     or near-hard constraints.
   - Chord/function plan influences candidate chord ranking.
   - Candidate goal influences register, motion, contrary motion, chord tone
     choice, and rhythmic density.

5. Normalize notation.

   - Reuse the shared notation normalization contract.
   - Split/tie only on measure/rhythm boundaries.
   - Preserve fixed BPM/meter.
   - Apply track display policy, clef, key signature, spelling, and warnings.

6. Score candidates before exposing them.

   Each generated candidate gets machine diagnostics:

   - harmonic fit score;
   - voice-leading score;
   - range fit ratio;
   - spacing violations;
   - parallel-perfect count;
   - similarity to sibling candidates;
   - plan adherence score;
   - readability score;
   - warnings.

7. Show user-facing decision evidence.

   The UI should compare candidates by musical role, not by engine fields:

   - "안정형: 기존 성부를 크게 방해하지 않는 기본 화음"
   - "대선율형: 소프라노와 반진행이 많아 독립성이 큼"
   - "넓은 간격형: 저음 받침이 강하지만 음역 확인 필요"

## HarmonyPlan Schema V2

The plan should be small enough for cheap calls and strict enough to influence
generation.

```json
{
  "key": "C",
  "mode": "major",
  "confidence": 0.78,
  "phrase_summary": "1-2마디 안정, 3마디 긴장, 4마디 종지",
  "measures": [
    {
      "measure_index": 1,
      "function": "tonic",
      "preferred_degrees": [1, 6],
      "cadence_role": "opening",
      "target_motion": "stable",
      "allowed_tensions": [],
      "avoid": ["parallel_octave", "voice_crossing"]
    },
    {
      "measure_index": 2,
      "function": "predominant",
      "preferred_degrees": [2, 4],
      "cadence_role": "build",
      "target_motion": "stepwise",
      "allowed_tensions": ["passing"],
      "avoid": ["large_leap"]
    }
  ],
  "candidate_directions": [
    {
      "candidate_index": 1,
      "profile_name": "balanced",
      "title": "안정형 블렌드",
      "goal": "rehearsal_safe",
      "register_bias": "middle",
      "motion_bias": "mostly_stepwise",
      "rhythm_policy": "follow_context",
      "chord_tone_priority": ["third", "root", "fifth"],
      "role": "기존 성부를 크게 방해하지 않는 기본 화음",
      "selection_hint": "처음 연습하거나 무난한 합창감을 원할 때 선택",
      "risk_tags": []
    }
  ],
  "warnings": []
}
```

Allowed values should be enum-based. Free text is allowed only for UI-facing
`title`, `role`, `selection_hint`, `phrase_summary`, and `warnings`.

## Candidate Types

Three default vocal candidates should be intentionally different:

1. Stable Blend

   - Goal: first-pass rehearsal safety.
   - Strongly prefers common tones, thirds, small motion, no range edges.
   - Penalizes large leaps and dense non-chord tones.

2. Counterline

   - Goal: independent singable line.
   - Rewards contrary motion against the strongest known context voice.
   - Allows passing tones on weak beats.
   - Still avoids crossing and parallel perfects.

3. Open Support

   - Goal: fuller harmony and bass/baritone support.
   - Rewards root/fifth support when the target slot is Baritone/Bass.
   - Allows wider spacing below Tenor, but keeps upper-voice spacing tighter.

For Soprano/Alto targets, "Open Support" should become "Upper Blend" instead
of forcing low-register behavior.

## Engine Changes Needed

### 1. New Internal Models

Add engine-owned models separate from API schemas:

- `HarmonyPlan`
- `MeasureHarmonyIntent`
- `CandidateGenerationGoal`
- `PlanValidationResult`
- `CandidateQualityReport`

These should live under `services/engine/harmony_plan.py` or similar.

### 2. Plan-Aware Chord Ranking

Current chord ranking is local-event based. Add measure intent:

- If measure function is tonic, discount I/vi/iii.
- If predominant, discount ii/IV.
- If dominant, discount V/vii.
- If cadence final, strongly prefer tonic landing.
- If DeepSeek suggests a key but local estimate disagrees, blend by confidence
  instead of blindly replacing local key.

### 3. Plan-Aware Pitch Cost

Extend profile cost with candidate goal:

- register target: low/middle/high/open;
- motion target: stable/stepwise/contrary/active;
- chord-tone priority;
- non-chord-tone allowance;
- maximum leap preference;
- target relation to known upper/lower voices.

### 4. Rhythmic Policy

Do not merely copy every context onset in every candidate. Candidate rhythm can
be:

- `follow_context`: current behavior, safest;
- `simplify`: merge repeated same-chord events into longer notes;
- `answer_melody`: keep strong beats and add weak-beat passing notes;
- `sustain_support`: use longer notes under active upper parts.

All policies still quantize to the studio beat grid and measure boundaries.

### 5. Post-Generation Optimizer

After beam search:

- merge adjacent same-pitch notes only when rhythmically readable;
- split measure-crossing notes into tied display segments;
- remove weak-beat ornamental notes if they create dense unreadable notation;
- prefer fewer accidentals when pitch alternatives are musically equivalent;
- recompute confidence from actual violations and plan adherence.

### 6. Candidate Diversity Gate

A candidate should be hidden or regenerated if it is too similar to another
candidate:

- pitch sequence distance below threshold;
- same average register within two semitones;
- same contour signature for more than 80 percent of events;
- same chord degree sequence for more than 85 percent of events.

Fallback regeneration should adjust candidate goal weights, not randomly jitter
notes.

## LLM Safety Boundary

DeepSeek may decide:

- phrase and measure-level intent;
- candidate goals;
- user-facing labels and selection hints;
- warnings.

DeepSeek may later be added as an event critic for extracted pitch events, but
that role is advisory repair policy, not unchecked authorship. The current
registration quality gate is deterministic and owns final BPM-grid timing,
measure ownership, clef/key/spelling, density cleanup, and range validation.

DeepSeek may also act as an ensemble registration critic when explicitly
enabled. In that role it receives sibling-track summaries and vertical
snapshots, then returns only bounded notation repair instructions. It does not
compose replacement notes or override the deterministic ensemble gate.

DeepSeek may not decide:

- final MIDI pitch sequence;
- exact onset/duration pitch events;
- BPM or meter;
- overwrite behavior;
- hidden server state;
- scoring result text.

If the plan is invalid, stale, too verbose, or too expensive, generation must
continue deterministically.

## Evaluation Plan

Add deterministic regression fixtures:

- single soprano melody, generate Alto/Tenor/Bass;
- soprano + bass, generate inner voices;
- SATB minus one voice, reconstruct missing voice;
- pop-like repeated melody, ensure candidates are not identical;
- dense voice-derived pitch events, ensure AI simplifies when asked;
- final cadence fixtures in major and minor;
- non-4/4 meter fixtures.

Candidate quality assertions:

- no known-voice crossing;
- no hard parallel perfects against known voices;
- generated notes stay in target range;
- final cadence lands on acceptable tonic/chord tone when plan requests it;
- sibling candidates differ beyond diversity threshold;
- `plan_adherence_score` is exposed;
- DeepSeek-disabled path still passes all tests.

## Rollout Phases

### Phase 1: Strong Planner Contract

Implement `HarmonyPlan` V2 schema, plan validation, and tests. DeepSeek can
return measure-level intent, but the engine may initially use only a subset.

### Phase 2: Plan-Aware Search

Wire measure function and candidate goals into chord ranking and pitch cost.
This is the first phase where DeepSeek should clearly alter generated notes.

### Phase 3: Rhythm Policies

Add simplify/sustain/answer-melody policies so candidates differ in rhythm as
well as pitch.

### Phase 4: Candidate Quality Report

Expose plan adherence, harmonic fit, voice-leading risk, and readability in the
candidate review UI.

### Phase 5: Optional Symbolic Model

Only after the above is stable, consider a dedicated symbolic harmonization
model. It should remain optional because alpha cost, deployment weight, and
auditable constraints matter more than novelty.

## Recommendation

Adopt the hybrid approach now:

- DeepSeek V4 Flash: planner and candidate explainer.
- Deterministic constrained search: final pitch-event generator.
- Quality report: candidate comparison and regression gate.

Do not adopt a heavyweight symbolic neural model yet. The next real quality
gain is making DeepSeek's plan feed the cost function and rhythm policy, not
letting an LLM directly write notes.
