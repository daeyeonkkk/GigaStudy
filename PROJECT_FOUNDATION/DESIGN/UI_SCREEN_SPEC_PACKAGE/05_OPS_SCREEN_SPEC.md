# 05. Ops Screen Spec

Screen ID: `PAGE-OPS`  
Route: `/ops`

## 0. 화면 역할

`Ops`는 운영자가 릴리즈 게이트, 실패 상태, 검증 로그를 빠르게 점검하는 dense utility screen이다.

원칙:

- poster hero 금지
- 설명보다 데이터 우선
- 큰 시각 장식 금지

## 1. 레이아웃

### Desktop

- compact header `72px`
- KPI strip `88px`
- 2-column diagnostic grid below

Column widths:

- left `1.1fr`
- right `0.9fr`

### Mobile

- single column
- KPI strip 2열 grid

## 2. Header

Contains:

- title: `운영 개요와 릴리즈 게이트`
- last refresh timestamp
- command buttons

Buttons fixed:

- `새로고침`
- `릴리즈 게이트 내려받기`
- `검증 가져오기`

## 3. KPI strip

Metrics fixed:

- release claim readiness
- runtime errors today
- validation runs this week
- failed uploads
- failed analysis jobs

Cell spec:

- min height `88px`
- label `11px`
- value `28px`
- status pill optional

## 4. Main grid blocks

## 4.1 Runtime logs block

Contains:

- time range dropdown
- severity filter tabs
- table

Row columns:

- timestamp
- page
- event
- severity
- detail action

Action:

- `상세 보기` → `DRAWER-OPS-LOG-DETAIL`

## 4.2 Release gate block

Contains:

- gate checklist
- claim readiness summary
- latest build

Buttons:

- `게이트 JSON 받기`
- `상세 조건 보기`

## 4.3 Validation import block

Contains:

- template download
- file upload button
- preview rows
- import confirm

Buttons:

- `템플릿 받기`
- `파일 선택`
- `미리 보기`
- `가져오기`

Connected surface:

- `MODAL-OPS-VALIDATION-IMPORT`

## 4.4 Validation log block

Contains:

- device/browser validation rows
- pass/fail flags
- details action

Action:

- `실행 상세` → `DRAWER-OPS-VALIDATION-DETAIL`

## 4.5 Failed tracks block

Contains:

- failed uploads table
- retry button

Action:

- `다시 시도`

## 4.6 Analysis jobs block

Contains:

- failed or pending jobs table
- model version
- retry button

Action:

- `재실행`
- `기록 보기` → `DRAWER-OPS-JOB-DETAIL`

## 4.7 Latest audio profiles block

Contains:

- latest saved device profiles
- warning flags
- open detail

Action:

- `프로필 상세` → `DRAWER-OPS-PROFILE-DETAIL`

## 5. Connected surfaces

### MODAL-OPS-VALIDATION-IMPORT

- width: `640px`
- blocks:
  - selected file info
  - parsed preview summary
  - overwrite warning
- footer:
  - `취소`
  - `가져오기`

### DRAWER-OPS-LOG-DETAIL

- width: `440px`
- fields:
  - event name
  - route
  - payload excerpt
  - related user/project ids

### DRAWER-OPS-VALIDATION-DETAIL

- width: `440px`
- fields:
  - browser
  - hardware
  - result flags
  - notes

### DRAWER-OPS-JOB-DETAIL

- width: `440px`
- fields:
  - job id
  - model version
  - retries
  - stderr excerpt

### DRAWER-OPS-PROFILE-DETAIL

- width: `440px`
- fields:
  - device name
  - sample rate
  - channel count
  - latency
  - warning flags

### DROPDOWN-OPS-TIME-RANGE

Items:

- `24시간`
- `3일`
- `7일`
- `30일`

## 6. Button inventory

| Control ID | Label | Target |
| --- | --- | --- |
| `BTN-OPS-REFRESH` | 새로고침 | page refresh |
| `BTN-OPS-DOWNLOAD-GATE` | 릴리즈 게이트 내려받기 | file download |
| `BTN-OPS-IMPORT` | 검증 가져오기 | `MODAL-OPS-VALIDATION-IMPORT` |
| `BTN-OPS-TEMPLATE` | 템플릿 받기 | file download |
| `BTN-OPS-FILE-PICK` | 파일 선택 | system file picker |
| `BTN-OPS-IMPORT-CONFIRM` | 가져오기 | import action |
| `BTN-OPS-RETRY-UPLOAD` | 다시 시도 | retry upload |
| `BTN-OPS-RETRY-JOB` | 재실행 | retry job |

## 7. 금지 요소

- 큰 hero 카피
- 소개 카드
- 따뜻한 감성 이미지
- product-facing brand headline
