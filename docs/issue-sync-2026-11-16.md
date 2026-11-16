# Scheduled GitHub issue sync diagnosis, 2026-11-16

[Failed workflow run](https://github.com/unbraind/pm-unit/actions/runs/43707381451).

Observed failure:

```text
node -e 'if (require("./" + process.argv[2] + "/extensions/pm-github/package.json").version !== process.argv[1]) process.exit(1)' "${PM_GITHUB_VERSION}" "${PM_SYNC_TRACKER}"
PM_GITHUB_VERSION: 2026.11.02
installed version: 2026.11.2
Process completed with exit code 1.
```

The job exits during package setup, before import. PM_GITHUB_VERSION is 2026.11.02, but npm installs version 2026.11.2. A literal string comparison calls process.exit(1) and emits no explanatory error. The log records a successful package install and then exit 1.

Main already contains [PR #20](https://github.com/unbraind/pm-unit/pull/20), which pins both callers to pm-github 2026.11.15. The reusable workflow normalizes numeric release components and reports version mismatch explicitly. No new caller patch or workflow dispatch is needed.

## Import gate evidence

1 planned, 0 skipped, 0 matched by provenance, 0 adopted, 1 new.

For non-blocked importers the read-only command is:

```sh
pm github import unbraind/pm-unit --state all --atomic --gate --dry-run --with-comments --json
```

Command output (exit 0):

```text
pm github gate: plan verified — 1 planned, 0 skipped, 0 matched by provenance, 0 adopted, 1 new.
[dry-run] Atomic plan would import 1, update 0, skip 0. Adopt 0.
```

A passing plan proves completeness and identity planning, not successful writes or a new scheduled CI run. Shared reference tags remain references; new mirror items in a plan are not applied by this investigation.

## Validation

Typecheck and lint pass. The pinned tracker validation returns `ok: true` with existing advisories. The seeded tracker validation and gated import preview also pass through `pm test --run --progress`. Package quick tests are still running at the initial draft; no full passing package suite is claimed. Remaining results are recorded in the linked sync repair item. CI is not dispatched manually, and no successful scheduled rerun is claimed.
