# GigaStudy Architecture Principles

Date: 2026-04-30

This document defines the code-structure rules for the current six-track
a cappella studio. It exists to keep feature work from turning the repository
back into one large page and one large service.

## Product Boundary

GigaStudy is one six-track score studio. The code should make that mental model
obvious:

- BPM and meter define the shared score paper.
- TrackNote is the symbolic truth.
- Retained audio is a playback asset aligned to that truth.
- User Sync moves a track layer after registration; it does not rewrite the
  score grid.

## Layer Responsibilities

### API Routes

Routes translate HTTP into use-case calls. They should not contain extraction,
notation, scoring, upload, or storage business rules.

Allowed:

- request/response binding
- dependency injection
- simple URL/header response shaping

Avoid:

- TrackNote mutation
- file validation policy
- queue scheduling decisions
- musical scoring/notation rules

### Studio Repository

`StudioRepository` is the studio write-boundary and orchestration facade.

Allowed:

- load/save studio documents
- enforce access/capacity before writes
- coordinate engines, queues, assets, and sidecars
- commit final track/candidate/report state

Avoid:

- low-level upload parsing
- direct-upload token cryptography
- direct stored-asset writes, deletes, lifecycle cleanup, or registry upserts
- candidate confidence math
- reusable TrackNote timeline transforms
- browser/UI-specific wording or layout assumptions

If a helper can be tested without repository storage, it probably belongs in a
policy or engine module instead.

### Studio Command Services

`studio_*_commands.py` modules are route-facing use-case coordinators that sit
behind `StudioRepository`.

Allowed:

- coordinate one user/admin action such as upload, generation, scoring,
  candidate review, resource lookup, or queue maintenance
- call repository persistence hooks when the action needs a transaction-like
  load/mutate/save boundary
- translate domain/use-case failures into HTTP-facing errors

Avoid:

- low-level asset/object-store implementation details
- reusable music-domain algorithms
- browser copy or layout assumptions
- becoming broad "misc command" containers

These command services are intentionally internal to the repository boundary.
They may use named repository hooks, but each command file must still have one
clear reason to change.

### Engine Modules

Engine modules own music-domain logic.

Allowed:

- TrackNote normalization
- sync-resolved note views
- voice extraction
- symbolic import
- OMR parsing
- harmony generation
- scoring
- notation/ensemble quality gates

Avoid:

- HTTP request details
- admin storage summaries
- object-store credentials
- browser state

### Storage And Upload Policy

Storage modules own bytes and durable metadata. Upload policy modules own file
type, MIME, staged/direct upload, and base64 validation.

Allowed:

- object/local storage path handling
- asset registry records
- direct-upload target/token policy
- upload size/type validation
- temporary scoring/engine upload files
- staged-upload promotion and cleanup

Avoid:

- TrackNote generation
- score notation cleanup
- user-facing studio flow decisions

`StudioAssetService` is the current boundary for this layer inside the API. New
file persistence, direct-upload, asset-registry, or cleanup behavior should be
added there first, then called by `StudioRepository` as orchestration. Admin
storage summaries may use studio state to mark references, but registry reads,
storage backfill, and asset summary shaping belong to the asset service.

### Web Pages

Pages coordinate route state, API calls, and user interactions.

Allowed:

- React state
- user action handlers
- composition of studio components
- page-level loading/error states

Avoid:

- low-level Web Audio scheduling math
- score engraving math
- file type policy
- candidate summary rules
- repeated route-state or empty/error shell markup

Those rules belong in `apps/web/src/lib/*` or focused components.

## Refactoring Rules

1. Prefer moving pure functions before splitting stateful classes.
2. Keep behavior unchanged unless the current behavior violates the foundation.
3. Every extracted module must have one reason to change.
4. Avoid "misc", "utils", or "helpers" names when a domain name exists.
5. A compatibility reader for old alpha data may remain if deleting it would
   make existing studios unrecoverable. It must be named as compatibility, not
   product behavior.
6. New code paths must pass through the shared registration quality gates before
   writing TrackNotes to a track.

## Current Hotspots

These files are still worth watching:

- `apps/api/src/gigastudy_api/services/studio_repository.py`
- `apps/web/src/components/studio/useStudioPlayback.ts`
- `apps/web/src/components/studio/EngravedScoreStrip.tsx`
- `apps/web/src/components/studio/TrackBoard.tsx`
- `apps/web/src/components/studio/TrackBoard.css`

When adding features, first ask whether code can move into an existing engine,
storage, upload policy, playback, engraving, or candidate-summary module.
