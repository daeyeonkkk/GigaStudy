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
   - From the current Cloudflare dashboard, the recommended click path is:
     `Workers & Pages -> Create application -> Pages -> Connect to Git`
   - If the current Cloudflare UI opens a `Create a Worker` screen first and does not show a Pages tab, use the link at the bottom:
     `Looking to deploy Pages? Get started`
   - That bottom `Get started` link is the correct handoff into the Pages flow.
   - Prefer a Git-integrated Pages project because Cloudflare still allows Wrangler-based manual deployments later if automatic builds are disabled.
   - If you create a brand-new Direct Upload project, Cloudflare does not let that same project switch to Git integration later.
   - For this repo, the preferred Git build configuration is:
     - Root directory:
       leave blank so Pages builds from the repository root
     - Build command:
       `npm run build:web`
     - Build output directory:
       `apps/web/dist`
   - Alternative valid setup:
     - Root directory:
       `apps/web`
     - Build command:
       `npm run build`
     - Build output directory:
       `dist`
   - Preferred means:
     the repo-root setup matches the current workspace scripts and root lockfile best.
   - Important pitfall:
     if the Cloudflare settings page shows `Deploy command` and `Version command`, you created a `Worker Builds` project, not a `Pages` project.
   - In that case, do not keep debugging the build there.
     Delete that Worker project and create a real Pages project instead.
2. One R2 bucket
   - Recommended click path:
     `Storage & databases -> R2 -> Create bucket`
   - Recommended alpha name:
     `gigastudy-alpha`
3. One R2 S3 API token
   - Scope:
     object read and write for the alpha bucket
   - In the current R2 dashboard, use:
     `R2 Object Storage -> Account Details -> API Tokens -> Manage`
   - Then create an API token or access key pair for the bucket.
4. Your Cloudflare account id
   - On the current `Workers & Pages` screen, the Account ID is already visible near the lower right of the page.

You will need these values:

- Pages project name
- Pages production URL
- Cloudflare account id
- R2 bucket name
- R2 access key id
- R2 secret access key

Meaning of those last two values:

- `R2 access key id`
  the public identifier for the S3-compatible credential pair
- `R2 secret access key`
  the private secret paired with that access key id

The backend uses them the same way an S3 client would use AWS-style credentials.
They are not the same thing as the bucket name or the S3 endpoint URL.

Important handling rule:

- the `Secret Access Key` is only shown at token creation time
- if you did not save it then, you should create a new R2 API token instead of trying to recover it later
- for a personal alpha, a `User API token` is acceptable
- for a longer-lived shared system, an `Account API token` is the stronger default if your role allows it

Recommended minimal settings for the current personal alpha:

- token type:
  `User API token`
- permission:
  `Object Read & Write`
- bucket scope:
  `Apply to specific buckets only`
- selected bucket:
  `gigastudy-alpha`
- TTL:
  `Forever`
- IP filtering:
  leave blank unless you deliberately want to pin one IP

### 2.2 Neon

Prepare these:

1. One Neon project
2. One database
3. One role with password
4. One connection string

Recommended click path in the current Neon console:

1. create or open one project
2. open the project dashboard
3. click `Connect`
4. in the connection modal, choose:
   - branch:
     the default branch
   - database:
     the main alpha database
   - role:
     a role with password
5. turn `Connection pooling` off if you want the direct URL
6. copy the generated connection string

If the dashboard already shows a `Connection string` card, that is also a valid entry point.

Recommended alpha choice:

- prefer a fresh Neon project for GigaStudy alpha instead of reusing an unrelated older project
- start with the direct Postgres connection string first
- if Neon also shows a pooled connection string, keep that as a later fallback only if Cloud Run connection pressure appears
- if the region list includes Singapore, prefer that for a Korea-based alpha because it is the closest currently documented Neon AWS region in Asia
- keep Neon Auth disabled for this alpha path

Current UI note:

- Neon may display the raw URL as `postgresql://...`
- that is normal
- for this repo, convert it manually to the SQLAlchemy + psycopg form by replacing the prefix with:
  `postgresql+psycopg://...`
