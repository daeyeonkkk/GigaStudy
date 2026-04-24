import { useEffect, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { RenderContext } from 'vexflow'
import {
  Accidental,
  Beam,
  Dot,
  Formatter,
  Fraction,
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
  Voice,
} from 'vexflow'

import {
  buildEngravingLayout,
  formatBeatInMeasure,
  getEngravingBeatLineStyle,
  getEngravingPlayheadStyle,
  getEngravingXForSeconds,
  getEngravingMarkerNoteStyle,
  getEngravingMeasureLineStyle,
  getTrackRenderModel,
} from '../../lib/studio'
import type { EngravingDuration, EngravingEvent } from '../../lib/studio'
import type { TrackRenderNote } from '../../lib/studio'
import type { ScoreNote, TrackSlot } from '../../types/studio'

type EngravedScoreStripProps = {
  beatsPerMeasure: number
  bpm: number
  playheadSeconds: number | null
  sharedMeasureWidths: number[]
  track: TrackSlot
}

type Clef = 'treble' | 'bass'

type DrawnNote = {
  event: EngravingEvent
  staveNote: StaveNote
}

const SCORE_HEIGHT_PX = 186
const STAVE_Y_PX = 42
const TIE_EPSILON_BEATS = 0.08
const SYNC_TRANSLATED_VEXFLOW_GROUPS = '.vf-stavenote, .vf-beam, .vf-stavetie'
const FIRST_MEASURE_NOTE_GUTTER_PX = 14

const pitchNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function getClef(slotId: number): Clef {
  return slotId >= 5 ? 'bass' : 'treble'
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

function getVexDurationCode(duration: EngravingDuration): string {
  return `${duration.duration}${'d'.repeat(duration.dots)}`
}

function createStaveNote(note: ScoreNote, duration: EngravingDuration, clef: Clef): StaveNote {
  const pitch = getVexPitch(note, clef)
  const staveNote = new StaveNote({
    clef,
    duration: getVexDurationCode(duration),
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

function createRest(duration: EngravingDuration, clef: Clef, hidden = false): StaveNote {
  const rest = new StaveNote({
    clef,
    duration: getVexDurationCode(duration),
    keys: [clef === 'bass' ? 'd/3' : 'b/4'],
    type: 'r',
  })
  if (duration.dots > 0) {
    Dot.buildAndAttach([rest], { all: true })
  }
  if (hidden) {
    rest.setStyle({ fillStyle: 'transparent', strokeStyle: 'transparent' })
  }
  return rest
}

function shouldBeamMeasure(events: EngravingEvent[]): boolean {
  const beamableNotes = events.filter(
    (event) => event.kind === 'note' && !event.renderNote?.note.is_rest && event.duration.beats <= 0.5,
  )
  if (beamableNotes.length < 2) {
    return false
  }
  if (beamableNotes.length > 12) {
    return false
  }

  const averageConfidence =
    beamableNotes.reduce((total, event) => total + (event.renderNote?.note.confidence ?? 0), 0) / beamableNotes.length
  const voiceHeavy = beamableNotes.filter((event) => event.renderNote?.note.source === 'voice').length >= beamableNotes.length / 2
  if (voiceHeavy && averageConfidence < 0.8) {
    return false
  }

  return true
}

function drawBeamsForMeasure(staveNotes: StaveNote[], events: EngravingEvent[], context: RenderContext) {
  if (!shouldBeamMeasure(events)) {
    return
  }

  try {
    Beam.generateBeams(staveNotes, {
      beamRests: false,
      flatBeams: true,
      groups: [new Fraction(1, 4)],
      maintainStemDirections: false,
      showStemlets: false,
    }).forEach((beam) => {
      beam.setContext(context).draw()
    })
  } catch {
    // Beam construction is best-effort. A bad imported rhythm should never blank the score.
  }
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
  const sourceRenderNote = source.event.renderNote
  if (!sourceRenderNote) {
    return null
  }
  const expectedNextBeat = source.event.startBeat + source.event.durationBeats

  for (let index = sourceIndex + 1; index < drawnNotes.length; index += 1) {
    const candidate = drawnNotes[index]
    const candidateRenderNote = candidate.event.renderNote
    if (!candidateRenderNote) {
      continue
    }
    if (candidate.event.startBeat > expectedNextBeat + TIE_EPSILON_BEATS) {
      return null
    }
    const isSplitSegment =
      candidateRenderNote.note.id === sourceRenderNote.note.id &&
      (candidate.event.tieStop || candidateRenderNote.segmentIndex === sourceRenderNote.segmentIndex + 1)
    const isExplicitTie =
      candidate.event.tieStop &&
      hasTiePitchMatch(sourceRenderNote, candidateRenderNote) &&
      Math.abs(candidate.event.startBeat - expectedNextBeat) <= TIE_EPSILON_BEATS
    if (isSplitSegment || isExplicitTie) {
      return index
    }
  }

  return null
}

export function EngravedScoreStrip({
  beatsPerMeasure,
  bpm,
  playheadSeconds,
  sharedMeasureWidths,
  track,
}: EngravedScoreStripProps) {
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
  const measureCount = Math.max(scoreModel.measureCount, engravingModel.measureCount, sharedMeasureWidths.length)
  const engravingLayout = useMemo(
    () => buildEngravingLayout(engravingModel.notes, measureCount, beatsPerMeasure, sharedMeasureWidths),
    [beatsPerMeasure, engravingModel.notes, measureCount, sharedMeasureWidths],
  )
  const scoreWidth = engravingLayout.scoreWidth
  const syncShiftPx = getSyncShiftPx(track.sync_offset_seconds, bpm, engravingLayout.syncPxPerBeat)
  const playheadX = useMemo(
    () =>
      playheadSeconds === null
        ? null
        : getEngravingXForSeconds(playheadSeconds, bpm, engravingLayout, beatsPerMeasure),
    [beatsPerMeasure, bpm, engravingLayout, playheadSeconds],
  )

  useEffect(() => {
    if (playheadX === null) {
      return
    }

    const viewport = engravingRef.current?.parentElement?.parentElement
    if (!viewport) {
      return
    }

    const leadingRoomPx = 88
    const trailingRoomPx = 180
    const currentLeft = viewport.scrollLeft
    const currentRight = currentLeft + viewport.clientWidth
    if (playheadX < currentLeft + leadingRoomPx) {
      viewport.scrollLeft = Math.max(0, playheadX - leadingRoomPx)
      return
    }
    if (playheadX > currentRight - trailingRoomPx) {
      viewport.scrollLeft = Math.max(0, playheadX - viewport.clientWidth * 0.42)
    }
  }, [playheadX])

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

    engravingLayout.measures.forEach((measure) => {
      const stave = new Stave(measure.x, STAVE_Y_PX, measure.width, {
        leftBar: measure.measureIndex === 0,
        rightBar: true,
        spaceAboveStaffLn: 5,
        spaceBelowStaffLn: 7,
      })

      if (measure.measureIndex === 0) {
        stave.addClef(clef)
      }
      stave.setMeasure(measure.measureNumber)
      if (measure.measureIndex === 0) {
        const noteStartX = stave.getNoteStartX()
        stave.setNoteStartX(noteStartX + FIRST_MEASURE_NOTE_GUTTER_PX)
      }
      stave.setContext(context).draw()

      const staveNotes: StaveNote[] = []
      const drawnMeasureNotes: DrawnNote[] = []

      measure.events.forEach((event) => {
        const staveNote =
          event.kind === 'rest' || event.renderNote === null
            ? createRest(event.duration, clef, event.hidden)
            : createStaveNote(event.renderNote.note, event.duration, clef)
        staveNotes.push(staveNote)
        if (event.kind === 'note') {
          drawnMeasureNotes.push({ event, staveNote })
        }
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

      drawBeamsForMeasure(staveNotes, measure.events, context)

      drawnNotes.push(...drawnMeasureNotes)
    })

    drawnNotes.forEach((drawnNote, index) => {
      if (!drawnNote.event.tieStart || !drawnNote.event.renderNote || drawnNote.event.renderNote.note.is_rest) {
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
  }, [beatsPerMeasure, clef, engravingLayout, scoreWidth, syncShiftPx, track.name])

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
            style={getEngravingBeatLineStyle(beatOffset, engravingLayout, beatsPerMeasure)}
          />
        ))}
        {scoreModel.measureBoundaryOffsets.map((beatOffset) => (
          <div
            className="track-card__beat-line track-card__beat-line--measure"
            key={`${track.slot_id}-measure-line-${beatOffset}`}
            style={getEngravingMeasureLineStyle(Math.round(beatOffset / Math.max(0.25, beatsPerMeasure)), engravingLayout)}
          />
        ))}
        {engravingModel.notes.map((renderNote) => (
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
            style={getEngravingMarkerNoteStyle(renderNote, engravingLayout, beatsPerMeasure, syncShiftPx)}
          >
            <small>{formatBeatInMeasure(renderNote.displayBeat, beatsPerMeasure)}</small>
            <strong>{renderNote.note.label}</strong>
          </div>
        ))}
        {playheadSeconds !== null ? (
          <div
            aria-hidden="true"
            className="track-card__playhead"
            data-testid={`track-playhead-${track.slot_id}`}
            style={getEngravingPlayheadStyle(playheadSeconds, bpm, engravingLayout, beatsPerMeasure)}
          />
        ) : null}
      </div>
    </div>
  )
}
