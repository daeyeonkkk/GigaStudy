# GigaStudy 화면설계 패키지 v2

Date: 2026-04-16  
Status: Review draft. This package is a from-scratch fixed screen-spec set for review.

## 목적

이 패키지는 현재 구현 화면을 정리하는 문서가 아니다.  
`GigaStudy` 제품에 맞는 새 화면설계를 고정값 수준으로 정의하는 문서 묶음이다.

즉, 이 패키지는 다음 기준으로 작성되었다.

- 현재 UI를 참고 기준으로 삼지 않는다
- 제품 목표, 사용자 흐름, 기능 요구를 기준으로 새로 설계한다
- 각 화면의 요소, 폰트, 크기, 간격, 색, 버튼 연결, 드롭다운, 모달, 팝오버까지 고정값으로 정의한다

## 문서 구성

1. [00_GLOBAL_UI_FIXED_SPEC.md](/C:/my_project/GigaStudy/PROJECT_FOUNDATION/DESIGN/UI_SCREEN_SPEC_PACKAGE/00_GLOBAL_UI_FIXED_SPEC.md:1)
2. [01_ROOT_LAUNCH_SCREEN_SPEC.md](/C:/my_project/GigaStudy/PROJECT_FOUNDATION/DESIGN/UI_SCREEN_SPEC_PACKAGE/01_ROOT_LAUNCH_SCREEN_SPEC.md:1)
3. [02_STUDIO_SCREEN_SPEC.md](/C:/my_project/GigaStudy/PROJECT_FOUNDATION/DESIGN/UI_SCREEN_SPEC_PACKAGE/02_STUDIO_SCREEN_SPEC.md:1)
4. [03_ARRANGEMENT_SCREEN_SPEC.md](/C:/my_project/GigaStudy/PROJECT_FOUNDATION/DESIGN/UI_SCREEN_SPEC_PACKAGE/03_ARRANGEMENT_SCREEN_SPEC.md:1)
5. [04_SHARED_REVIEW_SCREEN_SPEC.md](/C:/my_project/GigaStudy/PROJECT_FOUNDATION/DESIGN/UI_SCREEN_SPEC_PACKAGE/04_SHARED_REVIEW_SCREEN_SPEC.md:1)
6. [05_OPS_SCREEN_SPEC.md](/C:/my_project/GigaStudy/PROJECT_FOUNDATION/DESIGN/UI_SCREEN_SPEC_PACKAGE/05_OPS_SCREEN_SPEC.md:1)
7. [06_INTERACTION_CONNECTION_MATRIX.md](/C:/my_project/GigaStudy/PROJECT_FOUNDATION/DESIGN/UI_SCREEN_SPEC_PACKAGE/06_INTERACTION_CONNECTION_MATRIX.md:1)

## 읽는 순서

1. `00_GLOBAL_UI_FIXED_SPEC.md`
2. 페이지별 화면설계서
3. `06_INTERACTION_CONNECTION_MATRIX.md`

## 문서 해석 규칙

- 페이지별 문서가 공통 규격보다 우선한다
- 버튼 연결, 모달 연결, 드롭다운 연결은 `06_INTERACTION_CONNECTION_MATRIX.md`를 최종 기준으로 본다
- 현재 코드와 다를 경우 이 패키지가 우선이다

## 화면 ID

- `LAUNCH`
- `STUDIO`
- `ARR`
- `REVIEW`
- `OPS`

## 표면 ID 규칙

- 페이지: `PAGE-*`
- 모달: `MODAL-*`
- 드로어: `DRAWER-*`
- 팝오버: `POPOVER-*`
- 드롭다운: `DROPDOWN-*`
- 토스트: `TOAST-*`

## 현재 판단

이 패키지는 코어 제품의 첫 화면을 marketing home이 아니라 `Root Launch Screen`으로 본다.  
즉, `/`는 소개 페이지가 아니라 다음 세 가지를 즉시 처리하는 진입 화면이다.

- 새 프로젝트 만들기
- 최근 프로젝트 다시 열기
- 공유 검토 링크 열기

마케팅 목적의 public landing은 이 패키지 범위 밖이다.
