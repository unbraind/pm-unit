/** Independently instrument every emitted production statement, branch and function. */
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import instrumentLibrary from 'istanbul-lib-instrument';
import coverageLibrary from 'istanbul-lib-coverage';
import reportLibrary from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import { runtimeSources } from './inventory.ts';
import { npmEnvironment, testEnvironment } from './environment.ts';

const root = process.cwd(); const output = join(root, 'coverage');
rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true });
const manifest = JSON.parse(readFileSync('package.json','utf8')) as { coverageGate: { thresholds: Record<string,number>; ignore: string[] } };
if (['statements','branches','functions','lines'].some(dimension => manifest.coverageGate.thresholds[dimension] !== 100) || manifest.coverageGate.ignore.length !== 0) throw new Error('Coverage policy must require exactly 100 percent without ignores');
const source = runtimeSources();
const files = source.map(name => resolve('dist', name.replace(/\.ts$/, '.js')));
const emitted = readdirSync('dist',{recursive:true}).map(String).filter(name=>name.endsWith('.js')).map(name=>resolve('dist',name));
if (emitted.length !== files.length || emitted.some(file=>!files.includes(file))) throw new Error('Emitted source inventory differs from the authored source tree; clean and rebuild');
const originals = new Map(files.map(file => [file, readFileSync(file, 'utf8')]));
const instrumenter = instrumentLibrary.createInstrumenter({ esModules: true, produceSourceMap: false });
try {
  for (const [file, code] of originals) {
    if (/istanbul ignore|c8 ignore|v8 ignore/i.test(code)) throw new Error('Coverage ignores are forbidden');
    writeFileSync(file, instrumenter.instrumentSync(code, file));
  }
  const preload = join(output, 'collect.mjs');
  writeFileSync(preload, "import {writeFileSync} from 'node:fs';process.on('exit',()=>writeFileSync(new URL('./raw-'+process.pid+'.json',import.meta.url),JSON.stringify(globalThis.__coverage__||{})));\n");
  const result = spawnSync(process.execPath, ['--import', preload, '--test', '--test-concurrency=2', '--test-reporter=spec', ...readdirSync('test').filter(name => name.endsWith('.test.ts')).map(name => `test/${name}`)], { cwd: root, env: testEnvironment(npmEnvironment(process.env)), encoding:'utf8',maxBuffer:8*1024*1024 });
  process.stdout.write(result.stdout);process.stderr.write(result.stderr);
  const count=result.stdout.match(/^(?:ℹ |# )tests (\d+)\s*$/m);
  if (count === null || Number(count[1]) === 0 || /^(?:ℹ |# )(?:skipped|todo|cancelled) [1-9]/m.test(result.stdout)) throw new Error('A complete nonzero unskipped test run is required');
  if (result.status !== 0) throw new Error('Coverage tests failed');
  const map = coverageLibrary.createCoverageMap({});
  for (const file of readdirSync(output).filter(name => /^raw-.*\.json$/.test(name))) map.merge(JSON.parse(readFileSync(join(output, file), 'utf8')));
  for (const file of files) if (!map.files().includes(file)) throw new Error('A production source is absent from the report');
  const summary = map.getCoverageSummary().toJSON();
  const dimensions = ['statements', 'branches', 'functions', 'lines'] as const;
  reports.create('json').execute(reportLibrary.createContext({ dir: output, coverageMap: map }));
  reports.create('text').execute(reportLibrary.createContext({ dir: output, coverageMap: map }));
  writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  if (dimensions.some(dimension => summary[dimension].total === 0 || summary[dimension].covered !== summary[dimension].total)) throw new Error('Exactly 100 percent in every dimension is required');
  console.log(`coverage-gate: ${files.length} emitted files; independent counters all covered`);
} finally {
  for (const [file, code] of originals) writeFileSync(file, code);
}
