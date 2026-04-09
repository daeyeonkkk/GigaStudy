# GigaStudy 로드맵

기준일: 2026-04-07

## 0. 목적

이 문서는 GigaStudy를 실제 제품으로 만들기 위한 실행 순서와 단계별 완료 기준을 고정한다.

핵심 원칙은 기능을 넓게 벌리는 것이 아니라, 녹음 안정화에서 출발해 분석 신뢰도와 편곡 활용성을 순서대로 닫는 것이다.

## 1. 최상위 추진 원칙

- 1차 출시는 “실시간 천재 기능”보다 “녹음 후 신뢰도 높은 분석”에 집중한다.
- 악보 렌더링과 재생 엔진은 처음부터 분리한다.
- 오디오 입력은 MVP에서 단선율 보컬 또는 개별 파트 단위로 제한한다.
- 편곡 엔진은 생성형 모델보다 룰 기반 후보 생성기를 먼저 완성한다.
- 각 단계는 데모가 아니라 다음 단계의 입력이 되는 산출물까지 닫혀야 완료로 본다.

## 2. 병렬 작업 축

### 2.1 제품 / UX 축

- 한국어 중심 용어 체계 정리
- canonical UI direction을 `UI_DESIGN_DIRECTION.md`의 `Quiet Studio Console`로 고정
- 오디오 설정, 정렬 상태, 저신뢰도 상태를 설명 가능한 UI로 노출
- 재녹음과 후보 비교 흐름을 최소 클릭으로 유지

### 2.2 프론트엔드 스튜디오 축

- 오디오 입력 제어
- take 관리
- waveform / contour 프리뷰
- 스튜디오 믹서 및 편곡실 UI

### 2.3 분석 / 편곡 백엔드 축

- 정렬 파이프라인
- 채점 엔진
- 오디오→MIDI 변환
- 룰 기반 편곡
- 아티팩트 생성

### 2.4 데이터 / 운영 축

- DeviceProfile 중심 스키마
- job 상태 추적
- 모델 버전 기록
- 재시도와 오류 로그

### 2.5 시각 산출물 축

- canonical mockup source of truth를 `UI_MOCKUP_TRACK.md`로 고정
- Figma 또는 동등한 디자인 파일을 선호하되, repo 안에는 항상 export된 mockup asset을 함께 둔다
- `Home`, `Studio`, `Arrangement`를 먼저 high-fidelity mockup으로 고정한 뒤 구현에 연결
- 구현 화면은 임의 해석보다 frozen mockup 버전을 우선 기준으로 삼는다

## 3. 단계별 로드맵

### Phase 0. 프로젝트 기반 확정

목표:

- MVP 정의, 비목표, 기술 스택, 데이터 모델, 문서 기준을 고정한다.

주요 작업:

- 마스터 플랜 확정
- 로드맵과 체크리스트 작성
- repo bootstrap 기준 결정
- 개발 환경, 저장 구조, 분석 job 단위 정의

산출물:

- 기준 문서 세트
- 초기 폴더 구조안
- 공통 용어집 초안

완료 기준:

- “무엇을 1차 출시에서 하지 않을지”가 문서로 명확하다.
- Phase 1 착수에 필요한 기술 선택이 더 이상 흔들리지 않는다.

### Phase 1. 녹음 파이프라인과 DeviceProfile

목표:

- 사용자가 웹에서 프로젝트를 만들고, 장치를 고르고, take를 녹음하고 저장할 수 있게 한다.

주요 작업:

- 프로젝트 생성
- 가이드 트랙 업로드 또는 선택
- 마이크 입력 권한 요청과 장치 선택
- 실제 `getSettings()` 값 저장
- take 녹음, 업로드, 목록 표시
- count-in, metronome, mute / solo / volume 기본 믹서

산출물:

- 기본 스튜디오 화면
- 녹음 업로드 API
- DeviceProfile 저장 모델

완료 기준:

- 가이드 트랙이 있는 프로젝트를 만들 수 있다.
- take를 두 번 이상 녹음하고 다시 선택할 수 있다.
- 실제 sampleRate / latency / noise 처리 설정값이 저장된다.

세부 티켓 기준:

- `PHASE1_BACKLOG.md`를 단일 실행 백로그로 사용한다.

### Phase 2. 사후 정렬과 점수 엔진

목표:

- 녹음이 끝난 take를 가이드 기준으로 정렬하고, 점수와 구간 피드백을 생성한다.

주요 작업:

- coarse alignment 구현
- fine alignment 구현
- `alignment_confidence` 계산
- `pitch_score`, `rhythm_score`, `harmony_fit_score` 산출
- 피드백 JSON 스키마 정의
- 분석 job 저장과 상태 업데이트

산출물:

- 정렬 / 채점 워커
- 분석 결과 API
- 저신뢰도 상태 노출 규칙

