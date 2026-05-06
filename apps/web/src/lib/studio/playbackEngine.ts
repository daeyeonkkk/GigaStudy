import { getBrowserAudioContextConstructor } from '../audio/audioContext'
import {
  createInstrumentPlayback,
  DEFAULT_MELODIC_INSTRUMENT,
  PERCUSSION_CLICK_INSTRUMENT,
  type PlaybackInstrument,
} from './instruments'
import {
  createAudioBufferPlayback,
  disposePlaybackNode,
  disposePlaybackSession,
  type PlaybackNode,
  type PlaybackSession,
} from './playback'
import {
  STUDIO_TIME_PRECISION_SECONDS,
  beatToSeconds,
  getBeatSeconds,
  isMeasureDownbeat,
  type MeterContext,
} from './timing'

export type PlaybackRoute = 'studio' | 'practice' | 'recording' | 'scoring'

export type PlaybackSchedulerProfileId = 'standard' | 'stable' | 'ultraStable'

export type PlaybackSchedulerProfile = {
  cleanupAfterSeconds: number
  id: PlaybackSchedulerProfileId
  lateEventThresholdSeconds: number
  minimumStartDelaySeconds: number
  scheduleAheadSeconds: number
  tickMilliseconds: number
  warmupWindowCount: number
}

export type PlaybackProfileInput = {
  durationSeconds: number
  eventCount: number
  isMobileLike?: boolean
  route?: PlaybackRoute
  trackCount: number
}

export type PlaybackEngineAudioTrack = {
  buffer: AudioBuffer
  destination?: AudioNode
  relativeStartSeconds: number
  sourceOffsetSeconds: number
  timelineEndSeconds: number
  volume: number
}

export type PlaybackEngineEvent = {
  destination?: AudioNode
  durationSeconds: number
  frequency: number
  gridUnitSeconds?: number
  instrument?: PlaybackInstrument
  nextGapSeconds?: number
  relativeStartSeconds: number
  volume: number
}

export type PlaybackEngineEventTrack = {
  events: PlaybackEngineEvent[]
  slotId: number
}

export type PlaybackEngineDiagnostics = {
  activeNodeCount: number
  lateEventCount: number
  profileId: PlaybackSchedulerProfileId
  scheduledEventCount: number
  scheduledWindowCount: number
}

export type PlaybackEngineStartRequest = {
  audioTracks: PlaybackEngineAudioTrack[]
  bpm: number
  eventTracks: PlaybackEngineEventTrack[]
  includeMetronome: boolean
  maxBeat: number
  meter: MeterContext
  minTimelineSeconds: number
  onScheduledStart?: () => void
  onStartScheduled?: (scheduledStartAtMs: number) => void
  route?: PlaybackRoute
  scheduledStartAtMs?: number
  scheduledStartLeadMs?: number
  startSeconds: number
  timelineEndSeconds: number
}

export type PlaybackEngineStartResult = {
  diagnostics: PlaybackEngineDiagnostics
  maxTimelineSeconds: number
  minTimelineSeconds: number
  scheduledStartAtMs: number
  scheduledStartTime: number
  session: PlaybackSession
  startSeconds: number
}

type ActiveScheduledNode = {
  disposeAfterTime: number
  node: PlaybackNode
}

const PLAYBACK_SCHEDULER_PROFILES: Record<PlaybackSchedulerProfileId, PlaybackSchedulerProfile> = {
  standard: {
    cleanupAfterSeconds: 4,
    id: 'standard',
    lateEventThresholdSeconds: 0.03,
    minimumStartDelaySeconds: 0.55,
    scheduleAheadSeconds: 1.25,
    tickMilliseconds: 100,
    warmupWindowCount: 1,
  },
  stable: {
    cleanupAfterSeconds: 5,
    id: 'stable',
    lateEventThresholdSeconds: 0.04,
    minimumStartDelaySeconds: 1.1,
    scheduleAheadSeconds: 3,
    tickMilliseconds: 160,
    warmupWindowCount: 1,
  },
  ultraStable: {
    cleanupAfterSeconds: 6,
    id: 'ultraStable',
    lateEventThresholdSeconds: 0.05,
    minimumStartDelaySeconds: 1.6,
    scheduleAheadSeconds: 4,
    tickMilliseconds: 200,
    warmupWindowCount: 2,
  },
}

