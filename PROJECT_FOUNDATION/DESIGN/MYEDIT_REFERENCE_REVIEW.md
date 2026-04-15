Date: 2026-04-15
Status: Accepted as a Studio-only structural reference.

# MyEdit Reference Review

## 1. Why This Reference Matters

The attached MyEdit screen is a stronger reference than the current Studio surface for one specific job:
editing and reviewing one audio segment without distraction.

Unlike the broader Filmora pass, this reference is not about multi-panel media production.
It is about a single focused waveform workspace.

## 2. What The Reference Does Well

1. One task is obvious immediately.
   The user understands in one glance that this screen is for trimming and reviewing one audio file.
2. The waveform is the hero.
   The largest area belongs to the audio itself, not to secondary panels.
3. The left rail is narrow and concrete.
   Tools read like short working steps instead of a dashboard.
4. The lower control strip is practical.
   `start`, `end`, `mode`, and the main action sit close to the waveform instead of being scattered.
5. The primary action is visually unambiguous.
   There is one strong button that says "finish this edit".

## 3. What We Should Adopt

- a dark single-task workspace for Studio `리뷰` and `구간 다듬기`
- one dominant waveform stage
- a slim left tool rail with short Korean menu labels
- a lower trim-control strip with `시작`, `끝`, `방식`
- one strong primary action area for `적용` and `저장`

## 4. What We Should Reject

- mixed image/audio product chrome
- generic downloader branding language
- English-first menu labels
- consumer-tool clutter that does not help vocal practice
- any wording that sounds like internal engine names or editor variables

## 5. GigaStudy Mapping

The MyEdit-like pass maps to GigaStudy like this:

- file chip
  selected take or selected guide/take pair
- waveform stage
  take waveform with selected practice range
- left tool rail
  `구간 자르기`, `호흡 정리`, `다시 듣기`, `내보내기`
- lower control strip
  `시작`, `끝`, `적용 방식`
- primary action
  `적용`, `되돌리기`, `저장`

This is a Studio-only reference.
It should sharpen the recording/review workspace, not replace the broader product direction set by `UI_DESIGN_DIRECTION.md`.

## 6. Accepted Mockup Outcome

This review is considered applied when the repo includes:

- one editable source for `studio-v3-wave-editor`
- one frozen export for `studio-v3-wave-editor`
- one future browser-reviewed implementation pass that clearly follows the waveform-first workspace structure

## 7. Current Decision

`Filmora` remains the accepted secondary reference for multi-panel workspace structure.
`MyEdit` is now the accepted direct reference for the next Studio-only waveform editor pass.
