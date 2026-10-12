#!/usr/bin/env node
/**
 * Which new Apex classes and LWC folders the naming check refuses.
 *
 * Each case runs the hook exactly as Claude Code does, with the tool call on
 * standard input, against a throwaway SFDX project with a saved naming answer.
 *
 * Run: node hooks/__tests__/naming-check.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'naming-check.mjs');
const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'naming-check-')));

function project(name, naming) {
  const root = join(sandbox, name);
  mkdirSync(join(root, 'force-app', 'main', 'default', 'classes'), { recursive: true });
  mkdirSync(join(root, 'force-app', 'main', 'default', 'lwc', 'abcExistingUk'), { recursive: true });
  writeFileSync(join(root, 'force-app', 'main', 'default', 'classes', 'LegacyThing.cls'), '');
  writeFileSync(join(root, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }));
  if (naming !== undefined) {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'hean-harness.json'), typeof naming === 'string' ? naming : JSON.stringify({ naming }));
  }
  return root;
}
const BOTH = { apex: { use: true, prefix: 'ABC_', suffix: '_UK' }, lwc: { use: true, prefix: 'abc', suffix: 'Uk' } };
const P = project('both', BOTH);
writeFileSync(join(P, 'force-app', 'main', 'default', 'classes', 'OnlyMeta.cls-meta.xml'), '');
mkdirSync(join(P, 'force-app', 'main', 'default', 'classes', 'svc'), { recursive: true });
writeFileSync(join(P, 'force-app', 'main', 'default', 'classes', 'svc', 'OldNested.cls'), '');
const DOT = project('dot', { apex: BOTH.apex, lwc: BOTH.lwc });
writeFileSync(join(DOT, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: './force-app/' }] }));
const NO = project('no', { apex: { use: false }, lwc: { use: false } });
const NONE = project('none');
const BROKEN = project('broken', '{ not json');
const PLAIN = join(sandbox, 'plain');
mkdirSync(PLAIN);

const cls = (root, name, ext = '.cls') => join(root, 'force-app', 'main', 'default', 'classes', `${name}${ext}`);
const lwcFile = (root, name, file) => join(root, 'force-app', 'main', 'default', 'lwc', name, file);

/** The refusal text, or null when allowed. */
function refusal(input) {
  const out = execFileSync('node', [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
  if (!out.trim()) return null;
  const o = JSON.parse(out).hookSpecificOutput;
  return o?.permissionDecision === 'deny' ? o.permissionDecisionReason : null;
}
const write = (file, cwd = P) => ({ tool_name: 'Write', tool_input: { file_path: file, content: '' }, cwd });
const bash = (command, cwd = P) => ({ tool_name: 'Bash', tool_input: { command }, cwd });

let failures = 0;
const check = (label, got, expectDeny, ...texts) => {
  const ok = expectDeny ? got !== null && texts.every(t => got.includes(t)) : got === null;
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)}`}`);
  if (!ok) failures++;
};