let sharedPlaybackContext: AudioContext | null = null

export function getPlaybackSchedulerProfileConfig(
  profileId: PlaybackSchedulerProfileId,
): PlaybackSchedulerProfile {
  return PLAYBACK_SCHEDULER_PROFILES[profileId]
}

export function selectPlaybackSchedulerProfile({
  durationSeconds,
  eventCount,
  isMobileLike = detectMobileLikeRuntime(),
  route = 'studio',
  trackCount,
}: PlaybackProfileInput): PlaybackSchedulerProfile {
  const requiresUltraStable =
    trackCount >= 6 ||
    (durationSeconds >= 300 && trackCount >= 4) ||
    eventCount >= 1_200
  const requiresStable =
    isMobileLike ||
    route === 'recording' ||
    route === 'scoring' ||
    durationSeconds >= 300 ||
    trackCount >= 3 ||
    eventCount >= 300

  if (requiresUltraStable) {
    return PLAYBACK_SCHEDULER_PROFILES.ultraStable
  }
  if (requiresStable) {
    return PLAYBACK_SCHEDULER_PROFILES.stable
  }
  return PLAYBACK_SCHEDULER_PROFILES.standard
}

export function getWindowedPlaybackEvents<T extends { durationSeconds: number; relativeStartSeconds: number }>(
  events: T[],
  cursor: number,
  windowStartSeconds: number,
  windowEndSeconds: number,
): { events: T[]; nextCursor: number } {
  let nextCursor = Math.max(0, cursor)
  while (
    nextCursor < events.length &&
    events[nextCursor].relativeStartSeconds + events[nextCursor].durationSeconds <=
      windowStartSeconds + STUDIO_TIME_PRECISION_SECONDS
  ) {
    nextCursor += 1
  }

  const windowedEvents: T[] = []
  let scanIndex = nextCursor
  while (scanIndex < events.length && events[scanIndex].relativeStartSeconds <= windowEndSeconds) {
    windowedEvents.push(events[scanIndex])
    scanIndex += 1
  }
  return { events: windowedEvents, nextCursor: scanIndex }
}

export async function getSharedPlaybackAudioContext(): Promise<AudioContext | null> {
  if (sharedPlaybackContext && sharedPlaybackContext.state !== 'closed') {
    await sharedPlaybackContext.resume().catch(() => undefined)
    return sharedPlaybackContext
  }

  const AudioContextConstructor = getBrowserAudioContextConstructor()
  if (!AudioContextConstructor) {
    return null
  }

  sharedPlaybackContext = new AudioContextConstructor()
  primeAudioContext(sharedPlaybackContext)
  await sharedPlaybackContext.resume().catch(() => undefined)
  return sharedPlaybackContext
}

