# 04. Shared Review Screen Spec

Screen ID: `PAGE-REVIEW`  
Route: `/shared/:shareToken`

## 0. 화면 역할

이 화면은 `수정 없는 검토 화면`이다.

원칙:

- Studio처럼 보이면 안 된다
- 읽기 전용이 분명해야 한다
- 검토 대상, 결과 요약, 산출물 열기가 핵심이다

## 1. 레이아웃

### Desktop

- compact header `72px`
- summary strip `56px`
- 3-column body
  - left summary `260px`
  - center review canvas `1fr`
  - right score rail `280px`

### Mobile

- header
- summary strip
- review canvas
- score summary
- asset buttons

## 2. Header

Contains:

- share label
- project title
- snapshot date
- read-only badge

Buttons:

- `가이드 듣기`
- `MusicXML`
- `MIDI`

No edit buttons.

## 3. Summary strip

Fixed metrics:

- guide
- takes
- ready takes
- arrangements
- selected version

Metric styling:

- chip style with `12px` radius
- label `11px`
- value `15px`

## 4. Body

## 4.1 Left summary

Blocks:

- selected take
- alignment confidence
- melody draft status
- current arrangement

## 4.2 Center review canvas

Modes:

- score focus
- waveform focus

Mode switch trigger:

- `DROPDOWN-REVIEW-CANVAS-MODE`

Items:

- `악보`
- `파형`

Canvas rules:

- no edit overlays
- playback head only
- one note highlight accent allowed

## 4.3 Right score rail

Blocks:

- pitch
- rhythm
- harmony
- highlighted note
- brief comment

Button:

- `노트 세부`
- opens `DRAWER-REVIEW-NOTE-DETAIL`

## 5. Connected surfaces

### DRAWER-REVIEW-NOTE-DETAIL

- width: `360px`
- contains note metrics and correction sentence
- no edit fields

### POPOVER-REVIEW-ASSET-LINKS

- opened by `산출물`
- items:
  - `Guide WAV`
  - `MusicXML`
  - `MIDI`

### DROPDOWN-REVIEW-SNAPSHOT

- if multiple versions included
- items: version label list

## 6. Button inventory

| Control ID | Label | Target |
| --- | --- | --- |
| `BTN-REVIEW-HEADER-GUIDE` | 가이드 듣기 | guide player |
| `BTN-REVIEW-HEADER-XML` | MusicXML | download |
| `BTN-REVIEW-HEADER-MIDI` | MIDI | download |
| `BTN-REVIEW-NOTE-DETAIL` | 노트 세부 | `DRAWER-REVIEW-NOTE-DETAIL` |

## 7. 금지 요소

- edit ambiguity
- large mode cards
- setup/help text
- project management controls
