/** Contracts for deep gate isolation and executable-file CI routing. */
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseDocument } from 'yaml';

/** Workflow fields exercised by the tier contracts. */
interface Workflow {
  on: Record<string, { paths?: string[]; 'paths-ignore'?: string[] }>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, {
    name?: string;
    'runs-on': string;
    'timeout-minutes': number;
    env?: Record<string, string | number>;
    strategy?: { matrix: Record<string, (string | number)[]> };
    steps: { uses?: string; if?: string; run?: string; with?: Record<string, string> }[];
  }>;
}

/** Parse strictly so duplicate keys cannot silently replace gates. */
function workflow(name: string): Workflow {
  const document = parseDocument(readFileSync(`.github/workflows/${name}.yml`, 'utf8'), { uniqueKeys: true, strict: true });
  assert.deepEqual(document.errors, []);
  return document.toJS() as Workflow;
}

const extensions = ['mjs', 'cjs', 'js', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'sh'];

test('deep jobs retain all four full gates without cancelling active runs', () => {
  const deep = workflow('ci-deep');
  assert.equal(deep.concurrency['cancel-in-progress'], false);
  assert.equal(deep.concurrency.group, 'ci-deep-${{ github.ref }}');
  const job = deep.jobs.deep;
  assert.equal(job.name, 'deep (${{ matrix.node-version }}, ${{ matrix.package-manager }})');
  assert.deepEqual(job.strategy?.matrix, { 'node-version': [22, 26], 'package-manager': ['npm', 'bun'] });
  assert.equal(job.env?.PM_TEST_DEPTH, 'full');
  assert.equal(job.env?.PM_TEST_TIME_SCALE, 3);
  assert.equal(job['timeout-minutes'], 120);
  assert.equal(job['runs-on'], "${{ vars.PM_LOCAL_DEEP != 'off' && fromJSON('[\"self-hosted\",\"pm-local\"]') || 'ubuntu-latest' }}");
  const gates = job.steps.filter(step => /\b(?:npm|bun) run release:check\b/u.test(step.run ?? ''));
  assert.equal(gates.length, 2);
  for (const manager of ['npm', 'bun']) {
    const selected = gates.filter(step => step.if === `matrix.package-manager == '${manager}'`);
    assert.equal(selected.length, 1, `one full gate for ${manager}`);
    assert.equal(selected[0].run, `${manager} run release:check`);
  }
  const node = job.steps.find(step => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(node?.with?.cache, "${{ runner.environment == 'github-hosted' && 'npm' || '' }}");
  const bun = job.steps.find(step => step.uses?.startsWith('oven-sh/setup-bun@'));
  assert.equal(bun?.if, "runner.environment == 'github-hosted'");
  assert.ok(job.steps.some(step => step.run === 'bun --version'));
});

test('every PR detector routes executable tracker and docs paths to code', () => {
  const ci = workflow('ci');
  const detectors = Object.values(ci.jobs).flatMap(job => job.steps).filter(step => step.run?.includes('case "$path" in'));
  assert.ok(detectors.length > 0);
  const codePaths = extensions.flatMap(extension => [
    `.agents/pm/tool.${extension}`, `.agents/pm/nested/tool.${extension}`,
    `docs/tool.${extension}`, `docs/nested/tool.${extension}`,
  ]);
  codePaths.push('.agents/pm/extensions/plugin/manifest.json', '.agents/pm/extensions/README.md', 'src/index.ts');
  for (const detector of detectors) {
    const cases = detector.run?.match(/case "\$path" in[\s\S]*?esac/u)?.[0];
    assert.ok(cases);
    for (const [expected, paths] of [['true', codePaths], ['false', ['.agents/pm/tasks/item.toon', '.agents/pm/history/item.jsonl', 'README.md', 'docs/guide.md', 'LICENSE']]] as const) {
      for (const path of paths) {
        const result: SpawnSyncReturns<string> = spawnSync('bash', ['-c', `path=$1\ncode=false\n${cases}\nprintf '%s' "$code"`, 'classifier', path], { encoding: 'utf8', timeout: 5000 });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, expected, path);
      }
    }
  }
});

test('required CodeQL remains unfiltered for PR and main events', () => {
  const codeql = workflow('codeql');
  for (const event of ['push', 'pull_request']) {
    assert.equal(codeql.on[event].paths, undefined);
    assert.equal(codeql.on[event]['paths-ignore'], undefined);
  }
});
