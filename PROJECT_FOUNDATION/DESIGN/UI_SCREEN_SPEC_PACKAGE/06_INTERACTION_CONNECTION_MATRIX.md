# 06. Interaction Connection Matrix

## 0. 목적

이 문서는 버튼, 링크, 드롭다운, 팝오버, 모달, 드로어가 무엇과 연결되는지 최종 기준으로 고정한다.

## 1. Root Launch

| Source | Control | Type | Target | Transition | Dismiss |
| --- | --- | --- | --- | --- | --- |
| `PAGE-LAUNCH` | 새 프로젝트 | top action | `LAUNCH-SECTION-NEW-PROJECT` | same-page focus | n/a |
| `PAGE-LAUNCH` | 최근 작업 | top action | `LAUNCH-SECTION-RECENT` | same-page focus | n/a |
| `PAGE-LAUNCH` | 공유 검토 | top action | `LAUNCH-SECTION-SHARE` | same-page focus | n/a |
| `PAGE-LAUNCH` | recent row | selectable row | last workspace route | route push | n/a |
| `PAGE-LAUNCH` | recent row `⋯` | popover trigger | `POPOVER-LAUNCH-RECENT-ACTIONS` | popover open | click outside / esc |
| `PAGE-LAUNCH` | 박자 | form dropdown | `DROPDOWN-LAUNCH-TIME-SIGNATURE` | dropdown open | click outside / esc |
| `PAGE-LAUNCH` | 스튜디오 열기 | submit button | `PAGE-STUDIO` | create project then route push | n/a |
| `PAGE-LAUNCH` | 검토 열기 | submit button | `PAGE-REVIEW` | parse token then route push | n/a |
| `PAGE-LAUNCH` | 붙여넣기 | secondary button | clipboard paste | immediate action | n/a |

## 2. Studio

