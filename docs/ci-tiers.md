# Fleet CI v2

Required checks remain `test (22)`, `test (26)` and `codeql`. The PR tier runs
on pull requests and dispatch, on Ubuntu hosted runners, with superseded PR
cancellation and 15-minute job limits. Dispatch always selects the code tier.
Executable JavaScript/TypeScript/shell in the tracker or docs, and all tracker
extensions, select the code tier too.

| Check | Code PR Node 22 | Code PR Node 26 | Docs/tracker PR, both | Deep Node 22/26 × npm/Bun |
| --- | --- | --- | --- | --- |
| npm ci | yes | yes | yes | yes |
| Authoritative tracker health | — | release gate | install clone merge drivers; strict CLI | npm + Bun gates |
| Commit identity and tracked private-path policy | — | release gate | yes | npm + Bun gates |
| Privacy and public-corpus suites | quick tests | quick coverage | yes | full coverage |
| Build and test compilation | yes | release gate | build prerequisite for privacy suites | npm + Bun gates |
| Tests | quick | quick coverage | privacy suites only | full, npm + Bun |
| Typecheck, lint, duplication, docstrings | — | release gate | — | npm + Bun gates |
| Coverage: 100% statements, branches, functions, lines | — | quick | — | full, npm + Bun |
| Production audit, package dry-run | — | release gate | — | npm + Bun gates |
| Changelog consistency | — | release gate | yes | npm + Bun gates |
| Publish attestation verification | — | release gate | — | npm + Bun gates |
| Packed npm/Bun/npx/bunx and SDK acceptance | — | release gate | — | npm + Bun gates |
| Behavioral reverts and linked build proofs | — | release gate | — | npm + Bun gates |
| Bun dependency graph installation | — | smoke | — | smoke |
| CodeQL | separate required workflow | separate required workflow | required, unfiltered | main pushes and weekly |

Deep runs on main pushes, daily at 02:23 UTC, and dispatch. Release schedules
remain 05:37 UTC and minute 41 hourly. Deep jobs are `deep (22, npm)`,
`deep (22, bun)`, `deep (26, npm)` and `deep (26, bun)`. They use the local pool unless `PM_LOCAL_DEEP=off`, preserve active runs per ref, and
have a 120-minute limit. GitHub retains one pending run per group. Each matrix
job executes exactly one complete npm or Bun release gate.
Local runners keep their persistent npm cache and preinstalled Bun; hosted
runners use npm caching and Bun setup. Every deep log prints `bun --version`.

`PM_TEST_DEPTH=quick` selects the first 50 of the model's original 500 sequences.
Unset depth remains full. The seed generator and per-sequence assertions are
unchanged, as are 50-case batch boundaries; operation totals use generated cases.
The integer property sweep uses its first 25 of 201 values, with explicit
zero and positive boundary regressions in both depths. Precision digit-boundary
fixtures, capacity limits and privacy corpora remain complete. Coverage source
scope, ignores and all four 100% thresholds are unchanged.

`PM_TEST_TIME_SCALE` defaults to 1 and is 3 in deep CI. Only test-runner and subprocess harness
watchdogs scale, rounded up to integer milliseconds; invalid factors fail.
No product deadline changes. The full gate already proves Bun project installation and
bunx CLI/extension usage from the captured artifact, so the PR adds only the
Bun package-graph install smoke. Node 22 performs no standalone pack or coverage.

The latest successful main run, 43656921036, measured 32.731 seconds for the
500-sequence model and 33.504 seconds for packed acceptance. Its Node 22/26
runner executions took 2m01s/4m50s respectively. These are historical hosted
measurements; new quick timings and queue-inclusive receipts are recorded in
the PR and package tracker. Full depth is deferred to deep CI after merge.
CodeQL remains unfiltered because it is required; its Monday 01:47 UTC schedule
and PR cancellation remain, with a new 30-minute timeout.

Tracking: [pm-unit-ci-v2](https://github.com/unbraind/pm-unit/blob/main/.agents/pm/tasks/pm-unit-ci-v2.toon).
Companion: `pm-cli-website-dyhg`. Release caller, sync workflows and release
verifier scripts are unchanged.

## Final-template follow-up (2026-11-16)

Latest successful PR CI: [run 43820497226](https://github.com/unbraind/pm-unit/actions/runs/43820497226).
These are historical workflow job measurements, not a controlled benchmark of this change.

| Job | Execution (started → completed) | Wall time (created → completed) |
| --- | --- | --- |
| test (22) | 0m48s | 0m50s |
| test (26) | 4m19s | 4m21s |

Every measured job executed within the 15-minute quick-tier target. Queueing
explains any larger wall time. No test-depth adjustment or sharding is included.
CodeQL is required by branch protection, so its PR and main paths remain unfiltered.

The workflow contracts strictly parse all three tier YAML files, exercise each PR
classifier against data and executable paths, and verify one full gate per matrix
job, self-hosted setup, the runner expression and non-cancelling deep concurrency.
Full-depth execution remains post-merge deep-CI evidence.
