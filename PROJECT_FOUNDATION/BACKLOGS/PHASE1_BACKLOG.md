# GigaStudy Phase 1 Backlog

기준일: 2026-04-07

## 0. 목적

이 문서는 Phase 1인 “녹음 파이프라인과 DeviceProfile”을 실제 구현 티켓 단위로 분해한 실행 백로그다.

목표는 큰 방향을 다시 설명하는 것이 아니라, 프론트엔드 / 백엔드 / 워커 / 스키마 단위로 바로 착수 가능한 작업판을 만드는 것이다.

## 1. Phase 1 목표

Phase 1에서 닫아야 하는 사용자 가치:

1. 사용자가 프로젝트를 만들 수 있다.
2. 가이드 트랙을 붙이고 재생할 수 있다.
3. 마이크와 출력 환경을 선택하고 실제 적용된 오디오 설정값을 저장할 수 있다.
4. 여러 개의 보컬 take를 녹음하고 업로드하고 다시 선택할 수 있다.
5. 트랙 리스트와 기본 믹서 상태를 볼 수 있다.
6. 믹스다운 프리뷰 또는 저장 경로를 확보할 수 있다.

## 2. Phase 1 비포함 범위

아래는 Phase 1 티켓으로 잡지 않는다.

- 사후 정렬과 점수 엔진
- `alignment_confidence`
- 오디오→MIDI 멜로디 변환
- 4~5성부 후보 생성
- MusicXML 렌더링
- 관리자 대시보드

## 3. Phase 1 완료 판정

아래가 모두 되면 Phase 1 완료로 본다.

- 프로젝트 생성이 된다.
- 가이드 트랙이 프로젝트에 연결된다.
- `getSettings()` 기준 실제 오디오 설정값이 저장된다.
- take를 2개 이상 녹음하고 업로드해 다시 선택할 수 있다.
- 트랙 리스트에서 guide와 take 상태를 볼 수 있다.
- mixdown 아티팩트 경로가 있다.

## 4. Phase 1 고정 결정

- 업로드는 API 프록시 대신 pre-signed URL 또는 이에 준하는 직접 업로드 방식으로 설계한다.
- 오디오 원본은 보존하고, 필요하면 워커에서 canonical asset을 추가 생성한다.
- DeviceProfile은 user 단일값이 아니라 `browser + os + input_device_hash + output_route` 기준으로 upsert한다.
- 트랙 역할은 최소 `GUIDE`, `VOCAL_TAKE`, `MIXDOWN`으로 구분한다.
- Phase 1의 파형 프리뷰는 브라우저 즉시 계산을 우선하고, 워커 기반 peaks 생성은 재로딩 최적화 용도로 둔다.

## 5. 권장 착수 순서

1. `SC-01`, `SC-02`로 스키마 기준을 먼저 닫는다.
2. `BE-01`과 `FE-01`로 프로젝트 생성 흐름을 연다.
3. `SC-03`, `BE-02`, `BE-04`로 guide / take 업로드 수명주기를 만든다.
4. `BE-03`, `FE-02`로 DeviceProfile 저장을 붙인다.
5. `FE-03`, `FE-04`로 가이드 재생과 녹음을 닫는다.
6. `WK-01`, `WK-02`로 업로드 후 메타데이터와 canonical asset 처리를 붙인다.
7. `BE-05`, `FE-05`, `FE-06`으로 스튜디오 화면을 실사용 가능하게 만든다.
8. `BE-06`, `FE-07`, `WK-03`으로 mixdown 저장과 기본 재처리 구조를 닫는다.

## 6. 스키마 티켓

### SC-01. 프로젝트 / 트랙 / 아티팩트 코어 스키마

목적:

- 프로젝트, 가이드, take, mixdown을 저장할 최소 도메인 모델을 만든다.

범위:

- `Projects` 테이블 정의
- `Tracks` 테이블 정의
- `Artifacts` 테이블 정의
- 공통 timestamp, foreign key, soft delete 여부 결정
- `track_role`, `track_status`, `artifact_type` enum 정의

선행:

- 없음

완료 기준:

- 마이그레이션이 깨끗하게 적용된다.
- 프로젝트 1개에 guide 1개, take 2개, mixdown 1개를 연결할 수 있다.
- track 상태를 `PENDING_UPLOAD`, `UPLOADING`, `READY`, `FAILED` 수준으로 표현할 수 있다.

### SC-02. DeviceProfile 스키마와 upsert 키 정의

목적:

- 브라우저 실제 오디오 설정값을 장치 조합 기준으로 저장할 수 있게 한다.

범위:

