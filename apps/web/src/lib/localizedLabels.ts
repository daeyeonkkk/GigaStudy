export function getTrackStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'PENDING_UPLOAD':
      return '업로드 대기'
    case 'UPLOADING':
      return '업로드 중'
    case 'READY':
      return '준비 완료'
    case 'FAILED':
      return '실패'
    default:
      return status ?? '알 수 없음'
  }
}

export function getTrackRoleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'GUIDE':
      return '가이드'
    case 'VOCAL_TAKE':
      return '보컬 테이크'
    case 'MIXDOWN':
      return '믹스다운'
    default:
      return role ?? '알 수 없음'
  }
}

export function getAnalysisJobStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'QUEUED':
      return '대기열'
    case 'RUNNING':
      return '실행 중'
    case 'SUCCEEDED':
      return '완료'
    case 'FAILED':
      return '실패'
    default:
      return status ?? '대기 중'
  }
}

export function getProjectVersionSourceLabel(sourceType: string | null | undefined): string {
  switch (sourceType) {
    case 'MANUAL_SNAPSHOT':
      return '수동 스냅샷'
    case 'SHARE_LINK':
      return '공유 링크 스냅샷'
    default:
      return sourceType ?? '알 수 없음'
  }
}

export function getShareAccessScopeLabel(scope: string | null | undefined): string {
  switch (scope) {
    case 'READ_ONLY':
      return '읽기 전용'
    default:
      return scope ?? '알 수 없음'
  }
}

export function getValidationOutcomeLabel(outcome: string | null | undefined): string {
  switch (outcome) {
    case 'PASS':
      return '통과'
    case 'WARN':
      return '주의'
    case 'FAIL':
      return '실패'
    default:
      return outcome ?? '알 수 없음'
  }
}

export function getArrangementStyleLabel(style: string | null | undefined): string {
  switch (style) {
    case 'contemporary':
      return '컨템퍼러리'
    case 'ballad':
      return '발라드'
    case 'anthem':
      return '앤섬'
    default:
      return style ?? '알 수 없음'
  }
}

export function getDifficultyLabel(difficulty: string | null | undefined): string {
  switch (difficulty) {
    case 'beginner':
      return '입문'
    case 'basic':
      return '기본'
    case 'strict':
      return '엄격'
    default:
      return difficulty ?? '알 수 없음'
  }
}

export function getPartTypeLabel(partType: string | null | undefined): string {
  switch (partType) {
    case 'LEAD':
      return '리드'
    case 'SOPRANO':
      return '소프라노'
    case 'ALTO':
      return '알토'
    case 'TENOR':
      return '테너'
    case 'BASS':
      return '베이스'
    case 'BARITONE':
      return '바리톤'
    default:
      return partType ?? '미지정'
  }
}

export function getArrangementPartRoleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'MELODY':
      return '멜로디'
    default:
      return getPartTypeLabel(role)
  }
}

export function getShareErrorLabel(message: string): string {
  switch (message) {
    case 'Share link is inactive':
      return '공유 링크가 비활성화되었습니다.'
    case 'Share link has expired':
      return '공유 링크 사용 기한이 지났습니다.'
    case 'Shared project not found':
      return '공유 프로젝트를 찾지 못했습니다.'
    default:
      return message
  }
}
