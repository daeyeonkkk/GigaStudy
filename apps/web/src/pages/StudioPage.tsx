import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { starterTickets } from '../data/phase1'
import { buildApiUrl } from '../lib/api'
import type { Project } from '../types/project'

type StudioState =
  | { phase: 'loading' }
  | { phase: 'ready'; project: Project }
  | { phase: 'error'; message: string }

export function StudioPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [studioState, setStudioState] = useState<StudioState>({ phase: 'loading' })

  useEffect(() => {
    if (!projectId) {
      setStudioState({ phase: 'error', message: '프로젝트 ID가 없습니다.' })
      return
    }

    const controller = new AbortController()

    async function loadProject(): Promise<void> {
      try {
        const response = await fetch(buildApiUrl(`/api/projects/${projectId}`), {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(response.status === 404 ? '프로젝트를 찾을 수 없습니다.' : `HTTP ${response.status}`)
        }

        const project = (await response.json()) as Project
        setStudioState({ phase: 'ready', project })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setStudioState({
          phase: 'error',
          message:
            error instanceof Error ? error.message : '프로젝트를 불러오지 못했습니다.',
        })
      }
    }

    void loadProject()

    return () => controller.abort()
  }, [projectId])

  if (studioState.phase === 'loading') {
    return (
      <div className="page-shell">
        <section className="panel studio-panel">
          <p className="eyebrow">Studio</p>
          <h1>프로젝트를 불러오는 중</h1>
          <p className="panel__summary">생성한 프로젝트 메타데이터를 확인하고 있다.</p>
        </section>
      </div>
    )
  }

  if (studioState.phase === 'error') {
    return (
      <div className="page-shell">
        <section className="panel studio-panel">
          <p className="eyebrow">Studio</p>
          <h1>스튜디오를 열 수 없음</h1>
          <p className="form-error">{studioState.message}</p>
          <Link className="back-link" to="/">
            홈으로 돌아가기
          </Link>
        </section>
      </div>
    )
  }

  const { project } = studioState

  return (
    <div className="page-shell">
      <section className="panel studio-panel">
        <div className="studio-header">
          <div>
            <p className="eyebrow">Studio Entry</p>
            <h1>{project.title}</h1>
            <p className="panel__summary">
              FE-01 기준의 최소 스튜디오 진입 셸이다. 여기서 다음 단계인 guide 연결,
              장치 설정, take 녹음 화면으로 확장한다.
            </p>
          </div>

          <Link className="back-link" to="/">
            새 프로젝트 만들기
          </Link>
        </div>

        <div className="meta-grid">
          <article className="info-card">
            <h3>프로젝트 메타데이터</h3>
            <dl className="studio-meta">
              <div>
                <dt>ID</dt>
                <dd>{project.project_id}</dd>
              </div>
              <div>
                <dt>BPM</dt>
                <dd>{project.bpm ?? '미정'}</dd>
              </div>
              <div>
                <dt>조성</dt>
                <dd>{project.base_key ?? '미정'}</dd>
              </div>
              <div>
                <dt>박자</dt>
                <dd>{project.time_signature ?? '미정'}</dd>
              </div>
              <div>
                <dt>모드</dt>
                <dd>{project.mode ?? 'practice'}</dd>
              </div>
              <div>
                <dt>생성 시각</dt>
                <dd>{new Date(project.created_at).toLocaleString()}</dd>
              </div>
            </dl>
          </article>

          <article className="info-card">
            <h3>다음으로 붙일 항목</h3>
            <ul>
              <li>가이드 트랙 업로드와 재생 패널</li>
              <li>마이크 권한과 DeviceProfile 저장 패널</li>
              <li>take 녹음과 업로드 상태 리스트</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">Current Lane</p>
          <h2>Phase 1 우선 티켓 흐름</h2>
        </div>

        <div className="card-grid">
          {starterTickets.map((ticket) => (
            <article className="info-card" key={ticket}>
              <h3>{ticket}</h3>
              <p className="empty-note">
                foundation backlog 기준으로 바로 이어질 작업 단위다.
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