- `DeviceProfiles` 테이블 정의
- `requested_constraints_json`, `applied_settings_json` 저장 컬럼 정의
- `actual_sample_rate`, `channel_count`, `base_latency`, `output_latency`, `input_latency_est` 컬럼 정의
- `input_device_hash`, `output_route`, `browser`, `os` 기준 unique key 또는 upsert key 정의

선행:

- 없음

완료 기준:

- 같은 사용자라도 출력 장치가 다르면 다른 profile로 저장된다.
- 동일 장치 조합에서 다시 저장하면 중복 insert가 아니라 upsert가 된다.
- 실제 적용값 일부가 비어도 저장이 가능하다.

### SC-03. 업로드 / 녹음 수명주기 메타데이터 스키마

목적:

- guide와 take 업로드 완료 전후 상태, 저장 위치, 메타데이터를 표현한다.

범위:

- `Tracks`에 `storage_key`, `source_format`, `duration_ms`, `checksum`, `recording_started_at`, `recording_finished_at` 추가
- `Artifacts`에 원본 / canonical / peaks / mixdown 연결 방식 정의
- 업로드 완료 전 임시 상태와 완료 후 상태 전이 규칙 문서화

선행:

- `SC-01`

완료 기준:

- 클라이언트가 “track 생성 → 업로드 → 완료 확정” 순서로 API를 호출할 수 있다.
- 업로드 실패와 재시도 상태를 DB에서 구분할 수 있다.

## 7. 백엔드 티켓

### BE-01. 프로젝트 생성 / 조회 API

목적:

- 프론트엔드가 프로젝트를 만들고 다시 불러올 수 있게 한다.

범위:

- `POST /projects`
- `GET /projects/{projectId}`
- 필요 시 `PATCH /projects/{projectId}`
- 필드: `title`, `bpm`, `base_key`, `time_signature`, `mode`

선행:

- `SC-01`

완료 기준:

- 프로젝트 생성 후 식별자를 반환한다.
- 새로고침 후에도 프로젝트 기본 메타데이터를 다시 읽을 수 있다.
- 잘못된 필수값에 대해 검증 에러를 반환한다.

### BE-02. 가이드 업로드 초기화 / 완료 API

목적:

- 가이드 트랙을 프로젝트에 연결할 업로드 흐름을 연다.

범위:

- `POST /projects/{projectId}/guide/upload-url`
- `POST /projects/{projectId}/guide/complete`
- `GET /projects/{projectId}/guide`
- 업로드 완료 시 guide track 또는 artifact를 프로젝트에 연결

선행:

- `SC-01`
- `SC-03`
- `BE-01`

완료 기준:

- 사용자가 가이드 오디오를 업로드하고 프로젝트에 연결할 수 있다.
- 가이드가 없는 프로젝트와 있는 프로젝트를 구분해 조회할 수 있다.

### BE-03. DeviceProfile upsert / 조회 API

목적:

- 프론트엔드에서 실제 적용된 오디오 설정값을 저장하고 재사용할 수 있게 한다.

범위:

- `POST /device-profiles`
- `GET /device-profiles`
- 요청값과 실제 적용값 JSON 저장
- 최신 profile 반환 규칙 정의

선행:

- `SC-02`

완료 기준:

- 같은 장치 조합에서 중복 데이터가 쌓이지 않는다.
- 프론트엔드가 장치 선택 후 받은 실제 설정값을 저장할 수 있다.
- 이후 스튜디오 진입 시 마지막 profile을 다시 불러올 수 있다.

### BE-04. take 생성 / 업로드 / 완료 API

목적:

- 보컬 take를 여러 개 생성하고 업로드하고 상태를 관리한다.

범위:

- `POST /projects/{projectId}/tracks`
- `POST /tracks/{trackId}/upload-url`
- `POST /tracks/{trackId}/complete`
- `GET /projects/{projectId}/tracks`
- `track_role = VOCAL_TAKE` 흐름 처리

선행:

- `SC-01`
- `SC-03`
- `BE-01`

완료 기준:

- 같은 프로젝트에 take 2개 이상을 생성할 수 있다.
- 업로드 중 / 준비 완료 / 실패 상태를 API에서 확인할 수 있다.
- 프론트엔드가 take 번호 또는 정렬 순서를 안정적으로 표시할 수 있다.

### BE-05. 스튜디오 스냅샷 API

목적:

- 스튜디오 화면이 한 번의 조회로 필요한 상태를 받을 수 있게 한다.

범위:

- `GET /projects/{projectId}/studio`
- 응답에 프로젝트 메타데이터, guide 정보, take 목록, 최신 device profile, mixdown 여부 포함
- 프론트엔드용 요약 DTO 정의

