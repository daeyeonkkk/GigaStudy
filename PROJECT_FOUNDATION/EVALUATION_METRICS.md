# GigaStudy 핵심 평가지표

Date: 2026-05-07

이 문서는 GigaStudy의 제품/엔진/UI 변경을 평가하는 기준이다.
평가는 기능 개수보다 **한 사람이 6트랙 아카펠라 곡을 shared timeline
위에서 안정적으로 등록, 정렬, 재생, 연습, 채점, 보완할 수 있는가**를 본다.

## North Star

핵심 종합 지표는 **곡 완성 가능률**이다.

곡 완성 가능률은 다음 흐름이 막힘 없이 끝나는 비율로 판단한다.

1. 빈 스튜디오, 악보 파일, 녹음/음성 입력, AI 생성 중 하나로 시작한다.
2. 5~6개 트랙이 shared BPM/meter timeline 위에 놓인다.
3. 동시 재생, 연습, 채점, 수정, 복원이 정상 동작한다.
4. 사용자가 내부 구현을 몰라도 다음 행동을 이해할 수 있다.

V1 alpha 가중치는 다음과 같다.

| 영역 | 가중치 |
| --- | ---: |
| Track 등록 품질 | 30 |
| Timeline / Playback 신뢰도 | 20 |
| Practice / Scoring 유용성 | 15 |
| AI 생성 음악성 | 15 |
| UX 흐름 / 운영 안정성 | 15 |
| 비용 / 구조 건전성 | 5 |

## 1. Track 등록 품질

Track 등록은 가장 중요한 배포 차단 지표다. 등록이 흔들리면 playback,
practice, scoring, AI generation 모두 신뢰할 수 없다.

| 지표 | 의미 | 목표 |
| --- | --- | ---: |
| Track 배정 정확도 | MIDI/MusicXML/PDF 파트가 S/A/T/Baritone/Bass/Percussion 중 적절한 slot에 들어가는가 | fixture 95%+ |
| 빈 트랙 보존 | 없는 성부를 억지로 채우지 않고 빈 lane으로 남기는가 | 100% |
| Grid 정합률 | 자동 등록된 event onset/duration이 BPM/meter 기반 음표 grid에 맞는가 | 98%+ |
| Micro-gap 제거율 | 16분음표 미만 쉼/틈을 주변 event에 자연스럽게 흡수하는가 | 95%+ |
| 의미 있는 쉼 보존율 | 16분음표 이상 쉼은 빈 time으로 유지하는가 | 95%+ |
| 같은 pitch 병합 정확도 | 자동 등록에서 맞닿은 같은 pitch는 병합하되, 수동 편집 결과는 임의 병합하지 않는가 | regression 100% |
| Track 내 overlap rate | 단선율 성부에서 event끼리 겹치지 않는가 | 0 |
| 부분 실패 복구율 | 한 파트 실패가 전체 등록 실패로 번지지 않는가 | 100% |
| 음성 추출 사용 가능률 | 녹음/음성 업로드가 노이즈가 아닌 singable pitch event로 정리되는가 | 샘플 수동 80%+ |
| 후보 검토 부담 | 후보가 이유, 위험, 덮어쓰기 영향을 설명하고 raw field를 노출하지 않는가 | raw field 0건 |

등록 품질 테스트는 symbolic fixture를 CI 기준으로 삼고, `giga_sample/`
실제 샘플은 로컬 진단으로 보조한다. 실제 샘플 원본은 커밋하지 않는다.

## 2. Timeline / Playback 신뢰도

사용자는 선택한 트랙을 함께 재생하면 맞는다고 믿을 수 있어야 한다.

| 지표 | 의미 | 목표 |
| --- | --- | ---: |
| 선택 트랙 시작 오차 | event/audio/metronome이 shared scheduled time에 맞게 시작하는가 | p95 20~40ms 이하 |
| Playhead drift | 실제 재생 시간과 화면 playhead가 벌어지지 않는가 | 2분 기준 50ms 이하 |
| Sync 단일 적용 | track sync, region start, event start가 중복 적용되지 않는가 | regression 100% |
| 음량 반응성 | 슬라이더 조절이 active gain에 즉시 반영되는가 | 100ms 이하 |
| 음량 저장 안정성 | drag 중 서버 저장을 남발하지 않고 commit 시 저장되는가 | commit 1회 |
| 반복음 attack 분리 | 같은 pitch 16분음표 반복도 개별 onset으로 들리는가 | fixture pass |
| Tie sustain 처리 | measure-boundary tie만 새 attack 없이 이어지는가 | fixture pass |
| 재생 준비 시간 | 반복 재생에서 audio buffer cache가 fetch/decode를 줄이는가 | cached p95 300ms 이하 |
| 자동 횡스크롤 | playhead가 진행될 때 timeline viewport가 따라가는가 | e2e pass |

