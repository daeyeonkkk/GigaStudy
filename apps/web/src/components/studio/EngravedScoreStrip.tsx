import { useEffect, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Accidental } from 'vexflow-src/accidental'
import { Beam } from 'vexflow-src/beam'
import { Dot } from 'vexflow-src/dot'
import { Font } from 'vexflow-src/font'
import { Formatter } from 'vexflow-src/formatter'
import { Fraction } from 'vexflow-src/fraction'
import { Academico } from 'vexflow-src/fonts/academico'
import { AcademicoBold } from 'vexflow-src/fonts/academicobold'
import { Bravura } from 'vexflow-src/fonts/bravura'
import { Metrics, MetricsDefaults } from 'vexflow-src/metrics'
import type { RenderContext } from 'vexflow-src/rendercontext'
import { Renderer } from 'vexflow-src/renderer'
import { Stave } from 'vexflow-src/stave'
import { StaveNote } from 'vexflow-src/stavenote'
import { StaveTie } from 'vexflow-src/stavetie'
import { Voice } from 'vexflow-src/voice'

import {
  buildEngravingLayout,
  formatBeatInMeasure,
  getEngravingBeatLineStyle,
  getEngravingPlayheadStyle,
  getEngravingXForSeconds,
  getEngravingMarkerNoteStyle,
  getEngravingMeasureLineStyle,
  getKeySignatureAccidentalCount,
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
type ClefProfile = {
  annotation?: string
  vexClef: Clef
}

type DrawnNote = {
  event: EngravingEvent
  staveNote: StaveNote
}

const SCORE_HEIGHT_PX = 186
const STAVE_Y_PX = 42
const TIE_EPSILON_BEATS = 0.08
const SYNC_TRANSLATED_VEXFLOW_GROUPS = '.vf-stavenote, .vf-beam, .vf-stavetie'
const FIRST_MEASURE_NOTE_GUTTER_PX = 18

const pitchNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

initializeVexFlowFonts()

function initializeVexFlowFonts() {
  MetricsDefaults.fontFamily = 'Bravura,Academico'
  Metrics.clear()

  if (typeof FontFace === 'undefined') {
    return
  }

  void Promise.allSettled([
    Font.load('Bravura', Bravura, { display: 'block' }),
    Font.load('Academico', Academico, { display: 'swap' }),
    Font.load('Academico', AcademicoBold, { display: 'swap', weight: 'bold' }),
  ])
}

function getTrackClefProfile(track: TrackSlot): ClefProfile {
  const notationClef = track.notes.find((note) => note.clef)?.clef
  if (notationClef === 'bass') {
    return { vexClef: 'bass' }
  }
  if (notationClef === 'treble_8vb' || track.slot_id === 3) {
    return { annotation: '8vb', vexClef: 'treble' }
  }
  if (notationClef === 'treble') {
    return { vexClef: 'treble' }
  }
  return track.slot_id >= 4 ? { vexClef: 'bass' } : { vexClef: 'treble' }
}

function getDefaultDisplayOctaveShift(track: TrackSlot, clefProfile: ClefProfile): number {
  if (track.slot_id === 3 || clefProfile.annotation === '8vb') {
    return 12
  }
  return 0
}

function getTrackKeySignature(track: TrackSlot): string | null {
  const keySignature = track.notes.find((note) => note.key_signature)?.key_signature
  return keySignature && keySignature !== 'C' ? keySignature : null
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
  const match = /^([A-G])([#b]?)(-?\d+)$/u.exec(label.trim())
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

function shiftPitchLabelOctaves(label: string, semitoneShift: number): string | null {
  const match = /^([A-G])([#b]?)(-?\d+)$/u.exec(label.trim())
  if (!match || semitoneShift % 12 !== 0) {
    return null
  }
  const [, pitchClass, accidental, octaveText] = match
  return `${pitchClass}${accidental}${Number(octaveText) + semitoneShift / 12}`
}

function getVexPitch(
  note: ScoreNote,
  clef: Clef,
  defaultDisplayOctaveShift: number,
): { accidental: string | null; key: string } {
  if (note.is_rest) {
    return { accidental: null, key: clef === 'bass' ? 'd/3' : 'b/4' }
  }

  const displayShift = note.display_octave_shift ?? defaultDisplayOctaveShift
  const preferredLabel = note.spelled_label ?? note.label
  const shiftedPreferredLabel = shiftPitchLabelOctaves(preferredLabel, displayShift)
  const fallbackLabel =
    typeof note.pitch_midi === 'number' && Number.isFinite(note.pitch_midi)
      ? getMidiLabel(note.pitch_midi + displayShift)
      : note.label
  const parsed = getLabelParts(shiftedPreferredLabel ?? fallbackLabel) ?? { accidental: null, key: 'c/4' }

  const explicitAccidental =
    typeof note.accidental === 'string' && note.accidental.length > 0 ? note.accidental : null
  const accidental = explicitAccidental ?? (note.key_signature ? null : parsed.accidental)
  return {
    accidental,
    key: parsed.key,
  }
}

function getVexDurationCode(duration: EngravingDuration): string {
  return `${duration.duration}${'d'.repeat(duration.dots)}`
}

function attachDots(staveNote: StaveNote, duration: EngravingDuration) {
  for (let dotIndex = 0; dotIndex < duration.dots; dotIndex += 1) {
    Dot.buildAndAttach([staveNote], { all: true })
  }
}

function createStaveNote(
  note: ScoreNote,
  duration: EngravingDuration,
  clef: Clef,
  defaultDisplayOctaveShift: number,
): StaveNote {
  const pitch = getVexPitch(note, clef, defaultDisplayOctaveShift)
  const staveNote = new StaveNote({
    clef,
    duration: getVexDurationCode(duration),
    keys: [pitch.key],
    type: note.is_rest ? 'r' : undefined,
  })

  attachDots(staveNote, duration)
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
  attachDots(rest, duration)
  if (hidden) {
    rest.setStyle({ fillStyle: 'transparent', strokeStyle: 'transparent' })
  }
  return rest
}

function getOpeningNotePaddingPx(keySignature: string | null): number {
  return FIRST_MEASURE_NOTE_GUTTER_PX + getKeySignatureAccidentalCount(keySignature) * 3
}

function isBeamableNote(event: EngravingEvent): boolean {
  return event.kind === 'note' && !event.renderNote?.note.is_rest && event.duration.beats <= 0.5
}

function getBeamableGroups(staveNotes: StaveNote[], events: EngravingEvent[]): StaveNote[][] {
  const groups: StaveNote[][] = []
  let currentGroup: StaveNote[] = []
  const flushGroup = () => {
    if (currentGroup.length >= 2) {
      groups.push(currentGroup)
    }
    currentGroup = []
  }

  events.forEach((event, index) => {
    if (!isBeamableNote(event)) {
      flushGroup()
      return
    }
    currentGroup.push(staveNotes[index])
  })
  flushGroup()

  return groups
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
    getBeamableGroups(staveNotes, events).forEach((group) => {
      Beam.generateBeams(group, {
        beamRests: false,
        flatBeams: true,
        groups: [new Fraction(1, 4)],
        maintainStemDirections: false,
        showStemlets: false,
      }).forEach((beam) => {
        beam.setContext(context).draw()
      })
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
  const clefProfile = getTrackClefProfile(track)
  const clef = clefProfile.vexClef
  const defaultDisplayOctaveShift = getDefaultDisplayOctaveShift(track, clefProfile)
  const keySignature = getTrackKeySignature(track)
  const measureCount = Math.max(scoreModel.measureCount, engravingModel.measureCount, sharedMeasureWidths.length)
  const engravingLayout = useMemo(
    () => buildEngravingLayout(engravingModel.notes, measureCount, beatsPerMeasure, sharedMeasureWidths, keySignature),
    [beatsPerMeasure, engravingModel.notes, keySignature, measureCount, sharedMeasureWidths],
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
        stave.addClef(clefProfile.vexClef, undefined, clefProfile.annotation)
        if (keySignature) {
          try {
            stave.addKeySignature(keySignature)
          } catch {
            // Unknown imported key signatures should not block score rendering.
          }
        }
      }
      stave.setMeasure(measure.measureNumber)
      if (measure.measureIndex === 0) {
        const noteStartX = stave.getNoteStartX()
        stave.setNoteStartX(noteStartX + getOpeningNotePaddingPx(keySignature))
      }
      stave.setContext(context).draw()

      const staveNotes: StaveNote[] = []
      const drawnMeasureNotes: DrawnNote[] = []

      measure.events.forEach((event) => {
        const staveNote =
          event.kind === 'rest' || event.renderNote === null
            ? createRest(event.duration, clef, event.hidden)
            : createStaveNote(event.renderNote.note, event.duration, clef, defaultDisplayOctaveShift)
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
  }, [
    beatsPerMeasure,
    clef,
    clefProfile.annotation,
    clefProfile.vexClef,
    defaultDisplayOctaveShift,
    engravingLayout,
    keySignature,
    scoreWidth,
    syncShiftPx,
    track.name,
  ])

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
