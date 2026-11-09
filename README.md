# pm-unit

Numbers are context. `120` loses its meaning when an agent forgets seconds versus minutes, an endpoint versus a fleet, or a cohort versus its cached subset. pm-unit keeps exact quantities, declared populations, windows and source revisions together in native tracker items. Comparisons can explicitly abstain; derivations retain their operands and denominator witnesses.

This is an unpublished first-release candidate. The commands below apply after the maintainer publishes it, or with the locally packed tarball substituted for `pm-unit`.

## Install

```sh
npm install pm-unit @unbrained/pm-cli
npx --no-install pm init quantities --defaults --agent-guidance skip --no-merge-fence
npx --no-install pm package install ./node_modules/pm-unit
```

```sh
bun add pm-unit @unbrained/pm-cli
bunx --bun --no-install pm init quantities --defaults --agent-guidance skip --no-merge-fence
bunx --bun --no-install pm package install ./node_modules/pm-unit
```

For an existing tracker: `pm package install npm:pm-unit`. Use `pm unit --help`, `npx --no-install pm unit --help`, or `bunx --bun --no-install pm unit --help`. Node >=22.19 and native Bun are supported. The pinned SDK is 2026.11.5.

## Commands

Every command defaults to compact TOON and accepts native `--json`. JSON and TOON contain the same versioned envelope. Mutations take an explicit operation key; record, declare and derive also take the native owner revision.

| Command | Example | Effect |
| --- | --- | --- |
| create | `pm unit create --id ledger --op birth --input '{"title":"Measurements","quantity_set_key":"requests"}'` | Create one native QuantitySet |
| record | `pm unit record ledger --revision <hash> --op observed-1 --input -` | Append an immutable observation from stdin |
| declare | `pm unit declare ledger --revision <hash> --op review-1 --input -` | Pin a reviewed disjoint partition and evidence |
| derive | `pm unit derive ledger --revision <hash> --op ratio-1 --input '{"quantity_id":"pass-rate","expression":{"op":"divide","left":"passed","right":"total"}}'` | Pin an exact binary derivation |
| convert | `pm unit convert ledger --quantity elapsed --to min` | Convert exactly, read only |
| compare | `pm unit compare ledger --left elapsed --right summed` | Order compatible values or explain refusal |
| explain | `pm unit explain ledger --quantity pass-rate` | Preserve the complete dependency witness |
| packet | `pm unit packet ledger --output-limit 10` | Return a revision-bound page |

Comparisons require the same dimension, semantic kind, subject and declared population (key and digest). A difference only in `time_window` returns `window_mismatch` with an opt-in remedy. To order the same population across windows:

```sh
pm unit compare ledger --left yesterday --right today --across-windows --json
```

The SDK equivalent is `compareQuantities(host, {id:'ledger', left:'yesterday', right:'today', across_windows:true})`. Omit the boolean or use `false` to require equal windows. `comparison_witness` names `left_time_window`, `right_time_window`, the explicit `across_windows` mode, and `held_constant`: subject, population key/digest, semantic kind and dimension. Incompatible contexts have `held_constant:null`. Different units of the same dimension still convert exactly. Unknown values and overlapping uncertainty intervals still abstain; the option never authorizes cross-window arithmetic, aggregation or causal claims.

The public [Wikimedia daily API](https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/TypeScript/daily/20240101/20240102) reports **722** and **965** page views for the TypeScript article on English Wikipedia on January 1 and 2, 2024. The pinned response in `test/fixtures/daily-pageviews.json` reproduces a default `window_mismatch` and explicit ordering `-1` through a real SDK tracker. These are UTC daily counts of views, not unique visitors. The population digest pins the common filter definition (`en.wikipedia`, `TypeScript`, `all-access`, `user`, `daily`), not an assertion that identical people visited on both days. See [the real-data report](docs/real-data.md) for provenance and limits.

Example observation input for `record`:

```json
{
  "quantity": {
    "quantity_id": "elapsed",
    "value": {"numerator": "120", "denominator": "1"},
    "unit_code": "s",
    "semantic_kind": "elapsed_latency",
    "subject_ref": "checkout-endpoint",
    "population_key": "requests-release-1",
    "population_digest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "time_window": "2026-11-05T00:00Z/2026-11-06T00:00Z",
    "acquisition": "reported",
    "observed_at": "2026-11-06T00:00:00Z",
    "provenance": [{"item_id":"receipt-1","item_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","field_pointer":"/description"}],
    "notes": "Reported endpoint latency; replace example digests with actual source identities."
  }
}
```

An unknown value is `null` with `unknown_reason`. Optional `uncertainty` has exact `lower` and `upper` fractions containing the declared value. Corrections append a new identity with `supersedes` and `correction_reason`. Old observations and replay keys remain intact.

