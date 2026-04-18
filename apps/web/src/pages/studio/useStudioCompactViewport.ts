import { useEffect, useState } from 'react'

const studioCompactViewportQuery = '(max-width: 820px)'

export function useStudioCompactViewport(): boolean {
  const [isCompactViewport, setIsCompactViewport] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }

    return window.matchMedia(studioCompactViewportQuery).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQuery = window.matchMedia(studioCompactViewportQuery)
    const syncViewport = () => setIsCompactViewport(mediaQuery.matches)

    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)

    return () => {
      mediaQuery.removeEventListener('change', syncViewport)
    }
  }, [])

  return isCompactViewport
}
