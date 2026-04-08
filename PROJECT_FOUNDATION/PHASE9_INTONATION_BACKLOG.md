# GigaStudy Phase 9 Intonation Backlog

기준일: 2026-04-08

## 0. 목적

이 문서는 Phase 9인 “Intonation Quality Track”을 실제 구현 티켓 단위로 분해한 실행 백로그다.

목표는 현재의 coarse MVP scorer를 유지하면서도, 다음 단계에서 “좋은 귀를 가진 사용자도 납득할 수 있는 note-level intonation feedback”으로 끌어올리는 것이다.

## 1. Phase 9 목표

Phase 9에서 닫아야 하는 사용자 가치:

1. 사용자가 note마다 sharp / flat 방향과 크기를 확인할 수 있다.
2. 사용자가 “시작은 높았지만 sustain는 안정적” 같은 피드백을 납득할 수 있다.
3. 시스템이 무성 구간, 불안정 구간, 약한 onset을 동일하게 감점하지 않는다.
4. `harmony_fit_score`가 chord-aware인지 key-only fallback인지 구분된다.
5. 제품 팀이 점수 품질을 실제 보컬 fixture와 사람 평가 기준으로 설명할 수 있다.

## 2. Phase 9 비포함 범위

아래는 Phase 9 티켓으로 잡지 않는다.

- 자유 오디오에서 완전 자동 chord naming 고정밀화
- 다성 보컬 동시 입력의 완전한 note 분리
- 실시간 확정 채점
- 생성형 편곡 모델 고도화
- OMR

## 3. Phase 9 완료 판정

아래가 모두 되면 Phase 9 완료로 본다.

- preview contour와 scoring source가 분리된다.
- 분석 API가 note-level signed cents와 confidence를 반환한다.
- 점수와 피드백이 note segmentation 기준으로 계산된다.
- chord-aware harmony와 key-only fallback이 구분된다.
- 실제 보컬 fixture 또는 cents-shifted vocal corpus로 calibration report가 있다.
- 제품 카피가 현재 품질 단계와 충돌하지 않는다.

## 4. Phase 9 고정 결정

- 64포인트 preview contour는 UI 시각화 전용이다.
- scoring source는 `frame_pitch` 또는 `note_events` artifact를 기준으로 한다.
- cents 오차는 부호를 유지한 `signed cents`를 기본값으로 삼는다.
- note segmentation은 최소 `attack / settle / sustain / release`를 구분한다.
- `voiced_prob`와 RMS 기반 confidence weighting을 점수 합성에 사용한다.
- chord timeline이 없으면 key-only fallback을 허용하되 결과를 명시적으로 라벨링한다.
- 실제 사용 품질 평가는 sine wave만으로 통과시키지 않는다.

## 5. 권장 착수 순서

1. `IQ-SC-01`, `IQ-SC-02`로 데이터 계약과 artifact 스키마를 먼저 닫는다.
2. `IQ-WK-01`, `IQ-WK-02`로 frame-level pitch와 note-event 생성 파이프라인을 만든다.
3. `IQ-BE-01`, `IQ-BE-02`로 signed cents scorer와 aggregate score 합성 규칙을 붙인다.
4. `IQ-BE-03`으로 confidence weighting을 반영한다.
5. `IQ-BE-04`로 chord-aware harmony와 fallback labeling을 붙인다.
6. `IQ-FE-01`, `IQ-FE-02`로 note-level 피드백 UI를 연다.
7. `IQ-QA-01`, `IQ-QA-02`, `IQ-QA-03`으로 calibration과 claim gate를 닫는다.

## 6. 스키마 / 계약 티켓

### IQ-SC-01. note-level analysis artifact 계약

목적:

- 점수 계산과 UI가 같은 note-level 사실 집합을 보도록 공통 포맷을 만든다.

범위:

- `frame_pitch` artifact 포맷 정의
- `note_events` artifact 포맷 정의
- `confidence_summary_json` 구조 정의
- `pitch_quality_mode`, `harmony_reference_mode` enum 정의

선행:

- 없음

완료 기준:

- 분석 결과가 preview contour 없이도 재현 가능하다.
- API와 DB가 같은 artifact 버전을 참조할 수 있다.

### IQ-SC-02. chord reference와 fallback 계약

목적:

- `harmony_fit_score`가 무엇을 기준으로 계산됐는지 숨기지 않게 한다.

범위:

- `chord_timeline` artifact 정의
- chord-aware와 key-only fallback 응답 필드 정의
- chord marker 미존재 시 fallback 규칙 문서화

선행:

- 없음

완료 기준:

- UI와 API에서 harmony reference mode를 일관되게 노출할 수 있다.
- 운영자가 “왜 이 harmony score가 나왔는지” 설명할 수 있다.

## 7. 워커 / 분석 티켓

### IQ-WK-01. frame-level pitch artifact 생성

목적:

- UI preview와 별개로 정밀 판정을 위한 frame-level pitch source를 저장한다.

범위:

- `librosa.pyin`의 `f0`, `voiced_flag`, `voiced_prob` 추출
- RMS / energy feature 저장
- canonical audio 기준 frame pitch artifact 생성

선행:

- `IQ-SC-01`

완료 기준:

- take마다 frame-level pitch artifact가 저장된다.
- voiced와 low-confidence frame을 나중 단계에서 다시 필터링할 수 있다.

### IQ-WK-02. note segmentation과 note-event artifact 생성

목적:

- coarse 4분할 대신 note 기준의 판단 단위를 만든다.

범위:

- onset / offset 추정
- `attack / settle / sustain / release` window 생성
- target note 기준 note-event artifact 저장

선행:

- `IQ-WK-01`

완료 기준:

- note마다 시작 / sustain / release window가 정의된다.
- feedback 생성기가 quarter split 대신 note event를 사용한다.

## 8. 백엔드 티켓

### IQ-BE-01. signed cents scorer와 note score 합성

목적:

- sharp / flat 방향을 유지한 note-level 점수 경로를 만든다.

범위:

- `delta_cents = 1200 * log2(f0 / target_f0)` 적용
- `attack_signed_cents`, `sustain_median_cents`, `max_sharp_cents`, `max_flat_cents` 산출
- note score 가중치 구현
- aggregate `pitch_score` 합성

선행:

- `IQ-WK-01`
- `IQ-WK-02`

완료 기준:

- API가 sharp / flat 방향을 잃지 않는다.
- note-level과 aggregate pitch score가 함께 저장된다.

### IQ-BE-02. feedback v2와 API 계약

목적:

- 사람이 납득할 note-level 피드백 문장을 API로 내려준다.

범위:

- feedback schema v2 정의
- note-level message 생성
- 기존 coarse feedback과의 하위 호환 전략 정의

선행:

- `IQ-BE-01`

완료 기준:

- “시작은 높았지만 sustain는 안정적” 같은 문장이 note 단위로 생성된다.
- API 응답만 보고도 어떤 note가 문제인지 알 수 있다.

### IQ-BE-03. confidence weighting 적용

목적:

- 무성 구간과 불안정 구간을 사람 귀에 더 가까운 방식으로 처리한다.

범위:

- `voiced_prob` 기반 frame weighting
- RMS / energy 기반 confidence 보정
- unvoiced / low-confidence 제외 규칙

선행:

- `IQ-WK-01`
- `IQ-BE-01`

완료 기준:

- 자음-heavy onset과 무성 구간이 그대로 pitch penalty로 누적되지 않는다.
- confidence가 낮은 note는 결과와 UI에 함께 표시된다.

### IQ-BE-04. chord-aware harmony-fit와 fallback labeling

목적:

- `harmony_fit_score`를 실제 화성 기준으로 개선하고, fallback도 숨기지 않는다.

범위:

- chord timeline 입력 지원
- chord-aware harmony score 계산
- key-only fallback labeling

선행:

- `IQ-SC-02`
- `IQ-WK-02`

완료 기준:

- chord marker가 있을 때 chord-aware harmony가 계산된다.
- chord timeline이 없으면 fallback임이 API와 UI에 표시된다.

## 9. 프론트엔드 티켓

### IQ-FE-01. note-level 피드백 패널

목적:

- 사용자가 추상 점수 대신 문제 note를 보고 바로 교정할 수 있게 한다.

범위:

- note list / timeline
- sharp / flat direction 표시
- attack / sustain / timing 구분 표시
- confidence 배지

선행:

- `IQ-BE-02`

완료 기준:

- 사용자가 어느 note에서 얼마나 높거나 낮았는지 본다.
- aggregate score와 note feedback을 함께 이해할 수 있다.

### IQ-FE-02. harmony reference와 품질 단계 표시

목적:

- 사용자가 harmony score의 기준과 현재 품질 수준을 오해하지 않게 한다.

범위:

- `chord_aware` / `key_only` 라벨
- coarse scorer / note-level scorer 단계 표시
- 저신뢰 note UI 규칙

선행:

- `IQ-BE-03`
- `IQ-BE-04`

완료 기준:

- 사용자와 운영자가 현재 분석 모드를 혼동하지 않는다.
- fallback 결과가 정밀 chord-aware 결과처럼 보이지 않는다.

## 10. 품질 / 캘리브레이션 티켓

### IQ-QA-01. 실제 보컬 fixture 세트 구축

목적:

- sine wave 중심 테스트를 사람 목소리 기준으로 보강한다.

범위:

- 실제 보컬 fixture 수집 또는 사내 녹음셋 구성
- cents-shifted vocal corpus 준비
- 대표 실패 케이스 정리

선행:

- 없음

완료 기준:

- 최소한 `sharp attack`, `flat sustain`, `overshoot then settle`, `breathy onset`, `vibrato centered`, `portamento` 케이스가 포함된다.

### IQ-QA-02. threshold calibration report

목적:

- 난이도별 cent 허용치와 점수식을 사람 평가 기준으로 다시 맞춘다.

범위:

- 입문 / 기본 / 엄격 threshold 재검토
- note score weight calibration
- human rating 비교 리포트 작성

선행:

- `IQ-BE-01`
- `IQ-QA-01`

완료 기준:

- threshold와 score weight에 대한 기록이 남는다.
- “왜 이 점수가 82점인지” 운영자가 설명할 수 있다.

### IQ-QA-03. 제품 카피와 출시 게이트 감사

목적:

- 구현 수준보다 과장된 메시지가 나가지 않게 한다.

범위:

- 제품 카피 점검
- 데모 스크립트 점검
- release gate와 체크리스트 반영

선행:

- `IQ-BE-02`
- `IQ-FE-02`
- `IQ-QA-02`

완료 기준:

- note-level 품질 게이트 전에는 과장된 판정 표현이 남아 있지 않다.
- 정밀 판정 관련 카피가 구현 수준과 일치한다.