export async function startPlaybackEngineSession(
  request: PlaybackEngineStartRequest,
): Promise<PlaybackEngineStartResult> {
  const context = await getSharedPlaybackAudioContext()
  if (!context) {
    throw new Error('Audio playback is not available in this browser.')
  }
  if (context.state !== 'running') {
    await context.resume()
  }
  if (context.state !== 'running') {
    throw new Error('Audio playback is not ready yet. Please try again.')
  }

  const eventCount = request.eventTracks.reduce((sum, track) => sum + track.events.length, 0)
  const profile = selectPlaybackSchedulerProfile({
    durationSeconds: Math.max(0, request.timelineEndSeconds - request.startSeconds),
    eventCount,
    route: request.route,
    trackCount: request.audioTracks.length + request.eventTracks.length,
  })
  const requestedLeadSeconds =
    request.scheduledStartLeadMs !== undefined
      ? request.scheduledStartLeadMs / 1000
      : request.scheduledStartAtMs
        ? (request.scheduledStartAtMs - performance.now()) / 1000
        : 0
  const scheduledStartDelaySeconds = Math.max(profile.minimumStartDelaySeconds, requestedLeadSeconds)
  const scheduledStartTime = context.currentTime + scheduledStartDelaySeconds
  const scheduledStartAtMs = performance.now() + scheduledStartDelaySeconds * 1000
  const session: PlaybackSession = {
    closeContextOnDispose: false,
    context,
    nodes: [],
    timeoutIds: [],
  }
  const diagnostics: PlaybackEngineDiagnostics = {
    activeNodeCount: 0,
    lateEventCount: 0,
    profileId: profile.id,
    scheduledEventCount: 0,
    scheduledWindowCount: 0,
  }
  const activeNodes: ActiveScheduledNode[] = []
  let currentProfile = profile
  let timelineEndSeconds = request.timelineEndSeconds
  let latestRelativeStopSeconds = Math.max(0.1, timelineEndSeconds - request.startSeconds)

  const addManagedNode = (node: PlaybackNode | null, disposeAfterTime: number) => {
    if (!node) {
      return
    }
    session.nodes.push(node)
    activeNodes.push({ disposeAfterTime, node })
    diagnostics.activeNodeCount = activeNodes.length
  }

  const cleanupManagedNodes = () => {
    const retainNodes: ActiveScheduledNode[] = []
    for (const activeNode of activeNodes) {
      if (activeNode.disposeAfterTime < context.currentTime) {
        disposePlaybackNode(activeNode.node, context.currentTime)
        const sessionNodeIndex = session.nodes.indexOf(activeNode.node)
        if (sessionNodeIndex >= 0) {
          session.nodes.splice(sessionNodeIndex, 1)
        }
      } else {
        retainNodes.push(activeNode)
      }
    }
    activeNodes.length = 0
    activeNodes.push(...retainNodes)
    diagnostics.activeNodeCount = activeNodes.length
  }

  for (const audioTrack of request.audioTracks) {
    const startTime = scheduledStartTime + audioTrack.relativeStartSeconds
    const node = createAudioBufferPlayback(
      context,
      audioTrack.buffer,
      startTime,
      audioTrack.sourceOffsetSeconds,
      audioTrack.volume,
      audioTrack.destination ?? context.destination,
    )
    if (!node) {
      continue
    }
    const remainingDurationSeconds = Math.max(0, audioTrack.buffer.duration - audioTrack.sourceOffsetSeconds)
    addManagedNode(node, startTime + remainingDurationSeconds + currentProfile.cleanupAfterSeconds)
    latestRelativeStopSeconds = Math.max(
      latestRelativeStopSeconds,
      audioTrack.relativeStartSeconds + remainingDurationSeconds,
    )
    timelineEndSeconds = Math.max(timelineEndSeconds, audioTrack.timelineEndSeconds)
  }

  const eventTrackStates = request.eventTracks.map((track) => ({
    cursor: 0,
    events: track.events
      .filter(
        (event) =>
          Number.isFinite(event.relativeStartSeconds) &&
          Number.isFinite(event.durationSeconds) &&
          Number.isFinite(event.frequency) &&
          event.durationSeconds > 0,
      )
      .sort((left, right) => left.relativeStartSeconds - right.relativeStartSeconds),
    slotId: track.slotId,
  }))

  const metronomeState = createMetronomeSchedulerState(request)

  const maybeEscalateProfile = () => {
    if (diagnostics.lateEventCount < 8) {
      return
    }
    if (currentProfile.id === 'standard') {
      currentProfile = PLAYBACK_SCHEDULER_PROFILES.stable
    } else if (currentProfile.id === 'stable') {
      currentProfile = PLAYBACK_SCHEDULER_PROFILES.ultraStable
    }
    diagnostics.profileId = currentProfile.id
  }

  const scheduleEvent = (event: PlaybackEngineEvent, playbackRelativeNow: number) => {
    const eventEndRelativeSeconds = event.relativeStartSeconds + event.durationSeconds
    if (eventEndRelativeSeconds <= playbackRelativeNow + STUDIO_TIME_PRECISION_SECONDS) {
      diagnostics.lateEventCount += 1
      return
    }

    let startTime = scheduledStartTime + event.relativeStartSeconds
    let durationSeconds = event.durationSeconds
    const minimumStartTime = context.currentTime + 0.012
    if (startTime < context.currentTime + currentProfile.lateEventThresholdSeconds) {
      const trimSeconds = Math.max(0, minimumStartTime - startTime)
      startTime = minimumStartTime
      durationSeconds = Math.max(STUDIO_TIME_PRECISION_SECONDS, durationSeconds - trimSeconds)
      diagnostics.lateEventCount += 1
      maybeEscalateProfile()
    }

    const node = createInstrumentPlayback(context, {
      destination: event.destination ?? context.destination,
      duration: durationSeconds,
      frequency: event.frequency,
      gridUnitSeconds: event.gridUnitSeconds,
      instrument: event.instrument ?? DEFAULT_MELODIC_INSTRUMENT,
      nextGapSeconds: event.nextGapSeconds,
      startTime,
      volume: event.volume,
    })
    diagnostics.scheduledEventCount += 1
    addManagedNode(node, startTime + durationSeconds + currentProfile.cleanupAfterSeconds)
    latestRelativeStopSeconds = Math.max(latestRelativeStopSeconds, eventEndRelativeSeconds)
  }

  const scheduleMetronomeWindow = (windowEndSeconds: number, playbackRelativeNow: number) => {
    if (!metronomeState) {
      return
    }
    while (
      metronomeState.nextQuarterBeatOffset <= metronomeState.maxQuarterBeatOffset &&
      metronomeState.nextRelativeStartSeconds <= windowEndSeconds
    ) {
      const relativeStartSeconds = metronomeState.nextRelativeStartSeconds
      const nextClickEndSeconds = relativeStartSeconds + metronomeState.durationSeconds
      const frequency = isMeasureDownbeat(
        metronomeState.nextQuarterBeatOffset,
        request.meter.beatsPerMeasure,
      )
        ? 960
        : 720
      metronomeState.nextQuarterBeatOffset += request.meter.pulseQuarterBeats
      metronomeState.nextRelativeStartSeconds = getMetronomeRelativeStartSeconds(
        metronomeState.nextQuarterBeatOffset,
        request.bpm,
        request.startSeconds,
      )
      if (nextClickEndSeconds <= playbackRelativeNow - STUDIO_TIME_PRECISION_SECONDS) {
        diagnostics.lateEventCount += 1
        continue
      }
      scheduleEvent({
        durationSeconds: metronomeState.durationSeconds,
        frequency,
        instrument: PERCUSSION_CLICK_INSTRUMENT,
        relativeStartSeconds,
        volume: metronomeState.volume,
      }, playbackRelativeNow)
    }
  }

  const scheduleWindow = () => {
    if (context.state === 'closed') {
      return
    }
    const playbackRelativeNow = Math.max(0, context.currentTime - scheduledStartTime)
    const scheduleAheadSeconds =
      diagnostics.scheduledWindowCount === 0
        ? currentProfile.scheduleAheadSeconds * currentProfile.warmupWindowCount
        : currentProfile.scheduleAheadSeconds
    const windowEndSeconds = playbackRelativeNow + scheduleAheadSeconds

    diagnostics.scheduledWindowCount += 1
    for (const state of eventTrackStates) {
      const windowResult = getWindowedPlaybackEvents(
        state.events,
        state.cursor,
        playbackRelativeNow,
        windowEndSeconds,
      )
      state.cursor = windowResult.nextCursor
      windowResult.events.forEach((event) => scheduleEvent(event, playbackRelativeNow))
    }
    scheduleMetronomeWindow(windowEndSeconds, playbackRelativeNow)
    cleanupManagedNodes()

    const hasPendingEvents = eventTrackStates.some((state) => state.cursor < state.events.length)
    const hasPendingMetronome =
      metronomeState !== null &&
      metronomeState.nextQuarterBeatOffset <= metronomeState.maxQuarterBeatOffset
    const shouldContinue =
      hasPendingEvents ||
      hasPendingMetronome ||
      playbackRelativeNow <= latestRelativeStopSeconds + currentProfile.cleanupAfterSeconds
    if (shouldContinue) {
      session.timeoutIds.push(window.setTimeout(scheduleWindow, currentProfile.tickMilliseconds))
    }
  }

  scheduleWindow()
  request.onStartScheduled?.(scheduledStartAtMs)
  if (request.onScheduledStart) {
    session.timeoutIds.push(
      window.setTimeout(
        () => request.onScheduledStart?.(),
        Math.max(0, Math.round(scheduledStartAtMs - performance.now())),
      ),
    )
  }

  const sessionDurationSeconds = Math.max(0.1, latestRelativeStopSeconds + currentProfile.cleanupAfterSeconds)
  session.timeoutIds.push(
    window.setTimeout(
      () => disposePlaybackSession(session),
      Math.ceil((scheduledStartDelaySeconds + sessionDurationSeconds) * 1000),
    ),
  )

  return {
    diagnostics,
    maxTimelineSeconds: Math.max(timelineEndSeconds, request.startSeconds + latestRelativeStopSeconds),
    minTimelineSeconds: request.minTimelineSeconds,
    scheduledStartAtMs,
    scheduledStartTime,
    session,
    startSeconds: request.startSeconds,
  }
}

