# 02. Studio Screen Spec

Screen ID: `PAGE-STUDIO`  
Route: `/projects/:projectId/studio`

## 0. 화면 역할

`Studio`는 GigaStudy의 대표 작업면이다.

이 화면의 단일 목표:

- 사용자가 가이드 기준으로 take를 만들고, 선택 take를 듣고, 피드백을 보고, 다음 작업으로 넘긴다

## 1. 기준 레이아웃

### Desktop base

- total frame: `1440px`
- layout:
  - top strip: `76px`
  - left source rail: `220px`
  - center work area: flexible
  - right inspector: `320px`
  - bottom timeline lane: `220px`

### Large desktop

- left rail: `236px`
- inspector: `344px`
- center area expands only

### Tablet

- top strip fixed
- left rail collapses to icon + label mini rail `72px`
- inspector drops below canvas

### Mobile

- top strip stacks to 2 rows
- left rail becomes horizontal mode switch
- inspector becomes accordion below canvas
- timeline lane remains below canvas

## 2. 화면 구조

1. top project strip
2. left source rail
3. center waveform stage
4. right inspector
5. bottom timeline + track lane
6. lower workbench tabs

## 3. Top project strip

Surface ID: `STUDIO-REGION-TOPBAR`

Height: `76px`

Background:

- `shell-850`
- bottom divider `1px solid #32404C`

Layout columns:

1. project identity block `300px`
2. transport/settings strip `1fr`
3. quick utility actions `220px`

### 3.1 Project identity block

Elements:

- project title
- subline `mode / created date` one line

Typography:

| Element | Font | Size | Weight | Color |
| --- | --- | --- | --- | --- |
| project title | Instrument Sans | `28px` | `700` | `paper-000` |
| subline | Instrument Sans | `12px` | `500` | `paper-100` 72% |

### 3.2 Transport/settings strip

Contains 6 cells:

1. `템포`
2. `키`
3. `코드 타임라인`
4. `카운트인`
5. `마이크`
6. `정렬`

Each cell:

- width: flexible equal
- height: `76px`
- border-left: `1px solid #32404C`
- value stacked over label

Cell typography:

| Element | Size | Weight |
| --- | --- | --- |
| label | `11px` | `600` |
| value | `16px` | `700` |

### 3.3 Utility actions block

Buttons fixed:

1. `프로젝트 설정`
2. `공유`
3. `편곡실`

Button style:

- workspace command button
- aligned right

### 3.4 Connected surfaces

- `프로젝트 설정` → `DRAWER-STUDIO-PROJECT-SETTINGS`
- `공유` → `MODAL-STUDIO-SHARE`
- `편곡실` → `PAGE-ARR`

## 4. Left source rail

Surface ID: `STUDIO-REGION-RAIL`

Width: `220px`

Background:

- `shell-800`
- right divider `1px solid #32404C`

Structure order:

1. mode switch
2. project objects list
3. quick status rack

### 4.1 Mode switch

Mode buttons fixed:

- `녹음`
- `리뷰`
- `편곡 준비`

Button spec:

- height: `44px`
- full width
- active style: left accent bar `4px`
- inactive style: no fill

Interaction:

- changes visible lower workbench tab group
- does not navigate away

### 4.2 Project objects list

Sections fixed:

1. `가이드`
2. `테이크`
3. `노트 피드백`
4. `멜로디 초안`
5. `편곡 후보`

#### Guide block

- item row: current guide file name
- submeta: duration / key / sample rate
- actions:
  - `교체`
  - `세부`

`교체` → `DRAWER-STUDIO-GUIDE`  
`세부` → `DRAWER-STUDIO-GUIDE`

#### Take list

- list rows vertically
- row height: `52px`
- columns: take label / status / score / overflow menu

Take row actions:

- row click: select take in center stage
- overflow menu trigger `⋯` → `POPOVER-STUDIO-TAKE-ACTIONS`

Popover actions fixed:

- `이 take 듣기`
- `기준 take로 설정`
- `사람 평가용으로 표시`
- `삭제`

#### Note feedback section

- shows latest flagged notes count
- button: `노트 목록 열기`
- action: scroll focus to right inspector note table

#### Melody draft section

