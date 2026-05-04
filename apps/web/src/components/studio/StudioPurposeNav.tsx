import { Link } from 'react-router-dom'

import './StudioPurposeNav.css'

export type StudioPurposeSurface = 'studio' | 'editor' | 'practice' | 'report'

type StudioPurposeNavProps = {
  active: StudioPurposeSurface
  note: string
  studioId: string
}

const purposeLabels: Record<StudioPurposeSurface, { description: string; label: string }> = {
  studio: {
    description: '등록 · Sync · 재생',
    label: '스튜디오',
  },
  editor: {
    description: 'Region · PitchEvent',
    label: '음표 편집',
  },
  practice: {
    description: 'Reference · Waterfall',
    label: '연습',
  },
  report: {
    description: 'Scoring · Evidence',
    label: '리포트',
  },
}

function getPurposeHref(studioId: string, purpose: StudioPurposeSurface): string | null {
  if (purpose === 'studio') {
    return `/studios/${studioId}`
  }
  if (purpose === 'editor') {
    return `/studios/${studioId}/edit`
  }
  if (purpose === 'practice') {
    return `/studios/${studioId}/practice`
  }
  return null
}

export function StudioPurposeNav({ active, note, studioId }: StudioPurposeNavProps) {
  const purposes: StudioPurposeSurface[] = ['studio', 'editor', 'practice', 'report']

  return (
    <nav className="studio-purpose-nav" aria-label="스튜디오 용도별 화면" data-testid="purpose-nav">
      <div className="studio-purpose-nav__items">
        {purposes.map((purpose) => {
          const item = purposeLabels[purpose]
          const href = getPurposeHref(studioId, purpose)
          const isActive = active === purpose
          const className = `studio-purpose-nav__item ${isActive ? 'is-active' : ''} ${href ? '' : 'is-static'}`
          const content = (
            <>
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </>
          )

          if (isActive || !href) {
            return (
              <span
                aria-current={isActive ? 'page' : undefined}
                className={className}
                data-testid={`purpose-nav-${purpose}`}
                key={purpose}
              >
                {content}
              </span>
            )
          }

          return (
            <Link
              className={className}
              data-testid={`purpose-nav-${purpose}`}
              key={purpose}
              to={href}
            >
              {content}
            </Link>
          )
        })}
      </div>
      <p>{note}</p>
    </nav>
  )
}
