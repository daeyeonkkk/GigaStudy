[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectId,

    [Parameter(Mandatory = $true)]
    [string]$EnvFile,

    [string]$Region = "asia-northeast3",
    [string]$Repository = "gigastudy-alpha",
    [string]$ImageName = "gigastudy-api",
    [string]$ImageTag = "latest",
    [string]$JobName = "gigastudy-api-alpha-migrate",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_alpha_cloud_common.ps1")

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedEnvFile = Resolve-RepoPath -Path $EnvFile
$buildConfigPath = Resolve-RepoPath -Path "cloudbuild.api.yaml"
$imageUrl = "$Region-docker.pkg.dev/$ProjectId/$Repository/$ImageName`:$ImageTag"
$resolvedCloudRunEnvFile = $resolvedEnvFile

if (-not $DryRun -and $resolvedEnvFile.EndsWith(".example")) {
    throw "Use a real alpha env file, not the example template: $resolvedEnvFile"
}

if (-not $DryRun) {
    $resolvedCloudRunEnvFile = Convert-DotEnvToCloudRunYamlFile -Path $resolvedEnvFile
}

$repositoryDescribeArgs = @(
    "artifacts", "repositories", "describe", $Repository,
    "--location", $Region,
    "--project", $ProjectId
)

$repositoryCreateArgs = @(
    "artifacts", "repositories", "create", $Repository,
    "--repository-format=docker",
    "--location", $Region,
    "--project", $ProjectId
)

$buildArgs = @(
    "builds", "submit", $repoRoot,
    "--config", $buildConfigPath,
    "--substitutions", "_IMAGE_URL=$imageUrl",
    "--project", $ProjectId
)

$jobDescribeArgs = @(
    "run", "jobs", "describe", $JobName,
    "--project", $ProjectId,
    "--region", $Region
)

$jobCreateArgs = @(
    "run", "jobs", "create", $JobName,
    "--image", $imageUrl,
    "--project", $ProjectId,
    "--region", $Region,
    "--tasks", "1",
    "--max-retries", "0",
    "--parallelism", "1",
    "--command", "/app/scripts/run_api_alembic_upgrade.sh",
    "--env-vars-file", $resolvedCloudRunEnvFile
)

$jobUpdateArgs = @(
    "run", "jobs", "update", $JobName,
    "--image", $imageUrl,
    "--project", $ProjectId,
    "--region", $Region,
    "--tasks", "1",
    "--max-retries", "0",
    "--parallelism", "1",
    "--command", "/app/scripts/run_api_alembic_upgrade.sh",
    "--env-vars-file", $resolvedCloudRunEnvFile
)

$jobExecuteArgs = @(
    "run", "jobs", "execute", $JobName,
    "--project", $ProjectId,
    "--region", $Region,
    "--wait"
)

Write-Host "Alpha remote migration target image:" $imageUrl
Write-Host "Alpha remote migration env file:" $resolvedEnvFile

if ($DryRun) {
    Write-Host ""
    Write-Host "[dry-run] gcloud $($repositoryDescribeArgs -join ' ')"
    Write-Host "[dry-run] gcloud $($repositoryCreateArgs -join ' ')"
    Write-Host "[dry-run] gcloud auth configure-docker $Region-docker.pkg.dev --quiet"
    Write-Host "[dry-run] gcloud $($buildArgs -join ' ')"
    Write-Host "[dry-run] gcloud $($jobDescribeArgs -join ' ')"
    Write-Host "[dry-run] gcloud $($jobCreateArgs -join ' ')"
    Write-Host "[dry-run] gcloud $($jobUpdateArgs -join ' ')"
    Write-Host "[dry-run] gcloud $($jobExecuteArgs -join ' ')"
    exit 0
}

$gcloud = Resolve-GcloudCommand

Invoke-Gcloud -Executable $gcloud @repositoryDescribeArgs 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Invoke-Gcloud -Executable $gcloud @repositoryCreateArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create Artifact Registry repository $Repository."
    }
}

Invoke-Gcloud -Executable $gcloud auth configure-docker "$Region-docker.pkg.dev" --quiet
if ($LASTEXITCODE -ne 0) {
    throw "Failed to configure Docker auth for Artifact Registry."
}

Invoke-Gcloud -Executable $gcloud @buildArgs
try {
    if ($LASTEXITCODE -ne 0) {
        throw "Cloud Build failed while preparing the remote migration image."
    }

    Invoke-Gcloud -Executable $gcloud @jobDescribeArgs 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Invoke-Gcloud -Executable $gcloud @jobCreateArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create Cloud Run job $JobName."
        }
    }
    else {
        Invoke-Gcloud -Executable $gcloud @jobUpdateArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to update Cloud Run job $JobName."
        }
    }

    Invoke-Gcloud -Executable $gcloud @jobExecuteArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Cloud Run migration job failed."
    }
}
finally {
    if (-not $DryRun -and $resolvedCloudRunEnvFile -ne $resolvedEnvFile -and (Test-Path -LiteralPath $resolvedCloudRunEnvFile)) {
        Remove-Item -LiteralPath $resolvedCloudRunEnvFile -Force -ErrorAction SilentlyContinue
    }
}
