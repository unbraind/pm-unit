/** Behavioral safeguard removals run only in disposable copies of emitted production functions. */
import { mkdtempSync, cpSync, symlinkSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';

const changes = [
  { name: 'exact normalization removed', file: 'kernel', pattern: /export function rational\(value\) \{[\s\S]*?\n\}/, replacement: 'export function rational(value) { return value; }', test: 'core', filter: 'rational properties' },
  { name: 'unit scaling removed', file: 'kernel', pattern: /return arithmetic\(arithmetic\(value, units\[from\]\.factor, 'multiply'\), units\[to\]\.factor, 'divide'\);/, replacement: 'return value;', test: 'core', filter: 'real ledger preserves' },
  { name: 'context compatibility removed', file: 'kernel', pattern: /export function incompatibility\(left, right\) \{[\s\S]*?\n\}/, replacement: 'export function incompatibility(left, right) { return null; }', test: 'core', filter: 'comparison refuses' },
  { name: 'native guard replaced by unconditional write', file: 'api', pattern: /const checked = await host\.client\.withExpectedItemRevisions\(\[\{ id: snapshot.id, itemHash: snapshot.revision \}\], \(\) => host\.client\.update\(snapshot.id, (\{[^\n]+\})\)\);/, replacement: 'const checked = { result: await host.client.update(snapshot.id, $1), checked: [snapshot.id], unchecked: [] };', test: 'concurrency', filter: 'before_update preserves' },
  { name: 'durable operation replay removed', file: 'api', pattern: /const found = state\.operations\.find\(row => row\.operation_id === op\);/, replacement: 'const found = undefined;', test: 'core', filter: 'real ledger preserves' },
  { name: 'SDK credential guard removed', file: 'schema', pattern: /scanMutationSecrets\(value\)\.length === 0/, replacement: 'true', test: 'core', filter: 'strict privacy' },
  { name: 'explicit caller revision check removed', file: 'api', pattern: /insist\(snapshot.revision === input.revision, 'revision_conflict', 'Caller revision is stale', 'Reread the owner and explicitly review the request'\)/, replacement: 'insist(true)', test: 'core', filter: 'real ledger preserves' },
  { name: 'immutable result fingerprint removed', file: 'kernel', pattern: /operation.result.digest === digest\(target\)/, replacement: 'true', test: 'contracts', filter: 'stored records reject' },
  { name: 'write budget reservation removed', file: 'commands', pattern: /^\s*fitEnvelope\(host, envelope\(\{ owner_id: id, revision: 'f'[^\n]+\n/m, replacement: '\n', test: 'contracts', filter: 'native harness' },
  { name: 'fatal UTF-8 decoding removed', file: 'commands', pattern: /fatal: true/, replacement: 'fatal: false', test: 'contracts', filter: 'bounded stdin' },
  { name: 'subtraction mislabeled as an observed level', file: 'kernel', pattern: /semantic_kind: `[^`]+`/, replacement: 'semantic_kind: left.semantic_kind', test: 'core', filter: 'unknowns and conservative' },
  { name: 'semantic identity fingerprint truncated', file: 'kernel', pattern: /digest\(\[left.semantic_kind, right.semantic_kind\]\)/, replacement: 'digest([left.semantic_kind, right.semantic_kind]).slice(0, 24)', test: 'core', filter: 'exact binary derivations' },
  { name: 'transitive derivation witnesses removed', file: 'api', pattern: /derivation_witnesses: witnesses/, replacement: 'derivation_witnesses: []', test: 'core', filter: 'exact binary derivations' },
  { name: 'native related identity normalization removed', file: 'api', pattern: /const related = \[\.\.\.new Set\(await Promise\.all\(submitted\.related\.map\([^\n]+\)\)\)\]\.sort\(\);/, replacement: 'const related = submitted.related;', test: 'core', filter: 'real ledger preserves' },
  { name: 'directory field routing reverted', file: 'host', pattern: /export function persistedSchemaPort\(client, dynamic = false\) \{[\s\S]*?\n\}/, replacement: 'export function persistedSchemaPort(client) { return { get: client.get.bind(client), readItemRevision: client.readItemRevision.bind(client), withExpectedItemRevisions: client.withExpectedItemRevisions.bind(client), listAllComplete: client.listAllComplete.bind(client), create: options => client.create(nativeOptions(options)), update: (id, options) => client.update(id, nativeOptions(options)) }; }', test: 'install.acceptance', filter: 'one captured artifact', mustMatch: 'invalid_argument_value' },
];
for (const change of changes) {
  const root = mkdtempSync(join(tmpdir(), 'unit-revert-'));
  try {
    for (const file of ['dist', 'test', 'scripts', 'docs', '.github', 'package.json', 'manifest.json', 'README.md', 'ARCHITECTURE.md', 'CHANGELOG.md', 'LICENSE', 'tsconfig.json', 'tsconfig.test.json']) cpSync(file, join(root, file), { recursive: true }); symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'dir');
    const file = join(root, `dist/src/${change.file}.js`); const source = readFileSync(file, 'utf8'); assert.match(source, change.pattern, `Mutation did not match ${change.name}`); writeFileSync(file, source.replace(change.pattern, change.replacement));
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', `--test-name-pattern=${change.filter}`, change.test.endsWith('.acceptance') ? `test/${change.test}.ts` : `test/${change.test}.test.ts`], { cwd: root, env: testEnvironment(npmEnvironment(process.env)), encoding: 'utf8', timeout: 120000 });
    assert.notEqual(result.status, 0, `Safeguard removal incorrectly passed: ${change.name}`); assert.match(result.stdout + result.stderr, /AssertionError|Missing expected rejection|Missing expected exception|UnitRefusal:/, `Failure must be behavioral: ${change.name}`); if ('mustMatch' in change && typeof change.mustMatch === 'string') assert.match(result.stdout + result.stderr, new RegExp(change.mustMatch)); console.log(`EXPECTED FAIL: ${change.name}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const restored = spawnSync(process.execPath, ['--test', '--test-concurrency=2', 'test/core.test.ts', 'test/contracts.test.ts'], { env: testEnvironment(npmEnvironment(process.env)), encoding: 'utf8', timeout: 120000 });
assert.equal(restored.status, 0, restored.stdout + restored.stderr); console.log(`revert-gate: ${changes.length} behavioral failures; unchanged implementation passes`);
