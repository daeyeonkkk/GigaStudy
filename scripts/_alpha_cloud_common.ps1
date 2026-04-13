[CmdletBinding()]
param()

if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $script:PSNativeCommandUseErrorActionPreference = $false
}

function Resolve-RepoPath {
    param([string]$Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return (Resolve-Path -LiteralPath $Path).Path
    }

    $repoRoot = Split-Path -Parent $PSScriptRoot
    return (Resolve-Path -LiteralPath (Join-Path $repoRoot $Path)).Path
}

function Read-DotEnvFile {
    param([string]$Path)

    $variables = [ordered]@{}
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

function Convert-DotEnvToCloudRunYamlFile {
    param([string]$Path)

    $variables = Read-DotEnvFile -Path $Path
    $tempPath = Join-Path ([System.IO.Path]::GetTempPath()) ("gigastudy-alpha-env-" + [System.Guid]::NewGuid().ToString("N") + ".yaml")
    $lines = foreach ($name in $variables.Keys) {
        $value = [string]$variables[$name]
        $escaped = $value.Replace("'", "''")
        "${name}: '${escaped}'"
    }

    Set-Content -LiteralPath $tempPath -Value $lines -Encoding UTF8
    return $tempPath
}

function Resolve-GcloudCommand {
    $command = Get-Command gcloud -ErrorAction SilentlyContinue
    if ($command) {
        return @{
            Mode = "command"
            Value = $command.Source
        }
    }

    $sdkRoot = Join-Path $env:LOCALAPPDATA "Google\Cloud SDK\google-cloud-sdk"
    $windowsWrapper = Join-Path $sdkRoot "bin\gcloud.cmd"
    if (Test-Path $windowsWrapper) {
        return @{
            Mode = "command"
            Value = $windowsWrapper
        }
    }

    $pythonEntry = Join-Path $sdkRoot "lib\gcloud.py"
    if (Test-Path $pythonEntry) {
        $python = Get-Command python -ErrorAction SilentlyContinue
        if (-not $python) {
            throw "Found Cloud SDK Python entrypoint but python is not available on PATH."
        }

        return @{
            Mode = "python"
            Value = $python.Source
            Script = $pythonEntry
        }
    }

    throw "gcloud CLI is required for the alpha deployment workflow."
}

function Invoke-Gcloud {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Executable,

        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Args
    )

    if ($Executable.Mode -eq "python") {
        $argumentList = @($Executable.Script) + $Args
    }
    else {
        $argumentList = $Args
    }

    $process = Start-Process -FilePath $Executable.Value -ArgumentList $argumentList -NoNewWindow -Wait -PassThru
    $global:LASTEXITCODE = $process.ExitCode
}
