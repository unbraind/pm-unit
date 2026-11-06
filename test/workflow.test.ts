import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { decideDailyRelease } from 'pm-ops/daily-release';
import { verify } from 'pm-ops/attestation';
import { fixture } from './helpers.ts';
import { npmEnvironment } from '../scripts/environment.ts';

test('CI health accepts a plain tracker but rejects corrupt native history',async t=>{
  const {root,pmRoot,id}=await fixture(t);const script=resolve('scripts/tracker-health.ts');
  const env={...npmEnvironment(process.env),PM_PATH:pmRoot,PM_AUTHOR:'fixture',HOME:root,GIT_CEILING_DIRECTORIES:root};
  const accepted=spawnSync(process.execPath,[script],{cwd:root,env,encoding:'utf8',timeout:30000});assert.equal(accepted.status,0,accepted.stderr);assert.equal(JSON.parse(accepted.stdout).ok,true);
  appendFileSync(join(pmRoot,'history',`${id}.jsonl`),'not-json\n');
  const refused=spawnSync(process.execPath,[script],{cwd:root,env,encoding:'utf8',timeout:30000});assert.equal(refused.status,1,refused.stderr);const result=JSON.parse(refused.stdout);assert.equal(result.ok,false);assert.match(result.failed_because.join(','),/history/,JSON.stringify(result.failed_because));
  assert.match(readFileSync('.github/workflows/ci.yml','utf8'),/run: npm run tracker:health/);
});

test('daily release remains main-only and approval-gated with exact archived provenance publishing',()=>{
  const workflow=readFileSync('.github/workflows/release.yml','utf8');assert.match(workflow,/schedule:/);assert.match(workflow,/workflow_dispatch:/);
  assert.equal((workflow.match(/if: github.ref == 'refs\/heads\/main' && vars.PM_RELEASE_APPROVED == 'true'/g)??[]).length,3);
  const publishes=[...workflow.matchAll(/^\s*npm publish\s+(\S+)([^\n]*)/gm)];assert.equal(publishes.length,1);assert.equal(publishes[0][1],'./release-artifact/package.tgz');assert.match(publishes[0][2],/--provenance --ignore-scripts/);
  assert.match(workflow,/sha256sum --check --strict/);assert.match(workflow,/npm run release:check/);assert.match(workflow,/npm run release:notes/);assert.match(workflow,/id-token: write/);
  // Only active (non-comment) lines count. The caller pins a pm-github release commit by full SHA with
  // its version comment; Dependabot updates both. The deprecated pm-github-version fallback stays absent.
  const syncLines=readFileSync('.github/workflows/pm-github-sync.yml','utf8').split('\n').filter(line=>!/^\s*#/.test(line));
  const syncCallers=syncLines.filter(line=>/^\s*uses:\s*unbraind\/pm-github\/\.github\/workflows\/pm-github-sync\.yml@/.test(line));
  assert.equal(syncCallers.length,1,'exactly one active pm-github sync caller');
  assert.match(syncCallers[0],/^\s*uses:\s*unbraind\/pm-github\/\.github\/workflows\/pm-github-sync\.yml@[0-9a-f]{40} # pm-github \d{4}\.\d{2}\.\d{2}\s*$/);
  // Any active mention counts (block, flow, quoted or spaced keys); trailing comments are stripped first.
  assert.equal(syncLines.some(line=>line.replace(/\s#.*$/,'').includes('pm-github-version')),false,'the deprecated pm-github-version input must not be set');
  assert.deepEqual(verify(process.cwd()).failures,[]);
});
test('canonical pm-ops release planner covers no-change dependency-only collision and stale PR decisions',()=>{
  const base={existingPrs:[],mainSha:'a'.repeat(40),lastRelease:{tag:'v2026.11.4',sha:'b'.repeat(40)},today:'2026.11.5',hasChanges:true,releaseTags:['v2026.11.4']};
  const unchanged=decideDailyRelease({...base,hasChanges:false});assert.equal(unchanged.should_release,false);
  const dependency=decideDailyRelease(base);assert.equal(dependency.should_release,true);assert.equal(dependency.npm_version,'2026.11.5');
  const collision=decideDailyRelease({...base,releaseTags:['v2026.11.4','v2026.11.5'],publishedToday:true});assert.equal(collision.should_release,false);
  const stale=decideDailyRelease({...base,existingPrs:[{number:4,headRefName:'release/v2026.11.4',isCrossRepository:false,author:{login:'github-actions[bot]'}}]});assert.equal(stale.base_sha,base.mainSha);
  // The archived handoff is published only after the complete gate succeeds.
  const workflow=readFileSync('.github/workflows/release.yml','utf8');assert.match(workflow,/needs.prepare.outputs.should_release == 'true'/);assert.match(workflow,/steps.publish.outcome == 'success'/);assert.ok(workflow.indexOf('npm run release:check')<workflow.indexOf('npm publish ./release-artifact/package.tgz'));
});
