# GigaStudy 프로젝트 기획 및 상세 설계서

기준일: 2026-04-07

## 0. 프로젝트 정의

GigaStudy는 웹 기반 보컬 학습 및 반자동 아카펠라 편곡 스튜디오다.

클라이언트는 멀티트랙 녹음, 가이드 재생, 임시 피치 시각화, 믹스다운 프리뷰를 담당하고, 서버는 사후 정밀 정렬, 채점, 오디오→MIDI 변환, 4~5성부 후보 생성, MusicXML/MIDI/guide 산출을 담당한다.

이 프로젝트의 중심 가치는 실시간 확정 판정이 아니라, 녹음 후 정확도 높은 분석과 학습 피드백이다.

## 1. MVP 한 줄 정의

사용자가 웹에서 가이드에 맞춰 여러 보컬 take를 녹음하고, 녹음 후 자동 정렬·채점 받고, 멜로디를 4~5성부 후보 악보로 받아 수정·재생·내보내는 서비스.

## 2. 목표 사용자와 대표 시나리오

- 소규모 아카펠라 팀이 파트 연습용 가이드와 피드백을 빠르게 받고 싶다.
- 개인 보컬 학습자가 pitch, rhythm, harmony-fit을 분리된 피드백으로 보고 싶다.
- 편곡 입문자가 멜로디만으로 4~5성부 후보를 여러 개 받아 수정하고 싶다.

대표 사용자 흐름은 아래와 같다.

1. 프로젝트를 만들고 템포, 조성, 가이드 트랙을 정한다.
2. 마이크와 출력 경로를 선택하고 실제 적용된 오디오 설정값을 저장한다.
3. 여러 take를 녹음하고 브라우저에서 파형과 임시 피치 contour를 확인한다.
4. 서버에서 take를 정렬하고 pitch, rhythm, harmony-fit 점수와 구간 피드백을 생성한다.
5. 멜로디를 MIDI로 추출하거나 직접 MIDI/MusicXML을 넣어 4~5성부 후보안을 만든다.
6. 사용자는 악보를 보고 수정하고 재생하고 MusicXML, MIDI, guide WAV를 내보낸다.

## 3. 제품 목표와 비목표

### 3.1 목표

- 브라우저에서 안정적으로 멀티 take 보컬 녹음을 수행한다.
- 녹음 후 사후 정렬을 거쳐 신뢰도 있는 점수와 구간 피드백을 제공한다.
- 보컬 멜로디 또는 MIDI/MusicXML 입력에서 4~5성부 후보안을 자동 생성한다.
- 결과를 악보, 가이드 재생, 내보내기 흐름까지 한 번에 닫는다.

### 3.2 비목표(v1)

- 브라우저에서의 실시간 확정 채점
- 자유 혼합 오디오에서의 고정밀 chord naming
- PDF 또는 스캔 악보 OMR
- Web MIDI를 핵심 입력 흐름으로 두는 구조
- 브라우저 WebGPU 의존형 추론
- 생성형 편곡 모델을 코어 의존성으로 두는 구조

## 4. MVP 범위표

### 4.1 반드시 포함하는 범위(P0)

