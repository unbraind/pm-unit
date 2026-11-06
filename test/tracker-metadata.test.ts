import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PmClient } from '@unbrained/pm-cli/sdk/core';

test('comparison follow-up is discoverable by each individual tag', async t => {
  const root = await mkdtemp(join(tmpdir(), 'unit-metadata-')); t.after(() => rm(root, { recursive: true, force: true }));
  const pmRoot = join(root, '.agents/pm'); const client = new PmClient({ cwd: root, pmRoot, noExtensions: true });
  await client.init('pm-unit', { defaults: true, agentGuidance: 'skip', mergeFence: false });
  const id = 'pm-unit-2h1z';
  for (const path of [`features/${id}.toon`, `history/${id}.jsonl`]) {
    await mkdir(join(pmRoot, path.split('/')[0]), { recursive: true });
    await copyFile(new URL(`../.agents/pm/${path}`, import.meta.url), join(pmRoot, path));
  }
  const got = await client.get(id, { outputInclude: 'full', outputBudget: 'unbounded', outputLimit: 'unbounded' });
  assert.ok('item' in got); assert.ok(got.item.tags);
  assert.deepEqual([...got.item.tags].sort(), ['agents', 'compare', 'manual-test']);
  for (const tag of ['agents', 'compare', 'manual-test']) {
    const filtered = await client.list({ tag, excludeTerminal: false, full: true, noTruncate: true, strictRead: true, outputBudget: 'unbounded', outputLimit: 'unbounded' });
    assert.ok('items' in filtered && filtered.items.some(item => item.id === id), `Missing independent tag: ${tag}`);
  }
});
