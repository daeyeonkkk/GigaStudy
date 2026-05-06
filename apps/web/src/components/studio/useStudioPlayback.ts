import { useEffect, useRef, useState } from 'react'

import { getTrackAudioUrl } from '../../lib/api'
import {
  DEFAULT_MELODIC_INSTRUMENT,
  DEFAULT_PERCUSSION_INSTRUMENT,
  DEFAULT_SYNC_STEP_SECONDS,
  STUDIO_TIME_PRECISION_SECONDS,
  disposePlaybackSession,
  formatTrackName,
  getCachedDecodedAudioBuffer,
  getPlaybackPreparationMessage,
  getRegionsTimelineEndSeconds,
  getSharedPlaybackAudioContext,
  getSixteenthNoteSeconds,
  getTrackVolumeScale,
  getVolumeScaleFromPercent,
  loadCustomGuideInstrument,
  startLoopingMetronomeSession,
  startPlaybackEngineSession,
  type MeterContext,
  type PlaybackEngineAudioTrack,
  type PlaybackEngineEvent,
  type PlaybackEngineEventTrack,
  type PlaybackInstrument,
  type PlaybackRoute,
  type PlaybackSession,
  type PlaybackSourceMode,
} from '../../lib/studio'
import type { Studio, TrackSlot } from '../../types/studio'
import type { SetStudioActionState } from './studioActionState'
import {
  buildPlaybackTrackPlan,
  getAudioTrackSchedule,
  getMaxBeatFromRegions,
  getPitchEventSchedule,
  getPlaybackRegionsBySlot,
  getSustainedPitchEvents,
} from './studioPlaybackHelpers'

type PlaybackTimeline = {
  audioContext?: AudioContext
  audioStartTime?: number
  maxSeconds: number
  minSeconds: number
  startSeconds: number
  startedAtMs: number
}

type PlaybackStartOptions = {
  onStartScheduled?: (scheduledStartAtMs: number) => void
  onScheduledStart?: () => void
  route?: PlaybackRoute
  scheduledStartAtMs?: number
  scheduledStartLeadMs?: number
  startSeconds?: number
}

type UseStudioPlaybackArgs = {
  metronomeEnabled: boolean
  registeredSlotIds: number[]
  registeredTracks: TrackSlot[]
  setActionState: SetStudioActionState
  studio: Studio | null
  studioMeter: MeterContext
}

const STABLE_GUIDE_TRACK_EVENT_THRESHOLD = 48

