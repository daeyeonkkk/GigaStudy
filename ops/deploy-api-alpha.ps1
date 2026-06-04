param(
  [string]$ProjectId = "gigastudy-alpha-493208",
  [string]$Region = "asia-northeast3",
  [string]$ServiceName = "gigastudy-api-alpha",
  [string]$ArtifactRepository = "gigastudy-alpha",
  [string]$ImageName = "gigastudy-api",
  [string]$EnvFile = "ops/cloud-run.alpha.env.yaml"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $EnvFile)) {
  throw "Missing $EnvFile. Copy ops/cloud-run.alpha.env.example.yaml to $EnvFile and fill non-secret alpha values."
}

$image = "$Region-docker.pkg.dev/$ProjectId/$ArtifactRepository/$ImageName`:latest"

gcloud builds submit . `
  --config cloudbuild.api.yaml `
  --substitutions "_IMAGE=$image"

gcloud run deploy $ServiceName `
  --image $image `
  --region $Region `
  --platform managed `
  --min-instances 0 `
  --max-instances 1 `
  --concurrency 4 `
  --env-vars-file $EnvFile `
  --set-secrets "GIGASTUDY_API_ADMIN_PASSWORD=gigastudy-api-admin-password:latest,GIGASTUDY_API_ADMIN_SESSION_SECRET=gigastudy-api-admin-session-secret:latest,GIGASTUDY_API_S3_ACCESS_KEY_ID=gigastudy-api-s3-access-key-id:latest,GIGASTUDY_API_S3_SECRET_ACCESS_KEY=gigastudy-api-s3-secret-access-key:latest,GIGASTUDY_API_DEEPSEEK_API_KEY=gigastudy-api-deepseek-api-key:latest" `
  --allow-unauthenticated