Playback 평가는 audio 신호 자체와 UI 상태를 분리해서 본다. UI 편의를 위해
event 길이, sync, scheduled time을 바꾸는 것은 실패로 본다.

## 3. Practice / Scoring 유용성

Scoring은 점수 숫자가 아니라 다음 연습 위치와 이유를 알려줘야 한다.

| 지표 | 의미 | 목표 |
| --- | --- | ---: |
| 채점 완료율 | 녹음 시작 -> 중지 -> 삭제/채점 시작 -> report 흐름이 막히지 않는가 | 95%+ |
| Answer scoring alignment | performance가 target track과 시간상 잘 맞춰져 평가되는가 | fixture pass |
| Harmony scoring 판별력 | 유용한 tension과 명백한 collision을 구분하는가 | fixture pass |
| Report deep-link 성공률 | report focus가 실제 region/event로 이동하는가 | 100% |
| 기준 트랙 UX 명확성 | 채점 기준과 들려줄 기준음을 분리해서 이해할 수 있는가 | 사용자 테스트 pass |
| 채점 pending 보존/삭제 | 녹음 후 사용자가 삭제 또는 채점 시작을 선택할 수 있는가 | e2e pass |
| Report actionability | report가 틀린 위치, 이유, 다음 연습 포인트를 제시하는가 | manual review |

Scoring command는 빠르게 접수되어야 하고, 무거운 분석은 scoring job으로
보여야 한다. 사용자는 작업이 멈춘 것처럼 느끼지 않아야 한다.

## 4. AI 생성 음악성

AI 생성은 그럴듯한 음표 나열이 아니라 기존 track을 참고한 아카펠라
성부 작성이어야 한다.

| 지표 | 의미 | 목표 |
| --- | --- | ---: |
| Context 사용률 | target 외 등록 track을 실제 생성 판단에 반영하는가 | 100% |
| 후보 다양성 | 후보 3개가 역할, 리듬, 진행에서 의미 있게 다른가 | 3종 구분 |
| Singability | 음역, 도약, 밀도, breathing room이 노래 가능한가 | rule pass |
| Ensemble fit | voice crossing, spacing, 충돌, 병행 위험이 낮은가 | quality gate pass |
| Bass 역할성 | Bass 생성 시 root motion과 tuning gravity를 지탱하는가 | manual review |
| Upper voice 역할성 | S/A/T/Baritone이 pad, counterline, blend 역할을 자연스럽게 갖는가 | manual review |
| Percussion 분리 | Percussion은 harmony가 아니라 rhythm engine으로 생성되는가 | slot 6 regression |
| 후보 승인 후 유지율 | 승인한 후보를 바로 삭제/수정하지 않고 쓰는 비율 | telemetry 추적 |
| LLM 실효성 | LLM이 쓰인 경우 실제 engine decision을 바꾸는가 | decorative call 0건 |

Candidate UI는 role, note-flow preview, compact musical facts, concrete review
warnings를 보여준다. confidence percentages, raw score metrics, duplicate
preview widgets는 주요 판단 근거가 아니다.

## 5. UX 흐름 / 운영 안정성

Public UI는 사용자를 위한 화면이다. 내부 구현을 설명하는 메타 문구는
품질 실패로 본다.

| 지표 | 의미 | 목표 |
| --- | --- | ---: |
| 첫 화면 명확성 | 새 스튜디오, 악보 파일 시작, 목록 진입이 헷갈리지 않는가 | manual pass |
| 작업 상태 표시 | 등록/생성/채점 중 단계, 경과, 가능한 예상 시간을 보여주는가 | 100% |
| 메타 발언 제거 | public UI에 API/서버/엔진/LLM/polling 같은 표현이 없는가 | test pass |
| Activity polling 안정성 | 작업 중 full StudioResponse를 반복 조회하지 않는가 | mock test pass |
| 페이지 이동 정합성 | Studio/Edit/Practice 이동 후 저장된 timeline이 일치하는가 | e2e pass |
| 편집 경량성 | 편집 draft는 프론트에서 처리되고 저장 시 한 번만 서버 호출되는가 | unit pass |
| 빈 트랙 노출 | 모든 화면에서 6개 트랙이 유지되고 빈 track은 빈 lane으로 보이는가 | e2e pass |
| 모바일/데스크톱 레이아웃 | 버튼, 라벨, event가 겹치거나 잘리지 않는가 | screenshot pass |
| Admin 기능성 | 로그인, 스튜디오 관리, 비활성 cleanup, 음원 교체가 동작하는가 | admin e2e |

