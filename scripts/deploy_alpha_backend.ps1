[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectId,

    [Parameter(Mandatory = $true)]
    [string]$EnvFile,

    [string]$Region = "asia-northeast3",
    [string]$ServiceName = "gigastudy-api-alpha",
    [string]$Repository = "gigastudy-alpha",
    [string]$ImageName = "gigastudy-api",
    [string]$ImageTag = "latest",
    [string]$Memory = "1Gi",
    [string]$Cpu = "1",
    [int]$MaxInstances = 1,
    [int]$MinInstances = 0,
    [int]$Concurrency = 1,
    [string]$Timeout = "300s",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Resolve-RepoPath {
    param([string]$Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return (Resolve-Path -LiteralPath $Path).Path
    }

    $repoRoot = Split-Path -Parent $PSScriptRoot
    return (Resolve-Path -LiteralPath (Join-Path $repoRoot $Path)).Path
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedEnvFile = Resolve-RepoPath -Path $EnvFile
$imageUrl = "$Region-docker.pkg.dev/$ProjectId/$Repository/$ImageName`:$ImageTag"

if (-not $DryRun -and $resolvedEnvFile.EndsWith(".example")) {
    throw "Use a real alpha env file, not the example template: $resolvedEnvFile"
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
    "--tag", $imageUrl,
    "--project", $ProjectId
)

$deployArgs = @(
    "run", "deploy", $ServiceName,
    "--image", $imageUrl,
    "--project", $ProjectId,
    "--region", $Region,
    "--allow-unauthenticated",
    "--port", "8080",
    "--cpu", $Cpu,
    "--memory", $Memory,
    "--min-instances", $MinInstances,
    "--max-instances", $MaxInstances,
    "--concurrency", $Concurrency,
    "--timeout", $Timeout,
    "--env-vars-file", $resolvedEnvFile
)

Write-Host "Alpha backend target image:" $imageUrl
Write-Host "Alpha backend env file:" $resolvedEnvFile

if ($DryRun) {
    Write-Host ""
    Write-Host "[dry-run] gcloud $($repositoryDescribeArgs -join ' ')"
    Write-Host "[dry-run] gcloud $($repositoryCreateArgs -join ' ')"
    Write-Host "[dry-run] gcloud auth configure-docker $Region-docker.pkg.dev --quiet"
    Write-Host "[dry-run] gcloud $($buildArgs -join ' ')"
    Write-Host "[dry-run] gcloud $($deployArgs -join ' ')"
    exit 0
}

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw "gcloud CLI is required for the alpha backend deploy workflow."
}

& gcloud @repositoryDescribeArgs 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    & gcloud @repositoryCreateArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create Artifact Registry repository $Repository."
    }
}

& gcloud auth configure-docker "$Region-docker.pkg.dev" --quiet
if ($LASTEXITCODE -ne 0) {
    throw "Failed to configure Docker auth for Artifact Registry."
}

& gcloud @buildArgs
if ($LASTEXITCODE -ne 0) {
    throw "Cloud Build failed."
}

& gcloud @deployArgs
if ($LASTEXITCODE -ne 0) {
    throw "Cloud Run deploy failed."
}
