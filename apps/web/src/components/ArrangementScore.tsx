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
    message: '편곡 후보를 만들거나 선택하면 악보를 표시합니다.',
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
          message: '편곡 후보를 만들거나 선택하면 악보를 표시합니다.',
        })
        return
      }

      setRenderState({
        phase: 'loading',
        message: 'MusicXML을 악보 화면에 불러오는 중입니다...',
      })

      try {
        const response = await fetch(musicXmlUrl, { signal: controller.signal })
        if (!response.ok) {
          throw new Error('MusicXML을 내려받지 못했습니다.')
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
            message: '최신 MusicXML 산출물로 악보를 표시했습니다.',
          })
        }
      } catch (error) {
        if (controller.signal.aborted || cancelled) {
          return
        }

        setRenderState({
          phase: 'error',
          message: error instanceof Error ? error.message : '악보를 표시하지 못했습니다.',
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
