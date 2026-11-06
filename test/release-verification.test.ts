import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { verify } from 'pm-ops/attestation';
import { npmEnvironment } from '../scripts/environment.ts';

for(const state of ['QUEUED','FAILURE'])test(`archived release refuses a ${state.toLowerCase()} required check`,()=>{
  const root=mkdtempSync(join(tmpdir(),'unit-release-'));
  try{
    const workflow=readFileSync('.github/workflows/release.yml','utf8');assert.deepEqual(verify(process.cwd()).failures,[]);
    const start=workflow.indexOf('          deadline=$(( SECONDS + 1800 ))');const end=workflow.indexOf('          rm -f "$merge_err" "$pr_view_err"',start);assert.ok(start>0&&end>start);
    const loop=workflow.slice(start,end).replace(/^ {10}/gm,'').replace('deadline=$(( SECONDS + 1800 ))','deadline=$SECONDS');
    writeFileSync(join(root,'checks.json'),JSON.stringify({mergeStateStatus:'BLOCKED',statusCheckRollup:[{name:'CI',status:state==='QUEUED'?'QUEUED':'COMPLETED',conclusion:state==='FAILURE'?'FAILURE':null}]}));
    const script=`set -euo pipefail\nowner=example\nrepo=pm-unit\npr_number=1\nrelease_commit=fixture\nGITHUB_REPOSITORY=example/pm-unit\nGITHUB_SERVER_URL=https://example.org\nfunction gh(){ if [[ "$1" == pr && "$2" == view ]]; then local filter="\u0024{!#}"; jq "$filter" checks.json; elif [[ "$1" == api && "\u0024{2:-}" == --method && "\u0024{3:-}" == PUT ]]; then echo 'required check not successful' >&2; return 1; fi; }\n${loop}\nprintf 'UNEXPECTED_PUBLICATION'\n`;
    const result=spawnSync('bash',['-c',script],{cwd:root,env:npmEnvironment(process.env),encoding:'utf8',timeout:10000});assert.notEqual(result.status,0);assert.match(result.stdout,/CI/);assert.match(result.stdout,/not merging or publishing/);assert.doesNotMatch(result.stdout,/UNEXPECTED_PUBLICATION/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('a failed release gate cannot reach the archived publishing handoff',()=>{
  const workflow=readFileSync('.github/workflows/release.yml','utf8');const checked=workflow.match(/- name: Run release checks[\s\S]*?run: ([^\n]+)/)?.[1];assert.equal(checked,'npm run release:check');
  const script=`set -euo pipefail\nfunction npm(){ if [[ "$1" == run && "$2" == release:check ]]; then return 1; fi; echo UNEXPECTED_PUBLICATION; }\n${checked}\nnpm publish ./release-artifact/package.tgz --provenance --ignore-scripts\n`;
  const result=spawnSync('bash',['-c',script],{env:npmEnvironment(process.env),encoding:'utf8'});assert.notEqual(result.status,0);assert.doesNotMatch(result.stdout,/UNEXPECTED_PUBLICATION/);
  assert.match(workflow,/needs: prepare/);assert.doesNotMatch(workflow,/if:.*always\(\)/);
});
