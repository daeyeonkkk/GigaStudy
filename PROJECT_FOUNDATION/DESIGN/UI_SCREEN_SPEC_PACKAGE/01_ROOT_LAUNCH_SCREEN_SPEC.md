# 01. Root Launch Screen Spec

Screen ID: `PAGE-LAUNCH`  
Route: `/`

## 0. 화면 역할

`Root Launch`는 제품 소개 페이지가 아니라 `작업 진입 화면`이다.

이 화면에서 사용자는 3초 안에 다음 셋 중 하나를 바로 실행할 수 있어야 한다.

1. 새 프로젝트를 만든다
2. 최근 프로젝트를 다시 연다
3. 공유 검토 링크를 연다

## 1. 전체 레이아웃

### Desktop

- total width: `1440px` 기준
- content max width: `1360px`
- section order:
  1. utility topbar
  2. launch shell

### Tablet

- launch shell 1열 전환
- recent projects가 위
- command rail이 아래

### Mobile

- topbar actions는 `새 프로젝트`, `최근 작업`, `공유 검토` 3개만 유지
- recent list 먼저
- new project form 다음
- share opener 마지막

## 2. 화면 배경

- background: `paper-050` 단색 기반
- page-wide decorative hero 금지
- 감성 이미지 금지
- 그라디언트 glow는 사용하지 않는다

## 3. 영역 구성

## 3.1 Utility Topbar

Height: `72px`

### 좌측

- logo wordmark: `GigaStudy`
- sublabel: `Vocal Studio`

### 우측

- action 1: `새 프로젝트`
- action 2: `최근 작업`
- action 3: `공유 검토`

### Typography

| Element | Font | Size | Weight | Color |
| --- | --- | --- | --- | --- |
| logo wordmark | Instrument Sans | `20px` | `700` | `ink-900` |
| logo sublabel | Instrument Sans | `11px` | `600` | `ink-500` |
| topbar action | Instrument Sans | `15px` | `600` | `ink-700` |

### Interaction

- `새 프로젝트`: focus `LAUNCH-SECTION-NEW-PROJECT`
- `최근 작업`: focus `LAUNCH-SECTION-RECENT`
- `공유 검토`: focus `LAUNCH-SECTION-SHARE`

## 3.2 Launch Shell

Section ID: `LAUNCH-SHELL`

Role:

- 제품 첫 화면의 유일한 주 작업면

Surface:

- width: `1360px`
- min height: `820px`
- border: `1px solid line-200`
- radius: `24px`
- background: `paper-000`
- no internal card mosaic

Layout:

- left region: `840px`
- right region: `520px`
- vertical divider `1px solid line-200`

## 3.3 Recent Projects Region

Section ID: `LAUNCH-SECTION-RECENT`

Layout order:

1. region header
2. search row
3. recent list

### Region header

- title: `최근 작업`
- body: 없음

### Search row

Contains:

- search input placeholder: `프로젝트 이름으로 찾기`
- filter tabs:
  - `전체`
  - `최근 연 항목`
  - `고정`

### Recent list

- row height: `84px`
- row divider only
- row background hover only
- no individual card radius

Each row contains 6 columns:

1. project title stack
2. last updated
3. 작업 목적
4. progress summary
5. last workspace
6. open action + overflow

### Row typography

| Element | Size | Weight |
| --- | --- | --- |
| title | `18px` | `700` |
| row meta | `12px` | `600` |
| row value | `14px` | `500` |

### Fixed row actions

- row click: open last workspace
- `열기`: open last workspace
- overflow trigger `⋯` → `POPOVER-LAUNCH-RECENT-ACTIONS`

### POPOVER-LAUNCH-RECENT-ACTIONS

Items fixed:

- `스튜디오로 열기`
- `편곡실로 열기`
- `공유 링크 복사`
- `고정`

### Empty state

Only one line permitted:

- `아직 프로젝트가 없습니다`

## 3.4 Command Rail

Section ID: `LAUNCH-SECTION-COMMAND`

Layout:

- stacked sections separated by dividers
- no floating mini cards

Order:

1. new project
2. shared review opener

## 3.5 New Project Section

Section ID: `LAUNCH-SECTION-NEW-PROJECT`

### Header

- eyebrow: `새 프로젝트`
- title: `세션 이름과 기본값만 정하면 바로 스튜디오로 들어갑니다`
- body: 없음

