# Codex Tooling

Date: 2026-05-04

GigaStudy uses the machine-level Codex toolkit under `%USERPROFILE%\.codex`.
The baseline is intentionally global, so new repositories get the same shell,
search, GitHub, and browser-validation capabilities without copying scripts
into each project.

## Global Toolkit

Primary commands:

```powershell
codex-doctor
codex-map
```

- `codex-doctor`: checks PATH wiring, PowerShell policy, GitHub auth, core CLI
  tools, runtimes, and Playwright browser cache.
- `codex-map`: maps the current repository root, Git state, stack markers,
  top-level layout, and a source-file sample.

Global documentation lives at:

```powershell
%USERPROFILE%\.codex\CODEX_TOOLING.md
```

The local `codex-portable-bootstrap/` folder is an ignored transfer bundle for
restoring that global environment on another Windows machine. It should be used
as an import artifact, not as project source.

## Installed CLI Baseline

Installed into the current user profile:

- `rg` / ripgrep: fast code and text search.
- `fd`: fast file discovery.
- `jq`: JSON inspection and filtering.
- `yq`: YAML/TOML/XML/JSON inspection and transforms.
- `bat`: readable file previews.
- `delta`: readable Git diffs.
- `fzf`: fuzzy terminal selection.
- `gh`: GitHub CLI for PR, issue, and CI workflows.
- `ffmpeg` / `ffprobe`: audio and video inspection/conversion.
- Poppler tools such as `pdfinfo`, `pdftoppm`, and `pdftotext`: PDF inspection/rendering.
- `magick`: image conversion and lightweight preprocessing.
- `shellcheck`: shell script linting.
- `hadolint`: Dockerfile linting.
- `hyperfine`: command/runtime benchmarking.
- `just`: optional project command facade.
- `wrangler`: Cloudflare Pages/R2/Workers workflows.

The PowerShell user profile adds user PATH entries and `%USERPROFILE%\.codex\bin`
to app-launched PowerShell sessions. It also routes `npm` and `npx` to their
`.cmd` launchers, avoiding the common Windows execution-policy failure for
`npm.ps1` and `npx.ps1`.

## Available Codex Capabilities

- Local shell with Git, Node, npm, uv, Python, rg, fd, jq, yq, bat, delta, fzf,
  gh, ffmpeg, Poppler, ImageMagick, ShellCheck, hadolint, hyperfine, just,
  wrangler, and Playwright.
- Node REPL MCP for quick JavaScript experiments.
- Playwright MCP and project Playwright for browser/E2E validation.
- Browser Use plugin for local browser inspection.
- GitHub plugin for repository, PR, and CI workflows.
- Figma and Canva connectors are discoverable for design work.
- `cproj`, `cgs`, `repos`, and `gstat` are available from new PowerShell
  sessions for workspace navigation and multi-repo Git status checks.

## Project Verification Stack

Primary commands:

```powershell
python -m compileall apps/api/src/gigastudy_api
cd apps/api
uv run pytest
cd ../..
npm.cmd run lint:web
npm.cmd run build:web
npm.cmd run test:e2e
```

Tooling health check:

```powershell
codex-doctor
```

## Playwright Browser Cache

The project Playwright dependency is `@playwright/test` from the root workspace.
The same browser cache is also reachable through the global `playwright` CLI.
Browsers installed for version `1.59.1`:

- Chromium
- Firefox
- WebKit
- FFmpeg
- Winldd

This lets `npm.cmd run test:e2e` run the configured cross-browser projects.
