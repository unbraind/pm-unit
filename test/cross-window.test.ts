import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createExtensionTestHarness, decodeToon } from '@unbrained/pm-cli/sdk/testing';
import extension, { compareQuantities, recordQuantity, readQuantitySet, deriveQuantity, envelope, fitEnvelope, digest } from '../dist/index.js';
import type { Quantity, UnitResult } from '../dist/index.js';
import { fixture, request, hasCode, historyEvents } from './helpers.ts';

test('window-only mismatch requires an explicit option and retains exact context witnesses without writes', async t => {
  const { host, id, pmRoot } = await fixture(t);
  await recordQuantity(host, await request(host, id, 'yesterday', { time_window: '2026-11-04' }));
  await recordQuantity(host, await request(host, id, 'today', { unit_code: 'min', value: { numerator: '3', denominator: '1' } }));
  const before = await readQuantitySet(host, id); const events = await historyEvents(pmRoot, id);
  const query = { id, left: 'yesterday', right: 'today' };
  for (const across_windows of [undefined, false]) {
    const refused = await compareQuantities(host, { ...query, across_windows });
    assert.equal(refused.reason, 'window_mismatch'); assert.equal(refused.ordering, null); assert.equal(refused.usable, false); assert.match(refused.remedy, /--across-windows/);
  }
  const compared = await compareQuantities(host, { ...query, across_windows: true });
  assert.equal(compared.usable, true); assert.equal(compared.ordering, -1); assert.equal(compared.reason, null);
  assert.deepEqual(compared.comparison_witness, { across_windows: true, left_time_window: '2026-11-04', right_time_window: '2026-11-05', held_constant: { subject_ref: 'endpoint', population_key: 'requests', population_digest: digest('requests'), semantic_kind: 'elapsed_latency', dimension: 'time' } });
  assert.equal((await compareQuantities(host, { id, left: 'today', right: 'yesterday', across_windows: true })).ordering, 1);
  assert.equal((await compareQuantities(host, { id, left: 'today', right: 'today', across_windows: true })).ordering, 0);
  assert.equal((await compareQuantities(host, { id, left: 'today', right: 'today' })).ordering, 0);
  for (const across_windows of ['true', 1, null, []]) await assert.rejects(compareQuantities(host, { ...query, across_windows } as unknown as Parameters<typeof compareQuantities>[1]), hasCode('invalid_input'));
  for (const op of ['add', 'subtract', 'multiply', 'divide'] as const) await assert.rejects(deriveQuantity(host, { id, op: `cross-window-${op}`, revision: before.revision, quantity_id: 'delta', expression: { op, left: 'today', right: 'yesterday' } }), hasCode('window_mismatch'));
  await assert.rejects(deriveQuantity(host, { id, op: 'override-arithmetic', revision: before.revision, quantity_id: 'delta', expression: { op: 'subtract', left: 'today', right: 'yesterday' }, across_windows: true } as unknown as Parameters<typeof deriveQuantity>[1]), hasCode('invalid_input'));
  assert.equal((await readQuantitySet(host, id)).revision, before.revision); assert.equal(await historyEvents(pmRoot, id), events);
});

test('across-window opt-in preserves all other refusals, unknowns and interval abstention', async t => {
  const { host, id } = await fixture(t); await recordQuantity(host, await request(host, id, 'base'));
  const cases: [Partial<Quantity>, string][] = [[{ unit_code: 'm' }, 'dimension_mismatch'], [{ semantic_kind: 'other' }, 'semantic_mismatch'], [{ subject_ref: 'other' }, 'population_mismatch'], [{ population_key: 'other' }, 'population_mismatch'], [{ population_digest: digest('other') }, 'population_mismatch'], [{ value: null, unknown_reason: 'Not measured' }, 'unknown_operand'], [{ uncertainty: { lower: { numerator: '100', denominator: '1' }, upper: { numerator: '140', denominator: '1' } } }, 'uncertainty_overlap']];
  for (const [index, [patch, reason]] of cases.entries()) {
    const key = `other-${index}`; await recordQuantity(host, await request(host, id, key, { time_window: '2026-11-04', ...patch }));
    const result = await compareQuantities(host, { id, left: 'base', right: key, across_windows: true });
    assert.equal(result.reason, reason); assert.equal(result.ordering, null); assert.equal(result.usable, false);
    assert.equal(result.comparison_witness.held_constant === null, index < 5);
    assert.equal(result.comparison_witness.left_time_window, '2026-11-05'); assert.equal(result.comparison_witness.right_time_window, '2026-11-04');
  }
});

