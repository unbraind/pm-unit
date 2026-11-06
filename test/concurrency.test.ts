import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { recordQuantity, deriveQuantity, createQuantitySet, createDirectoryHost, readQuantitySet } from '../dist/index.js';
import { fixture, request, hasCode, historyEvents } from './helpers.ts';
import { npmEnvironment } from '../scripts/environment.ts';

const mutationSteps = ['after_read', 'before_guard', 'before_update', 'after_update', 'after_guard', 'before_receipt'] as const;
for (const step of mutationSteps) test(`competing native write at ${step} preserves both quantities`, async t => {
  const { host, id, pmRoot } = await fixture(t); const peer = createDirectoryHost(pmRoot, 'peer'); const input = await request(host, id, 'owner'); let injected = false;
  host.boundary = async boundary => { if (boundary === step && !injected) { injected = true; await recordQuantity(peer, await request(peer, id, 'peer')); } };
  const result = await recordQuantity(host, input); assert.equal(result.outcome, 'committed'); assert.equal(injected, true);
  assert.deepEqual((await readQuantitySet(peer, id)).state.observations.map(q => q.quantity_id).sort(), ['owner', 'peer']);
  const before = await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8'); assert.equal((await recordQuantity(peer, input)).replayed, true); assert.equal(await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8'), before);
});
for (const step of ['before_create', 'after_create']) test(`create collision at ${step} converges without adoption`, async t => {
  const { host, birth, pmRoot } = await fixture(t); const peer = createDirectoryHost(pmRoot, 'peer'); const input = { ...birth, id: 'corpus-second', op: 'second' }; let injected = false;
  host.boundary = async boundary => { if (boundary === step && !injected) { injected = true; await createQuantitySet(peer, input); } };
  await createQuantitySet(host, input); assert.equal((await createQuantitySet(peer, input)).replayed, true);
  assert.equal((await readFile(join(pmRoot, 'history', 'corpus-second.jsonl'), 'utf8')).trim().split('\n').length, 1);
});
for (const step of mutationSteps) test(`crash at ${step} then rerun converges on original key`, async t => {
  const { host, id, pmRoot } = await fixture(t); const input = await request(host, id, 'recovery'); let crashed = false;
  host.boundary = async boundary => { if (boundary === step && !crashed) { crashed = true; throw new Error('Synthetic interrupted caller'); } };
  await assert.rejects(recordQuantity(host, input), hasCode('outcome_unknown')); delete host.boundary;
  const recovered = await recordQuantity(host, input);
  assert.equal(recovered.outcome, 'committed');
  const committed = ['after_update', 'after_guard', 'before_receipt'].includes(step); assert.equal(recovered.replayed, committed);
  const state = (await readQuantitySet(host, id)).state; assert.equal(state.observations[0].quantity_id, 'recovery'); assert.equal(state.operations.length, 2);
  assert.equal(await historyEvents(pmRoot, id), 2);
});
for (const step of ['before_create', 'after_create']) test(`creation crash at ${step} recovers by the same key`, async t => {
  const { host, birth } = await fixture(t); const input = { ...birth, id: 'corpus-crash', op: 'crash-create' }; let crashed = false;
  host.boundary = async boundary => { if (boundary === step && !crashed) { crashed = true; throw new Error('Synthetic crash'); } };
  await assert.rejects(createQuantitySet(host, input), hasCode('outcome_unknown')); delete host.boundary;
  assert.equal((await createQuantitySet(host, input)).replayed, step === 'after_create');
});
test('three CAS losses return explicit contention and derived decisions never rebase', async t => {
  const { host, id, pmRoot } = await fixture(t); const peer = createDirectoryHost(pmRoot, 'peer'); const input = await request(host, id, 'contended'); let sequence = 0;
  host.boundary = async step => { if (step === 'before_update') await recordQuantity(peer, await request(peer, id, `peer-${sequence++}`)); };
  await assert.rejects(recordQuantity(host, input), hasCode('contention')); assert.equal(sequence, 3); delete host.boundary;
  const edit = { id, op: 'derive-stale', revision: (await readQuantitySet(host, id)).revision, quantity_id: 'ratio', expression: { op: 'divide' as const, left: 'peer-0', right: 'peer-1' } };
  host.boundary = async step => { if (step === 'before_update') await recordQuantity(peer, await request(peer, id, 'new-peer')); };
  await assert.rejects(deriveQuantity(host, edit), hasCode('revision_conflict')); delete host.boundary;
  assert.equal((await readQuantitySet(host, id)).state.derivations.length, 0);
});
test('two independent OS writers preserve every acknowledged record and refuse contention', async t => {
  const { host, id, root, pmRoot } = await fixture(t); const worker = join(root, 'worker.mjs');
  await writeFile(worker, `import {createDirectoryHost,recordQuantity,readQuantitySet,digest} from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};const host=createDirectoryHost(process.argv[2],process.argv[3]);const id=process.argv[4];const accepted=[],refused=[];for(let i=0;i<10;i++){const key=process.argv[3]+'-'+i;const revision=(await readQuantitySet(host,id)).revision;try{await recordQuantity(host,{id,op:key,revision,quantity:{quantity_id:key,value:{numerator:String(i),denominator:'1'},unit_code:'s',semantic_kind:'elapsed',subject_ref:'endpoint',population_key:'requests',population_digest:digest('requests'),time_window:'window',acquisition:'reported',observed_at:'2026-11-05T00:00:00Z',provenance:[{item_id:'corpus-source',item_hash:digest('source'),field_pointer:'/description'}]}});accepted.push(key);}catch(error){if(['contention','revision_conflict'].includes(error.code))refused.push(key);else throw error;}}console.log(JSON.stringify({accepted,refused}));`);
  /** Capture each process result; no package lock is shared between writers. */
  const execute = (author: string) => new Promise<{ accepted: string[]; refused: string[] }>((resolve, reject) => {
    const child = spawn(process.execPath, [worker, pmRoot, author, id], { env: { ...npmEnvironment(process.env), GIT_CEILING_DIRECTORIES: root } }); let out = '', err = '';
    child.stdout.on('data', chunk => out += String(chunk)); child.stderr.on('data', chunk => err += String(chunk)); child.on('error', reject); child.on('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
  });
  const results = await Promise.all([execute('writer-a'), execute('writer-b')]); const accepted = results.flatMap(row => row.accepted).sort(); const refused = results.flatMap(row => row.refused); const state = (await readQuantitySet(host, id)).state;
  assert.equal(accepted.length + refused.length, 20); assert.ok(accepted.length > 0); assert.deepEqual(state.observations.map(q => q.quantity_id).sort(), accepted); assert.deepEqual(state.operations.slice(1).map(q => q.operation_id).sort(), accepted);
  t.diagnostic(JSON.stringify({ requests: 20, acknowledged: accepted.length, explicit_conflicts: refused.length, preserved: state.observations.length }));
});

for (const step of mutationSteps) test(`identical request at ${step} adds one record and one audit event`, async t => {
  const { host, id, pmRoot } = await fixture(t); const peer = createDirectoryHost(pmRoot, 'peer'); const input = await request(host, id, 'shared'); let injected = false;
  host.boundary = async point => { if (point === step && !injected) { injected = true; await recordQuantity(peer, input); } };
  await recordQuantity(host, input); const state = (await readQuantitySet(peer, id)).state;
  assert.deepEqual(state.observations.map(q => q.quantity_id), ['shared']); assert.equal(injected, true); assert.equal(state.operations.length, 2);
  assert.equal(await historyEvents(pmRoot, id), 2);
});
for (const step of mutationSteps) test(`identical derivation at ${step} never duplicates a pinned result`, async t => {
  const { host, id, pmRoot } = await fixture(t); const peer = createDirectoryHost(pmRoot, 'peer');
  for (const key of ['numerator', 'denominator']) await recordQuantity(host, await request(host, id, key));
  const input = { id, op: 'shared-derive', revision: (await readQuantitySet(host, id)).revision, quantity_id: 'ratio', expression: { op: 'divide' as const, left: 'numerator', right: 'denominator' } }; let injected = false;
  host.boundary = async point => { if (point === step && !injected) { injected = true; await deriveQuantity(peer, input); } };
  if (['after_read', 'before_guard', 'before_update'].includes(step)) await assert.rejects(deriveQuantity(host, input), hasCode('revision_conflict')); else await deriveQuantity(host, input);
  assert.equal((await deriveQuantity(peer, input)).replayed, true); const state = (await readQuantitySet(peer, id)).state; assert.equal(state.derivations.length, 1); assert.equal(state.operations.length, 4);
  assert.equal(await historyEvents(pmRoot, id), 4);
});
for (const step of ['before_update', 'after_update', 'before_receipt']) test(`hard OS exit at ${step} preserves crash replay convergence`, async t => {
  const { host, id, root, pmRoot } = await fixture(t); const input = await request(host, id, 'hard-crash'); const worker = join(root, 'crash-worker.mjs');
  await writeFile(worker, `import {createDirectoryHost,recordQuantity} from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};const host=createDirectoryHost(process.argv[2],'crash-writer');host.boundary=async step=>{if(step===process.argv[3])process.exit(73);};await recordQuantity(host,JSON.parse(process.argv[4]));`);
  const status = await new Promise<number | null>((resolve, reject) => { const child = spawn(process.execPath, [worker, pmRoot, step, JSON.stringify(input)], { env: npmEnvironment(process.env), stdio: 'ignore' }); child.on('error', reject); child.on('close', resolve); });
  assert.equal(status, 73); const replay = await recordQuantity(host, input); assert.equal(replay.replayed, step !== 'before_update');
  assert.equal((await readQuantitySet(host, id)).state.observations.length, 1); assert.equal(await historyEvents(pmRoot, id), 2);
});