try {
  console.log('Apex');
  check('matching new class', refusal(write(cls(P, 'ABC_AccountService_UK'))), false);
  check('matching new test class', refusal(write(cls(P, 'ABC_AccountService_UKTest'))), false);
  check('new class without prefix', refusal(write(cls(P, 'AccountService_UK'))), true, 'ABC_AccountService_UK', 'naming.apex', 'avoid Test at the end of a production name');
  check('new meta file without suffix', refusal(write(cls(P, 'ABC_AccountService', '.cls-meta.xml'))), true, 'ABC_AccountService_UK');
  check('prefix case is exact', refusal(write(cls(P, 'abc_AccountService_UK'))), true);
  const nested = (name, ext = '.cls') => join(P, 'force-app', 'main', 'default', 'classes', 'svc', `${name}${ext}`);
  check('nested class, wrong name refused', refusal(write(nested('Bad'))), true, 'ABC_Bad_UK');
  check('nested class, matching name allowed', refusal(write(nested('ABC_Good_UK'))), false);
  check('nested existing class allowed', refusal(write(nested('OldNested'))), false);
  const askUser = refusal(write(nested('Bad')));
  check('refusal tells the agent to ask the user, not change the answer', askUser?.includes('Only the user changes the saved answer') === true && !askUser.includes('to change the answer, run'), askUser);
  check('existing class is never refused', refusal(write(cls(P, 'LegacyThing'))), false);
  check('a .cls outside a package folder', refusal(write(join(P, 'scripts', 'apex', 'Foo.cls'))), false);
  console.log('LWC');
  check('new matching component', refusal(write(lwcFile(P, 'abcAccountPickerUk', 'abcAccountPickerUk.js'))), false);
  check('new component without prefix', refusal(write(lwcFile(P, 'accountPicker', 'accountPicker.js'))), true, 'abcAccountPickerUk', 'naming.lwc');
  check('new component created through its test file', refusal(write(lwcFile(P, 'accountPicker', '__tests__/accountPicker.test.js'))), true);
  check('file in an existing component', refusal(write(lwcFile(P, 'abcExistingUk', 'helper.js'))), false);
  console.log('Commands');
  check('sf apex generate class, wrong name', refusal(bash('sf apex generate class --name AccountService --output-dir force-app/main/default/classes')), true, 'ABC_AccountService_UK');
  check('sf apex generate class -n, right name', refusal(bash('sf apex generate class -n ABC_AccountService_UK')), false);
  check('sfdx force:apex:class:create, wrong name', refusal(bash('sfdx force:apex:class:create -n AccountService')), true);
  check('sf lightning generate component --type lwc, wrong name', refusal(bash('sf lightning generate component --name accountPicker --type lwc')), true, 'abcAccountPickerUk');
  check('sf lightning generate component without --type (Aura default)', refusal(bash('sf lightning generate component --name accountPicker')), false);
  check('unrelated command', refusal(bash('ls force-app')), false);
  console.log('Fix round 1');
  check('meta file beside an existing class', refusal(write(cls(P, 'LegacyThing', '.cls-meta.xml'))), false);
  check('class beside an existing meta file', refusal(write(cls(P, 'OnlyMeta'))), false);
  check('sf template generate apex class', refusal(bash('sf template generate apex class --name AccountService')), true, 'ABC_AccountService_UK');
  check('sf template generate lightning component lwc', refusal(bash('sf template generate lightning component --type lwc --name accountPicker')), true, 'abcAccountPickerUk');
  check('package path with ./ and trailing slash', refusal(write(cls(DOT, 'AccountService'), DOT)), true, 'ABC_AccountService_UK');
  check('-d outside a package folder', refusal(bash('sf apex generate class -n AccountService -d scripts/apex')), false);
  check('-d inside a package folder', refusal(bash('sf apex generate class -n AccountService -d force-app/main/default/classes')), true);
  check('-d resolved from the command folder', refusal(bash('cd force-app && sf apex generate class -n AccountService -d main/default/classes')), true);
  check('npx sf', refusal(bash('npx sf apex generate class -n AccountService')), true);
  check('absolute path sf', refusal(bash('/usr/local/bin/sf apex generate class -n AccountService')), true);
  check('command sfdx', refusal(bash('command sfdx force:apex:class:create -n AccountService')), true);
  check('lwc under staticresources', refusal(write(join(P, 'force-app', 'main', 'default', 'staticresources', 'lib', 'lwc', 'newUtil', 'x.js'))), false);
  check('mkdir new lwc folder', refusal(bash('mkdir force-app/main/default/lwc/accountPicker')), true, 'abcAccountPickerUk');
  check('mkdir -p new lwc folder', refusal(bash('mkdir -p force-app/main/default/lwc/accountPicker/__tests__')), true);
  check('mkdir matching lwc folder', refusal(bash('mkdir -p force-app/main/default/lwc/abcAccountPickerUk')), false);
  check('mkdir __mocks__ at lwc level', refusal(bash('mkdir -p force-app/main/default/lwc/__mocks__')), false);
  check('mkdir __tests__ at lwc level', refusal(bash('mkdir force-app/main/default/lwc/__tests__')), false);
  check('mkdir brace expansion skipped', refusal(bash('mkdir -p force-app/main/default/lwc/{abcOne,abcTwo}')), false);
  check('mkdir existing lwc folder', refusal(bash('mkdir -p force-app/main/default/lwc/abcExistingUk')), false);
  check('mkdir elsewhere', refusal(bash('mkdir -p scripts/lwc/foo')), false);
  console.log('No check');
  check('use no', refusal(write(cls(NO, 'Anything'))), false);
  check('nothing saved', refusal(write(cls(NONE, 'Anything'))), false);
  check('unreadable settings', refusal(write(cls(BROKEN, 'Anything'))), false);
  check('outside an SFDX project', refusal(write(join(PLAIN, 'classes', 'Foo.cls'), PLAIN)), false);
  check('bad input JSON', refusal('not json'), false);
  check('another tool', refusal({ tool_name: 'Read', tool_input: { file_path: cls(P, 'Foo') }, cwd: P }), false);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
