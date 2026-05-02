from __future__ import annotations

from gigastudy_api.api.schemas.studios import SourceKind, Studio
from gigastudy_api.config import get_settings
from gigastudy_api.domain.track_events import TrackPitchEvent
from gigastudy_api.services.engine.arrangement import prepare_ensemble_registration
from gigastudy_api.services.engine.event_quality import (
    RegistrationQualityResult,
    apply_registration_review_instruction,
    prepare_notes_for_track_registration,
)
from gigastudy_api.services.engine.timeline import (
    registered_sync_resolved_tracks,
    registered_sync_resolved_tracks_by_slot,
)
from gigastudy_api.services.llm.registration_review import (
    review_ensemble_registration_with_deepseek,
    review_track_registration_with_deepseek,
)

LLM_REGISTRATION_REVIEW_BYPASS_SOURCE_KINDS: set[str] = {"ai"}


class TrackRegistrationPreparer:
    """Single cleanup gate before imported material becomes registered pitch-event regions."""

    def prepare_notes(
        self,
        studio: Studio,
        slot_id: int,
        *,
        source_kind: SourceKind,
        notes: list[TrackPitchEvent],
    ) -> RegistrationQualityResult:
        registration = self._prepare_single_track_events(
            studio,
            slot_id,
            source_kind=source_kind,
            notes=notes,
        )
        return self._apply_ensemble_arrangement_gate(
            studio,
            slot_id,
            registration,
            source_kind=source_kind,
        )

    def prepare_batch(
        self,
        studio: Studio,
        mapped_notes: dict[int, list[TrackPitchEvent]],
        *,
        source_kind: SourceKind,
    ) -> dict[int, RegistrationQualityResult]:
        first_pass = {
            slot_id: self._prepare_single_track_events(
                studio,
                slot_id,
                source_kind=source_kind,
                notes=notes,
            )
            for slot_id, notes in mapped_notes.items()
        }
        proposed_tracks_by_slot = {
            slot_id: registration.notes
            for slot_id, registration in first_pass.items()
        }
        return {
            slot_id: self._apply_ensemble_arrangement_gate(
                studio,
                slot_id,
                registration,
                source_kind=source_kind,
                proposed_tracks_by_slot=proposed_tracks_by_slot,
            )
            for slot_id, registration in first_pass.items()
        }

    def _prepare_single_track_events(
        self,
        studio: Studio,
        slot_id: int,
        *,
        source_kind: SourceKind,
        notes: list[TrackPitchEvent],
    ) -> RegistrationQualityResult:
        reference_tracks = self._reference_tracks(studio, exclude_slot_id=slot_id)
        reference_tracks_by_slot = self._reference_tracks_by_slot(studio, exclude_slot_id=slot_id)
        registration = prepare_notes_for_track_registration(
            notes,
            bpm=studio.bpm,
            slot_id=slot_id,
            source_kind=source_kind,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            reference_tracks=reference_tracks,
        )
        if source_kind in LLM_REGISTRATION_REVIEW_BYPASS_SOURCE_KINDS:
            return _with_llm_registration_review_skip(
                registration,
                reason="ai_candidate_generation",
            )
        settings = get_settings()
        instruction = review_track_registration_with_deepseek(
            settings=settings,
            title=studio.title,
            bpm=studio.bpm,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            slot_id=slot_id,
            source_kind=source_kind,
            original_notes=notes,
            prepared_notes=registration.notes,
            diagnostics=registration.diagnostics,
            context_tracks_by_slot=reference_tracks_by_slot,
        )
        if instruction is None:
            return registration
        return apply_registration_review_instruction(
            notes,
            instruction=instruction.model_dump(exclude_none=True),
            bpm=studio.bpm,
            slot_id=slot_id,
            source_kind=source_kind,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            baseline_result=registration,
            reference_tracks=reference_tracks,
        )

    def _apply_ensemble_arrangement_gate(
        self,
        studio: Studio,
        slot_id: int,
        registration: RegistrationQualityResult,
        *,
        source_kind: SourceKind,
        proposed_tracks_by_slot: dict[int, list[TrackPitchEvent]] | None = None,
    ) -> RegistrationQualityResult:
        existing_tracks_by_slot = self._reference_tracks_by_slot(studio, exclude_slot_id=slot_id)
        if proposed_tracks_by_slot:
            existing_tracks_by_slot.update(
                {
                    proposed_slot_id: proposed_notes
                    for proposed_slot_id, proposed_notes in proposed_tracks_by_slot.items()
                    if proposed_slot_id != slot_id and proposed_notes
                }
            )
        ensemble_result = prepare_ensemble_registration(
            target_slot_id=slot_id,
            candidate_notes=registration.notes,
            existing_tracks_by_slot=existing_tracks_by_slot,
            bpm=studio.bpm,
            source_kind=source_kind,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
        )
        ensemble_registration = RegistrationQualityResult(
            notes=ensemble_result.notes,
            diagnostics={
                **registration.diagnostics,
                "ensemble_arrangement": ensemble_result.diagnostics,
            },
        )
        if source_kind in LLM_REGISTRATION_REVIEW_BYPASS_SOURCE_KINDS:
            return _with_ensemble_llm_review_skip(
                ensemble_registration,
                reason="ai_candidate_generation",
            )
        settings = get_settings()
        instruction = review_ensemble_registration_with_deepseek(
            settings=settings,
            title=studio.title,
            bpm=studio.bpm,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            slot_id=slot_id,
            source_kind=source_kind,
            original_notes=registration.notes,
            prepared_notes=ensemble_registration.notes,
            diagnostics=ensemble_registration.diagnostics,
            context_tracks_by_slot=existing_tracks_by_slot,
            proposed_tracks_by_slot=proposed_tracks_by_slot,
        )
        if instruction is None:
            return ensemble_registration

        reviewed_registration = apply_registration_review_instruction(
            ensemble_registration.notes,
            instruction=instruction.model_dump(exclude_none=True),
            bpm=studio.bpm,
            slot_id=slot_id,
            source_kind=source_kind,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
            baseline_result=ensemble_registration,
            reference_tracks=list(existing_tracks_by_slot.values()),
        )
        reviewed_ensemble_result = prepare_ensemble_registration(
            target_slot_id=slot_id,
            candidate_notes=reviewed_registration.notes,
            existing_tracks_by_slot=existing_tracks_by_slot,
            bpm=studio.bpm,
            source_kind=source_kind,
            time_signature_numerator=studio.time_signature_numerator,
            time_signature_denominator=studio.time_signature_denominator,
        )
        return RegistrationQualityResult(
            notes=reviewed_ensemble_result.notes,
            diagnostics={
                **reviewed_registration.diagnostics,
                "ensemble_arrangement": reviewed_ensemble_result.diagnostics,
                "pre_ensemble_llm_registration_quality": ensemble_registration.diagnostics,
            },
        )

    def _reference_tracks(
        self,
        studio: Studio,
        *,
        exclude_slot_id: int,
    ) -> list[list[TrackPitchEvent]]:
        return registered_sync_resolved_tracks(
            studio.tracks,
            bpm=studio.bpm,
            exclude_slot_id=exclude_slot_id,
        )

    def _reference_tracks_by_slot(
        self,
        studio: Studio,
        *,
        exclude_slot_id: int,
    ) -> dict[int, list[TrackPitchEvent]]:
        return registered_sync_resolved_tracks_by_slot(
            studio.tracks,
            bpm=studio.bpm,
            exclude_slot_id=exclude_slot_id,
        )


def _with_llm_registration_review_skip(
    registration: RegistrationQualityResult,
    *,
    reason: str,
) -> RegistrationQualityResult:
    diagnostics = dict(registration.diagnostics)
    actions = list(diagnostics.get("actions", []))
    skip_action = f"llm_registration_review_skipped_{reason}"
    if skip_action not in actions:
        actions.append(skip_action)
    diagnostics["actions"] = actions
    diagnostics["llm_registration_review"] = {
        "applied": False,
        "skipped_reason": reason,
    }
    return RegistrationQualityResult(notes=registration.notes, diagnostics=diagnostics)


def _with_ensemble_llm_review_skip(
    registration: RegistrationQualityResult,
    *,
    reason: str,
) -> RegistrationQualityResult:
    diagnostics = dict(registration.diagnostics)
    diagnostics["llm_ensemble_review"] = {
        "applied": False,
        "skipped_reason": reason,
    }
    return RegistrationQualityResult(notes=registration.notes, diagnostics=diagnostics)
