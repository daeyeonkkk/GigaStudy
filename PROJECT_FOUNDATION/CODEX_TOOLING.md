# Codex Tooling

Date: 2026-05-02

This workspace is tuned for fast Codex-assisted rebuild work on GigaStudy.

## Installed CLI Tools

Installed with `winget` into the current user profile:

- `rg` / ripgrep: fast code and text search.
- `fd`: fast file discovery.
- `jq`: JSON inspection and filtering.
- `gh`: GitHub CLI for PR, issue, and CI workflows.

PowerShell user execution policy is set to `RemoteSigned` so the local profile
can load. The profile adds the user PATH entries created by winget to app
launched PowerShell sessions and routes `npm`/`npx` to their `.cmd` launchers.
That avoids the common Windows execution-policy failure for `npm.ps1`.

## Available Codex Capabilities

- Local shell with Git, Node, npm, uv, Python, rg, fd, jq, gh.
- Node REPL MCP for quick JavaScript experiments.
- Playwright MCP and project Playwright for browser/E2E validation.
- Browser Use plugin for local browser inspection.
- GitHub plugin for repository, PR, and CI workflows.
- Figma and Canva connectors are discoverable for design work.

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
powershell -ExecutionPolicy Bypass -File scripts/codex-doctor.ps1
```

## Playwright Browser Cache

The project Playwright dependency is `@playwright/test` from the root
workspace. Browsers installed for version `1.59.1`:

- Chromium
- Firefox
- WebKit
- FFmpeg
- Winldd

This lets `npm.cmd run test:e2e` run the configured cross-browser projects.