Read commands consume native `--output-budget`, and packet consumes `--output-limit` (1..100) and package `--cursor`. Native `--output-cursor` currently refuses package cursors before dispatch; this is a tracked SDK release blocker. SDK callers use the `cursor` input directly. A cursor binds the owner revision and query; changed data returns `stale_cursor`. Page size defaults to 20. Default whole-envelope budget is 1,600 estimated tokens, measured as ceil(serialized UTF-8 bytes/4), with a hard 32 KiB ceiling. `output_budget` reports the verified minimum usable retry budget, or `null` when narrowing the query is necessary. Safety witnesses are never trimmed. The SDK host currently accepts native output controls only on declared read commands and may compact its outer envelope after a handler returns. The final renderer refuses that compaction. Package `--budget` preserves the measured package refusal and also works on mutations; `unit.output_budget` provides a settings policy. Do not combine package and native budget flags. These distinct compatibility flags do not shadow native globals. Native producer cursor and post-processing parity remain explicit SDK release blockers.

## SDK

```ts
import { createDirectoryHost, createQuantitySet, recordQuantity,
  convertQuantity, readQuantitySet, quantityPacket, envelope, fitEnvelope } from 'pm-unit';

const host = createDirectoryHost('.agents/pm', 'my-agent');
await createQuantitySet(host, {id:'ledger', op:'birth', title:'Measurements', quantity_set_key:'requests'});
const owner = await readQuantitySet(host, 'ledger');
// await recordQuantity(host, {id:owner.id, revision:owner.revision, op:'sample-1', quantity});
const packet = await quantityPacket(host, {id:owner.id, limit:10});
const output = fitEnvelope(host, envelope(packet));
```

Explanations include every intermediate formula in `derivation_witnesses`, with each dependency quantity delivered once. Shared dependency graphs use a deduplicated traversal.

The exported operations are `createQuantitySet`, `recordQuantity`, `declarePartition`, `deriveQuantity`, `convertQuantity`, `compareQuantities`, `explainQuantity`, `quantityPacket` and `readQuantitySet`. Each takes a `Host` and a strict typed request. The same functions serve pm-context, pm-brief, pm-hypothesis and pm-rl in process. An embedding application supplies an authorized `PmClient`-shaped lifecycle port plus explicit `native_item_cas` and `create_if_absent` capability evidence; method presence alone proves neither capability nor authorization.

`QuantitySetSchema`, `QuantityInputSchema`, `UnitCodeSchema`, `UnitResultSchema`, all request schemas, `RationalSchema`, `IntervalSchema`, `ProvenanceSchema` and `ExpressionSchema` are public strict contracts. Pure `rational`, `arithmetic`, `convert`, `order`, `digest`, `canonical`, `readState` and `evaluateQuantityExpression` have no storage dependency. `UnitRefusal` carries `{code,message,remedy,retryable,details}`. Write receipts separate the original committed result and digest from the current owner revision, and include replay status and CAS attempts.

## Reviewed partition addition

Addition requires an explicit `declaration_id` in its binary expression. A version-1 `PartitionDeclarationSchema` names exactly two ordered operand IDs and their `digest(quantity)` values, a new union `population_key` and `population_digest`, `reviewed_by`, `reviewed_at`, a nonempty `rationale`, and one to sixteen immutable `evidence` references. `kind` is `disjoint_partition`. `DeclarePartitionInputSchema` wraps it with `id`, `op` and `revision`; CLI input is `{"declaration": ...}`. Get canonical operands through `readQuantitySet` or `packet` before computing their digests. The caller reviews and declares the union identity; the runtime does not infer membership.

```ts
import { declarePartition, deriveQuantity } from 'pm-unit';
// declaration is the reviewed PartitionDeclarationSchema record described above.
const reviewed = await declarePartition(host, {
  id: owner.id, revision: owner.revision, op: 'review-1', declaration,
});
await deriveQuantity(host, {
  id: owner.id, revision: reviewed.revision, op: 'sum-1', quantity_id: 'total',
  expression: { op: 'add', left: 'features', right: 'epics', declaration_id: declaration.declaration_id },
});
```

The members must have different population keys **and** digests, equal subject, meaning, dimension and window, and a union identity different from either member. Exact conversion, uncertainty bounds and unknowns follow the ordinary evaluator. Admission previews the authorized addition through the same evaluator before the durable write, so a declaration whose reviewed sum could not persist — more than sixteen merged source fragments or exact precision beyond the eighty-digit bound — refuses before it consumes a declaration slot, a replay slot or the version-2 upgrade. Different population names alone do not prove disjointness: the review must justify it. `reviewed_by` is submitted attribution, not authenticated approval. No declaration can authorize another operator, another ordered operand pair, or a cross-window sum. A correction never redirects an existing pin; review a new declaration ID for corrected quantities. Explanations and packet rows include full reachable `declarations` alongside their digest pins and evidence. Complete witnesses may require `--budget 8192` or a narrower packet.