| 영역 | 포함 기능 | MVP 판정 기준 |
| --- | --- | --- |
| 오디오 설정 / 디바이스 프로파일 | 마이크 선택, `echoCancellation`/`autoGainControl`/`noiseSuppression` 요청, `getSettings()` 저장, `getSupportedConstraints()` 저장, browser audio capability snapshot 저장, device profile 저장 | 실제 sampleRate, latency, 노이즈 처리 적용 여부와 브라우저 오디오 지원 상태를 함께 확인하고 저장할 수 있어야 한다. |
| 스튜디오 핵심 흐름 | 프로젝트 생성, 가이드 업로드 또는 선택, take 녹음, mute/solo/volume, count-in, metronome, take 저장, mixdown | 사용자가 웹에서 녹음하고 take를 다시 골라 들을 수 있어야 한다. |
| 사후 정렬 + 채점 | coarse alignment, fine alignment, `alignment_confidence`, `pitch_score`, `rhythm_score`, `harmony_fit_score`, 구간 피드백 JSON | 정렬 실패나 저신뢰도를 감지하고 점수와 함께 보여줘야 한다. |
| 멜로디 추출 | 오디오→MIDI 초벌, quantize, phrase split, key 추정, note cleanup | 단선율 보컬 또는 개별 파트 입력 기준으로 수정 가능한 멜로디 초안이 나와야 한다. |
| 반자동 편곡 | 4~5성부 후보안 2~3개, 음역/도약/병행 회피 제약, 템플릿 퍼커션 on/off, 사용자 수정 가능 | 정답 1개가 아니라 선택 가능한 후보안을 제공해야 한다. |
| 악보 / 재생 / export | MusicXML 렌더링, 파트별 color/solo/guide mode, MIDI export, MusicXML export, guide WAV export | 악보 엔진과 재생 엔진이 분리된 상태로 보여주기와 내보내기가 닫혀야 한다. |

### 4.2 출시 직후 보강 범위(P1)

- 난이도 프리셋: 입문 / 기본 / 엄격
- 파트별 음역 프리셋: S / A / T / B / Baritone
- 편곡 후보 A/B/C 비교 UI
- beatbox 템플릿 3~5종
- 프로젝트 버전 히스토리
- 공유 링크
- 관리자용 잡 상태 모니터링

### 4.3 MVP에서 제외하는 범위(P2 이후)

- 실시간 확정 점수
- 자유 오디오에서의 정밀 chord naming
- PDF / 스캔 악보 OMR
- Web MIDI 중심 입력 플로우
- 협업 편집 / 동시 작업
- 브라우저 WebGPU 의존형 추론
- 생성형 편곡 모델 코어 의존

## 5. 최종 기술 스택

### 5.1 프론트엔드

- React 19.2
- TypeScript
- Vite
- Zustand
- TanStack Query
- AudioWorklet
- Web Worker
- OfflineAudioContext
- WASM
- OSMD
- Tone.js 또는 Web Audio 기반 자체 플레이어

### 5.2 백엔드 / 분석

- FastAPI API 서버
- 백그라운드 분석 워커
- Basic Pitch
- `librosa.pyin`
- `music21`
- `note-seq`
- 룰 기반 편곡 엔진

### 5.3 저장소 / 인프라

- PostgreSQL
- S3 호환 오브젝트 스토리지
- 비동기 job queue
- 모델 버전 및 아티팩트 메타데이터 추적

## 6. 시스템 구조

### 6.1 프론트엔드 책임

- 장치 선택과 오디오 설정값 저장
- 녹음 세션 제어와 take 관리
- waveform / contour 프리뷰
- 스튜디오 믹서 UI
- 편곡 후보 선택과 악보 보기
- guide playback / export 요청

### 6.2 백엔드 책임

- 업로드된 take 저장과 메타데이터 관리
- 사후 정렬과 점수 계산
- 오디오→MIDI 초벌 생성과 정리
- 룰 기반 성부 후보 생성
- MusicXML / MIDI / guide WAV 아티팩트 생성
- job 상태 추적과 재시도

### 6.3 입력 가정

- MVP의 오디오 입력은 단선율 보컬 또는 개별 파트 단위 처리로 제한한다.
- 편곡 엔진의 입력은 보컬 오디오, 멜로디 MIDI, MusicXML 세 가지로 제한한다.
- 자유 혼합 음원 전체를 한 번에 완성형 편곡으로 만드는 기능은 후속 버전으로 미룬다.

## 7. 오디오 / 정렬 / 채점 설계

### 7.1 입력 제약과 실제 적용값

- `echoCancellation: false`, `autoGainControl: false`, `noiseSuppression: false`, `channelCount: 1`을 우선 요청한다.
- 요청값은 보장되지 않으므로 `getSupportedConstraints()`와 `track.getSettings()`로 실제 적용값을 읽어 저장한다.
- `sampleRate`, `latency`, `channelCount`, 출력 경로를 함께 기록한다.
- secure context 여부, Permissions API 마이크 상태, MediaRecorder codec 지원, Web Audio / OfflineAudioContext 지원 여부도 함께 기록한다.
- 브라우저별 capability warning flag를 계산해 저장하고, 저장 전 현재 상태와 저장된 DeviceProfile 양쪽에서 모두 노출한다.