- if the hostname includes `-pooler`, you are looking at the pooled connection string
- if the `Connection pooling` toggle is off and the hostname does not include `-pooler`, you are looking at the direct connection string

Security rule:

- if a full connection string or database password is pasted into chat, logs, screenshots, or any other shared surface, rotate it immediately and do not reuse it as the alpha credential

Why this is the current recommendation:

- the alpha deployment is still small
- migrations and debugging are simpler when the first connection path is the plain direct URL
- if concurrency pressure appears later, we can switch the runtime env to the pooled URL

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

Ready-to-paste backend template:

```env
GIGASTUDY_API_ENV=production
GIGASTUDY_API_APP_NAME=GigaStudy API
GIGASTUDY_API_CORS_ORIGINS=https://gigastudy-alpha.pages.dev
GIGASTUDY_API_PUBLIC_APP_URL=https://gigastudy-alpha.pages.dev
GIGASTUDY_API_DATABASE_URL=postgresql+psycopg://<neon-user>:<neon-password>@<neon-endpoint>/<neon-database>?sslmode=require
GIGASTUDY_API_DATABASE_ECHO=false
GIGASTUDY_API_DEFAULT_USER_NICKNAME=alpha-dev
GIGASTUDY_API_STORAGE_BACKEND=s3
GIGASTUDY_API_STORAGE_ROOT=./storage
GIGASTUDY_API_S3_BUCKET=gigastudy-alpha
GIGASTUDY_API_S3_REGION=auto
GIGASTUDY_API_S3_ENDPOINT_URL=https://25b918bfa109d96c3c29be00ad0b34cc.r2.cloudflarestorage.com
GIGASTUDY_API_S3_ACCESS_KEY_ID=<r2-access-key-id>
GIGASTUDY_API_S3_SECRET_ACCESS_KEY=<r2-secret-access-key>
GIGASTUDY_API_S3_SESSION_TOKEN=
GIGASTUDY_API_S3_ADDRESSING_STYLE=path
GIGASTUDY_API_BASIC_PITCH_NODE_BINARY=node
GIGASTUDY_API_BASIC_PITCH_TIMEOUT_SECONDS=90
```

### 3.2 Frontend env

Create:

- `apps/web/.env.alpha`

Start from:

- `apps/web/.env.alpha.example`

Leave `VITE_API_BASE_URL` blank until the first Cloud Run deploy returns the service URL.
Then update it to:

- `https://<cloud-run-service>.run.app`

Ready-to-paste frontend template before backend deploy:

```env
VITE_API_BASE_URL=
```

Ready-to-paste frontend template after backend deploy:

```env
VITE_API_BASE_URL=https://<cloud-run-service>.run.app
```

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

If the Git-integrated Pages build fails before install or build starts and mentions `root directory not found`,
go back to the Pages project build settings and reset them to the preferred repo-root values above.

If the project settings page shows Worker-only fields like `Deploy command: npx wrangler deploy` or `Version command: npx wrangler versions upload`,
stop there and recreate the project as Pages before continuing.

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

## 6A. Fastest Next Order During Setup

If the operator already created the R2 bucket and S3 API credentials, the fastest next order is:

1. finish the Cloudflare Pages build setup first
   - fix build settings
   - retry the build
   - confirm the Pages URL exists
2. record the Cloudflare values locally
   - account id
   - Pages project name
   - Pages URL
   - R2 bucket name
   - R2 access key id
   - R2 secret access key
3. create the Neon database and copy the final connection string
4. create the GCP project and enable Cloud Run, Cloud Build, and Artifact Registry
5. only then fill:
   - `apps/api/.env.alpha`
   - `apps/web/.env.alpha`

This order is preferred because:

- it closes the current Pages blocker while the operator is already in Cloudflare
- it avoids filling local env files with partial placeholders too early
- it reduces the chance of mixing the wrong Pages URL or Cloudflare account id into the backend env

## 7. Current Truth

- Repo scaffolding: done
- Local dry-run verification: done
- Real cloud secrets and accounts: user action required
- Real HTTPS staging verification: still open
