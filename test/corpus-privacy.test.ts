import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';

const privateRepositories = ['pm-observer', 'pm-web-hosted', 'pm-gpt'];
const guardedFiles = ['test/corpus.ts', 'test/fixtures/measurements.json', 'docs/real-data-receipt.json'];

/** Reject non-public citations without attempting to access the named repository. */
function checkPublicText(text: string) {
  for (const name of privateRepositories) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.ok(!new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(text), `Private fleet dependency: ${name}`);
  }
}

/** Walk syntax nodes without executing the harvester or importing its dependencies. */
function walk(value: unknown, visit: (node: Record<string, unknown>) => void) {
  if (Array.isArray(value)) { for (const child of value) walk(child, visit); return; }
  if (typeof value !== 'object' || value === null) return;
  const node = value as Record<string, unknown>; if (typeof node.type === 'string') visit(node);
  for (const [key, child] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) walk(child, visit);
}

/** Constrain all corpus read entry points, including Git acquisition and SDK roots. */
function checkReadBoundaries(source: string) {
  const tree = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  const compact = (text: string) => JSON.stringify(parse(text, { sourceType: 'module', plugins: ['typescript'], tokens: true }).tokens?.map(token => ({ type: typeof token.type === 'string' ? token.type : token.type.label, value: token.value })));
  const text = (node: Record<string, unknown>) => compact(source.slice(node.start as number, node.end as number));
  const imports: Record<string, string[]> = {
    'node:assert/strict': ['assert'],
    'node:fs/promises': ['mkdtemp', 'mkdir', 'rm', 'readFile', 'writeFile'],
    'node:path': ['join', 'resolve'], 'node:os': ['tmpdir'],
    'node:child_process': ['execFileSync'], 'node:crypto': ['createHash'],
    'node:url': ['fileURLToPath'],
    '@unbrained/pm-cli/sdk/core': ['PmClient'],
    '@unbrained/pm-cli/sdk/runtime': ['certifyCompleteListResult'],
  };
  const localImports = new Set(['../dist/index.js', '../dist/src/schema.js', '../scripts/inventory.ts', '../scripts/environment.ts']);
  const allowedCalls = [
    "readFile(join(corpusRoot, 'docs/policy-examples.md'), 'utf8')",
    "readFile(join(corpusRoot, 'test/fixtures/measurements.json'), 'utf8')",
    "readFile(join(corpusRoot, 'dist', path.replace(/\\.ts$/, '.js')))",
    "fileURLToPath(new URL('../', import.meta.url))",
    'runtimeSources(corpusRoot)',
    "resolve(corpusRoot, '..', repo)",
    "execFileSync('git', ['archive', revision, '.agents/pm'], { cwd: original, maxBuffer: 32 * 1024 * 1024, env: npmEnvironment(process.env) })",
    "execFileSync('tar', ['-x', '-C', copy], { input: archive })",
    'fetch(physicalSource.url, { signal: AbortSignal.timeout(20000) })',
    "new PmClient({ cwd: copy, pmRoot: join(copy, '.agents/pm'), noExtensions: true })",
    "new PmClient({ cwd: root, pmRoot, author: 'real-data', noExtensions: true })",
    "createDirectoryHost(pmRoot, 'real-data')",
  ].map(compact);
  const readNames = new Set(['readFile', 'resolve', 'fileURLToPath', 'runtimeSources', 'execFileSync', 'fetch', 'PmClient', 'createDirectoryHost']);
  const pathDeclarations = new Map(Object.entries({
    publicTrackers: "[{ repo: 'pm-vcs', revision: 'f2ab3c3412d87fbf766bc629b685a986b5400f61' }, { repo: 'pm-rl', revision: '962ac059ab8f6f8382dc93b1bc814cdc84b46fa8' },] as const",
    corpusRoot: "fileURLToPath(new URL('../', import.meta.url))",
    original: "resolve(corpusRoot, '..', repo)", copy: 'join(scratch, repo)',
    scratch: "await mkdtemp(join(tmpdir(), 'unit-public-'))",
    root: "await mkdtemp(join(tmpdir(), 'unit-real-data-'))", pmRoot: "join(root, '.agents/pm')",
  }).map(([name, expression]) => [name, compact(expression)]));
  const seenCalls: string[] = []; const seenPaths = new Set<string>(); let publicLoop = 0;
  walk(tree, node => {
    if (node.type === 'ImportDeclaration') {
      const module = (node.source as { value: string }).value;
      assert.ok(Object.hasOwn(imports, module) || localImports.has(module), `Unreviewed corpus import: ${module}`);
      if (Object.hasOwn(imports, module)) {
        const names = (node.specifiers as { local: { name: string }; imported?: { name: string } }[]).map(specifier => {
          const local = specifier.local.name; assert.equal(specifier.imported?.name ?? local, local, 'Read imports must not be aliased'); return local;
        });
        assert.deepEqual(names, imports[module], `Unreviewed read capabilities from ${module}`);
      }
    }
    assert.ok(node.type !== 'ImportExpression' && !(node.type === 'CallExpression' && (node.callee as { type: string }).type === 'Import'), 'Dynamic corpus imports are forbidden');
    if (['CallExpression', 'NewExpression'].includes(node.type as string)) {
      const callee = node.callee as { type: string; name?: string };
      assert.ok(!['require', 'eval', 'Function'].includes(callee.name ?? ''), 'Dynamic corpus capabilities are forbidden');
      if (callee.type === 'Identifier' && readNames.has(callee.name!)) seenCalls.push(text(node));
    }
    if (node.type === 'VariableDeclarator') {
      const name = (node.id as { name?: string }).name;
      if (name && pathDeclarations.has(name)) { assert.equal(text(node.init as Record<string, unknown>), pathDeclarations.get(name), `Read root must stay confined: ${name}`); seenPaths.add(name); }
    }
    if (node.type === 'ForOfStatement' && text(node.right as Record<string, unknown>) === compact('publicTrackers')) {
      const left = node.left as { start: number; end: number };
      assert.equal(source.slice(left.start, left.end).replace(/\s+/g, ''), 'const{repo,revision}'); publicLoop++;
    }
  });
  assert.deepEqual(seenCalls.sort(), allowedCalls.sort(), 'Corpus reads must use only the policy, fixture, emitted inventory and copied public trackers');
  assert.deepEqual([...seenPaths].sort(), [...pathDeclarations.keys()].sort()); assert.equal(publicLoop, 1);
}

