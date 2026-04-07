export const priorityCards = [
  {
    title: '프로젝트와 Guide 연결',
    items: [
      '프로젝트 생성과 기본 메타데이터 저장',
      'guide 업로드 및 재생 흐름 연결',
      '스튜디오 첫 진입 라우팅 완성',
    ],
  },
  {
    title: '오디오 설정과 DeviceProfile',
    items: [
      '마이크 권한 요청과 장치 선택',
      'getSettings() 기반 실제 적용값 저장',
      '입력 장치와 출력 경로 조합별 profile upsert',
    ],
  },
  {
    title: 'Take 녹음과 업로드',
    items: [
      '여러 take 연속 녹음',
      '업로드 진행률 및 실패 재시도',
      'guide / take 상태가 보이는 트랙 리스트',
    ],
  },
  {
    title: '후처리 준비',
    items: [
      '메타데이터 프로브 워커',
      'canonical audio 와 peaks 산출물 생성',
      'mixdown artifact 저장 경로 확보',
    ],
  },
] as const

export const starterTickets = ['SC-01', 'SC-02', 'BE-01', 'FE-01', 'SC-03'] as const
