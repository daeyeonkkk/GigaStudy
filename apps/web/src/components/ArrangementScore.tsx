import { useEffect, useRef, useState } from 'react'

type ArrangementScoreProps = {
  musicXmlUrl: string | null
  playheadRatio: number
  renderKey: string
}

type RenderState =
  | { phase: 'idle'; message: string }
  | { phase: 'loading'; message: string }
  | { phase: 'ready'; message: string }
  | { phase: 'error'; message: string }

export function ArrangementScore({
  musicXmlUrl,
  playheadRatio,
  renderKey,
}: ArrangementScoreProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [renderState, setRenderState] = useState<RenderState>({
    phase: 'idle',
    message: 'Generate or select an arrangement to render the score.',
  })

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const hostElement = hostRef.current

    async function renderScore(): Promise<void> {
      if (!musicXmlUrl || !hostElement) {
        if (hostElement) {
          hostElement.innerHTML = ''
        }
        setRenderState({
          phase: 'idle',
          message: 'Generate or select an arrangement to render the score.',
        })
        return
      }

      setRenderState({
        phase: 'loading',
        message: 'Loading MusicXML into the score view...',
      })

      try {
        const response = await fetch(musicXmlUrl, { signal: controller.signal })
        if (!response.ok) {
          throw new Error('MusicXML download failed.')
        }

        const xmlText = await response.text()
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay')

        if (cancelled || !hostElement) {
          return
        }

        hostElement.innerHTML = ''
        const osmd = new OpenSheetMusicDisplay(hostElement, {
          autoResize: true,
          backend: 'svg',
          drawTitle: true,
        })
        await osmd.load(xmlText)
        osmd.render()

        if (!cancelled) {
          setRenderState({
            phase: 'ready',
            message: 'Score rendered from the latest MusicXML artifact.',
          })
        }
      } catch (error) {
        if (controller.signal.aborted || cancelled) {
          return
        }

        setRenderState({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Score rendering failed.',
        })
      }
    }

    void renderScore()

    return () => {
      cancelled = true
      controller.abort()
      if (hostElement) {
        hostElement.innerHTML = ''
      }
    }
  }, [musicXmlUrl, renderKey])

  return (
    <div className="score-shell">
      <div className="score-shell__viewport">
        <div className="score-shell__canvas" ref={hostRef} />
        {renderState.phase === 'ready' ? (
          <div
            className="score-shell__playhead"
            style={{
              left: `${Math.min(100, Math.max(0, playheadRatio * 100))}%`,
            }}
          />
        ) : null}
      </div>

      {renderState.phase !== 'ready' ? (
        <div className="empty-card">
          <p>{renderState.message}</p>
        </div>
      ) : null}

      <p
        className={renderState.phase === 'error' ? 'form-error' : 'status-card__hint'}
      >
        {renderState.message}
      </p>
    </div>
  )
}