- shows status only
- button: `멜로디 편집`
- action: switch lower workbench to `Melody`

#### Arrangement candidates section

- shows candidate count
- button: `후보 만들기`
- action: switch lower workbench to `Arrangement`

### 4.3 Quick status rack

Fixed 4 rows:

- `선택 take`
- `총점`
- `마이크 상태`
- `정렬 신뢰도`

Value style:

- label `12px`
- value `18px`

## 5. Center waveform stage

Surface ID: `STUDIO-REGION-STAGE`

Layout:

1. stage header
2. overlay toolbar
3. waveform canvas
4. selected note strip

Background:

- `paper-000`
- no card radius
- full-height between top strip and timeline

### 5.1 Stage header

Height: `64px`

Left:

- stage title: `Wave + Pitch`
- current selected take label

Right:

- status pill `파형 준비됨 | 준비 중 | 오류`
- command group:
  - primary toggle `테이크 녹음 ↔ 녹음 중지`
  - `분석`

### 5.2 Overlay toolbar

Height: `40px`

Controls:

1. overlay toggle `파형`
2. overlay toggle `피치`
3. overlay toggle `타깃 노트`
4. overlay toggle `화성`
5. range dropdown
6. zoom popover trigger

#### DROPDOWN-STUDIO-RANGE

Items fixed:

- `전체 take`
- `선택 노트`
- `8마디`
- `4마디`

#### POPOVER-STUDIO-ZOOM

Items fixed:

- `50%`
- `100%`
- `150%`
- `맞춤`

### 5.3 Waveform canvas

Height:

- base: `380px`
- large desktop: `420px`

Canvas layers:

1. guide waveform lane
2. selected take waveform lane
3. temporary pitch contour
4. target note overlay
5. chord region overlay
6. playhead

Visual rules:

- guide lane: `ink-500` 35%
- selected take lane: `signal-cyan-500`
- target notes: `accent-600` 22%
- chord regions: `paper-100` with border
- playhead: `2px accent-600`

### 5.4 Empty state

Only one line permitted:

- `가이드와 take를 준비하면 파형이 표시됩니다`

Typography:

- `16px`
- `600`
- centered both axes

### 5.5 Selected note strip

Height: `112px`

Layout:

- left summary block `1fr`
- right metrics grid `320px`

Left block:

- label: `선택 노트`
- note name
- correction sentence 1줄 only

Right metrics:

- `시작`
- `유지`
- `타이밍`
- `신뢰도`

Clicking note marker in canvas:

- updates strip
- also opens `POPOVER-STUDIO-NOTE-DETAIL` on first click

## 6. Right inspector

Surface ID: `STUDIO-REGION-INSPECTOR`

Width: `320px`

Structure:

1. score block
2. note detail block
3. chord context block
4. next action block

### 6.1 Score block

Title: `점수`

Grid: `2 x 2`

Cells:

- `음정`
- `리듬`
- `화성`
- `총점`

Cell spec:

- min height: `84px`
- label `12px`
- value `24px`
- total score cell uses tinted paper accent

### 6.2 Note detail block

Title: `노트 상세`

Shows:

- note name
- direction badge
- start cents
- sustain cents
- timing ms
- confidence
- correction copy 1 line

### 6.3 Chord context block

Title: `화성 기준`

Shows:

- chord mode
- current chord
- fallback mode

Button:

- `코드 타임라인 편집`
- action: `DRAWER-STUDIO-CHORD-TIMELINE`

### 6.4 Next action block

Title: `다음 작업`

Contains 3 stacked buttons:

1. `멜로디 추출`
2. `사람 평가 묶음`
3. `편곡 후보 만들기`

Actions:

- `멜로디 추출` → lower workbench `Melody` tab focus
- `사람 평가 묶음` → `MODAL-STUDIO-HUMAN-RATING-EXPORT`
- `편곡 후보 만들기` → lower workbench `Arrangement` tab focus

## 7. Bottom timeline + track lane

Surface ID: `STUDIO-REGION-TIMELINE`

Height: `220px`

Layout rows:

1. transport row `48px`
2. player row `52px`
3. track lane area `120px`

### 7.1 Transport row

Controls fixed:

