# Candidate review status

The first slice and its local production checks are implemented. No repository, remote branch, PR, publication or hosted deployment was created.

The package tracker retains these release boundaries:

- `pm-unit-native-cursor`: SDK 2026.11.5 validates native cursors before extension dispatch and supports host collection cursors, without a public producer-owned continuation callback. Native outer output shaping can also compact a producer refusal. Distinct package `--cursor` and `--budget` compatibility flags work without shadowing native globals. The final renderer refuses host compaction and final envelopes above 32 KiB. These fallbacks are tested; native producer parity is not certified.
- `pm-unit-providers`: directory-host behavior is tested through real SDK trackers. Arbitrary database/remote provider certification remains upstream in pm-cli #1399, #1587 and #1588. A method-shaped object alone does not establish authorization or native atomicity. Unsupported capabilities refuse before reads or writes. No in-memory reference port is advertised as a real backend.
- `pm-unit-declarations`: reviewed compatibility/disjointness declarations, general product/exponent unit parsing and weighted ratio aggregation are later Features. Addition refuses until a disjoint partition can be witnessed. The binary first-release evaluator supports exact subtraction, dimensionless scaling and same-dimension ratios.

The owner must review these boundaries before approving an initial release. Public review, reviewer evidence and arbitrary-provider certification are separate from local source correctness, coverage and packed-install evidence. The release workflow stays disabled until `PM_RELEASE_APPROVED` is exactly `true` on main.