### 7.2 DeviceProfile 기준 저장

- 보정값은 user 단일값이 아니라 `user + browser + os + input_device + output_route` 기준의 `DeviceProfile`로 저장한다.
- 블루투스 이어폰, 내장 스피커, 유선 헤드폰은 같은 사용자라도 지연 특성이 다르므로 분리 저장한다.
- DeviceProfile은 요청값과 실제 적용값 외에도 `browser_user_agent`, `capabilities_json`, `diagnostic_flags_json`을 포함한 환경 진단 스냅샷을 저장한다.
- `capabilities_json`에는 최소한 `secure_context`, `media_devices`, `permissions`, `web_audio`, `media_recorder`, `audio_playback` 정보가 들어간다.
- `diagnostic_flags_json`은 `microphone_permission_denied`, `legacy_webkit_audio_context_only`, `missing_offline_audio_context`, `no_supported_recording_mime_type` 같은 환경 리스크를 정규화된 키로 남긴다.

### 7.3 2단계 정렬

- 1차 coarse alignment: `baseLatency`, `outputLatency`, `getOutputTimestamp()`, device profile 보정값으로 대략적인 시간축을 맞춘다.
- 2차 fine alignment: onset 패턴, count-in marker, 필요 시 cross-correlation으로 take별 미세 정렬을 한다.
- 결과로 `alignment_confidence`를 계산하고, 신뢰도가 낮으면 UI에서 명시한다.

### 7.4 채점 규칙

- 확정 채점은 서버에서 수행한다.
- 점수 축은 `pitch_score`, `rhythm_score`, `harmony_fit_score` 세 축을 기본으로 둔다.
- `voiced`가 아닌 구간, 신뢰도가 낮은 구간은 감점 대상에서 제외하거나 가중치를 낮춘다.
- 기본 난이도 기준 cent 허용치는 아래처럼 둔다.
  - 입문: ±25 cents
  - 기본: ±20 cents
  - 엄격: ±15 cents
- 피드백은 총점 한 줄이 아니라 구간형 문장으로 저장한다.

### 7.5 note-level 음정 판정 규격

- 64포인트 preview contour는 UI 프리뷰 전용 요약본으로 취급한다.
- `pitch_score`, `harmony_fit_score`, note-level 피드백은 frame-level pitch sequence 또는 note-event artifact를 기준으로 계산한다.
- 서버는 최소 `attack`, `settle`, `sustain`, `release` 구간을 구분할 수 있는 note segmentation 규칙을 가진다.
- 기본 window 기준은 아래처럼 둔다.
  - `attack`: note onset부터 `120ms` 또는 note 길이의 첫 `25%` 중 더 짧은 구간
  - `settle`: `attack` 직후부터 추가 `120~200ms`의 overshoot recovery 관찰 구간
  - `sustain`: `attack`과 `release`를 제외한 중심 안정 구간
  - `release`: 음 끝 tail 구간. 기본 점수 가중치는 낮게 두고 timing / release 이상 탐지에 우선 사용한다.
- 최소 반환 단위는 phrase 4등분이 아니라 note event다.
- note-level 출력은 아래 값을 담을 수 있어야 한다.
  - `note_index`, `target_midi`, `start_ms`, `end_ms`
  - `attack_signed_cents`
  - `sustain_median_cents`
  - `sustain_mad_cents`
  - `max_sharp_cents`, `max_flat_cents`
  - `in_tune_ratio`
  - `timing_offset_ms`
  - `confidence`
  - `message`

### 7.6 점수 합성 규칙

- cents 오차는 `delta_cents = 1200 * log2(f0 / target_f0)`로 계산하고 부호를 유지한다.
- note score는 아래 가중치를 기본으로 둔다.
  - `attack_score`: `0.25`
  - `sustain_score`: `0.55`
  - `stability_score`: `0.10`
  - `timing_score`: `0.10`
