/** Prove the package tarball has only public allowlisted text assets. */
import { runtimeSources } from './inventory.ts';
import { spawnSync } from 'node:child_process';
import { npmEnvironment } from './environment.ts';
const result = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { env: npmEnvironment(process.env), encoding: 'utf8' });
if (result.status !== 0) throw new Error('Package enumeration failed');
const packs = JSON.parse(result.stdout) as { files: { path: string }[] }[];
const files = packs[0].files.map(file => file.path);
const sources=runtimeSources();
const emitted=new Set(sources.flatMap(name=>['.js','.js.map','.d.ts','.d.ts.map'].map(extension=>`dist/${name.slice(0,-3)}${extension}`)));
for(const file of files)if(file.startsWith('dist/')&&!emitted.has(file))throw new Error('Tarball contains a stale or undeclared emitted source');
const publicAssets = new Set(['package.json', 'manifest.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'ARCHITECTURE.md', 'docs/real-data.md', 'docs/policy-examples.md', 'docs/real-data-receipt.json']);
for (const file of files) if (!emitted.has(file) && !publicAssets.has(file)) throw new Error(`Package allowlist failed: ${file}`);
if (!files.includes('dist/index.js')) throw new Error('Package entrypoint is missing');
console.log(`pack-gate: ${files.length} allowlisted files`);
