$ErrorActionPreference = "Stop"

function Add-PathIfExists {
  param([string]$Path)
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
    return
  }
  $parts = $env:Path -split ';' | Where-Object { $_ }
  if ($parts -notcontains $Path) {
    $env:Path = "$Path;$env:Path"
  }
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
foreach ($path in (($userPath -split ';') | Where-Object { $_ })) {
  Add-PathIfExists $path
}

function Invoke-VersionCheck {
  param(
    [string]$Name,
    [string]$Command,
    [string[]]$Arguments
  )

  $resolved = Get-Command $Command -ErrorAction SilentlyContinue
  if (-not $resolved) {
    return [pscustomobject]@{
      Tool = $Name
      Status = "missing"
      Source = ""
      Version = ""
    }
  }

  try {
    $output = & $Command @Arguments 2>&1
    $firstLine = ($output | Select-Object -First 1) -as [string]
    return [pscustomobject]@{
      Tool = $Name
      Status = "ok"
      Source = $resolved.Source
      Version = $firstLine.Trim()
    }
  } catch {
    return [pscustomobject]@{
      Tool = $Name
      Status = "error"
      Source = $resolved.Source
      Version = $_.Exception.Message
    }
  }
}

$checks = @(
  @{ Name = "git"; Command = "git"; Arguments = @("--version") },
  @{ Name = "rg"; Command = "rg"; Arguments = @("--version") },
  @{ Name = "fd"; Command = "fd"; Arguments = @("--version") },
  @{ Name = "jq"; Command = "jq"; Arguments = @("--version") },
  @{ Name = "gh"; Command = "gh"; Arguments = @("--version") },
  @{ Name = "node"; Command = "node"; Arguments = @("--version") },
  @{ Name = "npm"; Command = "npm.cmd"; Arguments = @("--version") },
  @{ Name = "npx"; Command = "npx.cmd"; Arguments = @("--version") },
  @{ Name = "uv"; Command = "uv"; Arguments = @("--version") },
  @{ Name = "python"; Command = "python"; Arguments = @("--version") },
  @{ Name = "playwright"; Command = "npx.cmd"; Arguments = @("playwright", "--version") }
)

$results = foreach ($check in $checks) {
  Invoke-VersionCheck -Name $check.Name -Command $check.Command -Arguments $check.Arguments
}

$results | Format-Table -AutoSize

Write-Host ""
Write-Host "Playwright browser cache:"
npx.cmd playwright install --list