선행:

- `BE-01`
- `BE-02`
- `BE-03`
- `BE-04`

완료 기준:

- 스튜디오 첫 진입 시 필요한 핵심 정보가 한 응답에 들어 있다.
- 프론트엔드가 여러 엔드포인트를 연속 호출하지 않아도 기본 화면을 그릴 수 있다.

### BE-06. mixdown 아티팩트 등록 API

목적:

- 클라이언트에서 만든 mixdown을 저장하고 다시 조회할 수 있게 한다.

범위:

- `POST /projects/{projectId}/mixdown/upload-url`
- `POST /projects/{projectId}/mixdown/complete`
- 스튜디오 스냅샷에 mixdown artifact 반영

선행:

- `SC-01`
- `SC-03`
- `BE-01`

완료 기준:

- 클라이언트가 만든 mixdown 파일을 업로드하고 프로젝트에 연결할 수 있다.
- 이후 스튜디오 진입 시 마지막 mixdown 존재 여부를 알 수 있다.

## 8. 워커 티켓

### WK-01. 업로드 오디오 메타데이터 프로브 워커

목적:

- guide와 take 업로드 직후 파일 메타데이터를 서버에서 검증하고 기록한다.

범위:

- duration, sample rate, channel count, format, checksum 추출
- 실패 시 `track_status = FAILED` 반영
- 성공 시 `track_status = READY` 또는 후속 처리 상태로 반영

선행:

- `SC-03`
- `BE-02`
- `BE-04`

완료 기준:

- 업로드 완료 이벤트 뒤에 파일 메타데이터가 DB에 채워진다.
- 손상 파일 또는 빈 파일 업로드를 구분할 수 있다.

### WK-02. canonical audio / peaks 생성 워커

목적:

- 이후 분석과 재로딩을 위해 canonical asset과 시각화용 산출물을 만든다.

범위:

- 필요 시 mono / sample-rate 통일본 생성
- waveform peaks JSON 또는 동등 산출물 생성
- 원본과 canonical asset의 artifact 관계 저장

선행:

- `WK-01`

완료 기준:

- 후속 분석 단계에서 사용할 canonical asset 경로가 확보된다.
- 프론트엔드가 새로고침 후에도 파형 데이터를 다시 읽을 수 있다.

### WK-03. 업로드 후처리 상태 전이 / 재시도 스켈레톤

목적:

- 워커 실패가 조용히 묻히지 않고 재처리 가능한 구조를 만든다.

범위:

- job status 테이블 또는 경량 상태 기록 방식 결정
- 최소 재시도 정책 정의
- idempotent 처리 기준 정의

선행:

- `WK-01`
- `WK-02`

완료 기준:

- 동일 업로드 완료 이벤트가 중복으로 들어와도 데이터가 깨지지 않는다.
- 실패 상태를 다시 처리할 수 있는 최소한의 수동 재시도 경로가 있다.

## 9. 프론트엔드 티켓

### FE-01. 프로젝트 생성 플로우와 스튜디오 진입

목적:

- 사용자가 프로젝트를 만들고 스튜디오 화면으로 들어가게 한다.

범위:

- 프로젝트 생성 화면
- 필수 메타데이터 입력 UI
- 생성 후 스튜디오 라우팅
- 기본 오류 처리

선행:

- `BE-01`

완료 기준:

- 프로젝트를 만들고 생성된 프로젝트로 이동할 수 있다.
- 새로고침 후에도 같은 프로젝트를 다시 불러올 수 있다.

### FE-02. 오디오 권한 / 장치 선택 / 설정값 저장 패널

목적:

- 마이크 권한 요청, 입력 장치 선택, 실제 적용 설정값 저장을 한 화면에 닫는다.

범위:

- 마이크 권한 요청
- 입력 장치 목록 표시
- 헤드폰 모드 토글 또는 안내
- 요청 constraints와 `getSettings()` 결과 표시
- DeviceProfile 저장 호출

선행:

- `BE-03`

완료 기준:

- 사용자가 마이크를 고를 수 있다.
- 실제 sample rate, channel count, 노이즈 처리 적용 여부를 볼 수 있다.
- 저장 후 재진입 시 마지막 장치 프로파일을 불러올 수 있다.

### FE-03. 가이드 재생, metronome, count-in UI

목적:

- 녹음 전에 사용자가 기준 가이드를 듣고 박자를 준비할 수 있게 한다.

범위:

- guide 업로드 UI
- 재생 / 일시정지 / seek
- metronome on / off
- count-in 길이 선택
- tempo / key 표시