- `attack_score`는 `attack_signed_cents`의 절대 오차와 overshoot를 함께 본다.
- `sustain_score`는 `sustain_median_cents`를 중심으로 계산한다.
- `stability_score`는 `sustain_mad_cents`와 `in_tune_ratio`를 반영한다.
- 최종 `pitch_score`는 note score를 `confidence`와 유효 voiced duration으로 가중 평균한 값으로 계산한다.
- `voiced_prob`, RMS, 무성 구간 비율은 note `confidence` 계산에 반영한다.

### 7.7 harmony-fit 판정 규칙

- `harmony_fit_score`는 melody intonation과 분리해 계산한다.
- chord marker 또는 chord timeline이 있으면 chord-aware harmony를 우선 사용한다.
- chord timeline이 없을 때만 key-scale fallback을 허용한다.
- fallback 결과는 `harmony_reference_mode = key_only`처럼 API와 UI에 명시한다.
- key-only fallback 결과를 chord-aware 정밀 판정처럼 홍보하지 않는다.

### 7.8 제품 카피와 정밀 판정 클레임 정책

- 현재 MVP scorer는 `녹음 후 학습용 보컬 채점기`로 설명한다.
- 아래 표현은 Phase 9 품질 트랙 완료 전에는 쓰지 않는다.
  - `정밀 음정 판정기`
  - `몇 cent 높고 낮은지 정확히 알려주는 도구`
  - `사람 귀 수준의 intonation judge`
- 제품 카피가 `sharp / flat 방향`, `attack vs sustain`, `vibrato 중심 안정도`를 주장하려면 note-level 품질 게이트가 선행돼야 한다.

## 8. 핵심 기능 명세

### FR 1. 스튜디오 / 멀티트랙 녹음

- 단일 프로젝트 안에서 여러 take를 녹음한다.
- 각 트랙은 mute / solo / volume / part type을 가진다.
- 가이드 트랙, click, count-in을 제공한다.
- 녹음 직후 브라우저에서 preview pitch contour와 waveform을 그린다.
- 완료 후 OfflineAudioContext로 mixdown을 만든다.

### FR 2. 채점 및 학습 피드백

- 실시간 프리뷰는 브라우저에서 대략적 contour만 보여준다.
- 확정 채점은 서버에서 pYIN 기반 분석과 note segmentation으로 수행한다.
- 피드백은 “시작음”, “sustain”, “박 시작”, “현재 화성과의 간격” 같은 구간형 문장으로 반환한다.
- 정밀 판정 단계에서는 aggregate score 외에 signed-cent 기반 note-level 산출물을 함께 보관하고 API로 노출할 수 있어야 한다.

### FR 3. 멜로디 추출

- 오디오 입력일 때는 Basic Pitch로 MIDI 초벌을 만든다.
- 이후 quantize, phrase split, key estimation, melody cleanup을 수행한다.
- 사용자 수정이 가능한 멜로디 초안을 확보해야 한다.

### FR 4. 반자동 편곡

- 편곡 엔진은 룰 기반 후보 생성기를 중심에 둔다.
- 제약 입력은 key, style, difficulty, voice range, max leap, parallel fifth / octave avoidance, beatbox on / off를 받는다.
- 출력은 정답 1개가 아니라 후보안 2~3개 이상이다.
- 퍼커션은 v1에서 템플릿 기반으로 시작한다.

### FR 5. 악보 / 재생 / export

- MusicXML을 canonical format으로 저장한다.
- 브라우저에서는 OSMD로 렌더링한다.
- 재생은 Tone.js 또는 별도 Web Audio 엔진으로 처리한다.
- 결과물은 MusicXML, MIDI, guide WAV로 export한다.

### FR 6. 기존 악보 입력

- v1 입력 포맷은 MusicXML / MIDI를 우선한다.
- PDF / 스캔 악보 OMR은 별도 워크플로우가 필요한 후속 기능으로 둔다.

## 9. UI / UX 기준

