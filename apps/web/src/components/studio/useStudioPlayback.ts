import { useEffect, useRef, useState } from 'react'

import { getTrackAudioUrl } from '../../lib/api'
import { getBrowserAudioContextConstructor } from '../../lib/audio'
import {
  createAudioBufferPlayback,
  createInstrumentPlayback,
  DEFAULT_MELODIC_INSTRUMENT,
  DEFAULT_PERCUSSION_INSTRUMENT,
  disposePlaybackSession,
  fetchAudioArrayBuffer,
  formatTrackName,
  getPlaybackPreparationMessage,
  getRegionsTimelineEndSeconds,
  getTrackVolumeScale,
  getVolumeScaleFromPercent,
  loadCustomGuideInstrument,
  scheduleMetronomeClicksFromTimeline,
  startLoopingMetronomeSession,
  type MeterContext,
  type PlaybackInstrument,
  type PlaybackNode,
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
  maxSeconds: number
  minSeconds: number
  startSeconds: number
  startedAtMs: number
}

type PlaybackStartOptions = {
  onStartScheduled?: (scheduledStartAtMs: number) => void
  onScheduledStart?: () => void
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
  const [syncStepSeconds, setSyncStepSeconds] = useState(0.01)
  const [globalPlaying, setGlobalPlaying] = useState(false)
  const [playingSlots, setPlayingSlots] = useState<Set<number>>(() => new Set())
  const [playbackTimeline, setPlaybackTimeline] = useState<PlaybackTimeline | null>(null)
  const [playheadSeconds, setPlayheadSeconds] = useState<number | null>(null)
  const playbackSessionRef = useRef<PlaybackSession | null>(null)
  const playbackTrackGainsRef = useRef<Map<number, GainNode>>(new Map())
  const playbackRunIdRef = useRef(0)

  function primeAudioContext(context: AudioContext) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const startTime = context.currentTime + 0.005
    gain.gain.setValueAtTime(0.0001, startTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.02)
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(440, startTime)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(startTime)
    oscillator.stop(startTime + 0.025)
  }

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
      const elapsedSeconds = (performance.now() - playbackTimeline.startedAtMs) / 1000
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
      setActionState({ phase: 'error', message: '재생할 수 있는 등록 트랙이 없습니다.' })
      return false
    }

    const runId = playbackRunIdRef.current + 1
    playbackRunIdRef.current = runId

    disposeCurrentPlaybackSession()

    const beatSeconds = 60 / studio.bpm
    const minTimelineSeconds = Math.min(
      0,
      ...playableTracks.map((track) => track.sync_offset_seconds),
    )
    const startSeconds = Math.max(minTimelineSeconds, options.startSeconds ?? minTimelineSeconds)
    const minimumStartDelaySeconds = 0.08
    const needsAudioContext = audioTracks.length > 0 || eventTracks.length > 0 || includeMetronome
    const nodes: PlaybackNode[] = []
    const timeoutIds: number[] = []
    let latestStop = 0
    let timelineEndSeconds = Math.max(startSeconds, minTimelineSeconds + 0.25)
    let maxBeat = 1
    let context: AudioContext | undefined
    let playbackStartAtMs = performance.now() + minimumStartDelaySeconds * 1000
    let scheduledStart = 0
    let scheduledStartDelaySeconds = minimumStartDelaySeconds
    const trackVolumeGains = new Map<number, GainNode>()

    const AudioContextConstructor = getBrowserAudioContextConstructor()
    if (needsAudioContext) {
      if (!AudioContextConstructor) {
        setActionState({ phase: 'error', message: '연주음이나 메트로놈을 재생할 오디오 장치를 열 수 없습니다.' })
        return false
      }
      try {
        context = new AudioContextConstructor()
        scheduledStart = context.currentTime + minimumStartDelaySeconds
        primeAudioContext(context)
        await context.resume()
      } catch {
        setActionState({ phase: 'error', message: '오디오 장치를 열 수 없습니다. 브라우저 권한을 확인하세요.' })
        return false
      }
    }

    try {
      let scheduledAnyTrack = false
      const audioTrackVolume = Math.max(0.28, Math.min(0.72, 0.72 / Math.sqrt(playableTracks.length)))
      const eventToneVolume =
        Math.max(0.5, Math.min(0.95, 0.95 / Math.sqrt(Math.max(1, eventTracks.length)))) * 0.4
      const activeContext = context
      const preparedAudioTracks: Array<{ buffer: AudioBuffer; track: TrackSlot; trackStartSeconds: number }> = []
      let melodicInstrument: PlaybackInstrument = DEFAULT_MELODIC_INSTRUMENT

      function getTrackOutput(track: TrackSlot): AudioNode | null {
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
        nodes.push({ gain: trackGain })
        return trackGain
      }

      if (audioTracks.length > 0) {
        if (!activeContext) {
          throw new Error('원음 재생용 오디오 장치를 열 수 없습니다.')
        }
        const requiresSynchronizedStart = audioTracks.length > 1 || eventTracks.length > 0 || includeMetronome
        const synchronizedParts = [
          `원음 ${audioTracks.length}개`,
          eventTracks.length > 0 ? `음표 ${eventTracks.length}개` : null,
          includeMetronome ? '메트로놈' : null,
        ].filter(Boolean)
        setActionState({
          phase: 'busy',
          message:
            requiresSynchronizedStart
              ? `${synchronizedParts.join(', ')}를 한 번에 맞춰 재생하도록 불러오는 중입니다.`
              : '원음 파일을 바로 재생할 수 있게 불러오는 중입니다.',
        })
        const decodedAudioTracks = await Promise.all(
          audioTracks.map(async (track) => {
            const audioUrl = getTrackAudioUrl(studio.studio_id, track.slot_id)
            const arrayBuffer = await fetchAudioArrayBuffer(audioUrl)
            const buffer = await activeContext.decodeAudioData(arrayBuffer.slice(0))
            return {
              buffer,
              track,
              trackStartSeconds: track.sync_offset_seconds,
            }
          }),
        )
        preparedAudioTracks.push(...decodedAudioTracks)
        if (requiresSynchronizedStart && playbackRunIdRef.current === runId) {
          setActionState({
            phase: 'busy',
            message: `${synchronizedParts.join(', ')}를 같은 박자 그리드에 정렬하는 중입니다.`,
          })
        }
      }

      if (playbackRunIdRef.current !== runId) {
        disposePlaybackSession({ context, nodes, timeoutIds })
        return false
      }

      if (eventTracks.length > 0 && activeContext) {
        try {
          const customInstrument = await loadCustomGuideInstrument(activeContext)
          melodicInstrument = customInstrument ?? DEFAULT_MELODIC_INSTRUMENT
        } catch {
          melodicInstrument = DEFAULT_MELODIC_INSTRUMENT
        }
      }

      scheduledStartDelaySeconds = Math.max(
        minimumStartDelaySeconds,
        options.scheduledStartLeadMs !== undefined
          ? options.scheduledStartLeadMs / 1000
          : options.scheduledStartAtMs
            ? (options.scheduledStartAtMs - performance.now()) / 1000
            : minimumStartDelaySeconds,
      )
      playbackStartAtMs = performance.now() + scheduledStartDelaySeconds * 1000
      scheduledStart = activeContext ? activeContext.currentTime + scheduledStartDelaySeconds : 0
      if (activeContext) {
        await activeContext.resume()
        if (activeContext.state !== 'running') {
          throw new Error('브라우저 오디오가 아직 시작되지 않았습니다. 재생 버튼을 다시 눌러주세요.')
        }
      }
      options.onStartScheduled?.(playbackStartAtMs)

      preparedAudioTracks.forEach(({ buffer, track, trackStartSeconds }) => {
        if (!activeContext) {
          return
        }
        const trackSchedule = getAudioTrackSchedule({
          bufferDurationSeconds: buffer.duration,
          scheduledStart,
          startSeconds,
          trackStartSeconds,
        })
        const node = createAudioBufferPlayback(
          activeContext,
          buffer,
          trackSchedule.scheduledStartSeconds,
          trackSchedule.sourceOffsetSeconds,
          audioTrackVolume,
          getTrackOutput(track) ?? activeContext.destination,
        )
        if (!node) {
          return
        }
        nodes.push(node)
        const trackRegions = regionsBySlot.get(track.slot_id)
        const trackEndSeconds = Math.max(
          trackSchedule.timelineEndSeconds,
          getRegionsTimelineEndSeconds(trackRegions) || trackSchedule.timelineEndSeconds,
        )
        latestStop = Math.max(
          latestStop,
          Math.max(0, trackEndSeconds - startSeconds),
        )
        timelineEndSeconds = Math.max(timelineEndSeconds, trackEndSeconds)
        maxBeat = Math.max(maxBeat, Math.ceil(trackEndSeconds / beatSeconds) + 1)
        scheduledAnyTrack = true

        maxBeat = getMaxBeatFromRegions(trackRegions, maxBeat)
      })

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
        trackRegions.forEach((region) => {
          getSustainedPitchEvents(region.pitch_events, isPercussion, track.slot_id).forEach(({ durationSeconds, frequency, startSeconds: eventStartSeconds }) => {
            const duration = durationSeconds
            const eventEndSeconds = eventStartSeconds + duration
            timelineEndSeconds = Math.max(timelineEndSeconds, eventEndSeconds)
            const eventSchedule = getPitchEventSchedule({
              durationSeconds: duration,
              eventStartSeconds,
              scheduledStart,
              startSeconds,
            })
            if (!eventSchedule) {
              return
            }
            nodes.push(
              createInstrumentPlayback(
                activeContext,
                {
                  destination: getTrackOutput(track) ?? activeContext.destination,
                  duration: eventSchedule.remainingDurationSeconds,
                  frequency,
                  instrument: isPercussion ? DEFAULT_PERCUSSION_INSTRUMENT : melodicInstrument,
                  startTime: eventSchedule.scheduledStartSeconds,
                  volume: isPercussion ? Math.min(0.2, eventToneVolume * 0.45) : eventToneVolume,
                },
              ),
            )
            latestStop = Math.max(
              latestStop,
              eventSchedule.relativeStartSeconds + eventSchedule.remainingDurationSeconds,
            )
            scheduledAnyTrack = true
          })
        })
      })

      if (!scheduledAnyTrack) {
        disposePlaybackSession({ context, nodes, timeoutIds })
        setActionState({ phase: 'error', message: '재생 가능한 녹음이나 음표가 없습니다.' })
        return false
      }

      if (includeMetronome && activeContext) {
        timelineEndSeconds = Math.max(timelineEndSeconds, maxBeat * beatSeconds)
        latestStop = Math.max(
          latestStop,
          scheduleMetronomeClicksFromTimeline(
            activeContext,
            nodes,
            scheduledStart,
            startSeconds,
            maxBeat,
            studio.bpm,
            studioMeter,
            0.035,
            studio.tempo_changes,
          ),
        )
      }
    } catch (error) {
      disposePlaybackSession({ context, nodes, timeoutIds })
      setActionState({
        phase: 'error',
        message:
          error instanceof Error && error.message.trim()
            ? error.message
            : '재생을 시작하지 못했습니다.',
      })
      return false
    }

    if (playbackRunIdRef.current !== runId) {
      disposePlaybackSession({ context, nodes, timeoutIds })
      return false
    }

    const playbackSession: PlaybackSession = { context, nodes, timeoutIds }
    const sessionDurationSeconds = Math.max(0.1, latestStop + 0.45)
    const timeoutId = window.setTimeout(() => {
      if (playbackSessionRef.current !== playbackSession) {
        return
      }

      disposePlaybackSession(playbackSession)
      playbackSessionRef.current = null
      setPlaybackTimeline(null)
      setPlayheadSeconds(null)
      clearPlaybackIndicators()
    }, Math.ceil((scheduledStartDelaySeconds + sessionDurationSeconds) * 1000))

    playbackSession.timeoutIds.push(timeoutId)
    playbackSessionRef.current = playbackSession
    playbackTrackGainsRef.current = trackVolumeGains
    if (options.onScheduledStart) {
      const scheduledStartCallbackId = window.setTimeout(() => {
        if (playbackSessionRef.current !== playbackSession || playbackRunIdRef.current !== runId) {
          return
        }
        options.onScheduledStart?.()
      }, Math.max(0, Math.round(playbackStartAtMs - performance.now())))
      playbackSession.timeoutIds.push(scheduledStartCallbackId)
    }
    setPlaybackTimeline({
      maxSeconds: Math.max(timelineEndSeconds, startSeconds + latestStop),
      minSeconds: minTimelineSeconds,
      startSeconds,
      startedAtMs: playbackStartAtMs,
    })
    return true
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
    if (await startPlaybackSession(selectedTracks, metronomeEnabled, { startSeconds })) {
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
    if (await startPlaybackSession(selectedTracks, metronomeEnabled)) {
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
      message: '선택 트랙을 싱크가 반영된 0초 지점으로 되돌렸습니다.',
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
      setActionState({ phase: 'error', message: `${formatTrackName(track.name)}은 아직 등록되지 않았습니다.` })
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
    if (await startPlaybackSession([track])) {
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
      message: `${formatTrackName(track.name)}을 싱크가 반영된 0초 지점으로 되돌렸습니다.`,
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
