from __future__ import annotations

from gigastudy_api.api.schemas.studios import SourceKind, Studio, TrackNote
from gigastudy_api.config import get_settings
from gigastudy_api.services.engine.arrangement import prepare_ensemble_registration
from gigastudy_api.services.engine.notation_quality import (
    RegistrationNotationResult,
    apply_notation_review_instruction,
    prepare_notes_for_track_registration,
)
from gigastudy_api.services.engine.timeline import (
    registered_sync_resolved_tracks,
    registered_sync_resolved_tracks_by_slot,
)
from gigastudy_api.services.llm.notation_review import (
    review_ensemble_registration_with_deepseek,
    review_notation_with_deepseek,
)


class TrackRegistrationPreparer:
    """Single quality gate for material before it becomes registered TrackNote truth."""

    def prepare_notes(
        self,
        studio: Studio,
        slot_id: int,
        *,
        source_kind: SourceKind,
        notes: list[TrackNote],
    ) -> RegistrationNotationResult:
        registration = self._prepare_single_track_notation(
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
        mapped_notes: dict[int, list[TrackNote]],
        *,
        source_kind: SourceKind,
    ) -> dict[int, RegistrationNotationResult]:
        first_pass = {
            slot_id: self._prepare_single_track_notation(
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

    def _prepare_single_track_notation(
        self,
        studio: Studio,
        slot_id: int,
        *,
        source_kind: SourceKind,
        notes: list[TrackNote],
    ) -> RegistrationNotationResult:
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
        settings = get_settings()
        instruction = review_notation_with_deepseek(
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
        return apply_notation_review_instruction(
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
        registration: RegistrationNotationResult,
        *,
        source_kind: SourceKind,
        proposed_tracks_by_slot: dict[int, list[TrackNote]] | None = None,
    ) -> RegistrationNotationResult:
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
        ensemble_registration = RegistrationNotationResult(
            notes=ensemble_result.notes,
            diagnostics={
                **registration.diagnostics,
                "ensemble_arrangement": ensemble_result.diagnostics,
            },
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

        reviewed_registration = apply_notation_review_instruction(
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
        return RegistrationNotationResult(
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
    ) -> list[list[TrackNote]]:
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
    ) -> dict[int, list[TrackNote]]:
        return registered_sync_resolved_tracks_by_slot(
            studio.tracks,
            bpm=studio.bpm,
            exclude_slot_id=exclude_slot_id,
        )