선행:

- `BE-02`
- `FE-01`

완료 기준:

- 가이드 업로드 후 스튜디오에서 재생할 수 있다.
- 녹음 직전 count-in과 metronome을 켜고 끌 수 있다.

### FE-04. 녹음 파이프라인과 take 업로드

목적:

- 실제 take 녹음과 업로드를 사용 가능한 수준으로 닫는다.

범위:

- 녹음 시작 / 정지
- take 생성과 업로드 연결
- 업로드 진행률 표시
- 업로드 실패 시 재시도
- take 번호 자동 증가

선행:

- `FE-02`
- `BE-04`

완료 기준:

- 사용자가 take를 2개 이상 연속 녹음할 수 있다.
- 녹음 후 업로드 상태를 화면에서 볼 수 있다.
- 실패한 take를 다시 업로드하거나 새 take로 재시도할 수 있다.

### FE-05. 트랙 리스트와 기본 믹서

목적:

- guide와 take를 한 화면에서 관리할 수 있게 한다.

범위:

- guide / take 트랙 리스트
- 선택된 take 강조
- mute / solo / volume
- 업로드 / 준비 완료 / 실패 상태 badge

선행:

- `BE-05`
- `FE-03`
- `FE-04`

완료 기준:

- guide와 take 상태를 구분해 보여준다.
- 사용자가 최소한의 믹서 조작을 할 수 있다.
- 여러 take 중 하나를 재생 대상으로 고를 수 있다.

### FE-06. waveform / 임시 contour 프리뷰

목적:

- 녹음 직후 시각적 확인 피드백을 제공한다.

범위:

- 파형 프리뷰
- 브라우저 기반 임시 pitch contour
- 새 take 생성 직후 즉시 표시
- 새로고침 후 서버 산출물 기반 재로딩 전략 연결

선행:

- `FE-04`
- `WK-02`

완료 기준:

- 새 take를 녹음하면 파형이 즉시 보인다.
- 임시 contour가 최소한 “녹음이 제대로 됐는지” 확인 가능한 수준으로 나온다.

### FE-07. OfflineAudioContext mixdown 생성과 저장

목적:

- Phase 1의 믹스다운 프리뷰와 저장 경로를 닫는다.

범위:

- 현재 선택된 guide / take 기준 mixdown 생성
- 재생 가능한 로컬 미리듣기
- mixdown 업로드와 저장

선행:

- `FE-05`
- `BE-06`

완료 기준:

- 사용자가 mixdown을 생성해 바로 들어볼 수 있다.
- 필요하면 mixdown을 프로젝트 artifact로 저장할 수 있다.

## 10. 권장 스프린트 묶음

### Sprint A. 프로젝트와 스키마 바닥 깔기

- `SC-01`
- `SC-02`
- `BE-01`
- `FE-01`

목표:

- 프로젝트를 만들고 기본 화면까지 진입한다.

### Sprint B. 장치 설정과 업로드 수명주기

- `SC-03`
- `BE-02`
- `BE-03`
- `BE-04`
- `FE-02`
- `FE-03`
- `FE-04`

목표:

- 가이드 연결, 장치 설정 저장, take 녹음과 업로드를 닫는다.

### Sprint C. 후처리와 스튜디오 사용성

- `WK-01`
- `WK-02`
- `BE-05`
- `FE-05`
- `FE-06`

목표:

- 스튜디오를 새로고침해도 상태가 살아 있고 파형 / 트랙 목록이 안정적으로 보인다.

### Sprint D. mixdown과 기본 운영 안전장치

- `BE-06`
- `FE-07`
- `WK-03`

목표:

- mixdown 저장과 업로드 후처리 실패 대응의 최소 구조를 닫는다.

## 11. 선행 결정이 필요한 항목

- 인증이 없는 단일 사용자 모드로 먼저 갈지, 로그인 기반으로 시작할지
- 업로드 저장소를 AWS S3로 바로 갈지, 로컬 호환 스토리지로 시작할지
- guide “선택”을 샘플 라이브러리로 먼저 구현할지, 업로드만 먼저 닫을지
- 녹음 인코딩 포맷을 WAV 우선으로 고정할지, WebM/Opus 저장을 허용할지

## 12. 착수 추천

가장 먼저 시작할 묶음은 아래다.

1. `SC-01`, `SC-02`
2. `BE-01`
3. `FE-01`
4. `SC-03`
5. `BE-03`

이 다섯 개가 닫히면 그 다음부터는 녹음과 업로드를 병렬로 붙이기 쉬워진다.
