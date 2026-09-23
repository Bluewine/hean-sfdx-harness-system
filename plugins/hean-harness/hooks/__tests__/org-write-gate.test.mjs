#!/usr/bin/env node
/**
 * What the org write gate must let through, and what it must stop. Also checks
 * that org-roles.mjs saves what the gate reads, beside the commit format answer.
 *
 * Every run uses a throwaway HOME holding its own CLI logins, aliases and
 * default org, so the machine's real Salesforce CLI state is never read.
 *
 * Run: node hooks/__tests__/org-write-gate.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'org-write-gate.mjs');
const ROLES_SCRIPT = join(dirname(HOOKS), 'scripts', 'org-roles.mjs');

const sandbox = mkdtempSync(join(tmpdir(), 'org-gate-'));
const HOME = join(sandbox, 'home');
const write = (file, json) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(json)); };

// Three logins: a development sandbox, a QA sandbox, and one never saved.
const ORGS = { dev: '00D000000000001AAA', qa: '00D000000000002AAA', other: '00D000000000003AAA' };
for (const [alias, orgId] of Object.entries(ORGS)) {
  write(join(HOME, '.sfdx', `${alias}@example.com.json`), { username: `${alias}@example.com`, orgId, isSandbox: true });
}
write(join(HOME, '.sfdx', 'alias.json'), { orgs: Object.fromEntries(Object.keys(ORGS).map(a => [a, `${a}@example.com`])) });

/** An SFDX project with this CLI default and these saved roles. */
const project = (name, defaultOrg, orgs) => {
  const dir = join(sandbox, name);
  write(join(dir, 'sfdx-project.json'), { packageDirectories: [{ path: 'force-app' }] });
  if (defaultOrg) write(join(dir, '.sf', 'config.json'), { 'target-org': defaultOrg });
  if (orgs) write(join(dir, '.claude', 'hean-harness.json'), { commitFormat: 'on', orgs });
  return dir;
};
const SAVED = {
  [ORGS.dev]: { alias: 'dev', username: 'dev@example.com', role: 'development', deploy: true, branch: null },
  [ORGS.qa]: { alias: 'qa', username: 'qa@example.com', role: 'pipeline', deploy: false, branch: 'integration' }
};
const READY = project('ready', 'dev', SAVED);
const MOVED = project('moved', 'qa', SAVED);
const UNSAVED_DEFAULT = project('unsaved-default', 'other', SAVED);
const NO_ROLES = project('no-roles', 'dev', null);
const NOT_SFDX = join(sandbox, 'plain');
mkdirSync(NOT_SFDX);

const env = { ...process.env, HOME };
delete env.SF_TARGET_ORG;

/** Run the hook exactly as Claude Code does; the refusal text, or null when allowed. */
function refusal(command, cwd = READY) {
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
    encoding: 'utf8', env
  });
  if (!out.trim()) return null;
  const o = JSON.parse(out).hookSpecificOutput;
  return o?.permissionDecision === 'deny' ? o.permissionDecisionReason : null;
}

