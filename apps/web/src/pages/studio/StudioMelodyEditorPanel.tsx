import { useStudioCompactViewport } from './useStudioCompactViewport'

type StatusTone = 'error' | 'loading' | 'ready'

type MelodyNoteEditorRow = {
  durationLabel: string
  endMs: number
  id: string
  onEndMsChange: (value: number) => void
  onPhraseIndexChange: (value: number) => void
  onPitchMidiChange: (value: number) => void
  onRemove: () => void
  onStartMsChange: (value: number) => void
  phraseIndex: number
  pitchMidi: number
  pitchName: string
  startMs: number
}

type StudioMelodyEditorPanelProps = {
  hasNotes: boolean
  noteRows: MelodyNoteEditorRow[]
  statusLabel: string
  statusTone: StatusTone
  summaryLabel: string
}

export function StudioMelodyEditorPanel({
  hasNotes,
  noteRows,
  statusLabel,
  statusTone,
  summaryLabel,
}: StudioMelodyEditorPanelProps) {
  const isCompactViewport = useStudioCompactViewport()

  return (
    <article className="panel studio-block">
      <div className="panel-header">
        <div>
          <p className="eyebrow">멜로디 편집기</p>
          <h2>노트 편집</h2>
        </div>
        <span className={`status-pill status-pill--${statusTone}`}>{statusLabel}</span>
      </div>

      {hasNotes ? (
        <details
          className="studio-mobile-fold studio-mobile-fold--secondary"
          open={isCompactViewport ? undefined : true}
        >
          <summary className="studio-mobile-fold__summary">
            <span>노트 직접 편집</span>
            <strong>{summaryLabel}</strong>
          </summary>
          <div className="studio-mobile-fold__body">
            <div className="melody-note-list">
              {noteRows.map((note) => (
                <div className="melody-note-row" key={note.id}>
                  <label>
                    <span>음높이</span>
                    <input
                      className="text-input"
                      min={0}
                      max={127}
                      type="number"
                      value={note.pitchMidi}
                      onChange={(event) => note.onPitchMidiChange(Number(event.target.value))}
                    />
                  </label>

                  <label>
                    <span>시작</span>
                    <input
                      className="text-input"
                      min={0}
                      type="number"
                      value={note.startMs}
                      onChange={(event) => note.onStartMsChange(Number(event.target.value))}
                    />
                  </label>

                  <label>
                    <span>끝</span>
                    <input
                      className="text-input"
                      min={1}
                      type="number"
                      value={note.endMs}
                      onChange={(event) => note.onEndMsChange(Number(event.target.value))}
                    />
                  </label>

                  <label>
                    <span>구간</span>
                    <input
                      className="text-input"
                      min={0}
                      type="number"
                      value={note.phraseIndex}
                      onChange={(event) => note.onPhraseIndexChange(Number(event.target.value))}
                    />
                  </label>

                  <div className="melody-note-meta">
                    <strong>{note.pitchName}</strong>
                    <span>{note.durationLabel}</span>
                  </div>

                  <button className="button-secondary button-secondary--small" type="button" onClick={note.onRemove}>
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </div>
        </details>
      ) : (
        <div className="empty-card">
          <p>아직 불러온 멜로디 노트가 없습니다.</p>
          <p>멜로디 초안을 추출하면 여기서 양자화된 노트 목록을 검토할 수 있습니다.</p>
        </div>
      )}
    </article>
  )
}