완료 기준:

- take 하나를 넣으면 정렬 결과와 3축 점수가 나온다.
- 정렬 실패 또는 저신뢰도를 구분해 표시할 수 있다.
- 결과가 DB에 저장되고 재조회된다.

### Phase 3. 스튜디오 학습 UI

목표:

- 사용자가 왜 점수가 나왔는지 이해하고 바로 재시도할 수 있는 학습 UI를 만든다.
- 이 단계 이후의 시각 리팩터는 `Quiet Studio Console` 방향을 기준으로 한다.

주요 작업:

- waveform / contour 시각화
- 타깃 노트 / 화성 오버레이
- 점수 패널과 피드백 패널
- 오답 구간 강조
- take 비교와 재녹음 동선 정리

산출물:

- 스튜디오 학습 화면
- 재시도 중심 UX

완료 기준:

- 사용자가 take를 고르고, 문제 구간을 보고, 바로 다시 녹음할 수 있다.
- 재녹음 동선이 2클릭 이내로 유지된다.

### Phase 4. 오디오→MIDI 멜로디 변환

목표:

- 보컬 take에서 편곡 가능한 멜로디 초안을 만든다.

주요 작업:

- Basic Pitch 초벌 추출
- 리샘플 파이프라인 정리
- quantize, phrase split, key estimation
- note cleanup
- 수정 가능한 멜로디 에디트 포맷 정의

산출물:

- 멜로디 초안 생성 API
- 멜로디 검수용 데이터 포맷

완료 기준:

- 단선율 보컬 take에서 MIDI 초벌이 생성된다.
- 과도한 note fragmentation이 기본적으로 정리된다.
- 사용자가 다음 단계 편곡 입력으로 쓸 수 있는 멜로디가 확보된다.

### Phase 5. 반자동 편곡 엔진

목표:

- 멜로디 입력에서 4~5성부 후보안을 여러 개 생성한다.

주요 작업:

- 음역 제약 모델링
- max leap, 병행 5도 / 8도 회피 규칙 구현
- difficulty preset 연결
- 후보안 2~3개 생성 로직
- 템플릿 퍼커션 on / off

산출물:

- 룰 기반 성부 생성기
- 후보 비교용 arrangement 데이터

완료 기준:

- 멜로디 입력에서 후보안 2개 이상이 생성된다.
- 음역 제한과 병행 회피가 기본적으로 반영된다.
- 사용자가 후보를 선택하거나 수정할 수 있는 구조가 된다.

### Phase 6. 악보, 재생, export

목표:

- 편곡 결과를 보고, 듣고, 내보내는 흐름을 닫는다.

주요 작업:

- OSMD 기반 MusicXML 렌더링
- 재생 엔진 분리 설계
- playhead 동기화
- 파트별 color / solo / guide mode
- MIDI / MusicXML / guide WAV export

산출물:

- 편곡실 화면
- export 파이프라인
- 가이드 재생 플로우

완료 기준:

- 편곡 후보를 악보로 볼 수 있다.
- 파트별 가이드 청취와 solo가 된다.
- MusicXML, MIDI, guide WAV를 내보낼 수 있다.

### Phase 7. 운영 안정화와 출시 게이트

목표:

- 실패를 설명하고 복구할 수 있는 제품 상태를 만든다.

주요 작업:

- job 재시도
- 오류 로그와 관리자 확인 화면
- 모델 버전 기록
- 분석 timeout 정책
- 업로드 만료 정책
- 사용자용 실패 메시지 정리

산출물:

- 운영 대시보드 초안
- 실패 대응 플로우
- 출시 판정표

완료 기준:

- 실패한 분석 job을 재처리할 수 있다.
- 어떤 모델과 설정으로 결과가 나왔는지 추적 가능하다.
- 사용자에게 무응답 대신 실패 이유를 노출할 수 있다.

### Phase 8. 출시 직후 보강(P1)

목표:

- 코어 흐름은 유지한 채 학습 품질과 사용성을 강화한다.

주요 작업:

- 난이도 프리셋 UI
- 파트별 음역 프리셋
- 후보안 A / B / C 비교 개선
- beatbox 템플릿 추가
- 프로젝트 버전 히스토리
- 공유 링크
- 관리자 잡 모니터링 개선

완료 기준:

- 코어 MVP를 흔들지 않고 P1 기능이 독립적으로 추가된다.

### Phase 9. Intonation Quality Track

목표:

- 현재의 coarse MVP scorer를 note-level intonation analyzer로 끌어올리고, 강한 귀를 가진 사용자도 납득할 수 있는 sharp / flat 피드백을 만든다.

주요 작업:

