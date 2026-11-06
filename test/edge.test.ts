import test from 'node:test';
import assert from 'node:assert/strict';
import { fitOutputEnvelope, OutputEnvelopeFitError } from '@unbrained/pm-cli/sdk';
import { PmClient } from '@unbrained/pm-cli/sdk/core';
import { createQuantitySet, recordQuantity, compareQuantities, deriveQuantity, readQuantitySet, quantityPacket, envelope, fitEnvelope, UnitRefusal, digest } from '../dist/index.js';
import { explanation } from '../dist/src/api.js';
import { persistedSchemaPort } from '../dist/src/host.js';
import { renderOutput } from '../dist/src/output.js';
import { runCommand } from '../dist/src/commands.js';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import { fixture, request, observation, hasCode } from './helpers.ts';

test('interval ordering is conservative on each side and on overlap', async t => {
  const { host, id } = await fixture(t);
  await recordQuantity(host, await request(host, id, 'uncertain', { uncertainty: { lower: { numerator: '110', denominator: '1' }, upper: { numerator: '130', denominator: '1' } } }));
  await recordQuantity(host, await request(host, id, 'low', { value: { numerator: '1', denominator: '1' } }));
  await recordQuantity(host, await request(host, id, 'high', { value: { numerator: '500', denominator: '1' } }));
  assert.equal((await compareQuantities(host, { id, left: 'uncertain', right: 'low' })).ordering, 1);
  assert.equal((await compareQuantities(host, { id, left: 'uncertain', right: 'high' })).ordering, -1);
  assert.equal((await compareQuantities(host, { id, left: 'low', right: 'uncertain' })).ordering, -1);
  assert.equal((await compareQuantities(host, { id, left: 'high', right: 'uncertain' })).ordering, 1);
  assert.equal((await compareQuantities(host, { id, left: 'uncertain', right: 'uncertain' })).reason, 'uncertainty_overlap');
});

test('native persisted schema adapters preserve undefined option validation and peer schema ownership', async t => {
  const { native, host, birth } = await fixture(t);
  await assert.rejects(host.client.create(), error => error instanceof Error);
  await native.schemaRemoveType('QuantitySet'); await native.schemaAddType('QuantitySet', { folder: 'foreign', description: 'Peer-owned type' });
  await assert.rejects(createQuantitySet(host, { ...birth, id: 'corpus-new' }), hasCode('invalid_record'));
});

test('settings and invalid CLI dispatch are validated without writes', async t => {
  const { native, pmRoot, birth, host } = await fixture(t);
  /** Real SDK context with injected host-owned settings policy. */
  const ctx = (policy: unknown): CommandHandlerContext => ({ command: 'unit packet', args: [birth.id], options: {}, global: {}, pm_root: pmRoot, sdk: { client: native, fitOutputEnvelope, readSettingsSection: async () => ({ value: policy }) } } as unknown as CommandHandlerContext);
  const unknown = await runCommand('unknown', ctx(undefined)) as { refusal: { code: string } }; assert.equal(unknown.refusal.code, 'invalid_input');
  for (const policy of [null, [], { unsupported: true }, { output_budget: 0 }]) assert.equal((await runCommand('packet', ctx(policy)) as { ok: boolean }).ok, false);
  assert.equal((await runCommand('packet', ctx({ output_budget: 1600 })) as { ok: boolean }).ok, true);
  assert.equal((await host.settings!()), undefined);
});

test('serialized fitter capability failures remain bounded typed refusals', async t => {
  const { host, id } = await fixture(t); const value = envelope(await quantityPacket(host, { id }));
  /** Fault injection wraps the real public fitter; normal paths are never mocked. */
  const missing = ((...args: Parameters<typeof fitOutputEnvelope>) => { try { return fitOutputEnvelope(...args); } catch (error) { assert.ok(error instanceof OutputEnvelopeFitError); Object.defineProperty(error, 'minimum_tokens', { value: undefined }); throw error; } }) as typeof fitOutputEnvelope;
  assert.throws(() => fitEnvelope({ fitOutputEnvelope: missing }, value, 1), hasCode('backend_unsupported'));
  let calls = 0;
  const badRetry = ((...args: Parameters<typeof fitOutputEnvelope>) => { calls++; try { return fitOutputEnvelope(...args); } catch (error) { assert.ok(error instanceof OutputEnvelopeFitError); if (calls > 1) throw new UnitRefusal('permission_denied', 'Synthetic authorized-host refusal'); throw error; } }) as typeof fitOutputEnvelope;
  // The real fitter normally stabilizes in one pass; force the retry through an independently measured too-small hint.
  const first = ((...args: Parameters<typeof fitOutputEnvelope>) => { try { return badRetry(...args); } catch (error) { if (calls === 1 && error instanceof OutputEnvelopeFitError) Object.defineProperty(error, 'minimum_tokens', { value: 1 }); throw error; } }) as typeof fitOutputEnvelope;
  assert.throws(() => fitEnvelope({ fitOutputEnvelope: first }, value, 1), hasCode('permission_denied'));
});

