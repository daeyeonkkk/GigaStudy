import { Link } from 'react-router-dom'

import './StudioPurposeNav.css'

export type StudioPurposeSurface = 'studio' | 'editor' | 'practice' | 'report'

type StudioPurposeNavProps = {
  active: StudioPurposeSurface
  studioId: string
}

const purposeLabels: Record<StudioPurposeSurface, string> = {
  studio: '스튜디오',
  editor: '음표 편집',
  practice: '연습',
  report: '리포트',
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

export function StudioPurposeNav({ active, studioId }: StudioPurposeNavProps) {
  const purposes: StudioPurposeSurface[] =
    active === 'report' ? ['studio', 'editor', 'practice', 'report'] : ['studio', 'editor', 'practice']

  return (
    <nav className="studio-purpose-nav" aria-label="스튜디오 용도별 화면" data-testid="purpose-nav">
      <div className="studio-purpose-nav__items">
        {purposes.map((purpose) => {
          const label = purposeLabels[purpose]
          const href = getPurposeHref(studioId, purpose)
          const isActive = active === purpose
          const className = `studio-purpose-nav__item ${isActive ? 'is-active' : ''} ${href ? '' : 'is-static'}`

          if (isActive || !href) {
            return (
              <span
                aria-current={isActive ? 'page' : undefined}
                className={className}
                data-testid={`purpose-nav-${purpose}`}
                key={purpose}
              >
                {label}
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
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
