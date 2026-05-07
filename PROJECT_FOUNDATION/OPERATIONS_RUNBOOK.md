# GigaStudy Operations Runbook

Date: 2026-05-07

This runbook covers alpha deployment, secret handling, R2 metadata
backup/restore, environment standardization, and the installable web app
boundary. It is operational foundation because these choices affect user data
durability and admin access.

## Runtime Decision

GigaStudy remains web-first for alpha.

- Cloudflare Pages hosts the web client.
- Cloud Run hosts the API.
- Cloudflare R2 stores metadata, engine queue state, asset registry, uploads,
  generated files, and playback-instrument config.
- The web client may be installed as a PWA shell, but important keys and
  privileged actions remain server-side.
- Native desktop packaging is deferred until local ML, offline projects, MIDI
  devices, or filesystem-first workflows become product requirements.

## Secret Classes

Public web values:

- `VITE_API_BASE_URL`

Non-secret API config:

- `GIGASTUDY_API_APP_ENV`
- `GIGASTUDY_API_CORS_ORIGINS`
- `GIGASTUDY_API_METADATA_BACKEND`
- `GIGASTUDY_API_METADATA_PREFIX`
- `GIGASTUDY_API_STORAGE_BACKEND`
- `GIGASTUDY_API_STORAGE_ROOT`
- `GIGASTUDY_API_S3_BUCKET`
- `GIGASTUDY_API_S3_REGION`
- `GIGASTUDY_API_S3_ENDPOINT_URL`
- cleanup, retention, cache, and limit values

Secret API config:

- `GIGASTUDY_API_ADMIN_PASSWORD`
- `GIGASTUDY_API_ADMIN_PASSWORD_ALIASES`, if used
- `GIGASTUDY_API_ADMIN_SESSION_SECRET`
- `GIGASTUDY_API_ADMIN_TOKEN`, only for scripts or emergency operator access
- `GIGASTUDY_API_S3_ACCESS_KEY_ID`
- `GIGASTUDY_API_S3_SECRET_ACCESS_KEY`
- `GIGASTUDY_API_DEEPSEEK_API_KEY`, if LLM features are enabled
- `GIGASTUDY_API_DATABASE_URL`, if Postgres is reintroduced

Do not put secret API config in Pages, Vite, or tracked env files. Native app
packaging would not change this rule because client-bundled keys can be
extracted.

## Admin Sessions

The admin page logs in with the configured admin username/password and receives
a short-lived signed bearer token. The browser stores only that token in
`sessionStorage`; it does not store the admin password after login.

Defaults:

- session token TTL: 1 hour
- token signing secret: `GIGASTUDY_API_ADMIN_SESSION_SECRET`
- fallback static admin token: supported only for scripts/emergency operations

If admin credentials leak:

1. Rotate `GIGASTUDY_API_ADMIN_PASSWORD`.
2. Rotate `GIGASTUDY_API_ADMIN_SESSION_SECRET` to invalidate existing browser
   sessions.
3. Rotate `GIGASTUDY_API_ADMIN_TOKEN` if it was configured.
4. Redeploy the API revision with the new secrets.

## Secret Manager Deployment

Alpha Cloud Run deployments should use Google Secret Manager for secrets.

Required secret names:

- `gigastudy-api-admin-password`
- `gigastudy-api-admin-session-secret`
- `gigastudy-api-s3-access-key-id`
- `gigastudy-api-s3-secret-access-key`

Optional secret names:

- `gigastudy-api-admin-password-aliases`
- `gigastudy-api-admin-token`
- `gigastudy-api-deepseek-api-key`

Grant the Cloud Run runtime service account secret access before deploying.
Use the smallest service account scope available for the alpha service.

Deployment files:

- `ops/cloud-run.alpha.env.example.yaml` documents non-secret alpha env values.
- `ops/cloud-run.alpha.env.yaml` is the local, untracked copy used by deploys.
- `ops/deploy-api-alpha.ps1` builds and deploys the API with
  `--env-vars-file` and `--set-secrets`.

The API deployment keeps:

- `--min-instances 0`
- `--max-instances 1`
- `--concurrency 4`
- no always-on scheduler

## R2 Metadata Backup

R2 metadata is object storage, not a transactional database. Alpha backups are
prefix snapshots.

Back up before risky changes:

1. Confirm the target bucket and prefix.
2. Export these prefixes:
   - `metadata/`
   - `uploads/`
   - `jobs/`
   - `staged/`
   - `playback_instrument/`
3. Store the export under a dated backup prefix or outside the bucket.
4. Record the API revision, web asset hash, and backup timestamp.

Restore:

1. Stop user-facing writes by avoiding new studio/import actions during the
   restore window.
2. Back up the current prefixes before overwriting anything.
3. Copy the selected backup prefixes back to their active locations.
4. Run API smoke checks:
   - `/api/health`
   - `/api/health/ready`
   - `/api/studios?limit=12&offset=0`
5. Open at least one restored studio and verify regions, archives, and assets.

Never partially restore only `metadata/` when referenced audio/generated assets
are also needed for playback or restore.

## Cleanup Policy

Default alpha retention:

- pending browser recordings: 30 minutes
- orphan direct uploads: 30 minutes
- inactive studio assets: 7 days
- non-pinned track archives: latest 3 per slot

Cleanup is explicit or opportunistic. Do not add a 5-minute scheduler that wakes
the API only to drain work.

## PWA Boundary

The web app exposes a manifest and a minimal service worker so testers can
install it as an app-like shell.

The service worker must not cache API responses or studio data by default. User
data durability belongs to the API/R2 backend, not to an offline browser cache.

PWA installability is a UX convenience, not a security boundary.
