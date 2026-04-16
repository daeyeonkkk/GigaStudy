# 00. Global UI Fixed Spec

## 0. 적용 범위

이 문서는 `Root Launch`, `Studio`, `Arrangement`, `Shared Review`, `Ops` 전 화면의 공통 규격을 고정한다.

## 1. 기준 아트 디렉션

- 제품 인상: modern rehearsal control room
- 핵심 대비: dark shell + warm paper canvas
- 기본 성격: calm, serious, precise
- 금지 성격: generic SaaS, ops dashboard, marketing card mosaic

## 2. 기준 해상도와 breakpoint

### Desktop base

- 기준 캔버스: `1440 x 1024`
- 최대 콘텐츠 폭: `1360px`
- 좌우 안전 여백: `32px`

### Large desktop

- 기준 캔버스: `1600 x 1024`
- 최대 콘텐츠 폭: `1520px`
- 좌우 안전 여백: `40px`

### Tablet

- breakpoint: `768px ~ 1199px`
- 좌우 여백: `24px`

### Mobile

- breakpoint: `<= 767px`
- 좌우 여백: `16px`

## 3. 폰트 체계

### Primary UI sans

- family: `Instrument Sans`
- fallback: `Manrope`, `Noto Sans KR`, `sans-serif`
- usage: 본문, 버튼, 입력, 표, 상태, 도구 라벨, 내비게이션

### Display serif

- family: `Fraunces`
- fallback: `Cormorant Garamond`, `serif`
- usage: core product package에서는 사용하지 않는다
- note: 별도 public marketing site가 생길 경우에만 사용 가능

### Font weight contract

- `400`: 긴 본문
- `500`: 기본 UI 라벨
- `600`: 버튼, 필드 라벨, 상태 제목
- `700`: 핵심 수치, 선택 상태, 강한 구역 제목

### Numeric contract

- 숫자와 시간은 `font-variant-numeric: tabular-nums`
- BPM, 점수, 시간, take index, export count 모두 tabular figures 사용

## 4. 타입 스케일

### Desktop

| Token | Size | Line height | Weight | Usage |
| --- | --- | --- | --- | --- |
| `display-01` | `64px` | `0.98` | `600` | reserved outside core product |
| `display-02` | `48px` | `1.00` | `600` | reserved outside core product |
| `title-01` | `32px` | `1.08` | `700` | Page `h1` |
| `title-02` | `24px` | `1.12` | `700` | Major panel `h2` |
| `title-03` | `20px` | `1.18` | `700` | Minor panel `h3` |
| `body-01` | `18px` | `1.55` | `400` | Launch helper copy |
| `body-02` | `16px` | `1.55` | `400` | Default body copy |
| `label-01` | `15px` | `1.35` | `600` | Buttons, form labels |
| `label-02` | `14px` | `1.30` | `600` | Dense labels |
| `meta-01` | `12px` | `1.25` | `600` | Eyebrow, field meta |

### Mobile

| Token | Size | Line height | Weight | Usage |
| --- | --- | --- | --- | --- |
| `display-01` | `40px` | `1.00` | `600` | reserved outside core product |
| `title-01` | `28px` | `1.10` | `700` | Page `h1` |
| `title-02` | `22px` | `1.14` | `700` | Major panel `h2` |
| `body-01` | `17px` | `1.55` | `400` | Launch helper copy |
| `body-02` | `15px` | `1.55` | `400` | Default body copy |
| `label-01` | `14px` | `1.35` | `600` | Buttons, labels |
| `meta-01` | `12px` | `1.25` | `600` | Eyebrow |

## 5. 색상 토큰

| Token | Value | Usage |
| --- | --- | --- |
| `shell-900` | `#151C22` | deepest shell |
| `shell-850` | `#1B242D` | top bars, rails |
| `shell-800` | `#232F3A` | secondary shell |
| `paper-000` | `#FFFDF9` | primary paper |
| `paper-050` | `#FBF6EE` | default light surface |
| `paper-100` | `#F2E7D8` | tinted paper |
| `line-200` | `#DDD2C3` | light dividers |
| `line-400` | `#BDAF9A` | medium dividers |
| `ink-900` | `#1E2A35` | strong text |
| `ink-700` | `#465867` | body text |
| `ink-500` | `#6B7B88` | muted text |
| `accent-600` | `#B75B2D` | main accent |
| `accent-500` | `#CA6D3A` | hover accent |
| `signal-cyan-500` | `#4C8FA6` | waveform, pitch overlay |
| `success-500` | `#2F7B62` | ready, stable |
| `warning-500` | `#A36B1D` | caution |
| `danger-500` | `#A5433F` | error |

## 6. 간격 체계

| Token | Value |
| --- | --- |
| `space-04` | `4px` |
| `space-08` | `8px` |
| `space-12` | `12px` |
| `space-16` | `16px` |
| `space-20` | `20px` |
| `space-24` | `24px` |
| `space-32` | `32px` |
| `space-40` | `40px` |
| `space-56` | `56px` |
| `space-72` | `72px` |