- GigaStudy의 canonical UI source of truth는 `DESIGN/UI_SCREEN_SPEC_PACKAGE/`다.
- `/`의 첫 화면은 marketing home이 아니라 `Root Launch Screen`으로 정의한다.
- 아래 View 기준은 기능 배치와 학습 흐름의 기준이고, 고정된 시각 톤, 타이포그래피, 연결 규칙은 `DESIGN/UI_SCREEN_SPEC_PACKAGE/README.md`와 각 화면 spec을 함께 본다.

### View 1. 오디오 설정 / 캘리브레이션

- 마이크 장치 선택
- 실제 적용된 sampleRate / channelCount / latency 표기
- AEC / AGC / NS 적용 여부 표기
- 현재 브라우저 capability warning 표기
- 저장된 DeviceProfile capability warning 표기
- 스피커 캘리브레이션은 선택형
- 헤드폰 모드 안내

### View 2. 스튜디오

- 상단: tempo, key, chord marker, count-in 설정
- 중앙: waveform + pitch contour + 타깃 노트 / 화성 오버레이
- 하단: 트랙 리스트, 녹음 / 재생 / 정렬 상태
- 우측: pitch / rhythm / harmony 점수와 진단 피드백

### View 3. 편곡실

- 상단: 후보안 A / B / C 탭
- 중앙: 4~5성부 악보
- 좌측: 스타일 / 난이도 / 음역 / 퍼커션 제약
- 우측: 파트별 solo, guide mode, export 버튼

## 10. 데이터 모델 기준

기존 `Users.offset_latency` 단일 컬럼은 제거하고 아래 구조를 기준으로 잡는다.

### Users

- `user_id`
- `nickname`
- `created_at`

### DeviceProfiles

- `device_profile_id`
- `user_id`
- `browser`
- `os`
- `input_device_hash`
- `output_route`
- `browser_user_agent`
- `requested_constraints_json`
- `applied_settings_json`
- `capabilities_json`
- `diagnostic_flags_json`
- `actual_sample_rate`
- `input_latency_est`
- `base_latency`
- `output_latency`
- `calibration_method`
- `calibration_confidence`

### Projects

- `project_id`
- `user_id`
- `title`
- `bpm`
- `base_key`
- `time_signature`
- `mode`
- `created_at`

### Tracks

- `track_id`
- `project_id`
- `part_type`
- `take_no`
- `audio_url`
- `actual_sample_rate`
- `duration_ms`
- `alignment_offset_ms`
- `alignment_confidence`
- `created_at`

### AnalysisJobs

- `job_id`
- `project_id`
- `track_id`
- `job_type`
- `status`
- `model_version`
- `requested_at`
- `finished_at`
- `error_message`

### Scores

- `score_id`
- `project_id`
- `track_id`
- `pitch_score`
- `rhythm_score`
- `harmony_fit_score`
- `total_score`
- `pitch_quality_mode`
- `harmony_reference_mode`
- `feedback_json`

### NoteAnalysisArtifacts

- `note_analysis_id`
- `project_id`
- `track_id`
- `analysis_job_id`
- `artifact_type`
- `version`
- `payload_json`
- `confidence_summary_json`

기본 `artifact_type`는 아래를 포함한다.

- `frame_pitch`
- `note_events`
- `chord_timeline`
- `alignment_debug`

### Arrangements

- `arrangement_id`
- `project_id`
- `input_source_type`
- `style`
- `difficulty`
- `constraint_json`
- `musicxml_url`
- `midi_url`
- `guide_audio_url`

### Artifacts

- `artifact_id`
- `project_id`
- `artifact_type`
- `url`
- `meta_json`
- `created_at`

## 11. 개발 우선순위

### 1순위. 녹음 파이프라인과 디바이스 프로파일

- 프로젝트 생성
- 가이드 재생
- 보컬 take 녹음
- 오디오 업로드
- 트랙 리스트 렌더링
- 실제 sampleRate / latency / 노이즈 처리 여부 저장

완료 기준:

