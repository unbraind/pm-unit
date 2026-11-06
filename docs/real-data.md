# Real-data evaluation

The evaluator copies the Git-tracked `.agents/pm` trees from pinned public revisions into fresh non-Git directories, certifies complete SDK reads, and extracts reported numeric claims from native measurement comments. It never modifies either source tracker. Receipt timestamps are retained as reported acquisition times; actual measurement windows explicitly remain unknown. Native item hashes, source-fragment SHA-256 digests, field pointers and public commit URLs are retained in `test/fixtures/measurements.json`; source bodies are not copied into the quantity ledger.

Run `npm ci`, `npm run build`, then `npm run test:real-data` from a source checkout. This uses the pinned, sanitized public fixture and writes the ignored `real-data.local.json` report. `node test/real-data.acceptance.ts --refresh --write-receipt` explicitly regenerates the fixture and committed receipt from sibling public fleet checkouts, the NASA public fact sheet and this repository's [policy examples](policy-examples.md). It requires only the public `pm-vcs` and `pm-rl` checkouts with the pinned commits available locally, plus network access to NASA. Acquisition verifies the pinned physical-source digest and preserves the original acquisition timestamp; changed source content requires review. The shipped runtime performs no source scanning or network access.

Measured receipt from the initial 2026.11.6 candidate:

| Metric | Result |
| --- | ---: |
| Actual published numeric claims admitted | 47 |
| Exact independent conversion results reproduced | 47 / 47 |
| Native quantity records, including controls and derivations | 53 |
| Known exact derived ratios | 1 |
| Illustrative policy controls, separate from measured claims | 4 |
| Unknown derived ratios | 1 |
| Incompatible comparisons refused | 6 / 6 |
| Unsafe persisted sums refused | 2 / 2 |
| Full ten-claim packet | 12,876 bytes / 3,219 estimated tokens |
| Default 1,600-token request | Refused; measured minimum retry budget 3,219 |
| Raw selected native item text baseline | 290,636 bytes / 72,659 estimated tokens |
| Explicit SDK calls in the evaluator | 173 |
| Ledger/evaluation wall time | 12,263 ms |

The call count is explicit package and native SDK invocations, not backend I/O operations. The wall time starts after fixture loading and excludes public-corpus harvesting. Delivered packet bytes are the larger native-fitter measurement across exact JSON and TOON renderings including fit metadata. The raw baseline is the sum of complete serialized native source items used by the corpus, with bytes/4 rounded upward. It is a manual-reading context baseline, not a claim of measured human reading speed or an equal-size projection. Ten selected claims are shown from a larger selected source corpus, so the token ratio is descriptive and not a universal compression factor.

The corpus contains 24 count observations, six MiB sizes, four durations in seconds, four percentages and six token counts from 17 native source items, plus three physical measurements from the [NASA Earth Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html). Their declared exact decimals are converted through an independent BigInt integer oracle, using factors and decimal denominators calculated outside the package kernel. Each expected and actual rational is present in the local report. The physical source is pinned by its fetched SHA-256; these are reported physical measurements, not assertions of exact real-world truth.

Public fleet revisions are `pm-vcs` at `f2ab3c3412d87fbf766bc629b685a986b5400f61` and `pm-rl` at `962ac059ab8f6f8382dc93b1bc814cdc84b46fa8`. The fixture names each native item hash and full source fragment digest. This repository's [policy examples](https://github.com/unbraind/pm-unit/blob/5f0aeee30896065fd2a810497af3efcdec96e7b1/docs/policy-examples.md) are separately pinned by their immutable public commit URL and exact content SHA-256 for the parallel-duration and cached-token subset policies. The ten-second elapsed versus twenty-second summed-duration controls are explicitly illustrative; they do not increase the 47 measured-claim denominator.

Predeclared controls refuse a test-count versus MiB comparison, count versus tokens, distinct test-run populations, Earth equatorial versus polar radius, elapsed versus summed duration, and total versus cached token semantics. The two unsafe additions refuse an unwitnessed count partition and a total-plus-subset sum. The cached-subset value is unknown because the selected policy source publishes no count; the derived ratio stays null and names `tokens-cached` rather than inventing evidence.

The exact ratio reconstruction retains both published test counts and their shared source-fragment population. Source references pin declarations, not coherent multi-item snapshots or current truth. The first release does not average percentages or infer disjointness. When a complete explanation cannot fit, it returns a measured budget refusal with all denominator and dependency witnesses intact.

The complete public [receipt](real-data-receipt.json) includes every expected and actual rational, source pin and emitted-module digest. Its implementation digest identifies the tested JavaScript inventory independently of Git.

The NASA document and repository-owned policy examples are explicitly anchored in two native scratch-tracker source items before quantities reference them. Their genuine native item hashes and public item snapshots are in the receipt; document content digests remain separate. The runtime does not automatically fetch or copy these documents.

`test/corpus-privacy.test.ts` rejects non-public fleet names in the harvester, fixture and receipt; checks the policy digest against the committed document; and constrains the harvester's filesystem, Git and SDK read entry points. Negative controls cover an unapproved file read, a native read redirected from a copy to its source checkout, an unapproved archive root and new read capabilities. The release revert gate independently redirects the SDK root in a disposable copy and requires this guard to fail.
