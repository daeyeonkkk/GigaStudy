# 03. Arrangement Screen Spec

Screen ID: `PAGE-ARR`  
Route: `/projects/:projectId/arrangement`

## 0. 화면 역할

이 화면은 `편곡 후보 비교 + 악보 검토 + 내보내기`를 한 번에 처리하는 musical artifact view다.

핵심 원칙:

- 악보가 화면의 주인공이다
- 제약 입력과 export는 악보를 보조한다
- 설명문보다 후보 비교와 파트 판단이 우선이다

## 1. 레이아웃

### Desktop

- top candidate bar: `72px`
- left rail: `280px`
- center score canvas: `1fr`
- right rail: `300px`

### Tablet

- left rail `240px`
- right rail below score

### Mobile

- candidate bar horizontal scroll
- constraints drawer pattern
- score first, controls later

## 2. Top candidate bar

Surface ID: `ARR-REGION-TOPBAR`

Contains:

1. project title small
2. candidate tabs `A / B / C`
3. preview transport
4. utility buttons

### Candidate tab spec

- height: `40px`
- min width: `92px`
- active indicator: bottom border `3px accent-600`
- content:
  - candidate code
  - fit score small label

### Utility buttons

- `스튜디오로`
- `후보 비교`
- `내보내기`

Actions:

- `스튜디오로` → `PAGE-STUDIO`
- `후보 비교` → `DRAWER-ARR-CANDIDATE-COMPARE`
- `내보내기` → `MODAL-ARR-EXPORT-PACK`

## 3. Left rail

Surface ID: `ARR-REGION-LEFT-RAIL`

Contains 3 blocks:

1. constraints
2. generation
3. candidate summary

### 3.1 Constraints block

Title: `제약`

Fields fixed:

- style
- difficulty
- voice range preset
- beatbox
- max leap
- avoid parallel

#### Dropdowns

- `DROPDOWN-ARR-STYLE`
- `DROPDOWN-ARR-DIFFICULTY`
- `DROPDOWN-ARR-VOICE-RANGE`
- `DROPDOWN-ARR-BEATBOX`

### 3.2 Generation block

Buttons:

- `후보 다시 생성`
- `제약 초기화`

### 3.3 Candidate summary block

Shows:

- lead fit
- max leap
- parallel alerts
- beatbox hits

Typography:

- label: `12px`
- value: `18px`

## 4. Center score canvas

Surface ID: `ARR-REGION-SCORE`

Role:

- dominant artifact

Structure:

1. score header
2. score paper frame
3. bar navigation strip

### 4.1 Score header

Left:

- title: current candidate name
- subline: style / difficulty / voice count

Right:

- `Zoom`
- `View mode`

#### POPOVER-ARR-SCORE-ZOOM

Items:

- `75%`
- `100%`
- `125%`
- `맞춤`

#### DROPDOWN-ARR-VIEW-MODE

Items:

- `전체 악보`
- `현재 재생 구간`
- `파트 강조`

### 4.2 Score paper frame

- background: `paper-000`
- border: `1px solid line-400`
- min height: `720px`
- internal padding: `32px`

Within score frame:

- OSMD render area
- current playback head line
- rehearsal mark gutter

### 4.3 Bar navigation strip

Height: `44px`

Contains:

- current bar indicator
- previous rehearsal mark
- next rehearsal mark
- loop current section toggle

## 5. Right rail

Surface ID: `ARR-REGION-RIGHT-RAIL`

Contains 4 blocks:

1. playback
2. part mixer
3. guide mode
4. export quick actions

### 5.1 Playback block

Buttons:

- `재생`
- `정지`
- `처음으로`

Time display:

- current time / total time

### 5.2 Part mixer block

Rows fixed:

- Lead
- Alto
- Tenor
- Bass
- Percussion optional

Each row:

- solo toggle
- mute toggle
- volume slider

### 5.3 Guide mode block

Options:

- `Guide 없음`
- `Lead 기준`
- `전체 겹치기`

### 5.4 Export quick actions

Buttons:

- `MusicXML 받기`
- `MIDI 받기`
- `Guide WAV 받기`

## 6. Connected surfaces

### DRAWER-ARR-CANDIDATE-COMPARE

- width: `420px`
- shows candidate A/B/C side-by-side metrics
- opened by `후보 비교`

### MODAL-ARR-EXPORT-PACK

- width: `640px`
- fields:
  - export name
  - include xml
  - include midi
  - include guide wav
- footer:
  - `취소`
  - `내보내기`

### DRAWER-ARR-CONSTRAINTS

- mobile/tablet only
- same content as left rail constraints

### POPOVER-ARR-PART-ACTIONS

- per-part row overflow actions
- items:
  - `이 파트만 듣기`
  - `음역 보기`
  - `가이드 기준으로 듣기`

## 7. Button inventory

| Control ID | Label | Target |
| --- | --- | --- |
| `BTN-ARR-TOPBAR-BACK-STUDIO` | 스튜디오로 | `PAGE-STUDIO` |
| `BTN-ARR-TOPBAR-COMPARE` | 후보 비교 | `DRAWER-ARR-CANDIDATE-COMPARE` |
| `BTN-ARR-TOPBAR-EXPORT` | 내보내기 | `MODAL-ARR-EXPORT-PACK` |
| `BTN-ARR-REGENERATE` | 후보 다시 생성 | regenerate current set |
| `BTN-ARR-RESET-CONSTRAINTS` | 제약 초기화 | reset left rail |
| `BTN-ARR-PLAY` | 재생 | score transport start |
| `BTN-ARR-STOP` | 정지 | score transport stop |
| `BTN-ARR-EXPORT-XML` | MusicXML 받기 | file download |
| `BTN-ARR-EXPORT-MIDI` | MIDI 받기 | file download |
| `BTN-ARR-EXPORT-GUIDE` | Guide WAV 받기 | file download |

## 8. 상태 설계

### No candidate selected

- score frame empty
- center title: `후보를 선택하세요`
- export buttons disabled

### Candidate selected

- score visible
- right rail active

### Preview loading

- score remains visible
- only playback controls show loading

## 9. 금지 요소

- 악보보다 큰 소개 문장
- 좌우 레일의 대형 카드 블록
- `왼쪽에서는 핵심만 고릅니다` 같은 해설형 제목
- 후보 선택을 hero 카드처럼 처리하는 방식