### Form grid

Desktop:

- row 1: project name full width
- row 2: BPM / Key
- row 3: Time signature / Goal

### Fields

| Field | Type | Height | Width |
| --- | --- | --- | --- |
| 프로젝트 이름 | text | `56px` | full |
| 템포(BPM) | number | `56px` | half |
| 기준 키 | text / select-combobox | `56px` | half |
| 박자 | select | `56px` | half |
| 작업 목적 | select | `56px` | half |

### Dropdown items

#### DROPDOWN-LAUNCH-TIME-SIGNATURE

- `4/4`
- `3/4`
- `6/8`
- `2/4`

#### DROPDOWN-LAUNCH-PROJECT-GOAL

- `기본 연습`
- `개인 점검`
- `팀 파트 연습`
- `편곡 준비`

### Primary submit button

- label idle: `스튜디오 열기`
- label submitting: `프로젝트 만드는 중...`
- style: brand primary
- width: full
- height: `56px`

### Submit action

- create new project
- navigate to `PAGE-STUDIO`

### Error state

- form error line appears below button
- font: `14px`
- color: `danger-500`
- max lines: `2`

## 3.6 Shared Review Opener

Section ID: `LAUNCH-SECTION-SHARE`

### Header

- eyebrow: `공유 검토`
- title: `공유 링크나 토큰으로 읽기 전용 검토 화면을 엽니다`
- body: 없음

### Fields

| Field | Type | Height | Width |
| --- | --- | --- | --- |
| 공유 링크 또는 토큰 | text | `56px` | full |

### Actions

- primary button: `검토 열기`
- secondary button: `붙여넣기`

### Submit action

- parse share token or URL
- navigate to `PAGE-REVIEW`

### Error state

- invalid token error line
- font: `14px`
- color: `danger-500`

## 4. Launch에서 금지되는 요소

- marketing hero
- workflow 설명 섹션
- 분위기용 대형 이미지
- 핵심 장면 소개
- 기능 bullet wall
- `API 연결됨`
- `MVP`
- `현재 빌드`
- 운영 상태 카드

## 5. Connected surfaces

### DROPDOWN-LAUNCH-TIME-SIGNATURE

- trigger: `박자`
- type: custom dropdown

### DROPDOWN-LAUNCH-PROJECT-GOAL

- trigger: `작업 목적`
- same style as above

### POPOVER-LAUNCH-RECENT-ACTIONS

- trigger: recent row overflow `⋯`
- width: `240px`

### SYSTEM-LAUNCH-CREATE-PROJECT

- submit action
- no modal confirm
- direct transition to `PAGE-STUDIO`

### SYSTEM-LAUNCH-OPEN-SHARE

- submit action
- no modal confirm
- direct transition to `PAGE-REVIEW`

## 6. Button inventory

| Control ID | Label | Type | Target |
| --- | --- | --- | --- |
| `BTN-LAUNCH-TOPBAR-NEW` | 새 프로젝트 | text action | `LAUNCH-SECTION-NEW-PROJECT` |
| `BTN-LAUNCH-TOPBAR-RECENT` | 최근 작업 | text action | `LAUNCH-SECTION-RECENT` |
| `BTN-LAUNCH-TOPBAR-SHARE` | 공유 검토 | text action | `LAUNCH-SECTION-SHARE` |
| `BTN-LAUNCH-RECENT-OPEN` | 열기 | row action | last workspace route |
| `BTN-LAUNCH-NEW-PROJECT-SUBMIT` | 스튜디오 열기 | primary | `PAGE-STUDIO` |
| `BTN-LAUNCH-SHARE-OPEN` | 검토 열기 | primary | `PAGE-REVIEW` |
| `BTN-LAUNCH-SHARE-PASTE` | 붙여넣기 | secondary | clipboard paste |

## 7. 상태 설계

### Idle

- recent list visible
- default form values shown
- share input empty

### Submitting project

- project submit button loading label
- new project fields disabled
- recent list remains interactive

### Opening share

- share submit button loading label
- share input disabled
- new project form remains interactive

### Error

- only local error line visible
- layout unchanged

## 8. Mobile adaptation

- recent list first
- new project form second
- share opener third
- topbar actions remain text only
- overflow popover becomes bottom sheet
