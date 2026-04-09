# Browser Environment Validation

Date: 2026-04-08

## Purpose

This document defines how GigaStudy validates real browser and hardware variability after the seeded Playwright release gate.

The automated browser gate is now good at proving the main flows work in controlled environments.
It is not enough to answer the harder product question:

`Will real users with different microphones, speakers, permissions, and Safari-family quirks still get a trustworthy recording and playback experience?`

This protocol closes that gap.

## What We Already Trust

- Chromium seeded smoke path
- Firefox seeded safe-path smoke path
- WebKit seeded safe-path smoke path
- Chromium fake-microphone recorder transport
- Chromium long-session endurance
- DeviceProfile capability snapshot capture
- Ops environment diagnostics view

## What Still Needs Native Validation

- Native Safari / WebKit recording transport
- Real microphone permission prompts and denial / recovery behavior
- Real output-route differences:
  built-in speakers, headphones, Bluetooth audio
- Actual MediaRecorder MIME support by environment
- Real Web Audio / OfflineAudioContext availability and latency behavior
- Long-session recording and playback on real hardware

## Required Test Matrix

Each validation round should cover at least this matrix:

1. Windows + Chrome + USB microphone + wired headphones
2. Windows + Firefox + built-in microphone + built-in speakers
3. macOS + Safari + built-in microphone + built-in speakers
4. macOS + Safari + AirPods or Bluetooth output
5. macOS + Chrome + wired headphones
6. iPadOS or iOS Safari if mobile recording is in near-term scope

If the full matrix is not available in one round, record exactly which cells were skipped.

## Required Flow Per Environment

For each matrix cell, validate this order:

1. Open the app in a secure context.
2. Enter the studio and request microphone access.
3. Save a DeviceProfile.
4. Confirm requested constraints and applied settings are visible.
5. Confirm current capability warnings and saved capability warnings are visible.
6. Record a short take.
7. Stop recording and confirm the take returns to the studio list.
8. Run post-recording analysis.
9. Play arrangement preview if that browser supports Web Audio playback.
10. Open ops overview and confirm the environment appears in diagnostics.

## Required Evidence Per Run

For each validated environment, capture:

- date and tester
- device model
- OS version
- browser version
- input device
- output route
- whether the page was a secure context
- microphone permission state before and after request
- selected recording MIME type
- audio context mode
- offline audio context mode
- actual sample rate
- base latency
- output latency
- warning flags
- whether take recording succeeded
- whether analysis succeeded
- whether playback succeeded
- notes on audible glitches, permission confusion, or latency surprises

## Pass / Warn / Fail Rules

Mark the run as `PASS` only if:

- DeviceProfile saves successfully
- take recording succeeds
- recorded take reappears in the studio
- analysis succeeds
- no unexpected warning flags appear
- no user-blocking playback or permission issue occurs

Mark the run as `WARN` if:

- the main recording flow works
- but there are warning flags, degraded playback, missing offline rendering, legacy webkit fallback, or confusing permission UX

Mark the run as `FAIL` if:

- microphone access cannot be recovered
- take recording cannot complete
- saved DeviceProfile data is inconsistent with observed behavior
- analysis or playback is blocked by the environment in a way the product does not explain

## Ops Report Workflow

Before a manual validation round:

1. Open `/ops`
2. Refresh overview
3. Download the environment diagnostics report
4. Use that report as the baseline for the round
5. If testers are collecting evidence outside the product UI, start from `apps/api/environment_validation/environment_validation_runs.template.csv`
6. Convert that sheet with `uv run python scripts/import_environment_validation_runs.py`
7. Review the preview JSON or submit the rows into the API
8. Prepare a new validation run entry in the ops validation log form if any manual follow-up is still needed

After a manual validation round:

1. Save DeviceProfiles from the tested environments
2. Refresh `/ops`
3. Save a structured validation run in the ops validation log
4. Download a fresh environment diagnostics report
5. Download the environment validation packet from ops
6. Attach the packet plus diagnostics report to release notes or the validation log
7. Compare new warning flags against the previous baseline

The environment validation packet is the preferred release-review artifact because it packages:

- the latest diagnostics snapshot
- recent manual validation runs
- required matrix coverage
- claim guardrails
- compatibility notes inferred from the stored evidence

The browser compatibility release-note draft is the preferred publishing artifact because it translates that packet into:

- covered matrix cells
- compatibility notes
- claim guardrails
- unsupported or not-yet-validated paths
- recent manual validation run summaries

## Release Gate Expectations

Before claiming improved browser support in release notes:

- at least one native Safari or WebKit run must be recorded
- at least one real-hardware recording run must be recorded
- warning flags added by the new environment must be explained
- the exported environment validation packet must be reviewed for uncovered matrix cells and guardrails
- the exported browser compatibility release-note draft must be reviewed before updating support claims
- any unsupported path must be described honestly in product and ops notes

## Current Honest Product Claim

Today GigaStudy can claim:

- seeded cross-browser flow coverage
- DeviceProfile environment diagnostics
- ops visibility into browser-audio warnings

Today GigaStudy should not claim:

- universal recorder reliability across native Safari and all hardware routes
- fully validated playback stability on all Safari-family environments

## Report Template

Use this template for each round:

```md
# Browser Environment Validation Run

- Date:
- Tester:
- Build / commit:

## Matrix Covered

- [ ] Windows + Chrome + USB mic + wired headphones
- [ ] Windows + Firefox + built-in mic + speakers
- [ ] macOS + Safari + built-in mic + speakers
- [ ] macOS + Safari + Bluetooth output
- [ ] macOS + Chrome + wired headphones
- [ ] Mobile Safari

## Results

### Environment
- Device:
- OS:
- Browser:
- Input:
- Output:

### DeviceProfile Snapshot
- Secure context:
- Mic permission:
- Recording MIME:
- AudioContext mode:
- OfflineAudioContext mode:
- Sample rate:
- Base latency:
- Output latency:
- Warning flags:

### Flow Outcome
- DeviceProfile save:
- Take recording:
- Analysis:
- Playback:
- Overall: PASS / WARN / FAIL

### Notes
- Audible issues:
- Permission issues:
- Unexpected warnings:
- Follow-up needed:
```