test('public corpus guard rejects private fleet citations in every generated artifact and the harvester', async () => {
  for (const path of guardedFiles) checkPublicText(await readFile(path, 'utf8'));
  for (const name of privateRepositories) {
    for (const exact of [name, name.toUpperCase()]) assert.throws(() => checkPublicText(JSON.stringify({ source: `https://github.com/example/${exact}/blob/main/README.md` })), /Private fleet dependency/);
    for (const allowed of [`${name}-tools`, `tools-${name}`, `${name}_tools`]) checkPublicText(`https://github.com/example/${allowed}/README.md`);
  }
});

test('public corpus guard confines reads to copied public trackers and explicit repository inputs', async () => {
  const source = await readFile('test/corpus.ts', 'utf8'); checkReadBoundaries(source);
  for (const mutation of [
    source + "\nawait readFile('../unapproved/README.md', 'utf8');\n",
    source.replace('cwd: copy, pmRoot: join(copy', 'cwd: original, pmRoot: join(original'),
    source.replace("resolve(corpusRoot, '..', repo)", "resolve(corpusRoot, '..', 'unapproved')"),
    source.replace("repo: 'pm-vcs'", "repo: 'pm- vcs'"),
    source.replace("from 'node:fs/promises'", "from 'node:fs'"),
    source + "\nawait import('node:fs');\n",
  ]) assert.throws(() => checkReadBoundaries(mutation), /Corpus reads|confined|Unreviewed|Dynamic/);
});

test('public policy fixture and receipt pin the repository-owned policy bytes', async () => {
  const policy = await readFile('docs/policy-examples.md', 'utf8');
  const fixture = JSON.parse(await readFile('test/fixtures/measurements.json', 'utf8')) as { policy_examples: { source: string; sha256: string } };
  const receipt = JSON.parse(await readFile('docs/real-data-receipt.json', 'utf8')) as { external_source_anchors: { source: string; content_digest: string; item: { body: string } }[] };
  const expected = { source: 'https://github.com/unbraind/pm-unit/blob/5f0aeee30896065fd2a810497af3efcdec96e7b1/docs/policy-examples.md', sha256: createHash('sha256').update(policy).digest('hex') };
  assert.deepEqual(fixture.policy_examples, expected);
  const anchor = receipt.external_source_anchors.find(row => row.source === expected.source); assert.ok(anchor);
  assert.equal(anchor.content_digest, expected.sha256); assert.equal(anchor.item.body, `Public source: ${expected.source}\nContent SHA-256: ${expected.sha256}\n${policy}`.trimEnd());
});
