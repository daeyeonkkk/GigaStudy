import { useEffect, useRef, useState } from 'react'

import './ManagedAudioPlayer.css'
import { normalizeAssetUrl } from '../lib/api'

type ManagedAudioPlayerProps = {
  muted: boolean
  src: string
  volume: number
}

function formatClock(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0:00'
  }

  const totalSeconds = Math.floor(value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function ManagedAudioPlayer({
  muted,
  src,
  volume,
}: ManagedAudioPlayerProps) {
  const normalizedSrc = normalizeAssetUrl(src) ?? src

  return (
    <ManagedAudioPlayerInner
      key={normalizedSrc}
      muted={muted}
      normalizedSrc={normalizedSrc}
      volume={volume}
    />
  )
}

type ManagedAudioPlayerInnerProps = {
  muted: boolean
  normalizedSrc: string
  volume: number
}

function ManagedAudioPlayerInner({
  muted,
  normalizedSrc,
  volume,
}: ManagedAudioPlayerInnerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    if (!audioRef.current) {
      return
    }

    audioRef.current.volume = Math.min(1, Math.max(0, volume))
    audioRef.current.muted = muted
  }, [muted, volume])

  useEffect(() => {
    if (!audioRef.current) {
      return
    }

    const audio = audioRef.current

    const syncFromElement = () => {
      setHasError(false)
      setCurrentTime(audio.currentTime)
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    }

    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(audio.duration || 0)
    }
    const handleError = () => {
      setHasError(true)
      setIsPlaying(false)
    }

    audio.addEventListener('loadedmetadata', syncFromElement)
    audio.addEventListener('durationchange', syncFromElement)
    audio.addEventListener('timeupdate', syncFromElement)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('loadedmetadata', syncFromElement)
      audio.removeEventListener('durationchange', syncFromElement)
      audio.removeEventListener('timeupdate', syncFromElement)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
    }
  }, [normalizedSrc])

  const canPlay = normalizedSrc.length > 0 && !hasError

  const handleTogglePlayback = async () => {
    if (!audioRef.current || !canPlay) {
      return
    }

    const audio = audioRef.current
    if (audio.paused) {
      try {
        await audio.play()
      } catch {
        setIsPlaying(false)
      }
      return
    }

    audio.pause()
  }

  const handleRestart = () => {
    if (!audioRef.current) {
      return
    }

    const audio = audioRef.current
    audio.currentTime = 0
    setCurrentTime(0)
    if (!audio.paused) {
      void audio.play().catch(() => {
        setIsPlaying(false)
      })
    }
  }

  const handleSeek = (nextValue: number) => {
    if (!audioRef.current) {
      return
    }

    const clamped = Math.min(duration || 0, Math.max(0, nextValue))
    audioRef.current.currentTime = clamped
    setCurrentTime(clamped)
  }

  return (
    <div className="managed-audio-player" data-muted={muted ? 'true' : 'false'}>
      <audio ref={audioRef} preload="metadata" src={normalizedSrc} />

      <div className="managed-audio-player__controls">
        <button
          className="managed-audio-player__button"
          disabled={!canPlay}
          type="button"
          onClick={() => void handleTogglePlayback()}
        >
          {isPlaying ? '일시정지' : '재생'}
        </button>

        <button
          className="managed-audio-player__button managed-audio-player__button--secondary"
          disabled={!canPlay || currentTime <= 0}
          type="button"
          onClick={handleRestart}
        >
          처음
        </button>

        <div className="managed-audio-player__status">
          <span>{muted ? '음소거' : `볼륨 ${Math.round(volume * 100)}%`}</span>
          <strong>
            {formatClock(currentTime)} / {formatClock(duration)}
          </strong>
        </div>
      </div>

      <label className="managed-audio-player__scrubber">
        <span className="managed-audio-player__scrubber-label">재생 위치</span>
        <input
          max={Math.max(duration, 0)}
          min={0}
          step={0.01}
          type="range"
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => handleSeek(Number(event.target.value))}
        />
      </label>

      {hasError ? (
        <p className="managed-audio-player__error">
          현재 브라우저에서 이 오디오를 재생하지 못했습니다.
        </p>
      ) : null}
    </div>
  )
}