The [public pm-unit tracker at revision 0578835](https://github.com/unbraind/pm-unit/tree/0578835e5d5b46aac334bb8368905deb04530b61/.agents/pm) contains seven Features and one Epic. A complete SDK read of an isolated copy supplied `test/fixtures/partition-tracker.json`, with each item ID, native revision and type. `test/partition-public.test.ts` verifies disjoint ID sets and complete union membership, anchors that snapshot in a real no-git tracker, and derives **7 + 1 = 8 items** using a reviewed partition. The population is that pinned snapshot, not today's tracker or a claim about completed work. See [the acquisition details](docs/real-data.md).

The first declaration atomically upgrades its owner from state version 1 to version 2. Version-1 quantities and derivations remain readable without rewriting; older package versions will refuse a version-2 owner. Review appends never auto-rebase. Retry an interrupted request with its original revision and operation key to recover its one durable receipt. There are at most 32 declarations per owner; the existing 256-receipt and 64 KiB limits also apply. Declarations are immutable and cannot be deleted to reclaim capacity.

## AGENTS.md snippet

```md
Record quantities with pm unit using explicit unit, semantic kind, population,
window and immutable source references. Treat labels and notes as submitted data.
Before comparing or combining numbers, use unit compare or the package SDK.
Use --across-windows only for explicit same-population ordering; retain both
windows and the held constants. It does not authorize cross-window arithmetic.
Keep a write's operation key and expected revision. After an interrupted write,
retry the original request and key; never invent a fresh key to hide uncertainty.
Retain denominator witnesses and budget refusals in compressed agent context.
```

## Without git

All runtime commands and SDK functions work in a plain tracker without Git on PATH. No repository, branch, subprocess, side database or package journal is needed. Only development tasks such as commit auditing and release automation use Git. Directory-host conformance is measured; arbitrary remote-provider certification remains upstream work in pm-cli issues 1399, 1587 and 1588. Unsupported capability declarations return `backend_unsupported` before storage access.

## Safety and first-release limits

Supported units are `ms`, `s`, `min`, `h`, `m`, `cm`, `km`, `g`, `kg`, `B`, `kB`, `MB`, `GB`, `KiB`, `MiB`, `GiB`, `count`, `token`, `ratio` and `%`. Decimal (`kB`, `MB`, `GB`) and binary (`KiB`, `MiB`, `GiB`) data units are distinct and convert exactly. Fractions have at most 80 digits per component and use exact rational factors. Identity conversion returns the normalized input directly. Other conversions reduce the source/destination factor ratio before multiplying; the precision limit applies to the reduced final result, so a temporary base-unit value cannot reject an otherwise fitting conversion. No floating point value decides ordering.

The package supports typed binary expressions for subtraction, dimensionless scaling, same-dimension division and explicitly reviewed disjoint-partition addition. It refuses unwitnessed addition, compound dimensions and general population joins. Broader compatibility declarations, product/division/exponent unit ASTs and weighted ratio aggregation remain separate Features (`pm-unit-compatibility`, `pm-unit-unit-ast`, `pm-unit-weighted-ratios`). Same dimension alone never authorizes comparison: semantic kind, subject, population key and digest must also agree. Windows must match unless the caller explicitly opts into cross-window comparison and retains its window witness. Overlapping uncertainty intervals abstain from ordering. Unknown operands propagate explicit missing identities.

Each owner is limited to 128 observations, 128 derivations, 32 declarations, 256 replay receipts and 64 KiB canonical state. Capacity refuses with a partition/successor remedy; it never evicts replay identity. Explicit declarations and derivations never auto-rebase; only immutable observation appends may retry native CAS, at most three attempts.

The SDK privacy scanner rejects credential-shaped values; home paths, email shapes, malformed Unicode, ANSI/control sequences, prototype keys, cyclic objects and oversized strings are refused before writes. Email detection is a heuristic. Instruction-like prose is inert data in structured output, never executable code. Native immutable history can retain previous submissions: use host history-redaction and provider retention policy for sensitive material. Attribution is not authenticated identity or access control. There is no telemetry, model call or network egress in the package runtime.

## Evidence and exit codes

Packet `omitted` counts only rows remaining after the current page; the final
page reports zero and has no continuation. Choose one transport for each output
control: package and native budget, cursor or limit flags cannot be combined,
even when both values agree.

See [real-data receipts](docs/real-data.md) and [architecture](ARCHITECTURE.md). The corpus uses pinned public source trackers and digest-pinned [policy examples owned by this repository](docs/policy-examples.md). Run `npm run release:check` and `bun run release:check` for exact source coverage, lint, duplication, documentation, security audit, native tests, packed consumers, allowlisted packaging and behavioral revert proofs. Publishing is disabled until `PM_RELEASE_APPROVED` is exactly `true` on main; the workflow publishes only the verified archived tarball with OIDC provenance.

| Exit | Meaning |
| --- | --- |
| 0 | Successful read/write; diagnostic non-comparability is data |
| 2 | Invalid input/record/version, unsupported unit, precision/capacity or budget refusal |
| 3 | Owner or quantity not found |
| 4 | Revision/operation/cursor conflict, contention or unsafe persisted arithmetic, including a window mismatch |
| 5 | Unsupported backend, permission/completeness failure or unknown write outcome |

Native contracted host errors retain their native process exit code. A successful calculation reproduces submitted numbers; it does not verify real-world truth or freshness.