export function useStudioPlayback({
  metronomeEnabled,
  registeredSlotIds,
  registeredTracks,
  setActionState,
  studio,
  studioMeter,
}: UseStudioPlaybackArgs) {
  const [playbackSource, setPlaybackSource] = useState<PlaybackSourceMode>('audio')
  const [playbackPickerOpen, setPlaybackPickerOpen] = useState(false)
  const [selectedPlaybackSlotIds, setSelectedPlaybackSlotIds] = useState<Set<number>>(() => new Set())
  const [syncStepSeconds, setSyncStepSeconds] = useState(DEFAULT_SYNC_STEP_SECONDS)
  const [globalPlaying, setGlobalPlaying] = useState(false)
  const [playingSlots, setPlayingSlots] = useState<Set<number>>(() => new Set())
  const [playbackTimeline, setPlaybackTimeline] = useState<PlaybackTimeline | null>(null)
  const [playheadSeconds, setPlayheadSeconds] = useState<number | null>(null)
  const playbackSessionRef = useRef<PlaybackSession | null>(null)
  const playbackTrackGainsRef = useRef<Map<number, GainNode>>(new Map())
  const playbackRunIdRef = useRef(0)
  const stopPlaybackSessionRef = useRef<() => void>(() => undefined)

  function disposeCurrentPlaybackSession() {
    disposePlaybackSession(playbackSessionRef.current)
    playbackSessionRef.current = null
    playbackTrackGainsRef.current = new Map()
    setPlaybackTimeline(null)
    setPlayheadSeconds(null)
  }

  function clearPlaybackIndicators() {
    setGlobalPlaying(false)
    setPlayingSlots(new Set())
  }

  function stopPlaybackSession() {
    playbackRunIdRef.current += 1
    disposeCurrentPlaybackSession()
    clearPlaybackIndicators()
  }

  useEffect(() => {
    stopPlaybackSessionRef.current = stopPlaybackSession
  })

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden' || !playbackSessionRef.current) {
        return
      }
      stopPlaybackSessionRef.current()
      setActionState({
        phase: 'success',
        message: '브라우저가 백그라운드로 전환되어 재생을 안전하게 중지했습니다.',
      })
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [setActionState])

  useEffect(() => {
    return () => {
      playbackRunIdRef.current += 1
      disposePlaybackSession(playbackSessionRef.current)
      playbackSessionRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!playbackTimeline) {
      return undefined
    }

    let animationFrameId = 0
    const updatePlayhead = () => {
      const elapsedSeconds =
        playbackTimeline.audioContext &&
        playbackTimeline.audioContext.state !== 'closed' &&
        playbackTimeline.audioStartTime !== undefined
          ? Math.max(0, playbackTimeline.audioContext.currentTime - playbackTimeline.audioStartTime)
          : Math.max(0, (performance.now() - playbackTimeline.startedAtMs) / 1000)
      const nextPlayheadSeconds = Math.min(
        playbackTimeline.maxSeconds,
        playbackTimeline.startSeconds + elapsedSeconds,
      )
      setPlayheadSeconds(nextPlayheadSeconds)
      if (playbackTimeline.startSeconds + elapsedSeconds <= playbackTimeline.maxSeconds + 0.2) {
        animationFrameId = window.requestAnimationFrame(updatePlayhead)
      }
    }

    updatePlayhead()
    return () => {
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [playbackTimeline])

  useEffect(() => {
    setSelectedPlaybackSlotIds((current) => {
      const registeredSlotIdSet = new Set(registeredSlotIds)
      const retainedSlotIds = new Set(
        [...current].filter((slotId) => registeredSlotIdSet.has(slotId)),
      )
      if (current.size === 0 && registeredSlotIds.length > 0) {
        return new Set(registeredSlotIds)
      }
      if (retainedSlotIds.size === current.size) {
        return current
      }
      return retainedSlotIds
    })
  }, [registeredSlotIds])

  async function startPlaybackSession(
    tracksToPlay: TrackSlot[],
    includeMetronome = metronomeEnabled,
    options: PlaybackStartOptions = {},
  ): Promise<boolean> {
    if (!studio) {
      return false
    }

    const regionsBySlot = getPlaybackRegionsBySlot(studio.regions)
    const { audioTracks, eventTracks, playableTracks } = buildPlaybackTrackPlan(
      tracksToPlay,
      playbackSource,
      regionsBySlot,
    )
    if (playableTracks.length === 0) {
      setActionState({ phase: 'error', message: '재생 가능한 등록 트랙이 없습니다.' })
      return false
    }

    const runId = playbackRunIdRef.current + 1
    playbackRunIdRef.current = runId
    disposeCurrentPlaybackSession()

    const beatSeconds = 60 / studio.bpm
    const eventPrecisionSeconds = STUDIO_TIME_PRECISION_SECONDS
    const eventGridUnitSeconds = getSixteenthNoteSeconds(studio.bpm, studioMeter)
    const minTimelineSeconds = Math.min(
      0,
      ...playableTracks.map((track) => track.sync_offset_seconds),
    )
    const startSeconds = Math.max(minTimelineSeconds, options.startSeconds ?? minTimelineSeconds)
    const needsAudioContext = audioTracks.length > 0 || eventTracks.length > 0 || includeMetronome
    let context: AudioContext | null = null
    let timelineEndSeconds = Math.max(startSeconds, minTimelineSeconds + 0.25)
    let maxBeat = 1
    const trackVolumeGains = new Map<number, GainNode>()

    if (needsAudioContext) {
      try {
        context = await getSharedPlaybackAudioContext()
      } catch {
        context = null
      }
      if (!context) {
        setActionState({ phase: 'error', message: '이 브라우저에서는 재생용 오디오 장치를 열 수 없습니다.' })
        return false
      }
    }

    const activeContext = context
    const disposePreparedGains = () => {
      trackVolumeGains.forEach((gain) => {
        try {
          gain.disconnect()
        } catch {
          return
        }
      })
      trackVolumeGains.clear()
    }
    const getTrackOutput = (track: TrackSlot): AudioNode | null => {
      if (!activeContext) {
        return null
      }
      const existingGain = trackVolumeGains.get(track.slot_id)
      if (existingGain) {
        return existingGain
      }
      const trackGain = activeContext.createGain()
      trackGain.gain.setValueAtTime(getTrackVolumeScale(track), activeContext.currentTime)
      trackGain.connect(activeContext.destination)
      trackVolumeGains.set(track.slot_id, trackGain)
      return trackGain
    }

    try {
      let scheduledAnyTrack = false
      const audioTrackVolume = Math.max(0.28, Math.min(0.72, 0.72 / Math.sqrt(playableTracks.length)))
      const eventToneVolume =
        Math.max(0.5, Math.min(0.95, 0.95 / Math.sqrt(Math.max(1, eventTracks.length)))) * 0.4
      const preparedAudioTracks: PlaybackEngineAudioTrack[] = []
      const preparedEventTracks: PlaybackEngineEventTrack[] = []
      let melodicInstrument: PlaybackInstrument = DEFAULT_MELODIC_INSTRUMENT
      const eventPitchCount = eventTracks.reduce(
        (sum, track) =>
          sum + (regionsBySlot.get(track.slot_id)?.reduce(
            (trackSum, region) => trackSum + region.pitch_events.length,
            0,
          ) ?? 0),
        0,
      )
      const preferStableGuidePlayback =
        eventTracks.length > 1 || eventPitchCount >= STABLE_GUIDE_TRACK_EVENT_THRESHOLD

      if (audioTracks.length > 0) {
        if (!activeContext) {
          throw new Error('오디오 재생 장치를 준비하지 못했습니다.')
        }
        const requiresSynchronizedStart = audioTracks.length > 1 || eventTracks.length > 0 || includeMetronome
        const synchronizedParts = [
          `오디오 ${audioTracks.length}개`,
          eventTracks.length > 0 ? `연주음 ${eventTracks.length}개` : null,
          includeMetronome ? '메트로놈' : null,
        ].filter(Boolean)
        setActionState({
          phase: 'busy',
          message:
            requiresSynchronizedStart
              ? `${synchronizedParts.join(', ')}를 같은 오디오 시계에 맞춰 준비하는 중입니다.`
              : '오디오 파일을 재생 준비하는 중입니다.',
        })

        const decodedAudioTracks = await Promise.all(
          audioTracks.map(async (track) => {
            const audioUrl = getTrackAudioUrl(studio.studio_id, track.slot_id)
            const cacheKey = [
              studio.studio_id,
              track.slot_id,
              track.audio_source_path ?? track.audio_source_label ?? 'audio',
              track.updated_at,
            ].join(':')
            const buffer = await getCachedDecodedAudioBuffer(activeContext, cacheKey, audioUrl)
            return {
              buffer,
              track,
              trackStartSeconds: track.sync_offset_seconds,
            }
          }),
        )

        decodedAudioTracks.forEach(({ buffer, track, trackStartSeconds }) => {
          const trackSchedule = getAudioTrackSchedule({
            bufferDurationSeconds: buffer.duration,
            scheduledStart: 0,
            startSeconds,
            trackStartSeconds,
          })
          const destination = getTrackOutput(track)
          if (!destination) {
            return
          }
          preparedAudioTracks.push({
            buffer,
            destination,
            relativeStartSeconds: trackSchedule.relativeStartSeconds,
            sourceOffsetSeconds: trackSchedule.sourceOffsetSeconds,
            timelineEndSeconds: trackSchedule.timelineEndSeconds,
            volume: audioTrackVolume,
          })
          const trackRegions = regionsBySlot.get(track.slot_id)
          const trackEndSeconds = Math.max(
            trackSchedule.timelineEndSeconds,
            getRegionsTimelineEndSeconds(trackRegions) || trackSchedule.timelineEndSeconds,
          )
          timelineEndSeconds = Math.max(timelineEndSeconds, trackEndSeconds)
          maxBeat = Math.max(maxBeat, Math.ceil(trackEndSeconds / beatSeconds) + 1)
          maxBeat = getMaxBeatFromRegions(trackRegions, maxBeat)
          scheduledAnyTrack = true
        })

        if (requiresSynchronizedStart && playbackRunIdRef.current === runId) {
          setActionState({
            phase: 'busy',
            message: `${synchronizedParts.join(', ')}를 재생 타임라인에 정렬하는 중입니다.`,
          })
        }
      }

      if (playbackRunIdRef.current !== runId) {
        disposePreparedGains()
        return false
      }

      if (eventTracks.length > 0 && activeContext && !preferStableGuidePlayback) {
        try {
          const customInstrument = await loadCustomGuideInstrument(activeContext)
          melodicInstrument = customInstrument ?? DEFAULT_MELODIC_INSTRUMENT
        } catch {
          melodicInstrument = DEFAULT_MELODIC_INSTRUMENT
        }
      }

      eventTracks.forEach((track) => {
        const trackRegions = regionsBySlot.get(track.slot_id)
        if (!trackRegions?.length) {
          return
        }
        if (!activeContext) {
          maxBeat = getMaxBeatFromRegions(trackRegions, maxBeat)
          return
        }

        const isPercussion = track.slot_id === 6
        maxBeat = getMaxBeatFromRegions(trackRegions, maxBeat)
        const destination = getTrackOutput(track)
        if (!destination) {
          return
        }
        const trackPitchEvents = trackRegions.flatMap((region) => region.pitch_events)
        const scheduledPitchEvents = getSustainedPitchEvents(
          trackPitchEvents,
          isPercussion,
          eventPrecisionSeconds,
          track.slot_id,
        )
        const engineEvents: PlaybackEngineEvent[] = []
        scheduledPitchEvents.forEach(({ durationSeconds, frequency, startSeconds: eventStartSeconds }, eventIndex) => {
          const eventEndSeconds = eventStartSeconds + durationSeconds
          const nextPitchEvent = scheduledPitchEvents[eventIndex + 1]
          const nextGapSeconds = nextPitchEvent
            ? Math.max(0, nextPitchEvent.startSeconds - eventEndSeconds)
            : undefined
          timelineEndSeconds = Math.max(timelineEndSeconds, eventEndSeconds)
          const eventSchedule = getPitchEventSchedule({
            durationSeconds,
            eventStartSeconds,
            precisionSeconds: eventPrecisionSeconds,
            scheduledStart: 0,
            startSeconds,
          })
          if (!eventSchedule) {
            return
          }
          engineEvents.push({
            destination,
            durationSeconds: eventSchedule.remainingDurationSeconds,
            frequency,
            gridUnitSeconds: eventGridUnitSeconds,
            instrument: isPercussion ? DEFAULT_PERCUSSION_INSTRUMENT : melodicInstrument,
            nextGapSeconds,
            relativeStartSeconds: eventSchedule.relativeStartSeconds,
            volume: isPercussion ? Math.min(0.2, eventToneVolume * 0.45) : eventToneVolume,
          })
          scheduledAnyTrack = true
        })
        if (engineEvents.length > 0) {
          preparedEventTracks.push({
            events: engineEvents,
            slotId: track.slot_id,
          })
        }
      })

      if (!scheduledAnyTrack) {
        disposePreparedGains()
        setActionState({ phase: 'error', message: '재생 가능한 오디오나 연주음이 없습니다.' })
        return false
      }

      if (includeMetronome) {
        timelineEndSeconds = Math.max(timelineEndSeconds, maxBeat * beatSeconds)
      }

      const engineResult = await startPlaybackEngineSession({
        audioTracks: preparedAudioTracks,
        bpm: studio.bpm,
        eventTracks: preparedEventTracks,
        includeMetronome,
        maxBeat,
        meter: studioMeter,
        minTimelineSeconds,
        onScheduledStart: () => {
          if (playbackRunIdRef.current === runId) {
            options.onScheduledStart?.()
          }
        },
        onStartScheduled: (scheduledStartAtMs) => {
          if (playbackRunIdRef.current === runId) {
            options.onStartScheduled?.(scheduledStartAtMs)
          }
        },
        route: options.route ?? 'studio',
        scheduledStartAtMs: options.scheduledStartAtMs,
        scheduledStartLeadMs: options.scheduledStartLeadMs,
        startSeconds,
        timelineEndSeconds,
      })

      if (playbackRunIdRef.current !== runId) {
        disposePlaybackSession(engineResult.session)
        disposePreparedGains()
        return false
      }

      const playbackSession = engineResult.session
      trackVolumeGains.forEach((gain) => playbackSession.nodes.push({ gain }))
      const sessionDurationSeconds = Math.max(0.1, engineResult.maxTimelineSeconds - startSeconds + 0.45)
      const clearUiTimeoutId = window.setTimeout(() => {
        if (playbackSessionRef.current !== playbackSession) {
          return
        }

        disposePlaybackSession(playbackSession)
        playbackSessionRef.current = null
        playbackTrackGainsRef.current = new Map()
        setPlaybackTimeline(null)
        setPlayheadSeconds(null)
        clearPlaybackIndicators()
      }, Math.ceil(Math.max(0, engineResult.scheduledStartAtMs - performance.now()) + sessionDurationSeconds * 1000))

      playbackSession.timeoutIds.push(clearUiTimeoutId)
      playbackSessionRef.current = playbackSession
      playbackTrackGainsRef.current = trackVolumeGains
      setPlaybackTimeline({
        audioContext: engineResult.session.context,
        audioStartTime: engineResult.scheduledStartTime,
        maxSeconds: engineResult.maxTimelineSeconds,
        minSeconds: engineResult.minTimelineSeconds,
        startSeconds: engineResult.startSeconds,
        startedAtMs: engineResult.scheduledStartAtMs,
      })
      return true
    } catch (error) {
      disposePreparedGains()
      setActionState({
        phase: 'error',
        message:
          error instanceof Error && error.message.trim()
            ? error.message
            : '재생을 시작하지 못했습니다.',
      })
      return false
    }
  }

  function togglePlaybackSelection(slotId: number) {
    setSelectedPlaybackSlotIds((current) => {
      const next = new Set(current)
      if (next.has(slotId)) {
        next.delete(slotId)
      } else {
        next.add(slotId)
      }
      return next
    })
  }

  function selectAllPlaybackTracks() {
    setSelectedPlaybackSlotIds(new Set(registeredSlotIds))
  }

  function openPlaybackPicker() {
    if (registeredTracks.length === 0) {
      setPlaybackPickerOpen(true)
      setActionState({ phase: 'error', message: '재생할 등록 트랙이 없습니다.' })
      return
    }
    setSelectedPlaybackSlotIds(new Set(registeredSlotIds))
    setPlaybackPickerOpen(true)
    setActionState({ phase: 'success', message: '동시에 재생할 트랙을 선택하세요.' })
  }

  function updateSyncStep(nextStepSeconds: number) {
    if (!Number.isFinite(nextStepSeconds) || nextStepSeconds <= 0) {
      return
    }
    setSyncStepSeconds(Math.round(Math.min(10, Math.max(0.001, nextStepSeconds)) * 1000) / 1000)
  }

  function getSelectedPlaybackTracks(): TrackSlot[] {
    if (!studio) {
      return []
    }
    return studio.tracks.filter(
      (track) => track.status === 'registered' && selectedPlaybackSlotIds.has(track.slot_id),
    )
  }

  async function startSelectedPlayback(startSeconds?: number) {
    const selectedTracks = getSelectedPlaybackTracks()
    if (selectedTracks.length === 0) {
      setPlaybackPickerOpen(true)
      setActionState({ phase: 'error', message: '동시 재생할 등록 트랙을 하나 이상 선택하세요.' })
      return
    }

    setActionState({
      phase: 'busy',
      message: getPlaybackPreparationMessage(
        selectedTracks,
        metronomeEnabled,
        playbackSource,
        getPlaybackRegionsBySlot(studio?.regions),
      ),
    })
    if (await startPlaybackSession(selectedTracks, metronomeEnabled, { startSeconds, route: 'studio' })) {
      setPlaybackPickerOpen(true)
      setPlayingSlots(new Set(selectedTracks.map((track) => track.slot_id)))
      setGlobalPlaying(true)
      setActionState({
        phase: 'success',
        message:
          playbackSource === 'audio'
            ? `${selectedTracks.length}개 트랙을 원음 우선으로 재생합니다.`
            : `${selectedTracks.length}개 트랙을 연주음만으로 재생합니다.`,
      })
    }
  }

  async function toggleGlobalPlayback() {
    if (globalPlaying) {
      stopPlaybackSession()
      setActionState({ phase: 'success', message: '선택 재생을 멈췄습니다.' })
      return
    }

    if (registeredTracks.length === 0) {
      setActionState({ phase: 'error', message: '재생할 등록 트랙이 없습니다.' })
      return
    }

    let selectedTracks = getSelectedPlaybackTracks()
    if (selectedTracks.length === 0) {
      selectedTracks = registeredTracks
      setSelectedPlaybackSlotIds(new Set(registeredTracks.map((track) => track.slot_id)))
    }

    setPlaybackPickerOpen(true)
    setActionState({
      phase: 'busy',
      message: getPlaybackPreparationMessage(
        selectedTracks,
        metronomeEnabled,
        playbackSource,
        getPlaybackRegionsBySlot(studio?.regions),
      ),
    })
    if (await startPlaybackSession(selectedTracks, metronomeEnabled, { route: 'studio' })) {
      setPlayingSlots(new Set(selectedTracks.map((track) => track.slot_id)))
      setGlobalPlaying(true)
      setActionState({
        phase: 'success',
        message:
          playbackSource === 'audio'
            ? `${selectedTracks.length}개 트랙을 원음 우선으로 재생합니다.`
            : `${selectedTracks.length}개 트랙을 연주음만으로 재생합니다.`,
      })
    }
  }

  function seekSelectedPlayback(nextSeconds: number) {
    if (!globalPlaying || !playbackTimeline) {
      return
    }
    const clampedSeconds = Math.max(
      playbackTimeline.minSeconds,
      Math.min(playbackTimeline.maxSeconds, nextSeconds),
    )
    void startSelectedPlayback(clampedSeconds)
  }

  function stopGlobalPlayback() {
    stopPlaybackSession()
    setActionState({
      phase: 'success',
      message: '선택 트랙 재생을 중지했습니다.',
    })
  }

  function changePlaybackSource(nextSource: PlaybackSourceMode) {
    if (nextSource === playbackSource) {
      return
    }
    stopPlaybackSession()
    setPlaybackSource(nextSource)
    setActionState({
      phase: 'success',
      message: nextSource === 'audio' ? '재생 방식을 원음 우선으로 바꿨습니다.' : '재생 방식을 연주음만으로 바꿨습니다.',
    })
  }

  async function toggleTrackPlayback(track: TrackSlot) {
    if (track.status !== 'registered') {
      setActionState({ phase: 'error', message: `${formatTrackName(track.name)}는 아직 등록되지 않았습니다.` })
      return
    }

    if (playingSlots.has(track.slot_id)) {
      stopPlaybackSession()
      setActionState({ phase: 'success', message: `${formatTrackName(track.name)} 재생을 멈췄습니다.` })
      return
    }

    setActionState({
      phase: 'busy',
      message: getPlaybackPreparationMessage([track], metronomeEnabled, playbackSource, getPlaybackRegionsBySlot(studio?.regions)),
    })
    if (await startPlaybackSession([track], metronomeEnabled, { route: 'studio' })) {
      setGlobalPlaying(false)
      setPlayingSlots(new Set([track.slot_id]))
      setActionState({
        phase: 'success',
        message:
          playbackSource === 'audio' && track.audio_source_path
            ? `${formatTrackName(track.name)} 원음을 재생합니다.`
            : `${formatTrackName(track.name)} 연주음을 재생합니다.`,
      })
    }
  }

  function stopTrackPlayback(track: TrackSlot) {
    stopPlaybackSession()
    setActionState({
      phase: 'success',
      message: `${formatTrackName(track.name)} 재생을 중지했습니다.`,
    })
  }

  function markReferencePlayback(slotIds: number[]) {
    setGlobalPlaying(false)
    setPlayingSlots(new Set(slotIds))
  }

  function startMetronomeOnlyPlayback(): boolean {
    if (!studio) {
      return false
    }
    stopPlaybackSession()
    const metronomeSession = startLoopingMetronomeSession(studio.bpm, studioMeter)
    if (!metronomeSession) {
      return false
    }
    playbackSessionRef.current = metronomeSession
    clearPlaybackIndicators()
    return true
  }

  function setActiveTrackVolume(slotId: number, volumePercent: number) {
    const activeTrackGain = playbackTrackGainsRef.current.get(slotId)
    if (!activeTrackGain) {
      return
    }
    const currentTime = activeTrackGain.context.currentTime
    activeTrackGain.gain.cancelScheduledValues(currentTime)
    activeTrackGain.gain.setTargetAtTime(getVolumeScaleFromPercent(volumePercent), currentTime, 0.015)
  }

  return {
    changePlaybackSource,
    globalPlaying,
    markReferencePlayback,
    openPlaybackPicker,
    playbackPickerOpen,
    playbackSource,
    playbackTimeline,
    playingSlots,
    playheadSeconds,
    seekSelectedPlayback,
    selectAllPlaybackTracks,
    selectedPlaybackSlotIds,
    setActiveTrackVolume,
    startMetronomeOnlyPlayback,
    startPlaybackSession,
    startSelectedPlayback,
    stopGlobalPlayback,
    stopPlaybackSession,
    stopTrackPlayback,
    syncStepSeconds,
    toggleGlobalPlayback,
    togglePlaybackSelection,
    toggleTrackPlayback,
    updateSyncStep,
  }
}