test('fresh unprovisioned host and unauthorized fitter refuse through public contracts', async t => {
  const { native, pmRoot, host, id } = await fixture(t, false);
  const context = { command: 'unit packet', args: [id], options: {}, global: {}, pm_root: pmRoot, sdk: { client: native, fitOutputEnvelope, readSettingsSection: async () => ({ value: undefined }) } } as unknown as CommandHandlerContext;
  assert.equal((await runCommand('packet', context) as { refusal: { code: string } }).refusal.code, 'not_found');
  const denied: typeof fitOutputEnvelope = () => { throw new UnitRefusal('permission_denied', 'Host denied output fitting'); };
  const sample = envelope({ owner_id: id, revision: 'a'.repeat(64), rows: [], returned: 0, omitted: 0, total: 0, continuation: null });
  assert.throws(() => fitEnvelope({ fitOutputEnvelope: denied }, sample), hasCode('permission_denied'));
  await assert.rejects(recordQuantity(host, { id, op: 'bad-unit', revision: 'a'.repeat(64), quantity: { ...observation('bad-unit'), unit_code: 'month' } } as unknown as Parameters<typeof recordQuantity>[1]), hasCode('unsupported_unit'));
  await assert.rejects(recordQuantity(host, { id, op: 'bad-value', revision: 'a'.repeat(64), quantity: { ...observation('bad-value'), acquisition: 'invented' } } as unknown as Parameters<typeof recordQuantity>[1]), hasCode('invalid_input'));
});


test('final scoped rendering refuses host compaction and final byte overflow', () => {
  for (const value of [null, 'data', {}, { read_output: {} }]) assert.ok(renderOutput(value, 'json').endsWith('\n'));
  for (const value of [{ output_budget_exceeded: {} }, { read_output: { strings_compacted: true } }, { read_output: { rows_compacted: true } }, { read_output: { result_omitted: true } }]) assert.equal(JSON.parse(renderOutput(value, 'json')).refusal.code, 'output_budget');
  assert.equal(JSON.parse(renderOutput({ value: 'x'.repeat(40000) }, 'json')).refusal.code, 'output_budget');
});


test('dynamic directory routes choose native options from the actual persisted schema', async t => {
  const { native } = await fixture(t, false); const port = persistedSchemaPort(native, true);
  const created = await port.create({ id: 'corpus-native-task', title: 'Native field routing control', type: 'Task' }); assert.equal(created.item.id, 'corpus-native-task');
  await port.update('corpus-native-task', { description: 'Preserved native options' });
  const got = await port.get('corpus-native-task', { outputInclude: 'full', outputBudget: 'unbounded' }); assert.ok('item' in got); assert.equal(got.item.description, 'Preserved native options');
});

test('aggregate byte ceilings refuse before native mutation without evicting replay identities', async t => {
  const { host, id } = await fixture(t); let admitted = 0; let refused = false;
  const provenance = Array.from({ length: 16 }, (_, index) => ({ item_id: `public-source-${index}`, item_hash: digest(index), field_pointer: '/description' }));
  for (let index = 0; index < 128; index++) {
    const input = await request(host, id, `capacity-${index}`, { notes: 'Shareable context. '.repeat(26), provenance }); const before = await host.client.readItemRevision(id);
    try { await recordQuantity(host, input); admitted++; }
    catch (error) { assert.ok(error instanceof UnitRefusal); assert.equal(error.code, 'limit_exceeded'); assert.deepEqual(await host.client.readItemRevision(id), before); refused = true; break; }
  }
  assert.equal(refused, true); assert.ok(admitted > 0); const owner = await readQuantitySet(host, id); assert.equal(owner.state.operations.length, admitted + 1); assert.equal(owner.state.observations.length, admitted);
});

test('known zero denominators refuse even when another operand is unknown', async t => {
  const { host, id } = await fixture(t);
  await recordQuantity(host, await request(host, id, 'zero', { value: { numerator: '0', denominator: '1' } }));
  await recordQuantity(host, await request(host, id, 'missing', { value: null, unknown_reason: 'No authorized measurement' }));
  const before = await host.client.readItemRevision(id);
  await assert.rejects(deriveQuantity(host, { id, revision: before.item_hash, op: 'unsafe-zero', quantity_id: 'unsafe-zero', expression: { op: 'divide', left: 'missing', right: 'zero' } }), hasCode('divide_by_zero'));
  assert.deepEqual(await host.client.readItemRevision(id), before);
});


test('shared derivation graphs retain every formula with a linear number of visits', async t => {
  const { host, id } = await fixture(t); let left = 'base-a', right = 'base-b';
  for (const key of [left, right]) await recordQuantity(host, await request(host, id, key, { unit_code: 'ratio', semantic_kind: 'scale', value: { numerator: '1', denominator: '1' } }));
  for (let index = 0; index < 22; index++) {
    const key = `shared-${index}`; await deriveQuantity(host, { id, op: key, revision: (await readQuantitySet(host, id)).revision, quantity_id: key, expression: { op: 'multiply', left, right } }); right = left; left = key;
  }
  const owner = await readQuantitySet(host, id); let reads = 0;
  // Count quantity reads in an SDK snapshot without replacing any SDK operation.
  for (const row of owner.state.derivations) { const value = row.quantity; Object.defineProperty(row, 'quantity', { get: () => { reads++; return value; }, enumerable: true }); }
  const result = explanation(owner.state, left); assert.equal(result.dependencies.length, 23); assert.equal(result.derivation_witnesses.length, 21); assert.equal(reads, 43);
  assert.throws(() => explanation(owner.state, left, new Set([left])), hasCode('derivation_cycle'));
});
