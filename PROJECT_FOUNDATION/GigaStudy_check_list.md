# GigaStudy 실행 체크리스트

기준일: 2026-04-07

이 문서는 착수 전 확인, 구현 중 점검, 출시 직전 검수를 한 번에 확인하기 위한 실행 체크리스트다.

## 1. 제품 기준 합의

- [ ] MVP 한 줄 정의를 팀이 동일하게 이해한다.
- [ ] v1 비목표가 문서에 명시돼 있다.
- [ ] “실시간 확정 채점”이 아니라 “녹음 후 정밀 분석”이 핵심 가치임을 합의했다.
- [ ] 오디오 입력 가정을 단선율 보컬 또는 개별 파트 단위로 제한했다.
- [ ] 1차 출시 컷라인 5개 항목을 기준으로 우선순위를 정한다.

## 2. 프로젝트 기반

- [ ] 프론트엔드 스택: React + TypeScript + Vite
- [ ] 오디오 처리 스택: AudioWorklet + Web Worker + OfflineAudioContext + WASM
- [ ] 백엔드 스택: FastAPI API 서버 + 분석 워커
- [ ] 분석 스택: Basic Pitch + `librosa.pyin` + `music21` + `note-seq`
- [ ] 악보 렌더링과 재생 엔진을 분리한다.
- [ ] 저장 구조: PostgreSQL + S3 호환 오브젝트 스토리지
- [ ] job 상태, 모델 버전, 아티팩트 메타데이터를 남기는 구조를 잡았다.

## 3. 녹음 파이프라인

- [ ] 프로젝트 생성이 된다.
- [ ] 가이드 트랙 업로드 또는 선택이 된다.
- [ ] 마이크 장치를 선택할 수 있다.
- [ ] `echoCancellation`, `autoGainControl`, `noiseSuppression`, `channelCount`를 요청한다.
- [ ] `getSettings()` 기반 실제 적용값을 저장한다.
- [ ] take를 여러 번 녹음하고 목록에서 다시 선택할 수 있다.
- [ ] mute / solo / volume 기본 믹서가 있다.
- [ ] count-in과 metronome이 동작한다.
- [ ] 녹음 직후 waveform과 임시 contour 프리뷰가 보인다.
- [ ] mixdown 생성 경로가 있다.

## 4. DeviceProfile / 정렬

- [ ] DeviceProfile이 user 단일값이 아니라 입력 / 출력 경로 기준으로 저장된다.
- [ ] `sampleRate`, `baseLatency`, `outputLatency`, 추정 입력 지연을 저장한다.
- [ ] `browser_user_agent`, capability snapshot, diagnostic warning flags를 저장한다.
- [ ] secure context, microphone permission, MediaRecorder codec, Web Audio / OfflineAudioContext 지원 상태를 확인할 수 있다.
- [ ] 저장 전 현재 capability warning과 저장된 DeviceProfile warning을 둘 다 UI에서 볼 수 있다.
- [ ] coarse alignment가 구현됐다.
- [ ] fine alignment가 구현됐다.
- [ ] `alignment_confidence`를 계산한다.
- [ ] 저신뢰도 상태를 사용자에게 표시한다.
- [ ] 헤드폰 모드와 스피커 캘리브레이션 예외를 구분한다.

## 5. 점수 엔진

- [ ] `pitch_score`를 반환한다.
- [ ] `rhythm_score`를 반환한다.
- [ ] `harmony_fit_score`를 반환한다.
- [ ] `feedback_json` 스키마가 정의돼 있다.
- [ ] voiced가 아닌 구간 처리 규칙이 있다.
- [ ] 낮은 confidence 구간 처리 규칙이 있다.
- [ ] 난이도별 cent 허용치 기준이 있다.
- [ ] `harmony_fit_score`가 chord-aware인지 key-only fallback인지 구분 규칙이 있다.
- [ ] 정렬 실패 / 분석 실패 시 사용자 메시지가 있다.

## 6. 스튜디오 학습 UI

- [ ] waveform / contour가 한 화면에서 보인다.
- [ ] 타깃 노트 또는 화성 오버레이가 보인다.
- [ ] 점수 패널과 피드백 패널이 분리돼 있다.
- [ ] 오답 구간이 강조된다.
- [ ] take 비교가 가능하다.
- [ ] 재녹음 동선이 짧다.

## 7. 오디오→MIDI 멜로디 변환

- [ ] Basic Pitch 초벌 생성이 된다.
- [ ] 과도한 쪼개짐을 줄이는 cleanup 단계가 있다.
- [ ] quantize가 된다.
- [ ] phrase split이 된다.
- [ ] key 추정이 된다.
- [ ] 사용자가 수정 가능한 멜로디 초안 포맷이 있다.