let pass = 0, fail = 0;
const check = (label, command, cwd, expect) => {
  const got = refusal(command, cwd);
  const ok = expect === null ? got === null : got !== null && expect.every(t => got.includes(t));
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}\n        ${JSON.stringify(command)}\n        expected ${expect === null ? 'allow' : `deny containing ${JSON.stringify(expect)}`}, got ${got === null ? 'allow' : JSON.stringify(got)}`);
};
const allow = (label, command, cwd) => check(label, command, cwd, null);
const deny = (label, command, cwd, ...texts) => check(label, command, cwd, texts);

console.log('Allowed');
allow('deploy to the saved deploy target',  'sf project deploy start --manifest m.xml');
allow('explicit -o to the deploy target',   'sf project deploy start -x m.xml -o dev');
allow('query on a pipeline org',            'sf data query -q "SELECT Id FROM Account" -o qa');
allow('retrieve on a pipeline org',         'sf project retrieve start -m ApexClass:Foo -o qa');
allow('tests on a pipeline org',            'sf apex run test -n FooTest -o qa');
allow('validate on a pipeline org',         'sf project deploy validate -x m.xml -o qa');
allow('dry run on a pipeline org',          'sf project deploy start -x m.xml --dry-run -o qa');
allow('package install report',             'sf package install report -i 0Hf -o qa');
allow('org not logged in here',             'sf project deploy start -x m.xml -o ghost');
allow('outside an SFDX project',            'sf project deploy start -x m.xml -o qa', NOT_SFDX);
allow('not an sf command',                  'echo sf project deploy start -o qa');

console.log('Refused');
deny('deploy to a pipeline org',            'sf project deploy start -x m.xml -o qa', READY, 'saved as pipeline', 'integration branch', 'dev (dev@example.com)');
deny('--target-org= form',                  'sf project deploy start --target-org=qa', READY, 'saved as pipeline');
deny('-oalias form',                        'sf project deploy start -oqa', READY, 'saved as pipeline');
deny('older -u flag',                       'sfdx force source delete -m ApexClass:Foo -u qa', READY, 'saved as pipeline');
deny('colon-separated command',             'sf project:deploy:start -o qa', READY, 'saved as pipeline');
deny('npx sf',                              'npx sf apex run -f x.apex -o qa', READY, 'saved as pipeline');
deny('data write',                          'sf data update record -s Account -i 001 -v "Name=x" -o qa', READY, 'saved as pipeline');
deny('permset assignment',                  'sf org assign permset -n Foo -o qa', READY, 'saved as pipeline');
deny('second command writes',               'sf data query -q "x" -o qa && sf apex run -f x.apex -o qa', READY, 'saved as pipeline');
deny('SF_TARGET_ORG in the command',        'SF_TARGET_ORG=qa sf project deploy start -x m.xml', READY, 'saved as pipeline');
deny('alias as a shell variable',           'sf project deploy start -x m.xml -o "$ORG_ALIAS"', READY, 'cannot read');
deny('explicit org with no saved role',     'sf project deploy start -x m.xml -o other', READY, 'has no saved role', 'org-roles.md');
deny('no roles saved in the project',       'sf project deploy start -x m.xml', NO_ROLES, 'No org roles are saved');
deny('cd into a project first',             `cd ${NO_ROLES} && sf project deploy start -x m.xml`, NOT_SFDX, 'No org roles are saved');
deny('pre/post deploy script',              'bash .claude/scripts/jenkins-pre-post-deploy.sh pre --org qa', READY, 'saved as pipeline');

console.log('CLI default moved');
deny('default moved to a pipeline org',     'sf project deploy start -x m.xml', MOVED, '!! The CLI default org is now qa', 'dev (dev@example.com)', 'saved as pipeline');
deny('default moved to an unsaved org',     'sf project deploy start -x m.xml', UNSAVED_DEFAULT, '!! The CLI default org is now other', 'has no saved role');
allow('explicit -o overrides a moved default', 'sf project deploy start -x m.xml -o dev', MOVED);
allow('pre/post script to the deploy target', 'bash .claude/scripts/jenkins-pre-post-deploy.sh both --org dev', MOVED);
const flagged = refusal('sf project deploy start -x m.xml -o qa', MOVED);
flagged !== null && !flagged.includes('!!') ? pass++ : (fail++, console.log('  FAIL  an explicit -o must not report a moved default'));

console.log('Saving roles');
const run = (...args) => execFileSync('node', [ROLES_SCRIPT, ...args], { cwd: NO_ROLES, env, encoding: 'utf8' });
run('set', 'dev', '--role', 'development', '--deploy', 'yes');
allow('allowed once the deploy target is saved', 'sf project deploy start -x m.xml', NO_ROLES);
run('set', 'qa', '--role', 'pipeline', '--deploy', 'no', '--branch', 'integration');
deny('pipeline org saved with deploy no', 'sf project deploy start -x m.xml -o qa', NO_ROLES, 'fed by the integration branch');
const saved = JSON.parse(readFileSync(join(NO_ROLES, '.claude', 'hean-harness.json'), 'utf8'));
saved.orgs[ORGS.dev]?.deploy === true && saved.orgs[ORGS.qa]?.branch === 'integration' ? pass++
  : (fail++, console.log(`  FAIL  saved roles: ${JSON.stringify(saved)}`));
run('remove', 'qa');
const afterRemove = JSON.parse(readFileSync(join(NO_ROLES, '.claude', 'hean-harness.json'), 'utf8'));
!afterRemove.orgs[ORGS.qa] && afterRemove.orgs[ORGS.dev] ? pass++ : (fail++, console.log('  FAIL  remove dropped the wrong org'));
const keptFormat = JSON.parse(readFileSync(join(READY, '.claude', 'hean-harness.json'), 'utf8'));
execFileSync('node', [ROLES_SCRIPT, 'set', 'other', '--role', 'research', '--deploy', 'no'], { cwd: READY, env });
JSON.parse(readFileSync(join(READY, '.claude', 'hean-harness.json'), 'utf8')).commitFormat === keptFormat.commitFormat ? pass++
  : (fail++, console.log('  FAIL  saving a role dropped the commit format answer'));

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
