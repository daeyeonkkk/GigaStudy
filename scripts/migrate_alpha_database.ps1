[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EnvFile,

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

function Read-DotEnv {
    param([string]$Path)

    $variables = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        $trimmed = $line.Trim()
        if ($trimmed.StartsWith("#")) {
            continue
        }

        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -ne 2) {
            continue
        }

        $name = $parts[0].Trim()
        $value = $parts[1].Trim()

        if (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        $variables[$name] = $value
    }

    return $variables
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedEnvFile = Resolve-RepoPath -Path $EnvFile

if (-not $DryRun -and $resolvedEnvFile.EndsWith(".example")) {
    throw "Use a real alpha env file, not the example template: $resolvedEnvFile"
}

$envVariables = Read-DotEnv -Path $resolvedEnvFile
if (-not $envVariables.ContainsKey("GIGASTUDY_API_DATABASE_URL")) {
    throw "GIGASTUDY_API_DATABASE_URL must be present in $resolvedEnvFile"
}

Write-Host "Alpha database env file:" $resolvedEnvFile

if ($DryRun) {
    Write-Host "[dry-run] uv run alembic upgrade head"
    exit 0
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv is required for the alpha migration workflow."
}

$originalValues = @{}
foreach ($entry in $envVariables.GetEnumerator()) {
    $originalValues[$entry.Key] = [System.Environment]::GetEnvironmentVariable($entry.Key, "Process")
    [System.Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
}

Push-Location (Join-Path $repoRoot "apps/api")
try {
    & uv run alembic upgrade head
    if ($LASTEXITCODE -ne 0) {
        throw "Alembic migration failed."
    }
}
finally {
    Pop-Location

    foreach ($entry in $originalValues.GetEnumerator()) {
        [System.Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
    }
}
