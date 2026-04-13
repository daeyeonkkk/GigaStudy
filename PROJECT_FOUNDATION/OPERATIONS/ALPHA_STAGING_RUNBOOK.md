# Alpha Staging Runbook

Date: 2026-04-13
Status: Use this document to close the last open Alpha Deployment Track item:
`one real HTTPS staging environment has been verified end to end on the chosen alpha stack`.

## 1. Goal

This runbook is the operator path for the current alpha target:

- Cloudflare Pages
- Cloud Run
- Neon
- Cloudflare R2

Repo-side scaffolding already exists.
The remaining work is now account setup, secret values, and one real end-to-end staging verification.

## 2. What The User Needs To Do

The user must prepare the cloud accounts and secret values.
Those are the only parts the repo cannot invent safely.

### 2.1 Cloudflare

Prepare these:

1. One Pages project
   - Prefer an existing Git-integrated Pages project if you want to preserve Git-based deploy options later.
   - If you create a brand-new Direct Upload project, Cloudflare does not let that same project switch to Git integration later.
2. One R2 bucket
   - Recommended alpha name:
     `gigastudy-alpha`
3. One R2 S3 API token
   - Scope:
     object read and write for the alpha bucket
4. Your Cloudflare account id

You will need these values:

- Pages project name
- Pages production URL
- Cloudflare account id
- R2 bucket name
- R2 access key id
- R2 secret access key

### 2.2 Neon

Prepare these:

1. One Neon project
2. One database
3. One role with password
4. One connection string

Use a connection string that includes:

- database host
- database name
- role
- password
- `sslmode=require`

You will need this value:

- `GIGASTUDY_API_DATABASE_URL`

### 2.3 Google Cloud

Prepare these:

1. One billing-enabled GCP project
2. Enable these services:
   - Cloud Run
   - Cloud Build
   - Artifact Registry
3. Install and log in with `gcloud`
4. Pick one region
   - recommended starting point:
     `asia-northeast3`

You will need these values:

- GCP project id
- chosen region

## 3. Local Files The User Must Fill

Create real local files from the repo templates.
Do not commit the real values.

### 3.1 Backend env

Create:

- `apps/api/.env.alpha`

Start from:

- `apps/api/.env.alpha.example`

Fill these placeholders:

- `<pages-project>`
- `<neon-user>`
- `<neon-password>`
- `<neon-endpoint>`
- `<neon-database>`
- `<cloudflare-account-id>`
- `<r2-access-key-id>`
- `<r2-secret-access-key>`

### 3.2 Frontend env

Create:

- `apps/web/.env.alpha`

Start from:

- `apps/web/.env.alpha.example`

Leave `VITE_API_BASE_URL` blank until the first Cloud Run deploy returns the service URL.
Then update it to:

- `https://<cloud-run-service>.run.app`

## 4. What We Can Do Together

After the user has prepared the accounts and filled the local env files, the repo already has these commands:

### 4.1 Run Neon migration

```powershell
pwsh -File scripts/migrate_alpha_database.ps1 -EnvFile apps/api/.env.alpha
```

### 4.2 Deploy backend to Cloud Run

```powershell
pwsh -File scripts/deploy_alpha_backend.ps1 -ProjectId <gcp-project-id> -EnvFile apps/api/.env.alpha
```

This script:

- builds the backend image with Cloud Build
- pushes to Artifact Registry
- deploys the Cloud Run service

### 4.3 Update frontend API base URL

After backend deploy, copy the Cloud Run HTTPS URL into:

- `apps/web/.env.alpha`

### 4.4 Deploy frontend to Pages

```powershell
pwsh -File scripts/deploy_alpha_frontend.ps1 -ProjectName <pages-project-name> -BranchName staging
```

This script:

- runs `npm run build:web`
- confirms the SPA `_redirects` file exists in the build output
- deploys the built app through Wrangler

## 5. What We Must Verify Before Closing The Checklist

The final checklist item is closed only after a real HTTPS staging run proves this full path:

1. open the staging web app over HTTPS
2. create a project
3. upload a guide
4. record one take
5. run analysis
6. extract melody
7. generate arrangement
8. open score workspace
9. export at least one artifact
10. create and open a share link

If any of those fail, the alpha staging checklist item stays open.

## 6. Recommended Handoff Format

When the user is ready to continue, the fastest safe handoff is:

1. confirm the following are ready:
   - Pages project name
   - Neon connection string
   - R2 bucket and credentials
   - GCP project id
2. confirm local files exist:
   - `apps/api/.env.alpha`
   - `apps/web/.env.alpha`
3. then continue with:
   - database migration
   - backend deploy
   - frontend deploy
   - real staging verification

## 7. Current Truth

- Repo scaffolding: done
- Local dry-run verification: done
- Real cloud secrets and accounts: user action required
- Real HTTPS staging verification: still open
