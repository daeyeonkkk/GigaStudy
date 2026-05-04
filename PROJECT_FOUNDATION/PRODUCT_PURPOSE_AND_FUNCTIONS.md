# GigaStudy 제품 목적과 기능

Date: 2026-05-04

이 문서는 GigaStudy의 압축 제품 계약이다. 기능, 리팩터링, 테스트,
디자인 판단이 필요할 때 "이것이 제품 목적에 기여하는가?"를 빠르게
판단하기 위해 사용한다.

## 목적

GigaStudy는 한 사람이 6성부 아카펠라 편곡을 만들고, 듣고, 연습하고,
평가할 수 있게 하는 공유 음악 타임라인 스튜디오다.

GigaStudy의 핵심 산출물은 개별 녹음 파일 묶음이 아니다. Soprano,
Alto, Tenor, Baritone, Bass, Percussion이 하나의 BPM과 meter grid 위에
놓이고, 사용자는 그것을 하나의 ensemble로 확인한다.

## 제품 약속

GigaStudy는 사용자가 다음을 할 수 있게 해야 한다.

1. 고정된 BPM과 meter를 가진 studio를 만든다.
2. 녹음, 업로드/가져오기, AI 생성을 통해 6개 track 중 원하는 곳에
   material을 추가한다.
3. 입력 material을 shared timeline 위의 편집 가능한 region과 pitch
   event로 변환한다.
4. 해석이 애매하거나 위험한 extraction/generation 결과는 등록 전에
   검토한다.
5. 숨은 timing system 없이 선택한 track들을 sync, 편집, 동시 재생한다.
6. 선택한 reference track을 들으며 연습하고, 유용한 scoring report를
   받는다.

## 핵심 모델

사용자에게 드러나는 제품 모델은 다음이다.

`Studio -> Track -> Region -> PitchEvent/AudioClip -> Playback/Practice/Scoring`

- `Studio`는 BPM, meter, 6개 track slot, region, candidate, job, report를
  가진다.
- `Track`은 Soprano, Alto, Tenor, Baritone, Bass, Percussion 중 하나의
  visible role slot이다.
- `Region`은 track 위에 등록된 음악적 구간이다.
- `PitchEvent`는 region 안에 놓이는 timed note/rest다.
- `AudioClip`은 녹음 또는 업로드된 track의 retained original audio다.
- `Candidate`는 승인 전까지 product truth가 아닌 검토 대상 material이다.
- `Report`는 answer track 또는 harmony context에 대한 performance 평가를
  설명한다.

public product truth는 `Studio.regions`, `ArrangementRegion`,
`PitchEvent`다. internal event shadow는 extraction, generation,
registration, scoring을 도울 수 있지만 두 번째 public timeline이 되면 안
된다.

## 주요 Workflow

### 1. 시작

사용자는 BPM/meter를 입력해 빈 studio로 시작하거나, PDF/MIDI/MusicXML
악보 파일로 engine이 studio를 seed하게 한다. `악보 파일로 시작`은
지원하는 score file이 있을 때만 노출/활성화되어야 한다. 개별 track 행의
업로드는 이 흐름과 다르며, 사용자가 가진 녹음파일을 해당 track에 올리는
`녹음파일 업로드`로 표시한다.

### 2. Material 등록

녹음, 녹음파일 업로드, document import, MIDI, MusicXML, PDF, AI generation은
모두 같은 목적을 가진다. studio grid 위에 사용할 수 있는 track region과
pitch event를 만드는 것이다. 애매한 material은 candidate가 되며, 사용자가
승인, 거절, target 변경을 판단할 수 있을 만큼의 근거를 제공해야 한다.
multi-part import에서는 가능한 track을 먼저 등록하고, 덮어쓰기 때문에
막히거나 등록에 실패한 track은 남은 후보와 사유를 보여준 뒤 정상 studio
흐름으로 돌아와야 한다.

### 3. 편곡과 Sync

사용자는 region과 pitch event를 편집하고, visible sync를 조정하며, 모든
part를 shared BPM/meter에 맞춘다. sync는 musical material을 grid에 대해
이동시키는 사용자-visible translation이다. barline을 움직이거나 hidden
tempo layer를 만들면 안 된다.

Studio 본 화면은 track 등록, 녹음, 녹음파일, AI 생성, 후보 검토, sync,
selected-track playback, report history에 집중한다. region 안의 세부
pitch event 수정은 별도의 구간 편집 화면에서 한다.

구간 편집 화면은 region/event를 정밀하게 고치는 작업면이다. 사용자는
region의 track, 시작 위치, 길이, 음량, 이름과 selected event의 pitch,
시작 위치, 길이를 수치 입력과 작은 nudge로 조정한다. 상세 조정은 local
draft로 쌓이고, `저장`을 눌렀을 때 한 번에 product timeline에 반영된다.
버전 기록은 region마다 따로 저장된다. 저장 전 상태는 제한된 restore
point로 남겨 잘못된 편집을 되돌릴 수 있어야 한다. 저장 전 draft는 같은
브라우저 session 안에서 page 이동 후에도 복구될 수 있지만, Studio와
Practice는 저장된 product timeline만 보여준다.

