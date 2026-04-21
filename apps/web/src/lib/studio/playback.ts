import { getBrowserAudioContextConstructor } from '../audio/audioContext'
import {
  DEFAULT_METER,
  getBeatSeconds,
  isMeasureDownbeat,
  type MeterContext,
} from './timing'

export type PlaybackNode = {
  oscillator: OscillatorNode
  gain: GainNode
}

export type PlaybackSession = {
  context?: AudioContext
  nodes: PlaybackNode[]
  timeoutIds: number[]
}

export function createTone(
  context: AudioContext,
  startTime: number,
  duration: number,
  frequency: number,
  volume: number,
  type: OscillatorType,
): PlaybackNode {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const attackTime = Math.min(0.025, duration / 3)

  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, startTime)
  gain.gain.setValueAtTime(0.0001, startTime)
  gain.gain.linearRampToValueAtTime(volume, startTime + attackTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(startTime)
  oscillator.stop(startTime + duration + 0.03)

  return { oscillator, gain }
}

export function startLoopingMetronomeSession(
  bpm: number,
  meter: MeterContext = DEFAULT_METER,
): PlaybackSession | null {
  const AudioContextConstructor = getBrowserAudioContextConstructor()
  if (!AudioContextConstructor) {
    return null
  }

  let context: AudioContext
  try {
    context = new AudioContextConstructor()
  } catch {
    return null
  }

  const beatSeconds = getBeatSeconds(bpm)
  const pulseSeconds = Math.max(0.04, beatSeconds * meter.pulseQuarterBeats)
  const lookaheadMilliseconds = 25
  const scheduleAheadSeconds = 0.12
  const session: PlaybackSession = { context, nodes: [], timeoutIds: [] }
  let pulseIndex = 0
  let nextClickTime = context.currentTime + 0.04

  const scheduleClicks = () => {
    if (context.state === 'closed') {
      return
    }

    try {
      void context.resume().catch(() => undefined)
      while (nextClickTime < context.currentTime + scheduleAheadSeconds) {
        const quarterBeatOffset = pulseIndex * meter.pulseQuarterBeats
        const isDownbeat = isMeasureDownbeat(quarterBeatOffset, meter.beatsPerMeasure)
        session.nodes.push(
          createTone(
            context,
            nextClickTime,
            0.045,
            isDownbeat ? 1040 : 760,
            isDownbeat ? 0.052 : 0.038,
            'square',
          ),
        )
        pulseIndex += 1
        nextClickTime += pulseSeconds
      }
      const timeoutId = window.setTimeout(scheduleClicks, lookaheadMilliseconds)
      session.timeoutIds.push(timeoutId)
    } catch {
      disposePlaybackSession(session)
    }
  }

  scheduleClicks()
  return session
}

export function disposePlaybackSession(session: PlaybackSession | null) {
  if (!session) {
    return
  }

  session.timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
  session.nodes.forEach(({ oscillator, gain }) => {
    try {
      gain.gain.cancelScheduledValues(0)
      gain.gain.setValueAtTime(0.0001, session.context?.currentTime ?? 0)
      oscillator.stop()
      oscillator.disconnect()
      gain.disconnect()
    } catch {
      return
    }
  })

  if (session.context && session.context.state !== 'closed') {
    void session.context.close().catch(() => undefined)
  }
}

export function scheduleMetronomeClicks(
  context: AudioContext,
  nodes: PlaybackNode[],
  scheduledStart: number,
  maxBeat: number,
  bpm: number,
  meter: MeterContext,
  volume: number,
): number {
  const beatSeconds = getBeatSeconds(bpm)
  let latestStop = 0
  for (
    let quarterBeatOffset = 0;
    quarterBeatOffset <= Math.max(0, maxBeat - 1) + 0.001;
    quarterBeatOffset += meter.pulseQuarterBeats
  ) {
    const clickStart = quarterBeatOffset * beatSeconds
    const frequency = isMeasureDownbeat(quarterBeatOffset, meter.beatsPerMeasure) ? 960 : 720
    nodes.push(createTone(context, scheduledStart + clickStart, 0.045, frequency, volume, 'square'))
    latestStop = Math.max(latestStop, clickStart + 0.045)
  }
  return latestStop
}