- preview contour와 scoring source 분리
- frame-level pitch / note-event artifact 저장
- `attack / settle / sustain / release` note segmentation
- signed cents, stability, confidence metric 추가
- `voiced_prob` + RMS 기반 confidence weighting
- chord-aware harmony와 key-only fallback labeling
- human-rating corpus manifest와 agreement report workflow
- 실제 보컬 fixture와 threshold calibration
- note-level 피드백 UI와 제품 카피 정합성 점검

산출물:

- `PHASE9_INTONATION_BACKLOG.md`
- note-level analysis schema / API 계약
- calibration fixture 세트와 품질 리포트
- note-level 피드백 UI

완료 기준:

- API가 note-level signed cents와 confidence를 반환한다.
- 피드백이 sharp / flat 방향과 attack / sustain 차이를 구분한다.
- harmony-fit이 chord-aware인지 key-only fallback인지 명시된다.
- 실제 보컬 fixture 기반 calibration 기록이 남는다.
- 이 단계가 닫히기 전에는 제품 카피가 `정밀 음정 판정기`를 주장하지 않는다.

### Phase 10. Browser Environment Validation

목표:

- seeded 브라우저 release gate 위에 native Safari / WebKit와 real hardware recording 검증을 얹어서, 실제 환경 편차를 릴리즈 판단에 반영한다.

주요 작업:

- ops overview의 environment diagnostics report를 기준 산출물로 사용
- ops overview의 manual validation run log를 실제 검증 기록 저장소로 사용
- `BROWSER_ENVIRONMENT_VALIDATION.md` 기준 matrix 실행
- native Safari / WebKit recording, permission, playback 검증
- output route 차이:
  built-in speaker, wired headphones, Bluetooth output
- warning flag 변화와 실제 사용자 체감 이슈를 함께 기록
- release note와 unsupported path 문구 갱신

산출물:

- environment diagnostics report JSON
- manual validation run entries
- native browser validation run log
- browser / hardware compatibility notes

완료 기준:

- 최소 1회 이상의 native Safari 또는 WebKit 검증 결과가 남는다.
- 최소 1회 이상의 real hardware recorder 검증 결과가 남는다.
- warning flag와 실제 체감 이슈가 함께 기록된다.
- 릴리즈 노트가 검증된 범위와 미검증 범위를 정직하게 구분한다.

## 4. 단계 간 의존성

1. Phase 1이 닫혀야 Phase 2의 입력 데이터가 안정화된다.
2. Phase 2가 닫혀야 Phase 3 UI가 신뢰도 있는 피드백을 표시할 수 있다.
3. Phase 4가 닫혀야 Phase 5 편곡 엔진의 실제 입력이 확보된다.
4. Phase 5가 닫혀야 Phase 6에서 악보 / 재생 / export를 유의미하게 제공할 수 있다.
5. Phase 7은 마지막 단계지만, job 메타데이터와 오류 로그 구조는 Phase 2부터 함께 심는다.
6. Phase 9는 Phase 2 분석 결과를 바탕으로 확장되며, 1차 출시 컷라인 이후에도 독립적으로 진행할 수 있다.
7. 다만 Phase 9가 닫히기 전에는 채점 엔진을 `human-like intonation judge`로 포장하지 않는다.

## 5. 1차 출시 기준

아래 다섯 가지가 닫히면 1차 출시 기준 충족으로 본다.

1. 가이드 트랙이 있는 프로젝트 생성
2. 보컬 take 녹음과 저장
3. 자동 정렬과 3축 점수 반환
4. 멜로디 추출 후 4~5성부 후보 2개 이상 생성
5. 악보 보기, guide playback, MIDI / MusicXML export

위 컷라인은 `MVP vocal practice scorer` 기준이다.
note-level 정밀 음정 판정 품질은 별도 Phase 9 완료 조건으로 관리한다.

## 6. 문서 연결

이 로드맵은 아래 문서와 함께 본다.

1. [GigaStudy_master_plan.md](/C:/my_project/GigaStudy/PROJECT_FOUNDATION/GigaStudy_master_plan.md)
2. [PHASE1_BACKLOG.md](/C:/my_project/GigaStudy/PROJECT_FOUNDATION/PHASE1_BACKLOG.md)
3. [PHASE9_INTONATION_BACKLOG.md](/C:/my_project/GigaStudy/PROJECT_FOUNDATION/PHASE9_INTONATION_BACKLOG.md)
4. [INTONATION_ANALYSIS_ASSESSMENT.md](/C:/my_project/GigaStudy/PROJECT_FOUNDATION/INTONATION_ANALYSIS_ASSESSMENT.md)
5. [GigaStudy_check_list.md](/C:/my_project/GigaStudy/PROJECT_FOUNDATION/GigaStudy_check_list.md)
6. [WORKING_PRINCIPLES.md](/C:/my_project/GigaStudy/PROJECT_FOUNDATION/WORKING_PRINCIPLES.md)
