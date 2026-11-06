import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PmClient } from '@unbrained/pm-cli/sdk/core';
import { createDirectoryHost, createQuantitySet, readQuantitySet, digest } from '../dist/index.js';
import type { Host, Quantity, RecordQuantityInput } from '../dist/index.js';
import type { TestContext } from 'node:test';
/** Real SDK tracker, isolated outside Git; cleanup is registered before initialization. */
export async function fixture(t: TestContext, provision = true) {
  const root = await mkdtemp(join(tmpdir(), 'pm-unit-')); t.after(() => rm(root, { recursive: true, force: true }));
  const pmRoot = join(root, '.agents/pm'); const native = new PmClient({ cwd: root, pmRoot, author: 'fixture', noExtensions: true });
  await native.init('corpus', { defaults: true, agentGuidance: 'skip', mergeFence: false });
  const host = createDirectoryHost(pmRoot, 'fixture'); const birth = { id: 'corpus-ledger', op: 'birth', title: 'Explicit quantities', quantity_set_key: 'measurements' };
  if (provision) await createQuantitySet(host, birth); return { root, pmRoot, native, host, birth, id: birth.id };
}
/** Deterministic observation with explicit public provenance and population. */
export function observation(id: string, patch: Partial<Quantity> = {}): Quantity {
  return { quantity_id: id, value: { numerator: '120', denominator: '1' }, unit_code: 's', semantic_kind: 'elapsed_latency', subject_ref: 'endpoint', population_key: 'requests', population_digest: digest('requests'), time_window: '2026-11-05', acquisition: 'reported', observed_at: '2026-11-05T00:00:00Z', provenance: [{ item_id: 'corpus-source', item_hash: digest('public receipt'), field_pointer: '/description' }], notes: '', ...patch };
}
/** New reviewed append at a freshly read native revision. */
export async function request(host: Host, id: string, key: string, patch: Partial<Quantity> = {}): Promise<RecordQuantityInput> { return { id, op: `record-${key}`, revision: (await readQuantitySet(host, id)).revision, quantity: observation(key, patch) }; }
/** Match one stable refusal category. */
export function hasCode(code: string): (error: unknown) => boolean { return error => typeof error === 'object' && error !== null && 'code' in error && error.code === code; }

/** Count native audit records to verify replay creates no duplicate history. */
export async function historyEvents(pmRoot: string, id: string): Promise<number> { return (await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8')).trim().split('\n').length; }
