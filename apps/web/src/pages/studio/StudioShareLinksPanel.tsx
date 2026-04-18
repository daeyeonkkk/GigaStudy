type StatusTone = 'error' | 'loading' | 'ready'
type MessageTone = 'error' | 'hint'

type ShareLinkHistoryCard = {
  accessScopeLabel: string
  createdAtLabel: string
  expiresAtLabel: string
  id: string
  isActive: boolean
  label: string
  lastAccessedLabel: string
  stateLabel: string
  summaryLabel: string
  url: string
}

type StudioShareLinksPanelProps = {
  canLaunchShareFlow: boolean
  copyMessage: { text: string; tone: MessageTone } | null
  deactivateBusy: boolean
  deactivateMessage: { text: string; tone: MessageTone } | null
  latestVersionLabel: string
  links: ShareLinkHistoryCard[]
  onCopy: (url: string) => void
  onDeactivate: (id: string) => void
  onOpenShareModal: () => void
  onRefresh: () => void
  primaryMessage: { text: string; tone: MessageTone } | null
  selectedShareArtifactCount: number
  shareTargetLabel: string
  statusLabel: string
  statusTone: StatusTone
}

export function StudioShareLinksPanel({
  canLaunchShareFlow,
  copyMessage,
  deactivateBusy,
  deactivateMessage,
  latestVersionLabel,
  links,
  onCopy,
  onDeactivate,
  onOpenShareModal,
  onRefresh,
  primaryMessage,
  selectedShareArtifactCount,
  shareTargetLabel,
  statusLabel,
  statusTone,
}: StudioShareLinksPanelProps) {
  return (
    <article className="panel studio-block" data-testid="share-links-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">공유 링크</p>
          <h2>공유</h2>
        </div>
        <span className={`status-pill status-pill--${statusTone}`}>{statusLabel}</span>
      </div>

      <p className="panel__summary">
        master plan에서는 공유 범위를 열어두고 있지만, 현재 slice는 읽기 전용 링크를 기준으로
        구현합니다. 각 링크는 먼저 버전을 고정한 뒤 수정 기능 없는 공개 뷰어 경로를 엽니다.
      </p>

      <div className="studio-share-summary">
        <div className="mini-card">
          <span>공유 기준</span>
          <strong>{shareTargetLabel}</strong>
        </div>
        <div className="mini-card">
          <span>포함 항목</span>
          <strong>{selectedShareArtifactCount}개</strong>
        </div>
        <div className="mini-card">
          <span>가장 최근 버전</span>
          <strong>{latestVersionLabel}</strong>
        </div>
        <div className="mini-card">
          <span>공유 가능 여부</span>
          <strong>{canLaunchShareFlow ? '준비됨' : '항목 없음'}</strong>
        </div>
      </div>

      <div className="button-row">
        <button
          className="button-primary"
          type="button"
          disabled={!canLaunchShareFlow}
          onClick={onOpenShareModal}
        >
          읽기 전용 공유 만들기
        </button>

        <button className="button-secondary" type="button" onClick={onRefresh}>
          공유 링크 새로고침
        </button>
      </div>

      {primaryMessage ? (
        <p className={primaryMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
          {primaryMessage.text}
        </p>
      ) : null}

      {deactivateMessage ? (
        <p className={deactivateMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
          {deactivateMessage.text}
        </p>
      ) : null}

      {copyMessage ? (
        <p className={copyMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
          {copyMessage.text}
        </p>
      ) : null}

      <div className="history-list">
        {links.length === 0 ? (
          <div className="empty-card">
            <p>아직 공유 링크가 없습니다.</p>
            <p>현재 스튜디오 스냅샷을 리뷰어에게 보내려면 읽기 전용 공유 URL을 만들어 주세요.</p>
          </div>
        ) : (
          links.map((link) => (
            <article className="history-card" key={link.id}>
              <div className="history-card__header">
                <div>
                  <strong>{link.label}</strong>
                  <span>{link.summaryLabel}</span>
                </div>
                <span className="candidate-chip">{link.accessScopeLabel}</span>
              </div>

              <div className="mini-card mini-card--stack">
                <span>공유 URL</span>
                <strong>{link.url}</strong>
              </div>

              <div className="mini-grid">
                <div className="mini-card">
                  <span>사용 기한</span>
                  <strong>{link.expiresAtLabel}</strong>
                </div>
                <div className="mini-card">
                  <span>마지막 열람</span>
                  <strong>{link.lastAccessedLabel}</strong>
                </div>
                <div className="mini-card">
                  <span>생성 시각</span>
                  <strong>{link.createdAtLabel}</strong>
                </div>
                <div className="mini-card">
                  <span>상태</span>
                  <strong>{link.stateLabel}</strong>
                </div>
              </div>

              <div className="button-row">
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => onCopy(link.url)}
                >
                  URL 복사
                </button>
                <a className="button-secondary" href={link.url} target="_blank" rel="noreferrer">
                  공유 화면 열기
                </a>
                <button
                  className="button-secondary"
                  type="button"
                  disabled={!link.isActive || deactivateBusy}
                  onClick={() => onDeactivate(link.id)}
                >
                  {link.isActive ? '비활성화' : '이미 비활성화됨'}
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </article>
  )
}
