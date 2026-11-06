import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PmClient } from '@unbrained/pm-cli/sdk/core';
import { certifyCompleteListResult } from '@unbrained/pm-cli/sdk/runtime';
import { createDirectoryHost, createQuantitySet, recordQuantity, deriveQuantity, convertQuantity, compareQuantities, readQuantitySet, quantityPacket, fitEnvelope, envelope, digest, UnitRefusal } from '../dist/index.js';
import type { Quantity, UnitCode } from '../dist/index.js';
import { guardSubmitted } from '../dist/src/schema.js';
import { runtimeSources } from '../scripts/inventory.ts';
import { npmEnvironment } from '../scripts/environment.ts';
/** Public source-pinned extracted measurement; no source body is copied into state. */
export interface Claim {
  /** Deterministic observation key. */
  key: string;
  /** Exact source-declared decimal. */
  decimal: string;
  /** Timestamp when the public receipt reported this claim, not the measurement window. */
  reported_at: string;
  /** Explicit physical or counting unit. */
  unit: UnitCode;
  /** First-release conversion target. */
  to: UnitCode;
  /** Independent conversion factor numerator. */
  scale: string;
  /** Independent conversion factor denominator. */
  divisor: string;
  /** Semantic meaning retained after compression. */
  kind: string;
  /** Exact source fragment population. */
  population: string;
  /** Distinguish native revisions from external document content digests. */
  source_kind: 'native_item' | 'external_document';
  /** Native identity or external document citation key. */
  item_id: string;
  /** Native revision for native sources, content SHA-256 for external documents. */
  item_hash: string;
  /** Exact source field pointer. */
  pointer: string;
  /** SHA-256 of the full source fragment. */
  fragment_digest: string;
  /** Public repository commit, or physical source URL. */
  source: string;
  /** Shared source-match identity for an explicitly paired numerator and denominator. */
  pair_of?: string;
  /** Position in the source's reported fraction, independent of fixture array order. */
  pair_role?: 'numerator' | 'denominator';
}
/** Resolve corpus inputs and outputs from this checkout, independent of the launch directory. */
export const corpusRoot = fileURLToPath(new URL('../', import.meta.url));
/** Match physical-source hosts exactly; paths, query text and lookalike hosts are not citations. */
export function isEarthFactSource(source: string): boolean {
  try { return new URL(source).hostname === 'nssdc.gsfc.nasa.gov'; } catch { return false; }
}
/** Preserve rule semantics and attach explicit pairing independently of fixture ordering. */
export function matchClaims(base: Omit<Claim, 'key' | 'decimal' | 'pair_of' | 'pair_role'>, values: readonly string[], offset: number): Claim[] {
  assert.ok(values.length === 1 || values.length === 2);
  const { source_kind, ...fields } = base;
  return values.map((decimal, part) => ({ key: `fleet-${offset + part}`, source_kind, decimal, ...fields, ...(values.length === 2 ? { pair_of: base.population, pair_role: part === 0 ? 'numerator' as const : 'denominator' as const } : {}) }));
}
/** Emit bounded source excerpts as JSON data for explicit maintainer review during refresh. */
export function harvestReviewLine(claim: Claim, fragment: string, index: number): string {
  return JSON.stringify({ selected_claim: claim, match_offset: index, excerpt: fragment.slice(Math.max(0, index - 80), index + 120) });
}
/** Independent decimal-to-rational oracle, without package arithmetic. */
export function decimalFraction(text: string, claimKey = 'unspecified') {
  assert.ok(typeof text === 'string' && /^\d+(?:\.\d+)?$/.test(text), `Invalid decimal claim ${JSON.stringify(claimKey)}: expected unsigned decimal digits`);
  const [whole, fraction = ''] = text.split('.'); return { numerator: String(BigInt(whole + fraction)), denominator: String(10n ** BigInt(fraction.length)) };
}
/** Validate positive integer conversion factors before the independent oracle uses BigInt. */
export function conversionFactor(text: string, claimKey: string): bigint {
  const message = `Invalid conversion factor for ${JSON.stringify(claimKey)}: expected positive integer digits`;
  assert.ok(typeof text === 'string' && /^\d+$/.test(text), message); const value = BigInt(text); assert.ok(value > 0n, message); return value;
}
// Only these public source revisions may be archived; native reads use their scratch copies.
const publicTrackers = [
  { repo: 'pm-vcs', revision: 'f2ab3c3412d87fbf766bc629b685a986b5400f61' },
  { repo: 'pm-rl', revision: '962ac059ab8f6f8382dc93b1bc814cdc84b46fa8' },
] as const;
const physicalSource = {
  url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html',
  sha256: '1b06e3ec31249d063d40d1b38837fac89ddcd2f4b25268b38e8a6d5f413e70ef',
  reported_at: '2026-11-06T05:05:17.741Z',
};
/** Load this repository's public policy text and pin its exact bytes. */
async function readPolicyExamples() {
  const text = await readFile(join(corpusRoot, 'docs/policy-examples.md'), 'utf8');
  return { text, anchor: { source: 'https://github.com/unbraind/pm-unit/blob/5f0aeee30896065fd2a810497af3efcdec96e7b1/docs/policy-examples.md', sha256: createHash('sha256').update(text).digest('hex') } };
}
/** Refresh curated numeric receipts from Git-tracked public fleet data into disposable non-Git copies. */
export async function harvest() {
  const scratch = await mkdtemp(join(tmpdir(), 'unit-public-')); const claims: Claim[] = []; const sources: { repo: string; revision: string; item_id: string; item_hash: string; bytes: number }[] = []; const selected = new Set<string>();
  try {
    for (const { repo, revision } of publicTrackers) {
      const original = resolve(corpusRoot, '..', repo);
      const copy = join(scratch, repo); await mkdir(copy); const archive = execFileSync('git', ['archive', revision, '.agents/pm'], { cwd: original, maxBuffer: 32 * 1024 * 1024, env: npmEnvironment(process.env) });
      execFileSync('tar', ['-x', '-C', copy], { input: archive });
      const client = new PmClient({ cwd: copy, pmRoot: join(copy, '.agents/pm'), noExtensions: true }); const corpus = await client.listAllComplete({ includeBody: true }); certifyCompleteListResult(corpus);
      const rules: { regex: RegExp; unit: UnitCode; to: UnitCode; scale: string; divisor: string; kind: string; max: number }[] = repo === 'pm-vcs' ? [
        { regex: /\b(\d+) tests\b/g, unit: 'count', to: 'count', scale: '1', divisor: '1', kind: 'test_count', max: 12 },
        { regex: /\b(\d+(?:\.\d+)?)\s*MiB\b/g, unit: 'MiB', to: 'B', scale: '1048576', divisor: '1', kind: 'data_size', max: 6 },
        { regex: /(?<![\d.-])(\d+(?:\.\d+)?)\s*(?:seconds|s)\b/g, unit: 's', to: 'min', scale: '1', divisor: '60', kind: 'elapsed_duration', max: 4 },
        { regex: /\b(\d+)\/(\d+)\b/g, unit: 'count', to: 'count', scale: '1', divisor: '1', kind: 'test_count', max: 6 },
        { regex: /\b(\d+(?:\.\d+)?)\s*(?:percent|%)\b/g, unit: '%', to: 'ratio', scale: '1', divisor: '100', kind: 'coverage_percentage', max: 4 },
      ] : [{ regex: /\b(\d+) tokens\b/g, unit: 'token', to: 'token', scale: '1', divisor: '1', kind: 'token_count', max: 6 }];
      for (const rule of rules) {
        let count = 0;
        for (const row of corpus.items) {
          if (count >= rule.max) break;
          const got = await client.get(row.id, { outputInclude: 'full', outputBudget: 'unbounded', outputLimit: 'unbounded' }); assert.ok('item' in got && 'item_hash' in got);
          const comments = got.item.comments ?? [];
          for (const [index, comment] of comments.entries()) {
            rule.regex.lastIndex = 0;
            for (const match of comment.text.matchAll(rule.regex)) {
              if (count >= rule.max) break;
              if (rule.kind === 'elapsed_duration' && /[-~]/.test(comment.text.slice(Math.max(0, match.index! - 4), match.index!))) continue;
              if (rule.kind === 'data_size' && (comment.text.includes('example') || comment.text.includes('fixture'))) continue;
              const pointer = `/comments/${index}/text`; const population = digest([repo, row.id, pointer, match.index]); const paired = match[2] !== undefined;
              if (paired && rule.unit === 'count' && (match[1] !== match[2] || Number(match[1]) < 200)) continue;
              const fingerprint = `${repo}:${row.id}:${pointer}:${match.index}:${rule.unit}`; if (selected.has(fingerprint)) continue; selected.add(fingerprint);
              const values = paired ? [match[1], match[2]] : [match[1]];
              const admitted = matchClaims({ source_kind: 'native_item', reported_at: comment.created_at, unit: rule.unit, to: rule.to, scale: rule.scale, divisor: rule.divisor, kind: rule.unit === '%' && /duplicat|jscpd/i.test(comment.text.slice(Math.max(0, match.index! - 64), match.index!)) ? 'duplication_percentage' : rule.kind, population, item_id: row.id, item_hash: got.item_hash as string, pointer, fragment_digest: createHash('sha256').update(comment.text).digest('hex'), source: `https://github.com/unbraind/${repo}/tree/${revision}` }, values, claims.length);
              for (const claim of admitted) { claims.push(claim); console.log(harvestReviewLine(claim, comment.text, match.index!)); }
              if (!sources.some(source => source.repo === repo && source.item_id === row.id)) sources.push({ repo, revision, item_id: row.id, item_hash: got.item_hash as string, bytes: Buffer.byteLength(JSON.stringify(got.item)) }); count++;
            }
          }
        }
      }
    }
    assert.ok(claims.length >= 30, `Public measured corpus too small: ${claims.length}`);
    const response = await fetch(physicalSource.url, { signal: AbortSignal.timeout(20000) }); assert.ok(response.ok); const html = await response.text(); const hash = createHash('sha256').update(html).digest('hex');
    assert.equal(hash, physicalSource.sha256, 'Physical source changed; review the public acquisition pin before refreshing');
    for (const [key, decimal, unit, to, scale, divisor, kind] of [
      ['earth-equatorial', '6378.137', 'km', 'm', '1000', '1', 'equatorial_radius'], ['earth-polar', '6356.752', 'km', 'm', '1000', '1', 'polar_radius'], ['earth-rotation', '23.9345', 'h', 's', '3600', '1', 'sidereal_rotation'],
    ] as const) { assert.ok(html.includes(decimal)); const claim: Claim = { key, source_kind: 'external_document', decimal, reported_at: physicalSource.reported_at, unit, to, scale, divisor, kind, population: digest('NASA Earth fact sheet'), item_id: 'nasa-earth-facts', item_hash: hash, pointer: key, fragment_digest: hash, source: physicalSource.url }; claims.push(claim); console.log(harvestReviewLine(claim, html, html.indexOf(decimal))); }
    const policy = await readPolicyExamples();
    const receipt = { schema_version: 1, claims, sources, policy_examples: policy.anchor, raw_item_bytes: sources.reduce((sum, row) => sum + row.bytes, 0), physical_source_sha256: hash };
    await writeFile(join(corpusRoot, 'test/fixtures/measurements.json'), JSON.stringify(receipt, null, 2) + '\n'); return receipt;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
/** Evaluate public receipt claims with independent expected rationals and predeclared mismatch controls. */
export async function evaluateCorpus() {
  const fixtureText = await readFile(join(corpusRoot, 'test/fixtures/measurements.json'), 'utf8');
  const input = JSON.parse(fixtureText) as { claims: Claim[]; raw_item_bytes: number; sources: unknown[]; policy_examples: { source: string; sha256: string } };
  const policy = await readPolicyExamples(); assert.deepEqual(input.policy_examples, policy.anchor, 'Policy anchor changed; refresh the public fixture before evaluation');
  const root = await mkdtemp(join(tmpdir(), 'unit-real-data-')); const started = performance.now(); let calls = 0;
  try {
    const pmRoot = join(root, '.agents/pm'); const native = new PmClient({ cwd: root, pmRoot, author: 'real-data', noExtensions: true }); await native.init('proof', { defaults: true, agentGuidance: 'skip', mergeFence: false });
    const external_source_anchors: { item: unknown; item_hash: string; source: string; content_digest: string }[] = [];
    /** Anchor explicitly selected public external facts in native items before referencing them. */
    async function anchor(key: string, source: string, content_digest: string, evidence: string) {
      const body = `Public source: ${source}\nContent SHA-256: ${content_digest}\n${evidence}`.trimEnd();
      await native.create({ id: key, title: 'Explicit public source anchor', type: 'Task', body }); calls++;
      const got = await native.get(key, { outputInclude: 'full', outputBudget: 'unbounded', outputLimit: 'unbounded' }); calls++; assert.ok('item' in got && 'item_hash' in got); assert.equal(got.item.body, body); guardSubmitted(got.item);
      external_source_anchors.push({ item: got.item, item_hash: got.item_hash as string, source, content_digest });
      return { item_id: got.item.id, item_hash: got.item_hash as string, field_pointer: '/body' };
    }
    const physical = input.claims.filter(claim => claim.source_kind === 'external_document'); assert.equal(physical.length, 3);
    const physicalRef = await anchor('proof-physical-source', physical[0].source, physical[0].item_hash, physical.map(claim => `${claim.key}: ${claim.decimal} ${claim.unit}; original measurement window unknown`).join('\n'));
    const host = createDirectoryHost(pmRoot, 'real-data'); const id = 'proof-ledger'; await createQuantitySet(host, { id, op: 'birth', title: 'Public measurement receipts', quantity_set_key: 'fleet' }); calls++;
    const results: { key: string; expected: { numerator: string; denominator: string }; actual: unknown }[] = [];
    for (const claim of input.claims) {
      const q: Quantity = { quantity_id: claim.key, value: decimalFraction(claim.decimal, claim.key), unit_code: claim.unit, semantic_kind: claim.kind, subject_ref: claim.key.startsWith('earth') ? 'earth' : 'public-fleet-run', population_key: claim.population, population_digest: claim.fragment_digest, time_window: `Measurement window unknown; receipt reported ${claim.reported_at}`, acquisition: 'reported', observed_at: claim.reported_at, provenance: [claim.source_kind === 'external_document' ? { ...physicalRef, citation_id: claim.key } : { item_id: claim.item_id, item_hash: claim.item_hash, field_pointer: claim.pointer }], notes: '' };
      await recordQuantity(host, { id, op: claim.key, revision: (await readQuantitySet(host, id)).revision, quantity: q }); calls += 2;
      const actual = (await convertQuantity(host, { id, quantity: claim.key, to: claim.to })).quantity.value!; calls++;
      const source = decimalFraction(claim.decimal, claim.key); const expected = { numerator: String(BigInt(source.numerator) * conversionFactor(claim.scale, `${claim.key}.scale`)), denominator: String(BigInt(source.denominator) * conversionFactor(claim.divisor, `${claim.key}.divisor`)) };
      assert.equal(BigInt(actual.numerator) * BigInt(expected.denominator), BigInt(expected.numerator) * BigInt(actual.denominator)); results.push({ key: claim.key, expected, actual });
    }
    const comparisons: { left: string; right: string; reason: string | null }[] = [];
    for (const [left, right] of [[input.claims[0].key, input.claims.find(row => row.unit === 'MiB')!.key], [input.claims[0].key, input.claims.find(row => row.unit === 'token')!.key], ['earth-equatorial', 'earth-polar'], [input.claims[0].key, input.claims.find(row => row.unit === 'count' && row.population !== input.claims[0].population)!.key]]) {
      const comparison = await compareQuantities(host, { id, left, right }); calls++; assert.equal(comparison.usable, false); comparisons.push({ left, right, reason: comparison.reason });
    }
    const numerator = input.claims.find(row => row.pair_role === 'numerator' && row.unit === 'count'); assert.ok(numerator?.pair_of);
    const pair = input.claims.find(row => row.pair_of === numerator.pair_of && row.pair_role === 'denominator'); assert.ok(pair);
    await deriveQuantity(host, { id, op: 'ratio-proof', revision: (await readQuantitySet(host, id)).revision, quantity_id: 'ratio-proof', expression: { op: 'divide', left: numerator.key, right: pair.key } }); calls += 2;
    const ratio = await convertQuantity(host, { id, quantity: 'ratio-proof', to: '%' }); calls++; assert.deepEqual(ratio.quantity.value, { numerator: '100', denominator: '1' });
    const controlsId = 'proof-controls'; await createQuantitySet(host, { id: controlsId, op: 'controls-birth', title: 'Public policy mismatch controls', quantity_set_key: 'controls' }); calls++;
    const baseline = (await readQuantitySet(host, id)).state.observations[0]; calls++;
    const policyRef = await anchor('proof-policy-examples', input.policy_examples.source, input.policy_examples.sha256, policy.text);
    const controls: Quantity[] = [
      { ...baseline, quantity_id: 'parallel-elapsed', value: { numerator: '10', denominator: '1' }, unit_code: 's', semantic_kind: 'elapsed_duration', population_key: 'parallel-example', population_digest: digest('parallel-example'), provenance: [policyRef], acquisition: 'estimated', notes: 'Illustrative repository policy example; not a new measured receipt.' },
      { ...baseline, quantity_id: 'parallel-summed', value: { numerator: '20', denominator: '1' }, unit_code: 's', semantic_kind: 'summed_tool_duration', population_key: 'parallel-example', population_digest: digest('parallel-example'), provenance: [policyRef], acquisition: 'estimated', notes: 'Illustrative repository policy example; not a new measured receipt.' },
      { ...baseline, quantity_id: 'tokens-total', unit_code: 'token', semantic_kind: 'input_total', population_key: 'token-policy', population_digest: digest('token-policy'), provenance: [policyRef], acquisition: 'estimated', notes: 'Mismatch control; total is illustrative.' },
      { ...baseline, quantity_id: 'tokens-cached', unit_code: 'token', semantic_kind: 'cached_subset', population_key: 'token-policy', population_digest: digest('token-policy'), provenance: [policyRef], value: null, unknown_reason: 'No cached-subset count is published in this selected source.', notes: '' },
    ];
    for (const q of controls) { await recordQuantity(host, { id: controlsId, op: q.quantity_id, revision: (await readQuantitySet(host, controlsId)).revision, quantity: q }); calls += 2; }
    for (const [left, right] of [['parallel-elapsed', 'parallel-summed'], ['tokens-total', 'tokens-cached']]) { const result = await compareQuantities(host, { id: controlsId, left, right }); calls++; assert.equal(result.reason, 'semantic_mismatch'); comparisons.push({ left, right, reason: result.reason }); }
    const unsafe: string[] = [];
    for (const [owner, left, right, code] of [[id, numerator.key, pair.key, 'unsafe_overlap'], [controlsId, 'tokens-total', 'tokens-cached', 'semantic_mismatch']]) {
      try { await deriveQuantity(host, { id: owner, op: `unsafe-${left}`, revision: (await readQuantitySet(host, owner)).revision, quantity_id: 'unsafe-sum', expression: { op: 'add', left, right } }); assert.fail('Unsafe sum was admitted'); }
      catch (error) { assert.ok(error instanceof UnitRefusal); assert.equal(error.code, code); unsafe.push(code); } calls += 2;
    }
    await deriveQuantity(host, { id: controlsId, op: 'unknown-ratio', revision: (await readQuantitySet(host, controlsId)).revision, quantity_id: 'unknown-ratio', expression: { op: 'divide', left: 'tokens-total', right: 'tokens-cached' } }); calls += 2;
    const unknown = await convertQuantity(host, { id: controlsId, quantity: 'unknown-ratio', to: '%' }); calls++; assert.equal(unknown.quantity.value, null); assert.match(unknown.quantity.unknown_reason!, /tokens-cached/);
    const packet = envelope(await quantityPacket(host, { id, limit: 10 })); calls++; const full = fitEnvelope(host, packet, 8192); const bytes = full.output_fit.output_bytes; let minimum: number | null = null;
    try { fitEnvelope(host, packet, 1600); } catch (error) { assert.ok(error instanceof UnitRefusal && error.code === 'output_budget'); minimum = error.details.minimum_usable_budget as number | null; }
    const emitted_inventory = await Promise.all(runtimeSources(corpusRoot).sort().map(async path => ({ path: path.replace(/\.ts$/, '.js'), sha256: createHash('sha256').update(await readFile(join(corpusRoot, 'dist', path.replace(/\.ts$/, '.js')))).digest('hex') })));
    return { fixture_digest: createHash('sha256').update(fixtureText).digest('hex'), implementation_digest: digest(emitted_inventory), emitted_inventory, sdk_version: '2026.11.5', measured_runtime: process.version, external_source_anchors, quantities: input.claims.length + 6, illustrative_controls: 4, unknown_derivations: 1, unknown_operand_ids: ['tokens-cached'], unsafe_refusals: unsafe, exact_claims: results.length, reproduced: results.length, refusals: comparisons, derived_ratios: 1, packet_claims: 10, packet_bytes: bytes, packet_tokens: Math.ceil(bytes / 4), packet_minimum_budget: minimum, raw_item_bytes: input.raw_item_bytes, raw_item_tokens: Math.ceil(input.raw_item_bytes / 4), calls, wall_ms: Math.round(performance.now() - started), results, sources: input.sources };
  } finally { await rm(root, { recursive: true, force: true }); }
}
