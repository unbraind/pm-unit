/** Check real event commit identities and tracked content without revealing private matches. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gitEnvironment } from './environment.ts';
const env = { ...gitEnvironment(process.env), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const approved = new Set(readFileSync('.github/approved-git-identities.txt','utf8').split('\n').filter(line=>line !== '' && !line.startsWith('#')));
if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8', env }).trim() === 'true') throw new Error('Shallow clone: the identity audit needs full history. Run git fetch --unshallow, then rerun the check.');
let revisions = ['HEAD'];
// GitHub's PR checkout is a synthetic merge whose author is outside this branch's policy.
// Scope the audit to the real event head, including every side-branch commit after the fork.
if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8')) as { pull_request: { base: { sha: string }; head: { sha: string } } };
  const { base, head } = event.pull_request;
  if (![base.sha, head.sha].every(sha => /^[a-f0-9]{40}$/i.test(sha))) throw new Error('Invalid PR commit range');
  const fork = execFileSync('git', ['merge-base', base.sha, head.sha], { encoding: 'utf8', env }).trim();
  revisions = [`${fork}..${head.sha}`];
} else if (process.env.GITHUB_EVENT_NAME === 'push') {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8')) as { before: string; after: string };
  if (![event.before, event.after].every(sha => /^[a-f0-9]{40}$/i.test(sha))) throw new Error('Invalid push commit range');
  revisions = event.before === '0'.repeat(40) ? [event.after] : [`${event.before}..${event.after}`];
}
const identities = execFileSync('git', ['log', '--format=%ae%x00%cn%x00%ce', ...revisions], { encoding: 'utf8', env }).trim().split('\n').filter(Boolean);
for (const identity of identities) {
  const [author, committerName, committer] = identity.split('\0');
  if (!approved.has(author) || author === 'noreply@github.com' || !approved.has(committer) || (committer === 'noreply@github.com' && committerName !== 'GitHub')) throw new Error('Unapproved commit identity');
}
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', env }).split('\0').filter(Boolean);
for (const file of files) if (/(?:[\\/](?:home|Users)[\\/]|[\\/]root[\\/])/iu.test(readFileSync(file, 'utf8'))) throw new Error(`Private path policy failed in ${file}`);
console.log(`identity-gate: ${identities.length} commits, ${files.length} tracked files, zero violations`);