- `Play`
- `Stop`
- `Guide`
- `Click`
- `Count-in`
- current time / duration

`Guide` toggle → `POPOVER-STUDIO-GUIDE-PLAYBACK`  
`Count-in` toggle → `DROPDOWN-STUDIO-COUNT-IN`

#### DROPDOWN-STUDIO-COUNT-IN

Items fixed:

- `없음`
- `1마디`
- `2마디`
- `4마디`

#### POPOVER-STUDIO-GUIDE-PLAYBACK

Items fixed:

- `Guide만`
- `Guide + 선택 take`
- `선택 take만`

### 7.2 Player row

Two inline player modules:

- `Guide`
- `선택 take`

### 7.3 Track lane area

Rows:

- one guide row
- multiple take rows

Each row columns:

1. name
2. status
3. select button (`take` rows only)
4. `믹스` details trigger
5. collapsed mix body:
   - mute
   - solo
   - volume slider
6. waveform mini strip or future preview slot
7. more menu

## 8. Lower workbench

Surface ID: `STUDIO-REGION-WORKBENCH`

Top tab bar items fixed:

1. `장치`
2. `가이드`
3. `녹음`
4. `분석`
5. `멜로디`
6. `편곡`
7. `믹스다운`
8. `버전`
9. `공유`

Workbench surface height:

- min `420px`

### 8.1 장치 tab

Split 2 columns:

- left: device inputs and monitoring
- right: saved profile snapshot

Buttons:

- `권한 요청` → browser permission prompt
- `목록 새로고침`
- `장치 저장`

Dropdowns:

- input device select
- output route select

### 8.2 가이드 tab

Split 2 columns:

- left: file dropzone + upload actions
- right: guide metadata + waveform preview

Buttons:

- `파일 선택` → system file picker
- `업로드`
- `교체`

### 8.3 녹음 tab

Contains:

- click toggle
- count-in dropdown
- headphones reminder
- recorder command cluster
- take list

### 8.4 분석 tab

Contains:

- selected take summary
- analysis command cluster
- note list table
- section feedback list

Buttons:

- `분석 실행`
- `저신뢰 take만 보기`
- `노트 상세 고정`

### 8.5 멜로디 tab

Contains:

- source take summary
- extraction settings
- note grid editor
- midi/xml asset actions

Buttons:

- `멜로디 추출`
- `초안 저장`
- `MIDI 받기`
- `편곡으로 보내기`

### 8.6 편곡 tab

Contains:

- constraints form
- candidate list
- selected candidate summary

Buttons:

- `후보 생성`
- `제약 초기화`
- `편곡실 열기`

### 8.7 믹스다운 tab

Contains:

- source mixer summary
- render controls
- preview player

Buttons:

- `미리듣기 렌더`
- `프로젝트 산출물로 저장`

### 8.8 버전 tab

Contains:

- collapsed version note input surface
- version list

Buttons:

- `현재 상태 저장`
- `이 버전으로 보기`

### 8.9 공유 tab

Contains:

- share launcher summary
- share links list

Buttons:

- `공유 만들기`
- `링크 복사`
- `읽기 화면 열기`
- `비활성화`

### 8.10 Control hierarchy contract

- The live recording intent is represented by one primary toggle button, not a separate `start` and `stop` pair.
- `record` becomes `stop` in place, while `count-in` and `uploading` lock the same button in a disabled state.
- Buttons that depend on prerequisites stay disabled until those prerequisites exist:
  note-list focus requires note feedback, melody tools require a selected take, arrangement generation requires a melody draft, and share launch requires at least one shareable artifact.
- Advanced capture constraints live in a collapsed `details` surface by default.
- Export and evidence-download actions do not sit inline beside the center-stage primary action; they live under one collapsed secondary surface.
- In track rows, `select` remains inline and visible, while mute / solo / volume live under one compact `mix` details surface.
- On compact mobile viewports, the left rail and right inspector do not stay expanded by default; they collapse to one-line summary surfaces and open on demand.
- On compact mobile viewports, long recorder lists such as the take list also collapse to one summary row and open on demand.
- On compact mobile viewports, dense non-recording workbench surfaces also collapse by default: analysis diagnostics, note-correction lists, melody note editors, arrangement preset explanations, arrangement part-mix lists, mixdown render summaries, version history, and share history.
- Version naming and version note inputs are collapsed by default and only expand when the user wants to override the automatic version label.
- Share label, expiry, version pinning, and artifact selection live only in `MODAL-STUDIO-SHARE`; the lower `share` tab only exposes the launcher and the history list.

