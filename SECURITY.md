# Security

GigaStudy is a public source repository. Runtime credentials and local alpha data
must stay outside git.

Do not commit real values for:

- `GIGASTUDY_API_ADMIN_PASSWORD`
- `GIGASTUDY_API_ADMIN_PASSWORD_ALIASES`
- `GIGASTUDY_API_ADMIN_SESSION_SECRET`
- `GIGASTUDY_API_ADMIN_TOKEN`
- `GIGASTUDY_API_DATABASE_URL`
- `GIGASTUDY_API_S3_ACCESS_KEY_ID`
- `GIGASTUDY_API_S3_SECRET_ACCESS_KEY`
- `GIGASTUDY_API_DEEPSEEK_API_KEY`
- Pages, Cloud Run, R2, Postgres, or LLM provider credentials
- local studio storage, uploaded assets, logs, samples, or generated outputs

Use ignored local files such as `apps/api/.env`, `apps/api/.env.alpha`,
`apps/web/.env.alpha`, and `ops/cloud-run.alpha.env.yaml` for private runtime
configuration. Production and alpha deployments should keep secrets in Google
Secret Manager or the equivalent deployment secret store.

Before changing repository visibility, cutting a release, or retiring a local
machine, scan the current tree and git history for secrets and back up any
private local data outside the public repository.