function createMetronomeSchedulerState(request: PlaybackEngineStartRequest) {
  if (!request.includeMetronome) {
    return null
  }
  const pulseQuarterBeats = Math.max(0.125, request.meter.pulseQuarterBeats)
  const beatSeconds = getBeatSeconds(request.bpm)
  let nextQuarterBeatOffset =
    Math.floor(Math.max(0, request.startSeconds) / beatSeconds / pulseQuarterBeats) * pulseQuarterBeats
  while (
    getRawMetronomeRelativeStartSeconds(nextQuarterBeatOffset, request.bpm, request.startSeconds) + 0.045 <
    0
  ) {
    nextQuarterBeatOffset += pulseQuarterBeats
  }

  return {
    durationSeconds: 0.045,
    maxQuarterBeatOffset: Math.max(0, request.maxBeat - 1) + 0.001,
    nextQuarterBeatOffset,
    nextRelativeStartSeconds: getMetronomeRelativeStartSeconds(
      nextQuarterBeatOffset,
      request.bpm,
      request.startSeconds,
    ),
    volume: 0.035,
  }
}

function getMetronomeRelativeStartSeconds(
  quarterBeatOffset: number,
  bpm: number,
  startSeconds: number,
): number {
  return Math.max(0, getRawMetronomeRelativeStartSeconds(quarterBeatOffset, bpm, startSeconds))
}

function getRawMetronomeRelativeStartSeconds(
  quarterBeatOffset: number,
  bpm: number,
  startSeconds: number,
): number {
  return beatToSeconds(quarterBeatOffset + 1, bpm) - startSeconds
}

function detectMobileLikeRuntime(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return navigator.maxTouchPoints > 1 || /Android|iPad|iPhone|Mobi/i.test(navigator.userAgent)
}

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
