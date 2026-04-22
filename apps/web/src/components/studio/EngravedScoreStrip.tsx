import { useEffect, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import {
  Accidental,
  Beam,
  Dot,
  Formatter,
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
  Voice,
} from 'vexflow'

import {
  formatBeatInMeasure,
  getScoreBeatLineStyle,
  getScoreMeasureBoundaryStyle,
  getTimelineNoteStyle,
  getTrackRenderModel,
} from '../../lib/studio'
import type { NoteDurationGlyph, TrackRenderNote } from '../../lib/studio'
import type { ScoreNote, TrackSlot } from '../../types/studio'

type EngravedScoreStripProps = {
  beatsPerMeasure: number
  bpm: number
  track: TrackSlot
}

type Clef = 'treble' | 'bass'

type VexDuration = {
  beats: number
  dots: number
  duration: 'w' | 'h' | 'q' | '8' | '16'
}

type DrawnNote = {
  renderNote: TrackRenderNote
  staveNote: StaveNote
}

const SCORE_HEIGHT_PX = 190
const STAVE_Y_PX = 58
const FIRST_MEASURE_EXTRA_WIDTH_PX = 92
const SCORE_RIGHT_PADDING_PX = 32
const MIN_REST_BEATS = 0.24
const TIE_EPSILON_BEATS = 0.08
const SYNC_TRANSLATED_VEXFLOW_GROUPS = '.vf-stavenote, .vf-beam, .vf-stavetie'

const pitchNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const durationCandidates: VexDuration[] = [
  { beats: 4, duration: 'w', dots: 0 },
  { beats: 3, duration: 'h', dots: 1 },
  { beats: 2, duration: 'h', dots: 0 },
  { beats: 1.5, duration: 'q', dots: 1 },
  { beats: 1, duration: 'q', dots: 0 },
  { beats: 0.75, duration: '8', dots: 1 },
  { beats: 0.5, duration: '8', dots: 0 },
  { beats: 0.375, duration: '16', dots: 1 },
  { beats: 0.25, duration: '16', dots: 0 },
]

const durationGlyphToVexDuration: Record<NoteDurationGlyph, VexDuration> = {
  whole: { beats: 4, duration: 'w', dots: 0 },
  half: { beats: 2, duration: 'h', dots: 0 },
  quarter: { beats: 1, duration: 'q', dots: 0 },
  eighth: { beats: 0.5, duration: '8', dots: 0 },
  sixteenth: { beats: 0.25, duration: '16', dots: 0 },
}

function getClef(slotId: number): Clef {
  return slotId >= 5 ? 'bass' : 'treble'
}

function getMeasureIndex(displayBeat: number, beatsPerMeasure: number): number {
  const safeBeatsPerMeasure = Math.max(0.25, beatsPerMeasure)
  return Math.floor((Math.max(1, displayBeat) - 1) / safeBeatsPerMeasure)
}

function getMeasureStartBeat(measureIndex: number, beatsPerMeasure: number): number {
  return 1 + measureIndex * Math.max(0.25, beatsPerMeasure)
}

function getMeasureX(measureIndex: number, measureWidth: number): number {
  if (measureIndex === 0) {
    return 0
  }
  return measureWidth + FIRST_MEASURE_EXTRA_WIDTH_PX + (measureIndex - 1) * measureWidth
}

function getMeasureWidth(measureIndex: number, measureWidth: number): number {
  return measureIndex === 0 ? measureWidth + FIRST_MEASURE_EXTRA_WIDTH_PX : measureWidth
}

function getScoreWidth(measureCount: number, measureWidth: number): number {
  return (
    getMeasureX(Math.max(0, measureCount - 1), measureWidth) +
    getMeasureWidth(Math.max(0, measureCount - 1), measureWidth) +
    SCORE_RIGHT_PADDING_PX
  )
}

function getSyncShiftPx(syncOffsetSeconds: number, bpm: number, pxPerBeat: number): number {
  const beatSeconds = 60 / Math.max(1, bpm)
  return (syncOffsetSeconds / beatSeconds) * pxPerBeat
}

function translateElement(element: Element, xPx: number) {
  const currentTransform = element.getAttribute('transform')
  const nextTransform = `translate(${Math.round(xPx * 100) / 100}, 0)`
  element.setAttribute('transform', currentTransform ? `${currentTransform} ${nextTransform}` : nextTransform)
}

function getLabelParts(label: string): { accidental: string | null; key: string } | null {
  const match = /^([A-G])([#b]?)(-?\d)$/u.exec(label.trim())
  if (!match) {
    return null
  }
  const [, pitchClass, accidental, octave] = match
  return {
    accidental: accidental || null,
    key: `${pitchClass.toLowerCase()}${accidental}/${octave}`,
  }
}

function getMidiLabel(pitchMidi: number): string {
  const pitchClass = ((Math.round(pitchMidi) % 12) + 12) % 12
  const octave = Math.floor(Math.round(pitchMidi) / 12) - 1
  return `${pitchNames[pitchClass]}${octave}`
}

function getVexPitch(note: ScoreNote, clef: Clef): { accidental: string | null; key: string } {
  if (note.is_rest) {
    return { accidental: null, key: clef === 'bass' ? 'd/3' : 'b/4' }
  }

  if (typeof note.pitch_midi === 'number' && Number.isFinite(note.pitch_midi)) {
    return getLabelParts(getMidiLabel(note.pitch_midi)) ?? { accidental: null, key: 'c/4' }
  }

  return getLabelParts(note.label) ?? { accidental: null, key: 'c/4' }
}

function getNearestVexDuration(beats: number): VexDuration {
  const safeBeats = Math.max(0.25, beats)
  return durationCandidates.reduce((best, candidate) => {
    const bestDistance = Math.abs(best.beats - safeBeats)
    const candidateDistance = Math.abs(candidate.beats - safeBeats)
    return candidateDistance < bestDistance ? candidate : best
  }, durationCandidates[durationCandidates.length - 1])
}

function getRestDurations(gapBeats: number): VexDuration[] {
  const roundedGap = Math.round(Math.max(0, gapBeats) * 4) / 4
  const rests: VexDuration[] = []
  let remaining = roundedGap

  while (remaining >= MIN_REST_BEATS) {
    const nextDuration =
      durationCandidates.find((candidate) => candidate.beats <= remaining + 0.001) ??
      durationGlyphToVexDuration.sixteenth
    rests.push(nextDuration)
    remaining = Math.round((remaining - nextDuration.beats) * 4) / 4
  }

  return rests
}

function createStaveNote(note: ScoreNote, duration: VexDuration, clef: Clef): StaveNote {
  const pitch = getVexPitch(note, clef)
  const staveNote = new StaveNote({
    clef,
    dots: duration.dots,
    duration: duration.duration,
    keys: [pitch.key],
    type: note.is_rest ? 'r' : undefined,
  })

  if (duration.dots > 0) {
    Dot.buildAndAttach([staveNote], { all: true })
  }
  if (!note.is_rest && pitch.accidental) {
    staveNote.addModifier(new Accidental(pitch.accidental), 0)
  }

  return staveNote
}

function createRest(duration: VexDuration, clef: Clef): StaveNote {
  const rest = new StaveNote({
    clef,
    dots: duration.dots,
    duration: duration.duration,
    keys: [clef === 'bass' ? 'd/3' : 'b/4'],
    type: 'r',
  })
  if (duration.dots > 0) {
    Dot.buildAndAttach([rest], { all: true })
  }
  return rest
}

function hasTiePitchMatch(left: TrackRenderNote, right: TrackRenderNote): boolean {
  if (left.note.is_rest || right.note.is_rest) {
    return false
  }
  if (
    typeof left.note.pitch_midi === 'number' &&
    Number.isFinite(left.note.pitch_midi) &&
    typeof right.note.pitch_midi === 'number' &&
    Number.isFinite(right.note.pitch_midi)
  ) {
    return Math.round(left.note.pitch_midi) === Math.round(right.note.pitch_midi)
  }
  return left.note.label === right.note.label
}

function findTieTargetIndex(drawnNotes: DrawnNote[], sourceIndex: number): number | null {
  const source = drawnNotes[sourceIndex]
  const expectedNextBeat = source.renderNote.displayBeat + source.renderNote.displayDurationBeats

  for (let index = sourceIndex + 1; index < drawnNotes.length; index += 1) {
    const candidate = drawnNotes[index]
    if (candidate.renderNote.displayBeat > expectedNextBeat + TIE_EPSILON_BEATS) {
      return null
    }
    const isSplitSegment =
      candidate.renderNote.note.id === source.renderNote.note.id &&
      candidate.renderNote.segmentIndex === source.renderNote.segmentIndex + 1
    const isExplicitTie =
      candidate.renderNote.tieStop &&
      hasTiePitchMatch(source.renderNote, candidate.renderNote) &&
      Math.abs(candidate.renderNote.displayBeat - expectedNextBeat) <= TIE_EPSILON_BEATS
    if (isSplitSegment || isExplicitTie) {
      return index
    }
  }

  return null
}

export function EngravedScoreStrip({ beatsPerMeasure, bpm, track }: EngravedScoreStripProps) {
  const engravingRef = useRef<HTMLDivElement | null>(null)
  const scoreModel = useMemo(
    () => getTrackRenderModel(track, bpm, beatsPerMeasure),
    [beatsPerMeasure, bpm, track],
  )
  const engravingTrack = useMemo(
    () => ({
      ...track,
      sync_offset_seconds: 0,
    }),
    [track],
  )
  const engravingModel = useMemo(
    () => getTrackRenderModel(engravingTrack, bpm, beatsPerMeasure),
    [beatsPerMeasure, bpm, engravingTrack],
  )
  const clef = getClef(track.slot_id)
  const measureCount = Math.max(scoreModel.measureCount, engravingModel.measureCount)
  const scoreWidth = getScoreWidth(measureCount, scoreModel.measureWidth)
  const syncShiftPx = getSyncShiftPx(track.sync_offset_seconds, bpm, scoreModel.pxPerBeat)

  useEffect(() => {
    const container = engravingRef.current
    if (!container) {
      return
    }

    container.innerHTML = ''

    const renderer = new Renderer(container, Renderer.Backends.SVG)
    renderer.resize(scoreWidth, SCORE_HEIGHT_PX)
    const context = renderer.getContext()
    const drawnNotes: DrawnNote[] = []

    Array.from({ length: measureCount }, (_, index) => index + 1).forEach((measureNumber, measureIndex) => {
      const staveX = getMeasureX(measureIndex, scoreModel.measureWidth)
      const staveWidth = getMeasureWidth(measureIndex, scoreModel.measureWidth)
      const stave = new Stave(staveX, STAVE_Y_PX, staveWidth, {
        leftBar: measureIndex === 0,
        rightBar: true,
        spaceAboveStaffLn: 5,
        spaceBelowStaffLn: 7,
      })

      if (measureIndex === 0) {
        stave.addClef(clef)
      }
      stave.setMeasure(measureNumber)
      stave.setContext(context).draw()

      const measureStartBeat = getMeasureStartBeat(measureIndex, beatsPerMeasure)
      const measureEndBeat = measureStartBeat + Math.max(0.25, beatsPerMeasure)
      const measureNotes = engravingModel.notes.filter(
        (renderNote) => getMeasureIndex(renderNote.displayBeat, beatsPerMeasure) === measureIndex,
      )
      const staveNotes: StaveNote[] = []
      const drawnMeasureNotes: DrawnNote[] = []
      let cursorBeat = measureStartBeat

      measureNotes.forEach((renderNote) => {
        const gapBeats = renderNote.displayBeat - cursorBeat
        getRestDurations(gapBeats).forEach((restDuration) => {
          staveNotes.push(createRest(restDuration, clef))
        })

        const duration = getNearestVexDuration(renderNote.displayDurationBeats)
        const staveNote = createStaveNote(renderNote.note, duration, clef)
        staveNotes.push(staveNote)
        drawnMeasureNotes.push({ renderNote, staveNote })
        cursorBeat = Math.max(cursorBeat, renderNote.displayBeat + renderNote.displayDurationBeats)
      })

      getRestDurations(measureEndBeat - cursorBeat).forEach((restDuration) => {
        staveNotes.push(createRest(restDuration, clef))
      })

      if (staveNotes.length === 0) {
        return
      }

      const voice = new Voice({
        beatValue: 16,
        numBeats: Math.max(1, Math.round(Math.max(0.25, beatsPerMeasure) * 4)),
      }).setMode(Voice.Mode.SOFT)
      voice.addTickables(staveNotes)

      new Formatter({ softmaxFactor: 1.2 })
        .joinVoices([voice])
        .formatToStave([voice], stave, { alignRests: true, context })
      voice.draw(context, stave)

      Beam.generateBeams(staveNotes, {
        beamRests: false,
        maintainStemDirections: true,
      }).forEach((beam) => {
        beam.setContext(context).draw()
      })

      drawnNotes.push(...drawnMeasureNotes)
    })

    drawnNotes.forEach((drawnNote, index) => {
      if (!drawnNote.renderNote.tieStart || drawnNote.renderNote.note.is_rest) {
        return
      }
      const targetIndex = findTieTargetIndex(drawnNotes, index)
      if (targetIndex === null) {
        return
      }
      const target = drawnNotes[targetIndex]
      new StaveTie({
        firstIndexes: [0],
        firstNote: drawnNote.staveNote,
        lastIndexes: [0],
        lastNote: target.staveNote,
      })
        .setContext(context)
        .draw()
    })

    const svg = container.querySelector('svg')
    svg?.classList.add('track-card__engraving-svg')
    svg?.setAttribute('aria-label', `${track.name} score`)
    svg?.setAttribute('role', 'img')

    if (Math.abs(syncShiftPx) >= 0.01) {
      container.querySelectorAll(SYNC_TRANSLATED_VEXFLOW_GROUPS).forEach((element) => {
        translateElement(element, syncShiftPx)
      })
    }

    return () => {
      container.innerHTML = ''
    }
  }, [beatsPerMeasure, clef, engravingModel, measureCount, scoreModel.measureWidth, scoreWidth, syncShiftPx, track.name])

  return (
    <div
      className="track-card__measure-strip track-card__engraved-strip"
      data-testid={`track-score-strip-${track.slot_id}`}
      style={
        {
          '--score-height': `${SCORE_HEIGHT_PX}px`,
          '--score-width': `${scoreWidth}px`,
        } as CSSProperties
      }
    >
      <div ref={engravingRef} className="track-card__engraving-canvas" />
      <div className="track-card__engraving-markers" aria-hidden="true">
        {scoreModel.beatGuideOffsets.map((beatOffset) => (
          <div
            className="track-card__beat-line"
            key={`${track.slot_id}-beat-line-${beatOffset}`}
            style={getScoreBeatLineStyle(beatOffset, scoreModel)}
          />
        ))}
        {scoreModel.measureBoundaryOffsets.map((beatOffset) => (
          <div
            className="track-card__beat-line track-card__beat-line--measure"
            key={`${track.slot_id}-measure-line-${beatOffset}`}
            style={getScoreMeasureBoundaryStyle(beatOffset, scoreModel)}
          />
        ))}
        {scoreModel.notes.map((renderNote) => (
          <div
            aria-label={`${renderNote.note.label} ${renderNote.durationLabel}`}
            className={[
              'track-card__measure-note',
              'track-card__engraving-marker',
              `track-card__note--${renderNote.durationGlyph}`,
              renderNote.tieStart ? 'track-card__note--tie-start' : '',
              renderNote.tieStop ? 'track-card__note--tie-stop' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-duration={renderNote.durationGlyph}
            data-testid={`track-note-${track.slot_id}-${renderNote.renderKey}`}
            key={renderNote.renderKey}
            style={getTimelineNoteStyle(track.slot_id, renderNote, scoreModel)}
          >
            <small>{formatBeatInMeasure(renderNote.displayBeat, beatsPerMeasure)}</small>
            <strong>{renderNote.note.label}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}