Studio, 구간 편집, Practice의 6개 track slot은 항상 보인다. 빈 track은
사라지는 것이 아니라 event MIDI가 없는 lane으로 표시된다. Piano roll,
studio lane, waterfall의 event mini는 음 길이에 맞는 얇은 bar로 표시하고,
pitch가 있으면 높낮이가 시각적으로 드러나야 한다. 정확한 음계명, 시작,
길이는 hover와 접근성 label에서 확인한다.

### 4. Playback과 Practice

사용자는 전체 ensemble 또는 선택한 track만 재생할 수 있다. audio playback
mode에서는 retained audio를 우선하고, symbolic material은 warm guide tone
synthesis로 재생한다. practice view는 audio와 같은 scheduled timeline을
따라야 한다.

연습 waterfall은 practice 화면의 책임이다. Studio 본 화면은 연습용
waterfall preview를 통합하지 않는다.

### 5. Scoring과 Report

채점은 Practice 화면의 연습 흐름 안에서 시작한다. 사용자는 채점할 part와
reference track을 고른 뒤 practice attempt를 녹음한다. answer scoring은
target track과 비교하고, harmony scoring은 selected reference tracks 위에서
새 part가 잘 맞는지 평가한다. report는 timing, pitch, missing, extra,
harmony issue를 행동 가능한 형태로 보여주고, 가능하면 studio의 matching
region/event를 다시 열 수 있어야 한다.

### 6. 부족한 Part 생성

AI generation은 등록된 context tracks를 바탕으로 symbolic track material을
완성한다. 생성 결과는 singable하고 role-aware한 candidate여야 하며, imported
또는 recorded material과 같은 normalization, range, timing, ensemble check를
통과해야 한다.

## 기능 범위

현재 제품 범위에 포함된다.

- Studio 생성과 persistence.
- 스튜디오 생성 시 alpha password 설정, password 기반 진입, public list에서
  deactivated studio 숨김.
- 6개의 visible track slot.
- 업로드, 녹음, direct upload, extraction queue, candidate review.
- Region lane, selected-region piano roll, practice waterfall surface.
- 빈 track lane 유지와 pitch/duration 기반 thin event mini.
- 용도별 page: 스튜디오, 구간 편집, 연습, 리포트 상세.
- Studio 하위 page 간 전환을 위한 공통 목적 navigation과 각 page의 짧은
  역할 안내.
- 구간 편집기의 session draft, 일괄 저장, 구간별 복원 기록.
- Shared BPM/meter timing, count-in, metronome, sync, playhead behavior.
- Per-track volume을 가진 synchronized selected-track playback.
- Answer scoring, harmony scoring, report history, report deep-link.
- 부족하거나 수정할 part를 위한 symbolic AI generation.
- `Studio.regions`의 pitch-event timeline을 MIDI 파일로 내보내기.
- alpha testing을 운영하기 위한 admin/resource tool.
- Admin의 active/inactive studio 관리, 개별 저장 파일 정리, 완전삭제, guide
  tone sample 교체.

현재 제품 범위에 포함되지 않는다.

- print-grade notation engraving을 primary editor로 삼는 것.
- full DAW mixer 또는 범용 audio workstation.
- 자연스러운 human-voice audio synthesis.
- 임의의 mixed choral audio에서 6 stem이 항상 정확히 분리된다는 가정.
- source registration 중 LLM이 canonical pitch event를 직접 작성하는 것.
- obsolete data model을 계속 살리는 hidden compatibility path.
- alpha infrastructure가 실제로 보장하지 않는 privacy claim.

## 결정 규칙

- 사용자가 6-track studio를 생성, 등록, 정렬, 재생, 연습, 채점, 개선하는
  데 도움이 되지 않는 기능은 미룬다.
- 두 system이 timing에 대해 서로 다른 답을 낼 수 있다면 하나의 shared
  BPM/meter timeline을 선택하고 다른 truth를 제거한다.
- imported/generated material이 불확실하면 약한 output을 조용히 등록하지
  말고 candidate evidence를 개선한다.
- playback, scoring, generation, report focus가 충돌하면 shared
  region/event timeline이 이긴다.
- LLM은 bounded engine decision에 영향을 줄 때만 사용하고 deterministic
  fallback을 가져야 한다.
- 구현을 설명하기 어려워지면 넓은 hidden orchestration layer보다 작고
  되돌리기 쉬운 구조를 우선한다.

## 성공 기준

GigaStudy가 제대로 작동한다는 것은 solo user가 다음을 할 수 있다는 뜻이다.

- app state를 잃지 않고 6-track a cappella studio를 만든다.
- 등록된 material이 의도한 musical grid 위에 있다고 신뢰한다.
- 선택한 track들이 함께 시작하고 alignment를 유지하는 것을 듣는다.
- region과 pitch event를 통해 part를 조정하고 검토한다.
- 유용한 reference track을 들으며 연습한다.
- report에서 실제로 고칠 수 있는 음악적 순간을 찾는다.
- singable하고 ensemble-aware한 support part를 생성한다.
