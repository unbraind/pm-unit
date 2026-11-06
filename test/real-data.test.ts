import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateCorpus } from './corpus.ts';
test('public fleet receipts and NASA physical quantities reproduce independently with explicit refusals', async t => {
  const receipt = await evaluateCorpus(); assert.ok(receipt.exact_claims >= 33); assert.equal(receipt.reproduced, receipt.exact_claims); assert.equal(receipt.refusals.length, 6); assert.equal(receipt.derived_ratios, 1); assert.equal(receipt.unsafe_refusals.length, 2); assert.deepEqual(receipt.unknown_operand_ids, ['tokens-cached']);
  assert.ok(receipt.packet_bytes <= 32768); assert.equal(receipt.packet_tokens, Math.ceil(receipt.packet_bytes / 4)); assert.ok(receipt.packet_minimum_budget === null || receipt.packet_minimum_budget > 1600);
  t.diagnostic(JSON.stringify({ exact_claims: receipt.exact_claims, quantities: receipt.quantities, comparisons_refused: receipt.refusals.length, unsafe_refusals: receipt.unsafe_refusals.length, packet_bytes: receipt.packet_bytes, packet_tokens: receipt.packet_tokens, raw_item_tokens: receipt.raw_item_tokens, calls: receipt.calls, wall_ms: receipt.wall_ms, implementation_digest: receipt.implementation_digest }));
  assert.equal(receipt.external_source_anchors.length, 2);
  for (const anchor of receipt.external_source_anchors) { assert.match(anchor.item_hash, /^[a-f0-9]{64}$/); assert.notEqual(anchor.item_hash, anchor.content_digest); }
  assert.ok(receipt.calls > 0 && receipt.wall_ms > 0); assert.ok(receipt.packet_tokens < receipt.raw_item_tokens);
  const fixture = JSON.parse(await readFile('test/fixtures/measurements.json', 'utf8')) as { claims: { source: string; item_hash: string; fragment_digest: string; pointer: string; key: string; kind: string }[] };
  assert.equal(fixture.claims.find(claim => claim.key === 'fleet-36')?.kind, 'duplication_percentage');
  assert.equal(fixture.claims.filter(claim => claim.source.includes('nasa.gov')).length, 3);
  for (const claim of fixture.claims) { assert.match(claim.item_hash, /^[a-f0-9]{64}$/); assert.match(claim.fragment_digest, /^[a-f0-9]{64}$/); assert.ok(claim.pointer.length > 0); }
});
