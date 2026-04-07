import { useEffect, useRef } from 'react'

type ManagedAudioPlayerProps = {
  muted: boolean
  src: string
  volume: number
}

export function ManagedAudioPlayer({
  muted,
  src,
  volume,
}: ManagedAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!audioRef.current) {
      return
    }

    audioRef.current.volume = Math.min(1, Math.max(0, volume))
    audioRef.current.muted = muted
  }, [muted, volume, src])

  return (
    <audio ref={audioRef} controls preload="metadata" src={src}>
      Your browser does not support audio playback.
    </audio>
  )
}