## 8. 반자동 편곡

- [ ] 멜로디 MIDI 또는 MusicXML 입력을 받을 수 있다.
- [ ] 후보안 2개 이상을 생성한다.
- [ ] 음역 제한을 반영한다.
- [ ] 최대 도약 제한을 반영한다.
- [ ] 병행 5도 / 8도 회피 규칙이 있다.
- [ ] difficulty preset을 받을 수 있다.
- [ ] 템플릿 퍼커션 on / off가 가능하다.
- [ ] 사용자가 후보를 선택 또는 수정할 수 있다.

## 9. 악보 / 재생 / export

- [ ] MusicXML을 canonical format으로 저장한다.
- [ ] OSMD 렌더링이 된다.
- [ ] 재생 엔진이 악보 렌더링과 분리돼 있다.
- [ ] 파트별 색상 / 숨김 / solo가 된다.
- [ ] guide playback이 된다.
- [ ] MIDI export가 된다.
- [ ] MusicXML export가 된다.
- [ ] guide WAV export가 된다.

## 10. 운영 안정화

- [ ] 분석 job 상태를 저장한다.
- [ ] 실패한 job 재시도가 가능하다.
- [ ] 모델 버전을 기록한다.
- [ ] 오류 로그를 확인할 수 있다.
- [ ] timeout / 실패 정책이 정의돼 있다.
- [ ] 업로드 보관 기간 정책이 있다.
- [ ] 사용자에게 실패 이유를 보여준다.

## 11. 1차 출시 게이트

- [ ] 가이드 트랙이 있는 프로젝트를 생성할 수 있다.
- [ ] 보컬 take를 녹음하고 저장할 수 있다.
- [ ] 자동 정렬과 3축 점수가 안정적으로 나온다.
- [ ] 멜로디 추출 후 4~5성부 후보 2개 이상이 생성된다.
- [ ] 악보 보기, guide playback, MIDI / MusicXML export가 닫혀 있다.
- [ ] 출시 직전 테스트에서 P0 범위 밖 기능이 MVP를 흔들지 않는다.
- [ ] 출시 카피가 현재 scorer를 `정밀 음정 판정기`처럼 과대 표현하지 않는다.

## 12. 정밀 음정 판정 품질 게이트

- [ ] preview contour와 scoring source가 분리돼 있다.
- [ ] frame-level pitch 또는 note-event artifact가 저장된다.
- [ ] note segmentation 기준이 `attack / settle / sustain / release` 수준으로 문서화돼 있다.
- [ ] API가 signed cents를 내려주고 sharp / flat 방향을 잃지 않는다.
- [ ] `attack_signed_cents`, `sustain_median_cents`, `sustain_mad_cents` 같은 note-level 지표가 있다.
- [ ] confidence weighting에 `voiced_prob`와 RMS 또는 이에 준하는 안정도 신호가 반영된다.
- [ ] `harmony_fit_score`가 chord-aware일 때와 key-only fallback일 때를 구분해 노출한다.
- [ ] 실제 보컬 fixture 또는 cents-shifted vocal corpus가 있다.
- [ ] threshold calibration 기록과 사람 평가 비교 기록이 있다.
- [ ] 이 게이트 전에는 `몇 cent 높고 낮은지 정확히 말해준다`는 카피를 쓰지 않는다.

## 13. 브라우저 환경 편차

- [ ] Chromium, Firefox, WebKit의 seeded safe path 차이를 문서로 남긴다.
- [ ] recorder transport는 fake microphone 기반 자동화와 실제 하드웨어 확인을 구분한다.
- [ ] Safari / WebKit 계열의 legacy audio constructor fallback 여부를 확인한다.
- [ ] real hardware variability 이슈를 capability snapshot과 diagnostic flag로 추적할 수 있다.
- [ ] ops overview에서 environment diagnostics report를 내려받을 수 있다.
- [ ] native browser 검증은 `BROWSER_ENVIRONMENT_VALIDATION.md` 기준으로 기록한다.

## 14. 지금은 하지 않을 것

- [ ] 실시간 확정 채점을 MVP에 넣지 않는다.
- [ ] OMR을 MVP에 넣지 않는다.
- [ ] 자유 chord naming 고정밀화를 MVP에 넣지 않는다.
- [ ] Web MIDI를 핵심 입력 플로우로 잡지 않는다.
- [ ] 생성형 편곡 모델을 코어 의존성으로 잡지 않는다.
