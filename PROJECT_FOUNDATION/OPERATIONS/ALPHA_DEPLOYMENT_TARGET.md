# Alpha Deployment Target

Date: 2026-04-13
Status: Reviewed against official platform docs and current GigaStudy repo constraints.

## 1. Short Answer

For a low-traffic personal alpha, this stack is directionally strong:

- Cloudflare Pages for the web frontend
- Cloud Run for the FastAPI backend
- Neon for PostgreSQL
- Cloudflare R2 for object storage

It is a good fit for GigaStudy's current architecture because the product is already split into:

- static frontend
- API backend
- PostgreSQL-compatible metadata
- S3-compatible object storage

However, the proposal is not `drop in and deploy today` as written.
Three repo-specific gaps matter before this becomes the real staging path:

1. the backend does not yet have a Cloud Run container image
2. uploads still pass through the API service instead of going direct to object storage
3. the frontend build settings in the proposal do not exactly match this monorepo

## 2. Official Cost And Limit Check

As of 2026-04-13, the proposal is mostly accurate.

### Cloudflare Pages

- Pages Free is still `$0`
- the Free plan includes:
  - 500 builds per month
  - 100 custom domains per project
  - unlimited static requests and bandwidth for static assets
- Pages also supports SPA-style routing behavior when no top-level `404.html` is present

Why this matters for GigaStudy:

- the current web app is a Vite SPA with React Router
- the repo does not ship a top-level `404.html`, so Pages is a viable frontend host

### Neon

- Neon still has a free plan at `$0`
- Neon currently advertises:
  - 0.5 GB storage per project
  - 100 compute hours per project per month
  - no credit card
  - no time limit

Why this matters for GigaStudy:

- this is enough for alpha-scale metadata
- the app should use the current Alembic schema, not a hand-picked subset of only a few tables

### Cloudflare R2

- R2 still has a generous free tier
- current free monthly usage includes:
  - 10 GB-month storage
  - 1 million Class A operations
  - 10 million Class B operations
- standard extra storage is still listed at `$0.015 / GB-month`

Why this matters for GigaStudy:

- storage cost is small for early audio usage
- direct upload is especially attractive because it keeps large audio payloads away from Cloud Run

### Cloud Run

- Cloud Run still requires a billing-enabled GCP project in practice
- the request-based free tier still includes:
  - 2 million requests per month
  - 180,000 vCPU-seconds per month
  - 360,000 GiB-seconds per month
- Cloud Run Jobs still have a separate free tier:
  - 240,000 vCPU-seconds per month
  - 450,000 GiB-seconds per month
- service request timeout still goes up to 60 minutes
- Cloud Run Jobs task timeout still goes up to 168 hours
- HTTP/1 request size is still capped at 32 MiB
- source deployments still rely on Cloud Build and Artifact Registry, which are billed separately from Cloud Run runtime pricing

Why this matters for GigaStudy:

- a low-traffic alpha can often remain near free-tier usage
- sync analysis is still a reasonable first deployment mode
- large audio uploads should not keep going through the API if Cloud Run is the production backend

## 3. What Is Right In The Proposal

- `Cloudflare Pages + Cloud Run + Neon + R2` is a sensible low-cost alpha target
- starting with one backend service is reasonable
- synchronous analysis is reasonable at alpha scale
- R2 is a good target for audio and generated artifacts
- Cloud Run `min instances = 0` is a good cost-control starting point
- delaying job splitting until real demand appears is reasonable

## 4. What Needs Correction For This Repo

### Frontend Build Settings

The proposal says:

- build command: `npm run build`
- output directory: `dist`

That is only correct if the Pages project root is set to `apps/web`.

For this repo there are two valid setups:

1. Pages root directory = `apps/web`
   - build command: `npm run build`
   - output directory: `dist`
2. Pages root directory = repo root
   - build command: `npm run build:web`
   - output directory: `apps/web/dist`

### Database Bootstrap

The proposal suggests manually starting with only a few tables.
That is not the right path for the current repo.

GigaStudy already depends on the current SQLAlchemy models and Alembic revisions.
For Neon, the correct bootstrap path is:

- create the database
- point `GIGASTUDY_API_DATABASE_URL` at Neon
- run `uv run alembic upgrade head`

This avoids drift between the repo and the deployed schema.

### Authentication Scope

The proposal suggests invite-code auth as the fastest alpha path.
For the current repo, that is not actually the fastest path.

GigaStudy already has:

- no real auth wall
- a default dev user path
- read-only share links

So the fastest alpha path is:

- keep auth minimal
- keep read-only share links
- do not introduce invite-code auth unless alpha users truly need it

### Backend Packaging

The repo does not currently contain a backend Dockerfile.

That matters more than usual here because the melody path uses a Node helper for Basic Pitch.
A real Cloud Run image for this repo should include:

- Python runtime
- Node runtime
- app dependencies
- the Basic Pitch helper script and package path

### Upload Flow

The current product upload flow still writes audio through API upload endpoints like:

- `PUT /api/uploads/tracks/{track_id}`

That is workable locally, but it is a weak fit for Cloud Run because:

- HTTP/1 request size is capped at 32 MiB
- large uploads keep API instances busy
- upload traffic increases backend cost and failure surface

So for the real alpha deployment path, browser-to-R2 direct upload should be treated as a deployment blocker, not as a later nice-to-have.

### Analysis Shape

The proposal describes one large `/analyze` request that also does melody extraction.

That is not how the current product is structured.
The current repo already has a cleaner split:

- analysis
- melody extraction
- arrangement generation

That split is good for alpha and should be preserved unless real usage proves otherwise.

## 5. Recommended Alpha Sequence For GigaStudy

1. Deploy the frontend to Cloudflare Pages.
2. Package the backend for Cloud Run with both Python and Node.
3. Point the backend at Neon PostgreSQL and R2.
4. Move browser uploads to direct object-storage upload URLs.
5. Wire `VITE_API_BASE_URL`, backend `CORS`, and `GIGASTUDY_API_PUBLIC_APP_URL`.
6. Verify one HTTPS staging flow end to end:
   project -> guide -> take -> analysis -> melody -> arrangement -> share.
7. Only then start collecting real-human and real-hardware evidence rounds.

## 6. Recommendation

Keep the stack choice.
Adjust the implementation order.

The best near-term deployment target for this repo is still:

- Cloudflare Pages
- Cloud Run
- Neon
- R2

But the first real deployment slice should be:

- document the target
- containerize the backend
- switch uploads to direct object storage
- verify one staging environment

## 7. Sources

- Cloudflare Pages limits and pricing:
  - https://developers.cloudflare.com/pages/platform/limits/
  - https://developers.cloudflare.com/pages/configuration/serving-pages/
- Neon pricing:
  - https://neon.tech/pricing
- Cloudflare R2 pricing:
  - https://developers.cloudflare.com/r2/pricing/
  - https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/
- Cloud Run pricing and limits:
  - https://cloud.google.com/run/pricing
  - https://cloud.google.com/run/quotas
  - https://cloud.google.com/run/docs/configuring/request-timeout
  - https://cloud.google.com/run/docs/configuring/task-timeout
