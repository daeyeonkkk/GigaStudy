from __future__ import annotations

from io import BytesIO
from math import ceil
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas

from gigastudy_api.api.schemas.studios import Studio, TrackNote, TrackSlot
from gigastudy_api.services.engine.music_theory import TRACKS, quarter_beats_per_measure


NOTE_STEPS = {
    0: 0,
    2: 1,
    4: 2,
    5: 3,
    7: 4,
    9: 5,
    11: 6,
}


class ScorePdfExportError(ValueError):
    pass


def build_studio_score_pdf(studio: Studio) -> bytes:
    registered_tracks = [
        track
        for track in studio.tracks
        if track.status == "registered" and any(note.is_rest is not True for note in track.notes)
    ]
    if not registered_tracks:
        raise ScorePdfExportError("PDF export requires at least one registered track.")

    buffer = BytesIO()
    page_size = landscape(A4)
    canvas = Canvas(buffer, pagesize=page_size)
    font_name = _register_export_font()
    width, height = page_size
    margin_x = 38
    current_y = height - 42
    page_number = 1

    _draw_header(canvas, studio, font_name, width, height, page_number)
    current_y -= 42

    beats_per_measure = quarter_beats_per_measure(
        studio.time_signature_numerator,
        studio.time_signature_denominator,
    )
    max_beat = max(
        note.beat + note.duration_beats
        for track in registered_tracks
        for note in track.notes
    )
    measure_count = max(1, ceil(max(0, max_beat - 1) / beats_per_measure))
    total_beats = max(beats_per_measure, measure_count * beats_per_measure)

    for slot_id, track_name in TRACKS:
        track = next((candidate for candidate in registered_tracks if candidate.slot_id == slot_id), None)
        if track is None:
            continue
        row_height = 82
        if current_y - row_height < 44:
            canvas.showPage()
            page_number += 1
            _draw_header(canvas, studio, font_name, width, height, page_number)
            current_y = height - 84
        _draw_track_row(
            canvas,
            track,
            track_name,
            font_name,
            margin_x,
            current_y,
            width - margin_x,
            beats_per_measure,
            total_beats,
            measure_count,
        )
        current_y -= row_height

    canvas.save()
    return buffer.getvalue()


def _register_export_font() -> str:
    font_name = "GigaStudyExport"
    if font_name in pdfmetrics.getRegisteredFontNames():
        return font_name

    candidates = [
        Path("C:/Windows/Fonts/malgun.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            pdfmetrics.registerFont(TTFont(font_name, str(candidate)))
            return font_name
    return "Helvetica"


def _draw_header(
    canvas: Canvas,
    studio: Studio,
    font_name: str,
    width: float,
    height: float,
    page_number: int,
) -> None:
    canvas.setFillColor(colors.black)
    canvas.setFont(font_name, 16)
    canvas.drawString(38, height - 34, studio.title)
    canvas.setFont(font_name, 9)
    canvas.drawRightString(
        width - 38,
        height - 31,
        f"{studio.bpm} BPM | {studio.time_signature_numerator}/{studio.time_signature_denominator} | Page {page_number}",
    )
    canvas.setStrokeColor(colors.HexColor("#8a949d"))
    canvas.setLineWidth(0.6)
    canvas.line(38, height - 45, width - 38, height - 45)


def _draw_track_row(
    canvas: Canvas,
    track: TrackSlot,
    track_name: str,
    font_name: str,
    left: float,
    top: float,
    right: float,
    beats_per_measure: float,
    total_beats: float,
    measure_count: int,
) -> None:
    label_width = 86
    staff_left = left + label_width + 18
    staff_right = right
    staff_width = staff_right - staff_left
    staff_top = top - 23
    line_gap = 6
    middle_line_y = staff_top - (2 * line_gap)

    canvas.setFont(font_name, 10)
    canvas.setFillColor(colors.black)
    canvas.drawString(left, top - 16, f"{track.slot_id:02d} {track_name}")
    canvas.setFont(font_name, 7)
    canvas.setFillColor(colors.HexColor("#52616d"))
    canvas.drawString(left, top - 30, track.source_label or "")

    canvas.setStrokeColor(colors.black)
    canvas.setLineWidth(0.45)
    for line_index in range(5):
        y = staff_top - line_index * line_gap
        canvas.line(staff_left, y, staff_right, y)

    canvas.setFont(font_name, 16)
    canvas.setFillColor(colors.black)
    clef = "F" if track.slot_id in {4, 5} else "G"
    canvas.drawString(staff_left - 24, middle_line_y - 6, clef)

    canvas.setStrokeColor(colors.HexColor("#c8cfd5"))
    canvas.setLineWidth(0.4)
    for measure_index in range(measure_count + 1):
        beat_offset = measure_index * beats_per_measure
        x = staff_left + (beat_offset / total_beats) * staff_width
        canvas.line(x, staff_top + 8, x, staff_top - 36)
        if measure_index < measure_count:
            canvas.setFont(font_name, 6)
            canvas.setFillColor(colors.HexColor("#384652"))
            canvas.drawString(x + 2, staff_top + 11, str(measure_index + 1))

    canvas.setStrokeColor(colors.black)
    canvas.setFillColor(colors.black)
    canvas.setLineWidth(0.8)
    for note in sorted(track.notes, key=lambda item: (item.beat, item.pitch_midi or -1)):
        _draw_note(canvas, note, track.slot_id, staff_left, staff_width, total_beats, middle_line_y, line_gap, font_name)


def _draw_note(
    canvas: Canvas,
    note: TrackNote,
    slot_id: int,
    staff_left: float,
    staff_width: float,
    total_beats: float,
    middle_line_y: float,
    line_gap: float,
    font_name: str,
) -> None:
    x = staff_left + ((max(1, note.beat) - 1) / total_beats) * staff_width
    if note.is_rest or note.pitch_midi is None:
        y = middle_line_y
        canvas.rect(x - 3, y - 2, 6, 4, fill=1, stroke=0)
    else:
        y = _note_y(slot_id, note.pitch_midi, middle_line_y, line_gap)
        canvas.ellipse(x - 4.5, y - 3.2, x + 4.5, y + 3.2, fill=1, stroke=1)
        canvas.line(x + 4, y, x + 4, y + 24)

    duration_x = x + max(8, note.duration_beats * staff_width / total_beats)
    canvas.setStrokeColor(colors.HexColor("#2f3a42"))
    canvas.line(x, y - 7, duration_x, y - 7)
    canvas.setFont(font_name, 5.8)
    canvas.setFillColor(colors.black)
    canvas.drawCentredString(x, y - 17, note.label)


def _note_y(slot_id: int, pitch_midi: int, middle_line_y: float, line_gap: float) -> float:
    pitch_step = _pitch_step(pitch_midi)
    middle_step = _pitch_step(50 if slot_id in {4, 5} else 71)
    y = middle_line_y + (pitch_step - middle_step) * (line_gap / 2)
    return max(middle_line_y - 28, min(middle_line_y + 28, y))


def _pitch_step(pitch_midi: int) -> int:
    octave = pitch_midi // 12 - 1
    pitch_class = pitch_midi % 12
    natural_pitch_class = min(NOTE_STEPS, key=lambda candidate: abs(candidate - pitch_class))
    return octave * 7 + NOTE_STEPS[natural_pitch_class]