test('cross-window CLI and SDK share strict JSON and TOON witnesses on a real tracker', async t => {
  const { host, id, pmRoot } = await fixture(t); await recordQuantity(host, await request(host, id, 'left'));
  await recordQuantity(host, await request(host, id, 'right', { time_window: '2026-11-04' }));
  const harness = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema', 'renderers'] }); t.after(() => harness.deactivate());
  const derivation = await harness.runCommand({ command: 'unit derive', args: [id], options: { op: 'no-cross-window-arithmetic', revision: (await readQuantitySet(host, id)).revision, input: JSON.stringify({ quantity_id: 'delta', expression: { op: 'subtract', left: 'left', right: 'right' } }) }, pmRoot });
  const refused = derivation.result as UnitResult; assert.equal(refused.refusal?.code, 'window_mismatch'); assert.equal(refused.exit_code, 4);
  for (const acrossWindows of [undefined, false, true, 'true'] as const) {
    const execution = await harness.runCommand({ command: 'unit compare', args: [id], options: { left: 'left', right: 'right', acrossWindows }, global: { outputBudget: 'unbounded' }, pmRoot });
    assert.equal(execution.cause, undefined); const result = execution.result as UnitResult;
    if (acrossWindows === 'true') { assert.equal(result.refusal?.code, 'invalid_input'); continue; }
    const sdk = await compareQuantities(host, { id, left: 'left', right: 'right', across_windows: acrossWindows });
    assert.deepEqual(result.data, sdk);
    const json = await harness.runRendererOverride({ format: 'json', command: 'unit compare', result });
    const toon = await harness.runRendererOverride({ format: 'toon', command: 'unit compare', result });
    assert.deepEqual(JSON.parse(String(json.rendered)), decodeToon(String(toon.rendered)));
    assert.deepEqual(JSON.parse(String(json.rendered)).data.comparison_witness, sdk.comparison_witness);
    assert.doesNotThrow(() => fitEnvelope(host, envelope(sdk), 8192));
  }
});

test('public Wikimedia daily measurements reproduce an honest day-over-day comparison', async t => {
  const source = JSON.parse(await readFile(new URL('./fixtures/daily-pageviews.json', import.meta.url), 'utf8')) as { source: string; retrieved_at: string; sha256: string; response: string };
  assert.equal(source.source, 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/TypeScript/daily/20240101/20240102');
  assert.equal(createHash('sha256').update(source.response).digest('hex'), source.sha256);
  const data = JSON.parse(source.response) as { items: { project: string; article: string; access: string; agent: string; granularity: string; timestamp: string; views: number }[] };
  assert.deepEqual(data.items.map(row => [row.timestamp, row.views]), [['2024010100', 722], ['2024010200', 965]]);
  const { native, host, id, pmRoot } = await fixture(t);
  const sourceId = 'corpus-daily-source'; await native.create({ id: sourceId, title: 'Public Wikimedia daily pageviews', type: 'Task', body: `Source: ${source.source}\nContent SHA-256: ${source.sha256}\n${source.response}` });
  const revision = await native.readItemRevision(sourceId);
  const population = { project: 'en.wikipedia', article: 'TypeScript', access: 'all-access', agent: 'user', granularity: 'daily' };
  for (const [index, row] of data.items.entries()) {
    const { timestamp, views, ...context } = row; assert.deepEqual(context, population);
    const start = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:00:00Z`;
    const end = new Date(Date.parse(start) + 86400000).toISOString().replace('.000Z', 'Z');
    await recordQuantity(host, await request(host, id, `day-${index + 1}`, { value: { numerator: String(views), denominator: '1' }, unit_code: 'count', semantic_kind: 'page_view_count', subject_ref: 'en.wikipedia.TypeScript', population_key: 'all-access.user.pageviews', population_digest: digest(population), time_window: `${start}/${end}`, observed_at: source.retrieved_at, provenance: [{ item_id: sourceId, item_hash: revision.item_hash, field_pointer: '/body' }], notes: 'Reported daily page views, not unique visitors. Same filter definition across UTC days; source truth and later corrections remain unknown.' }));
  }
  const query = { id, left: 'day-1', right: 'day-2' }; const before = await historyEvents(pmRoot, id);
  assert.equal((await compareQuantities(host, query)).reason, 'window_mismatch');
  const result = await compareQuantities(host, { ...query, across_windows: true });
  assert.equal(result.ordering, -1); assert.equal(result.usable, true); assert.equal(result.comparison_witness.held_constant?.population_digest, digest(population));
  assert.deepEqual([result.left.value, result.right.value], [{ numerator: '722', denominator: '1' }, { numerator: '965', denominator: '1' }]);
  assert.equal(await historyEvents(pmRoot, id), before); t.diagnostic(JSON.stringify({ source: source.source, sha256: source.sha256, left: result.left.value, right: result.right.value, ordering: result.ordering, witness: result.comparison_witness }));
});