| Source | Control | Type | Target | Transition | Dismiss |
| --- | --- | --- | --- | --- | --- |
| `PAGE-STUDIO` | 프로젝트 설정 | command button | `DRAWER-STUDIO-PROJECT-SETTINGS` | drawer slide-in right | esc / close / save |
| `PAGE-STUDIO` | 공유 | command button | `MODAL-STUDIO-SHARE` | modal fade-in | esc / close / submit |
| `PAGE-STUDIO` | 편곡실 | command button | `PAGE-ARR` | route push | n/a |
| `PAGE-STUDIO` | 녹음 | mode button | recording workbench focus | in-page mode switch | n/a |
| `PAGE-STUDIO` | 리뷰 | mode button | analysis workbench focus | in-page mode switch | n/a |
| `PAGE-STUDIO` | 편곡 준비 | mode button | arrangement workbench focus | in-page mode switch | n/a |
| `PAGE-STUDIO` | take row | selectable row | center stage selected take | local selection update | n/a |
| `PAGE-STUDIO` | take row `⋯` | popover trigger | `POPOVER-STUDIO-TAKE-ACTIONS` | popover | click outside / esc |
| `PAGE-STUDIO` | 테이크 녹음 | primary command | start recording | immediate action | stop / error |
| `PAGE-STUDIO` | 녹음 멈춤 | secondary command | stop recording | immediate action | n/a |
| `PAGE-STUDIO` | 분석 | secondary command | analysis run | immediate action | n/a |
| `PAGE-STUDIO` | 범위 | dropdown trigger | `DROPDOWN-STUDIO-RANGE` | dropdown | click outside / esc |
| `PAGE-STUDIO` | Zoom | popover trigger | `POPOVER-STUDIO-ZOOM` | popover | click outside / esc |
| `PAGE-STUDIO` | 코드 타임라인 편집 | button | `DRAWER-STUDIO-CHORD-TIMELINE` | drawer | esc / close / save |
| `PAGE-STUDIO` | 멜로디 추출 | button | workbench `멜로디` tab | in-page tab focus | n/a |
| `PAGE-STUDIO` | 사람 평가 묶음 | button | `MODAL-STUDIO-HUMAN-RATING-EXPORT` | modal | esc / close / submit |
| `PAGE-STUDIO` | 편곡 후보 만들기 | button | workbench `편곡` tab | in-page tab focus | n/a |
| `PAGE-STUDIO` | Guide | playback popover trigger | `POPOVER-STUDIO-GUIDE-PLAYBACK` | popover | click outside / esc |
| `PAGE-STUDIO` | Count-in | dropdown trigger | `DROPDOWN-STUDIO-COUNT-IN` | dropdown | click outside / esc |
| `PAGE-STUDIO` | 권한 요청 | button | browser permission prompt | system prompt | system close |
| `PAGE-STUDIO` | 목록 새로고침 | button | input/output device refresh | immediate action | n/a |
| `PAGE-STUDIO` | 장치 저장 | button | save device profile | immediate action | n/a |
| `PAGE-STUDIO` | 파일 선택 | file button | system file picker | system dialog | system close |
| `PAGE-STUDIO` | 업로드 | primary button | upload guide | immediate action | n/a |
| `PAGE-STUDIO` | 교체 | button | `DRAWER-STUDIO-GUIDE` | drawer | esc / close / replace |
| `PAGE-STUDIO` | 세부 | button | `DRAWER-STUDIO-GUIDE` | drawer | esc / close |
| `PAGE-STUDIO` | 장치 tab | workbench tab | `STUDIO-TAB-AUDIO` | in-page tab switch | n/a |
| `PAGE-STUDIO` | 가이드 tab | workbench tab | `STUDIO-TAB-GUIDE` | in-page tab switch | n/a |
| `PAGE-STUDIO` | 녹음 tab | workbench tab | `STUDIO-TAB-RECORDING` | in-page tab switch | n/a |
| `PAGE-STUDIO` | 분석 tab | workbench tab | `STUDIO-TAB-ANALYSIS` | in-page tab switch | n/a |
| `PAGE-STUDIO` | 멜로디 tab | workbench tab | `STUDIO-TAB-MELODY` | in-page tab switch | n/a |
| `PAGE-STUDIO` | 편곡 tab | workbench tab | `STUDIO-TAB-ARRANGEMENT` | in-page tab switch | n/a |
| `PAGE-STUDIO` | 믹스다운 tab | workbench tab | `STUDIO-TAB-MIXDOWN` | in-page tab switch | n/a |
| `PAGE-STUDIO` | 버전 tab | workbench tab | `STUDIO-TAB-VERSIONS` | in-page tab switch | n/a |
| `PAGE-STUDIO` | 공유 tab | workbench tab | `STUDIO-TAB-SHARE` | in-page tab switch | n/a |
| `PAGE-STUDIO` | input device | dropdown | `DROPDOWN-STUDIO-INPUT-DEVICE` | dropdown | click outside / esc |
| `PAGE-STUDIO` | output route | dropdown | `DROPDOWN-STUDIO-OUTPUT-ROUTE` | dropdown | click outside / esc |
| `PAGE-STUDIO` | 분석 실행 | primary button | run post analysis | immediate action | n/a |
| `PAGE-STUDIO` | 저신뢰 take만 보기 | toggle button | analysis filter change | immediate action | n/a |
| `PAGE-STUDIO` | 노트 상세 고정 | button | pin note detail to inspector | immediate action | unpin |
| `PAGE-STUDIO` | 멜로디 추출 | primary button | extract melody | immediate action | n/a |
| `PAGE-STUDIO` | 초안 저장 | button | save melody draft | immediate action | n/a |
| `PAGE-STUDIO` | MIDI 받기 | button | file download | browser download | n/a |
| `PAGE-STUDIO` | 후보 생성 | primary button | generate arrangements | immediate action | n/a |
| `PAGE-STUDIO` | 제약 초기화 | button | reset arrangement constraints | immediate action | n/a |
| `PAGE-STUDIO` | 편곡실 열기 | button | `PAGE-ARR` | route push | n/a |
| `PAGE-STUDIO` | 미리듣기 렌더 | button | render mixdown preview | immediate action | n/a |
| `PAGE-STUDIO` | 프로젝트 산출물로 저장 | button | save mixdown artifact | immediate action | n/a |
| `PAGE-STUDIO` | 현재 상태 저장 | button | version create | immediate action | n/a |
| `PAGE-STUDIO` | 이 버전으로 보기 | row action | version snapshot load | immediate action | n/a |
| `PAGE-STUDIO` | 공유 링크 만들기 | button | `MODAL-STUDIO-SHARE` or create inline share | modal/submit | close / success |
| `PAGE-STUDIO` | 링크 복사 | row action | clipboard copy | immediate action | success toast |
| `PAGE-STUDIO` | 읽기 화면 열기 | button | `PAGE-REVIEW` | new tab or route open | n/a |
| `PAGE-STUDIO` | 비활성화 | row action | share link deactivate confirm | immediate action or confirm modal | success toast |

## 3. Arrangement