## 9. Connected surfaces

### Drawers

- `DRAWER-STUDIO-PROJECT-SETTINGS`
- `DRAWER-STUDIO-GUIDE`
- `DRAWER-STUDIO-CHORD-TIMELINE`
- `DRAWER-STUDIO-AUDIO-SETUP`

### Modals

- `MODAL-STUDIO-SHARE`
- `MODAL-STUDIO-HUMAN-RATING-EXPORT`
- `MODAL-STUDIO-DELETE-TAKE-CONFIRM`

### Popovers

- `POPOVER-STUDIO-TAKE-ACTIONS`
- `POPOVER-STUDIO-NOTE-DETAIL`
- `POPOVER-STUDIO-GUIDE-PLAYBACK`
- `POPOVER-STUDIO-ZOOM`

### Dropdowns

- `DROPDOWN-STUDIO-RANGE`
- `DROPDOWN-STUDIO-COUNT-IN`
- `DROPDOWN-STUDIO-INPUT-DEVICE`
- `DROPDOWN-STUDIO-OUTPUT-ROUTE`

## 10. 주요 표면 상세 규격

## 10.1 DRAWER-STUDIO-PROJECT-SETTINGS

- width: `440px`
- fields:
  - project name
  - BPM
  - key
  - time signature
- footer buttons:
  - `취소`
  - `저장`

## 10.2 DRAWER-STUDIO-GUIDE

- width: `440px`
- blocks:
  - file selection
  - upload progress
  - current guide metadata
  - replace confirm button

## 10.3 DRAWER-STUDIO-CHORD-TIMELINE

- width: `440px`
- blocks:
  - current chord list table
  - add row button
  - seed-from-key button
  - paste-from-text accordion
  - save button

## 10.4 MODAL-STUDIO-SHARE

- width: `640px`
- title: `읽기 전용 공유 만들기`
- fields:
  - link label
  - expiry days
  - snapshot version select
    - includes `현재 작업면 그대로` as the first option
  - included artifacts checklist
- footer:
  - `취소`
  - `공유 링크 만들기`

## 10.5 MODAL-STUDIO-HUMAN-RATING-EXPORT

- width: `640px`
- content:
  - selected take summary
  - included files checklist
  - export destination summary
- footer:
  - `취소`
  - `묶음 만들기`

## 10.6 POPOVER-STUDIO-NOTE-DETAIL

- width: `280px`
- content:
  - note index
  - note name
  - correction direction
  - start / sustain / timing / confidence
  - `Inspector에 고정` action

## 11. 상태 설계

### Empty project

- no guide
- no take
- canvas empty state only
- lower tabs still accessible

### Guide ready / no take

- guide rows visible
- record actions enabled
- score and note detail values show `--`

### Take selected / not analyzed

- waveform visible
- transport visible
- `분석` primary command enabled

### Analysis complete

- score grid filled
- note detail active
- arrangement next action enabled

### Error states

- inline error line only
- no blocking modal for recoverable failures

## 12. 금지 요소

- 상단 소개 문단
- 설명형 카드
- 큰 둥근 카드 블록
- `현재 구현 상태`, `MVP`, `현재 빌드` 문구
- right inspector inside nested cards
- lower workbench title에 장문 설명

## 13. Mobile adaptation

- project utility block becomes 2-row strip
- left rail collapses to one summary row labeled `프로젝트` and opens on demand
- right inspector collapses to one summary row labeled `선택 상태` and opens on demand
- recorder panel keeps transport and record controls visible, but collapses the take list to one summary row on initial mobile load
- timeline lane keeps playback first, rows below
- track rows keep `select` inline and hide mix utilities under one `믹스` details trigger
- workbench tabs become horizontal scroller
- non-recording workbench tabs keep the primary command row visible, while dense diagnostics, editable note lists, preset explanations, part-mix lists, and history logs collapse to summary folds
