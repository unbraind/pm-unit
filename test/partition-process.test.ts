import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { declarePartition, deriveQuantity, readQuantitySet } from '../dist/index.js';
import type { DeclarePartitionInput, UnitMutationReceipt } from '../dist/index.js';
import { partitionFixture, partitionRequest, sumRequest } from './partition-helpers.ts';
import { historyEvents } from './helpers.ts';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';

/** Spawn an independent SDK client and expose a deterministic shared-state race barrier. */
function worker(t: TestContext, pmRoot: string, input: DeclarePartitionInput, boundary: string) {
  const child = fork(new URL('./partition-worker.ts', import.meta.url), [pmRoot, JSON.stringify(input), boundary], { env: testEnvironment(npmEnvironment(process.env)), stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let diagnostics = ''; child.stderr!.on('data', data => diagnostics += String(data));
  const ready = new Promise<void>((resolve, reject) => {
    child.on('message', message => { if ((message as { ready?: string }).ready === boundary) resolve(); });
    child.on('error', reject); child.once('exit', () => reject(new Error(`Worker exited before boundary: ${diagnostics}`)));
  });
  const result = new Promise<{ outcome: string; code?: string; receipt?: UnitMutationReceipt }>(resolve => {
    child.on('message', message => { if ('outcome' in (message as object)) resolve(message as { outcome: string }); });
  });
  const exited = new Promise<string | number | null>(resolve => { child.once('exit', (code, signal) => resolve(signal ?? code)); });
  return { child, ready, result, exited };
}

test('partition process race admits exactly one revision-bound review without losing native state', { timeout: 60000 }, async t => {
  const { host, id, pmRoot } = await partitionFixture(t); const input = await partitionRequest(host, id);
  const peer = { ...input, op: 'peer', declaration: { ...input.declaration, declaration_id: 'peer' } };
  const workers = [worker(t, pmRoot, input, 'before_update'), worker(t, pmRoot, peer, 'before_update')];
  await Promise.all(workers.map(w => w.ready)); workers.forEach(w => w.child.send('go'));
  const results = await Promise.all(workers.map(w => w.result)); await Promise.all(workers.map(w => w.exited));
  assert.equal(results.filter(r => r.outcome === 'committed').length, 1); assert.equal(results.filter(r => r.code === 'revision_conflict').length, 1);
  const owner = await readQuantitySet(host, id); assert.equal(owner.state.observations.length, 2); assert.equal(owner.state.declarations?.length, 1); assert.equal(await historyEvents(pmRoot, id), 4);
  const accepted = results.findIndex(r => r.outcome === 'committed');
  assert.equal((await declarePartition(host, accepted === 0 ? input : peer)).replayed, true);
  const loser = accepted === 0 ? peer : input;
  await declarePartition(host, { ...loser, revision: owner.revision });
  const after = await readQuantitySet(host, id); assert.deepEqual(after.state.declarations?.map(d => d.declaration_id).sort(), ['partition', 'peer']);
  assert.equal(await historyEvents(pmRoot, id), 5); await deriveQuantity(host, await sumRequest(host, id));
});

for (const boundary of ['before_update', 'after_update']) test(`partition process killed at ${boundary} converges on one declaration and audit event`, { timeout: 60000 }, async t => {
  const { host, id, pmRoot } = await partitionFixture(t); const input = await partitionRequest(host, id);
  const process = worker(t, pmRoot, input, boundary); await process.ready; process.child.kill('SIGKILL'); assert.equal(await process.exited, 'SIGKILL');
  const recovered = await declarePartition(host, input); assert.equal(recovered.replayed, boundary === 'after_update');
  assert.equal((await readQuantitySet(host, id)).state.declarations?.length, 1); assert.equal(await historyEvents(pmRoot, id), 4);
  const bytes = await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8');
  assert.equal((await declarePartition(host, input)).replayed, true); assert.equal(await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8'), bytes);
  await deriveQuantity(host, await sumRequest(host, id)); assert.equal((await readQuantitySet(host, id)).state.derivations[0].quantity.value?.numerator, '240');
});