| Source | Control | Type | Target | Transition | Dismiss |
| --- | --- | --- | --- | --- | --- |
| `PAGE-ARR` | 스튜디오로 | button | `PAGE-STUDIO` | route push | n/a |
| `PAGE-ARR` | 후보 비교 | button | `DRAWER-ARR-CANDIDATE-COMPARE` | drawer | esc / close |
| `PAGE-ARR` | 내보내기 | button | `MODAL-ARR-EXPORT-PACK` | modal | esc / close / submit |
| `PAGE-ARR` | style | dropdown | `DROPDOWN-ARR-STYLE` | dropdown | click outside / esc |
| `PAGE-ARR` | difficulty | dropdown | `DROPDOWN-ARR-DIFFICULTY` | dropdown | click outside / esc |
| `PAGE-ARR` | voice range | dropdown | `DROPDOWN-ARR-VOICE-RANGE` | dropdown | click outside / esc |
| `PAGE-ARR` | beatbox | dropdown | `DROPDOWN-ARR-BEATBOX` | dropdown | click outside / esc |
| `PAGE-ARR` | 후보 다시 생성 | button | regenerate candidates | immediate action | n/a |
| `PAGE-ARR` | 제약 초기화 | button | reset constraints | immediate action | n/a |
| `PAGE-ARR` | Zoom | popover trigger | `POPOVER-ARR-SCORE-ZOOM` | popover | click outside / esc |
| `PAGE-ARR` | View mode | dropdown | `DROPDOWN-ARR-VIEW-MODE` | dropdown | click outside / esc |
| `PAGE-ARR` | 재생 | button | playback start | immediate action | stop |
| `PAGE-ARR` | 정지 | button | playback stop | immediate action | n/a |
| `PAGE-ARR` | 처음으로 | button | playhead reset | immediate action | n/a |
| `PAGE-ARR` | part row `⋯` | popover trigger | `POPOVER-ARR-PART-ACTIONS` | popover | click outside / esc |
| `PAGE-ARR` | MusicXML 받기 | button | file download | browser download | n/a |
| `PAGE-ARR` | MIDI 받기 | button | file download | browser download | n/a |
| `PAGE-ARR` | Guide WAV 받기 | button | file download | browser download | n/a |

## 4. Shared Review

| Source | Control | Type | Target | Transition | Dismiss |
| --- | --- | --- | --- | --- | --- |
| `PAGE-REVIEW` | 가이드 듣기 | button | guide player | immediate action | stop |
| `PAGE-REVIEW` | MusicXML | button | file download | browser download | n/a |
| `PAGE-REVIEW` | MIDI | button | file download | browser download | n/a |
| `PAGE-REVIEW` | canvas mode | dropdown | `DROPDOWN-REVIEW-CANVAS-MODE` | dropdown | click outside / esc |
| `PAGE-REVIEW` | 노트 세부 | button | `DRAWER-REVIEW-NOTE-DETAIL` | drawer | esc / close |

## 5. Ops

| Source | Control | Type | Target | Transition | Dismiss |
| --- | --- | --- | --- | --- | --- |
| `PAGE-OPS` | 새로고침 | button | page reload/update | immediate action | n/a |
| `PAGE-OPS` | 릴리즈 게이트 내려받기 | button | file download | browser download | n/a |
| `PAGE-OPS` | 검증 가져오기 | button | `MODAL-OPS-VALIDATION-IMPORT` | modal | esc / close / submit |
| `PAGE-OPS` | 템플릿 받기 | button | file download | browser download | n/a |
| `PAGE-OPS` | 파일 선택 | file button | system file picker | system dialog | system close |
| `PAGE-OPS` | 미리 보기 | button | parsed preview update | immediate action | n/a |
| `PAGE-OPS` | 가져오기 | button | import submit | immediate action | success toast |
| `PAGE-OPS` | 시간 범위 | dropdown | `DROPDOWN-OPS-TIME-RANGE` | dropdown | click outside / esc |
| `PAGE-OPS` | 심각도 탭 | segmented tab | runtime severity filter | immediate action | n/a |
| `PAGE-OPS` | 로그 상세 보기 | row action | `DRAWER-OPS-LOG-DETAIL` | drawer | esc / close |
| `PAGE-OPS` | 실행 상세 | row action | `DRAWER-OPS-VALIDATION-DETAIL` | drawer | esc / close |
| `PAGE-OPS` | 다시 시도 | row action | retry upload | immediate action | n/a |
| `PAGE-OPS` | 재실행 | row action | retry job | immediate action | n/a |
| `PAGE-OPS` | 기록 보기 | row action | `DRAWER-OPS-JOB-DETAIL` | drawer | esc / close |
| `PAGE-OPS` | 프로필 상세 | row action | `DRAWER-OPS-PROFILE-DETAIL` | drawer | esc / close |

## 6. Confirm modal policy

확인 모달은 아래 경우에만 사용한다.

- 삭제
- 공유 링크 발급
- export pack 생성
- validation import 실행

그 외 일반 action은 inline 실행이 기본이다.

## 7. System surfaces

System-controlled surfaces:

- browser permission prompt
- native file picker
- browser download

이 표면들은 제품 디자인으로 재스킨하지 않는다.
