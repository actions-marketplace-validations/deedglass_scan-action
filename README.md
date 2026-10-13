# Deedglass scan

Grades the agent setup in your repository on every pull request: the **agent blast radius**, A to
F, with its deductions. It runs `deedglass scan` on the runner, read-only. Nothing is sent to
Deedglass; results go only to GitHub, and it only ever comments on pull requests in the repository that installed it.

A means a small blast radius, not a safe agent. What the grade measures: https://deedglass.com/score

## Use it

Copy both workflows from [`examples/`](examples/) into `.github/workflows/`:

- `deedglass-scan.yml` runs on `pull_request` with `contents: read`. It scans the head and the base,
  writes the job summary, uploads SARIF where the token allows, and uploads `result.json` (3 days).
- `deedglass-comment.yml` runs on `workflow_run` after it. It downloads `result.json`, validates it
  strictly, works out the pull request from the event itself, checks the changed files through the
  API, and posts **one** comment, edited on each push. It never checks out pull request code.

Comments appear only when the pull request changes agent config: `.mcp.json`, `.cursor/mcp.json`,
`.vscode/mcp.json`, `**/claude_desktop_config.json`, `**/mcp_config.json`, `package.json`,
`pyproject.toml`, `requirements*.txt`, `deedglass.yaml` or `policies/**`.

## Inputs and outputs

| Input | Default | Meaning |
|---|---|---|
| `version` | the version this action pins | the deedglass release to run; its sha256 must be in `checksums/` |
| `licence` | `''` | a Pro licence, only for comments on private repositories (pass a secret) |
| `fail-under` | `''` | fail when the grade is below this (A to D) |
| `sarif` | `auto` | `auto`, `always` or `never` |
| `dir` | `.` | the directory to scan |

Outputs: `grade`, `points`, `base-grade`, `touched`.

## Permissions

| Workflow | Trigger | Permissions | Secrets | Checks out PR code |
|---|---|---|---|---|
| scan | `pull_request` | `contents: read` (fork PRs get a read-only token) | none (the licence only on private repos) | yes, with `persist-credentials: false` |
| comment | `workflow_run` | `pull-requests: write`, `actions: read` | none | never |

## Forks

A fork's pull request runs the scan with a read-only token and no secrets. Its result reaches the
comment job only as data: at most 256 KiB, closed keys, typed fields, ids by pattern, strings
escaped, paths outside `[A-Za-z0-9._/@ -]` shown as `…`, links only to deedglass.com/score and
the run. The pull request number and the changed files come from GitHub, not from the artifact.

## Private repositories

The scan and the job summary are free everywhere. Comments on private repositories need a Pro
licence with `action_private` (checked by the CLI's own licence code). Known, accepted risk: a
forged `entitled: true` in the artifact gets a private repository one free comment.

## What it never does

- `pull_request_target`, or any write from the scan job.
- A comment, issue, pull request or badge in any repository other than this one.
- Telemetry, or uploading scan data anywhere.
- Running a deedglass binary whose sha256 isn't committed in this repository.

Windows runners are refused: "Deedglass scan runs on Linux and macOS runners."

## Releasing (maintainers)

1. Copy the release's `checksums.txt` lines into `checksums/<version>.txt` and set the `version`
   default in `action.yml`.
2. `npm test`, `actionlint`, `zizmor .` (one documented suppression, in `examples/`).
3. Tag `v1.x.y`, move `v1`. Publishing to the Marketplace is the founder's.

Apache-2.0.