- 프로젝트 생성이 된다.
- 가이드 트랙이 재생된다.
- take를 녹음하고 다시 고를 수 있다.
- 업로드와 메타데이터 저장이 된다.
- 실제 적용 오디오 설정값이 화면과 DB에 보인다.

### 2순위. 사후 정렬과 점수 엔진

- take 정렬
- 정렬 실패 / 저신뢰도 감지
- 3축 점수 반환
- 구간별 피드백 JSON 생성
- 결과 DB 저장

### 3순위. 스튜디오 UI

- take 선택
- waveform / contour 표시
- 오답 구간 강조
- 피드백 텍스트 표시
- 재녹음 동선 2클릭 이내

### 4순위. 오디오→MIDI 멜로디 변환

- Basic Pitch 초벌 생성
- note cleanup
- bpm / grid 기준 quantize
- key 추정
- 수정 가능한 멜로디 초안 생성

### 5순위. 반자동 편곡 엔진

- melody MIDI 입력
- 후보안 2~3개 생성
- 파트별 음역 제한 반영
- 병행 5도 / 8도 최소화
- 템플릿 퍼커션 on / off

### 6순위. 악보 렌더링, 재생, export

- MusicXML 표시
- 파트별 색상 / 숨김
- playhead 동기화
- MIDI / MusicXML / guide WAV export

### 7순위. 운영 안정화

- 실패 job 재처리
- 모델 버전 추적
- 오류 로그 확인
- 사용자에게 실패 이유 노출
- 관리자 모니터링 기초

## 12. 1차 출시 컷라인

아래 다섯 가지가 모두 닫히면 1차 출시 가능 상태로 본다.

1. 가이드 트랙이 있는 프로젝트 생성
2. 보컬 take 녹음과 저장
3. 자동 정렬과 3축 점수 반환
4. 멜로디 추출 후 4~5성부 후보 2개 이상 생성
5. 악보 보기, guide playback, MIDI / MusicXML export

## 13. 성공 지표와 운영 기준

- 사용자가 첫 녹음부터 점수 확인까지의 흐름을 끊기지 않고 완료할 수 있어야 한다.
- 정렬 실패 또는 저신뢰도 상태가 침묵하지 않고 명시되어야 한다.
- 편곡 후보는 “사용 불가한 더미”가 아니라 수정 가능한 출발점이어야 한다.
- export 산출물은 최소한 MusicXML과 MIDI에서 재사용 가능해야 한다.
- 분석 job은 재시도와 오류 확인이 가능해야 한다.
- `정밀 음정 판정`을 주장하는 경우, note-level signed cents와 human-vocal calibration gate를 함께 통과해야 한다.

## 14. 주요 리스크와 대응

- 브라우저 / 장치별 지연 편차
  - 대응: device profile, 사후 정렬, `alignment_confidence` 표시
- AI 편곡 기대치 과대
  - 대응: 정답 1개가 아니라 제약 기반 후보안 여러 개 제공
- 오디오 입력 품질 편차
  - 대응: 헤드폰 모드 안내, 실제 적용 설정값 저장, 실패 피드백 노출
- 정밀 음정 채점 기대치 과대
  - 대응: preview scorer와 note-level quality track을 구분하고, claim policy와 calibration gate를 함께 운영
- 라이선스 및 유지보수성
  - 대응: Basic Pitch, `note-seq`, `music21`, OSMD 중심으로 두고 AGPL 계열과 아카이브 프로젝트는 코어 의존에서 제외

## 15. 출시 전 반드시 확정할 의사결정

- 인증 범위: 내부 사용자 중심인지, 외부 사용자 가입형인지
- 저장 정책: 오디오 원본과 export 산출물의 보관 기간
- 작업 큐: 단일 워커 시작인지, 분석 / 편곡 워커 분리인지
- 편곡 스타일 프리셋: v1에 어떤 스타일을 몇 개까지 넣을지
- 공유 범위: 개인 프로젝트 전용인지, 읽기 전용 공유 링크까지 포함할지
- chord reference source: 수동 chord marker 우선인지, guide 기반 추정 fallback까지 포함할지
