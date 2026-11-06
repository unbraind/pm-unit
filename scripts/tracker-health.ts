/** Gate the authoritative native health verdict without requiring optional Git integration. */
import { PmClient } from '@unbrained/pm-cli/sdk/core';

const result = await new PmClient({ pmRoot: '.agents/pm', cwd: process.cwd() }).health({ checkOnly: true, full: true, requireMergeDrivers: false });
console.log(JSON.stringify({ ok: result.ok, checks: result.checks.map(check => ({ name: check.name, ok: check.ok, status: check.status })), failed_because: result.failed_because, warnings: result.warnings }));
process.exitCode = result.ok ? 0 : 1;