## 7. 모서리와 선

### Radius contract

- Root Launch shell: `24px`
- Root Launch status chips: `12px`
- Studio / Arrangement / Ops workspace panels: `0px`
- Shared Review summary chips: `12px`
- Pill badges only: `999px`

### Border contract

- default divider: `1px solid line-200`
- workspace shell divider: `1px solid #3A4753`
- score paper border: `1px solid line-400`
- warning outline: `1px solid warning-500`

## 8. 그림자 규칙

- Root Launch shell: soft depth shadow 금지
- Shared Review export popover: soft floating shadow 허용
- Studio, Arrangement, Ops main panels: 그림자 금지

## 9. 버튼 규격

### 9.1 Brand primary button

- height: `48px`
- padding: `0 20px`
- radius: `12px`
- font: `label-01`
- background: `accent-600`
- text: `paper-000`
- usage: Root Launch CTA, export confirmation CTA

### 9.2 Brand secondary button

- height: `48px`
- padding: `0 20px`
- radius: `12px`
- background: transparent
- border: `1px solid line-400`
- text: `ink-900`

### 9.3 Workspace command button

- height: `36px`
- padding: `0 12px`
- radius: `0px`
- font: `label-02`
- background: `paper-000`
- border: `1px solid line-400`
- text: `ink-900`
- usage: Studio, Arrangement, Ops

### 9.4 Workspace primary command button

- same size as workspace command
- background: `shell-850`
- border: `1px solid shell-850`
- text: `paper-000`

### 9.5 Disabled button

- opacity: `0.42`
- cursor: `not-allowed`
- no drop shadow

## 10. 입력 요소 규격

### 10.1 Root Launch form input

- height: `56px`
- radius: `16px`
- background: `paper-000`
- border: `1px solid line-200`
- font: `body-02`
- text: `ink-900`
- placeholder: `ink-500`

### 10.2 Workspace input

- height: `36px`
- radius: `0`
- background: `paper-000`
- border: `1px solid line-400`
- font: `label-02`

### 10.3 Textarea

- min-height: `128px`
- radius: `0`
- padding: `12px`
- resize: vertical only

## 11. Badge / pill 규격

### Status pill

- min-height: `28px`
- padding: `0 10px`
- radius: `999px`
- font: `meta-01`
- dot icon at left: `8px`

### Color mapping

- ready: `success-500` tint
- warning: `warning-500` tint
- error: `danger-500` tint
- neutral: `paper-100`

## 12. 탭 규격

- height: `40px`
- desktop min width: `96px`
- border bottom active only
- no pill tabs in Studio or Arrangement

## 13. 카드 사용 규칙

- Root Launch outer shell: 허용
- Root Launch recent rows: 금지
- Shared Review asset group: 제한적으로 허용
- Studio core: 금지
- Arrangement core: 금지
- Ops: 금지

## 14. 모달/드로어/팝오버 공통 규격

## 14.1 Modal

- width: `640px`
- max-height: `80vh`
- radius: `20px`
- overlay bg: `rgba(17, 23, 29, 0.48)`
- header height: `72px`
- footer height: `72px`

사용 용도:

- destructive confirm
- share publish
- export pack confirm
- validation import confirm

## 14.2 Drawer

- right-side drawer width: `440px`
- left-side drawer width: `400px`
- full-height
- radius: `0`
- shell bg: `paper-000`
- divider-heavy layout

사용 용도:

- audio setup
- chord timeline editor
- candidate constraints
- log detail

## 14.3 Popover

- width: `280px`
- radius: `12px`
- padding: `12px`
- shadow: `0 12px 32px rgba(20, 29, 37, 0.16)`

사용 용도:

- note detail quick info
- export quick actions
- playback mode quick select

## 14.4 Dropdown

- width matches trigger or explicit `240px`
- item height: `36px`
- list padding: `8px`
- radius: `12px` on Root Launch, `0` in workspace surfaces

## 14.5 File picker

- browser-native system dialog 사용
- 커스텀 모달로 대체 금지

## 15. 토스트 규격

- 위치: top-right desktop, bottom-center mobile
- width: `320px`
- radius: `12px`
- duration: `4s`
- action button: optional 1개 only

## 16. 모션 규격

- page reveal: `180ms ~ 260ms`
- drawer slide: `220ms`
- modal fade + scale: `180ms`
- active tab underline: `120ms`
- selection highlight: `120ms`

## 17. 접근성 고정 규칙

- 모든 텍스트 대비 `WCAG AA` 이상
- interactive target 최소 `40 x 40px`
- focus ring: `2px solid accent-500`
- icon-only button 금지, 단 예외적으로 close button은 `aria-label` 필수

## 18. 전역 금지 항목

- 구현 상태 설명 문구
- MVP 문구
- API 연결 상태 자랑
- dashboard card mosaic
- public-facing marketing hero inside core product
- Studio/Arrangement/Ops에서 둥근 카드 더미
- 12px 미만 본문
- 영어 개발 용어를 그대로 노출하는 UI 라벨