경량 UX 원칙은 성능 지표이기도 하다. 선택, 필터, 후보 target, tempo draft,
recording reference, playback selection은 local state로 두고, product truth가
바뀌는 save/register/approve/score/restore 순간에만 서버에 저장한다.

## 6. 비용 / 구조 건전성

Alpha에서는 무료권 유지와 구조 단순성이 실제 제품 품질이다.

| 지표 | 의미 | 목표 |
| --- | --- | ---: |
| R2 metadata 지속성 | Cloud Run 재시작 후 studio 목록/진입이 유지되는가 | 100% |
| Cloud Run 비용 정책 | min instances 0, max instances 1, 5분 scheduler 없음 | 100% |
| Cleanup 작동 | pending recording, orphan upload, inactive asset이 정책대로 정리되는가 | test pass |
| Payload 크기 | view별 response가 불필요한 candidate/report detail을 싣지 않는가 | budget 이하 |
| 큰 요청 응답성 | 생성/채점은 job 접수 후 빠르게 UI로 돌아오는가 | 접수 p95 1초 이하 |
| Product truth 유지 | public surface가 `Studio.regions`를 기준으로 동작하는가 | regression 100% |
| Legacy 부채 증가 | 새 compatibility layer나 dual truth가 늘지 않는가 | review gate |
| Release gate | unit/lint/build/api/e2e가 배포 전 통과하는가 | 100% |

새로운 기능이 이 표를 악화시키면 기능 완성으로 보지 않는다. 특히 dual
truth, 숨은 sync offset, 숨은 compatibility path, 무거운 full payload 재조회는
구현 편의가 아니라 구조 부채로 취급한다.

## Measurement Cadence

### 매 배포 필수 gate

- Registration regression.
- Playback scheduling helper.
- Scoring/report deep-link.
- Notice blocklist.
- Web unit/lint/build.
- API pytest.
- Chromium release gate.

### 기능 변경 시 fixture 평가

- 합성 NWC-style MIDI.
- Generic track name MIDI.
- Missing percussion score.
- Repeated 16th-note sample.
- Audio upload short phrase.
- AI generation context fixture.

### 주기적 실제 샘플 진단

- `아로하`.
- `물 만난 물고기`.
- 사용자가 추가한 실제 NWC export MIDI.
- `giga_sample/` 원본은 커밋하지 않고 로컬 진단에만 사용한다.

### 운영 telemetry

- Request p50/p95.
- Job queued/running/completed/failed count.
- Import partial failure count.
- Candidate approval/rejection rate.
- Scoring completion rate.
- Playback prepare time.
- Cleanup 대상/삭제량.

## Release Blocking Rules

다음은 alpha에서도 배포 차단으로 본다.

- 자동 등록 material이 `Studio.regions` product truth와 어긋난다.
- Score-file import가 missing percussion 같은 정상 결손에서 완료되지 않는다.
- 선택 track playback이 shared scheduled time을 유지하지 못한다.
- Sync/effective timeline이 두 번 적용되거나 report focus가 실제 event를
  열지 못한다.
- Public UI가 사용자가 이해할 수 없는 내부 용어를 상태 메시지로 노출한다.
- 작업 중 activity/read endpoint가 무거운 engine 처리나 queue repair를 유발한다.
- 기존 active material을 overwrite하면서 archive/restore 계약을 깨뜨린다.

## Defaults

- V1 평가는 상용 KPI보다 작은 tester가 실제 곡을 완성할 수 있는지를
  우선한다.
- 자동 등록 품질과 playback 신뢰도는 배포 차단 지표다.
- AI generation과 scoring은 rule, fixture, manual musical review를 함께 쓴다.
- 임의 confidence 숫자는 제품 판단에 쓰지 않는다. 근거가 있는 metric만
  사용자나 admin 판단에 노출한다.
- 기준치는 alpha 기본값이며, 실제 사용 로그가 쌓이면 더 엄격하게 조정한다.
