from __future__ import annotations

from gigastudy_api.services.engine.harmony_plan import DeepSeekHarmonyPlan
from gigastudy_api.services.llm.deepseek import plan_harmony_with_deepseek
from gigastudy_api.services.llm.midi_role_review import review_midi_roles_with_deepseek
from gigastudy_api.services.llm.extraction_plan import plan_voice_extraction_with_deepseek
from gigastudy_api.services.llm.registration_review import (
    review_ensemble_registration_with_deepseek,
    review_track_registration_with_deepseek,
)


# Product services import this module as the provider boundary. The current
# implementation uses DeepSeek/OpenRouter-compatible calls, but callers should
# treat these as bounded planner/reviewer capabilities rather than provider
# internals.
plan_harmony = plan_harmony_with_deepseek
plan_voice_extraction = plan_voice_extraction_with_deepseek
review_midi_roles = review_midi_roles_with_deepseek
review_track_registration = review_track_registration_with_deepseek
review_ensemble_registration = review_ensemble_registration_with_deepseek
