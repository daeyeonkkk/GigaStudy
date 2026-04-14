[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectName,

    [string]$BranchName,
    [string]$OutputDir = "apps/web/dist",
    [switch]$SkipBuild,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Resolve-RepoPath {
    param([string]$Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return (Resolve-Path -LiteralPath $Path).Path
    }

    $repoRoot = Split-Path -Parent $PSScriptRoot
    return (Join-Path $repoRoot $Path)
}

$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not $SkipBuild) {
    Push-Location $repoRoot
    try {
        & npm run build --workspace @gigastudy/web -- --mode alpha
        if ($LASTEXITCODE -ne 0) {
            throw "Web build failed."
        }
    }
    finally {
        Pop-Location
    }
}

$resolvedOutputDir = Resolve-RepoPath -Path $OutputDir
$indexPath = Join-Path $resolvedOutputDir "index.html"
$redirectsPath = Join-Path $resolvedOutputDir "_redirects"

if (-not (Test-Path -LiteralPath $indexPath)) {
    throw "Expected web build output not found: $indexPath"
}

if (-not (Test-Path -LiteralPath $redirectsPath)) {
    throw "Expected Cloudflare Pages SPA redirect file not found: $redirectsPath"
}

$wranglerArgs = @("wrangler@latest", "pages", "deploy", $resolvedOutputDir, "--project-name", $ProjectName)
if ($PSBoundParameters.ContainsKey("BranchName") -and $BranchName) {
    $wranglerArgs += @("--branch", $BranchName)
}

Write-Host "Alpha frontend output:" $resolvedOutputDir
if ($BranchName) {
    Write-Host "Alpha frontend branch alias:" $BranchName
}

if ($DryRun) {
    Write-Host "[dry-run] npx $($wranglerArgs -join ' ')"
    exit 0
}

& npx @wranglerArgs
if ($LASTEXITCODE -ne 0) {
    throw "Cloudflare Pages deploy failed."
}
