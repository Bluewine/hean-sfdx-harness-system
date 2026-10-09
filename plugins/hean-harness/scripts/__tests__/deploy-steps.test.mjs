#!/usr/bin/env node
/**
 * How deploy-steps.mjs reads deploy.yml and which step each runbook path
 * needs, for the four deploy.yml shapes the client repositories use.
 *
 * The fixtures are those repositories' deploy.yml files as their integration
 * branches held them on 2026-10-08, each named by the steps it lists. Only a
 * throwaway folder is written.
 *
 * Run: node scripts/__tests__/deploy-steps.test.mjs
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = dirname(fileURLToPath(import.meta.url));
const {
  parseDeploySteps, readDeploySteps, requiredStep, stepPresent, missingStep, addsCommand, addedMembers
} = await import(join(dirname(TESTS), 'lib', 'deploy-steps.mjs'));
const fixture = name => readFileSync(join(TESTS, 'fixtures', 'deploy-yml', `${name}.yml`), 'utf8');

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deploy-steps-')));

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const has = (label, text, ...parts) => check(label, typeof text === 'string' && parts.every(p => text.includes(p)), `got ${JSON.stringify(text)}`);

const xml = (...types) => '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
  types.map(([t, ms]) => `    <types>\n${ms.map(m => `        <members>${m}</members>\n`).join('')}        <name>${t}</name>\n    </types>\n`).join('') +
  '    <version>63.0</version>\n</Package>\n';

console.log('Parser');
const allSf = parseDeploySteps(fixture('all-steps-sf'));
check('all steps, SF key: the pre metadata folder', allSf.pre.metadata?.[0]?.sourceFolder === './runbooks/pre-deploy/metaData/', JSON.stringify(allSf.pre));
check('all steps, SF key: quotes are removed', allSf.pre.runSFCommandFromFile === 'runbooks/pre-deploy/sf/commands.txt');
check('all steps, SF key: a list item keeps its continuation key', allSf.post['metadata-destruct']?.[0]?.packageXml === 'deletePackage/post/package.xml');
check('all steps, SF key: the deploy block is read', allSf.deploy?.sourceFormat === 'sfdx');
const allSfdx = parseDeploySteps(fixture('all-steps-sfdx'));
check('all steps, SFDX key: the SFDX commands key', allSfdx.post.runSFDXCommandFromFile === 'runbooks/post-deploy/sf/commands.txt' && allSfdx.post.runSFCommandFromFile === undefined);
const preOnly = parseDeploySteps(fixture('pre-only-no-destruct'));
check('pre only, no destruct: post holds only the commands file',
  JSON.stringify(preOnly.post) === JSON.stringify({ runSFDXCommandFromFile: 'runbooks/post-deploy/sf/commands.txt' }), JSON.stringify(preOnly.post));
check('pre only, no destruct: pre has no metadata-destruct', preOnly.pre['metadata-destruct'] === undefined);
const noDestruct = parseDeploySteps(fixture('no-destruct'));
check('no destruct: sections with no blank line between them are read', noDestruct.deploy?.sourceFormat === 'sfdx' &&
  noDestruct.post.runAnonymousScriptFromDir === 'runbooks/post-deploy/apex', JSON.stringify(noDestruct));
check('no destruct: neither stage has metadata-destruct', noDestruct.pre['metadata-destruct'] === undefined && noDestruct.post['metadata-destruct'] === undefined);
check('CRLF line endings read the same', JSON.stringify(parseDeploySteps(fixture('all-steps-sf').replace(/\n/g, '\r\n'))) === JSON.stringify(allSf));
const commented = parseDeploySteps([
  '# pipeline steps',
  'pre:',
  '  # the metadata step',
  '  metadata: # list',
  "    - sourceFolder: 'runbooks/pre-deploy/metaData' # no ./ or trailing /",
  '',
  '  runAnonymousScriptFromDir: ./runbooks/pre-deploy/apex/',
  '  runSFDXCommandFromFile: "runbooks/pre-deploy/sf/commands.txt" # quoted, then a comment',
  '  note: "a #b"',
  'post:',
  ''
].join('\n'));
check('comment lines, blank lines and trailing comments are ignored',
  commented.pre.metadata?.[0]?.sourceFolder === 'runbooks/pre-deploy/metaData' && commented.pre.runAnonymousScriptFromDir === './runbooks/pre-deploy/apex/',
  JSON.stringify(commented));
check('a quoted value keeps its # and drops a trailing comment',
  commented.pre.note === 'a #b' && commented.pre.runSFDXCommandFromFile === 'runbooks/pre-deploy/sf/commands.txt', JSON.stringify(commented.pre));
check('an empty stage is an empty object', JSON.stringify(commented.post) === '{}');
for (const [label, text, part] of [
  ['a tab-indented line', 'pre:\n\tmetadata:\n', 'line 2'],
  ['a three-space indent', 'pre:\n   runAnonymousScriptFromDir: x\n', 'line 2'],
  ['a list item under no key', 'pre:\n    - sourceFolder: x\n', 'line 2'],
  ['a list item under a scalar key', 'pre:\n  runAnonymousScriptFromDir: x\n    - sourceFolder: y\n', 'line 3'],
  ['a value on a stage line', 'pre: x\n', 'line 1'],
  ['a file that names no stage', '# only a comment\n', 'names no stage'],
  ['a file with neither a pre nor a post stage', 'other:\n  key: x\n', 'neither a pre: nor a post:']
]) {
  let error = null;
  try { parseDeploySteps(text); } catch (e) { error = e.message; }
  has(`${label} cannot be parsed`, error, part);
}

console.log('Reading the file');
const repo = join(sandbox, 'repo');
mkdirSync(repo);
check('no deploy.yml is missing', readDeploySteps(repo).missing === true);
writeFileSync(join(repo, 'deploy.yml'), 'pre:\n\tmetadata:\n');
has('an unparsable deploy.yml is an error', readDeploySteps(repo).error, 'deploy.yml could not be read', 'line 2');
writeFileSync(join(repo, 'deploy.yml'), 'other:\n  key: x\n');
has('a deploy.yml with neither pre nor post is an error', readDeploySteps(repo).error, 'deploy.yml could not be read', 'neither a pre: nor a post:');
writeFileSync(join(repo, 'deploy.yml'), fixture('pre-only-no-destruct'));
check('a readable deploy.yml gives its steps', readDeploySteps(repo).steps?.post?.runSFDXCommandFromFile === 'runbooks/post-deploy/sf/commands.txt');
rmSync(join(repo, 'deploy.yml'));
mkdirSync(join(repo, 'deploy.yml'));
has('a deploy.yml that is a folder is an error', readDeploySteps(repo).error, 'deploy.yml could not be read');

console.log('Path to step');
check('a metaData file needs the metadata step',
  JSON.stringify(requiredStep('runbooks/post-deploy/metaData/flowDefinitions/F.flowDefinition-meta.xml')) ===
  JSON.stringify({ stage: 'post', kind: 'metadata', key: '`post.metadata[].sourceFolder`', value: 'runbooks/post-deploy/metaData', compare: null }),
  JSON.stringify(requiredStep('runbooks/post-deploy/metaData/flowDefinitions/F.flowDefinition-meta.xml')));
check('.keep needs no step', requiredStep('runbooks/post-deploy/metaData/.keep') === null && requiredStep('runbooks/pre-deploy/metaData/classes/.keep') === null);
check('a top-level .apex needs the apex step',
  requiredStep('runbooks/pre-deploy/apex/01_x.apex')?.kind === 'apex' && requiredStep('runbooks/pre-deploy/apex/01_x.apex')?.value === 'runbooks/pre-deploy/apex');
check('a non-.apex file or a nested .apex under apex/ needs no step',
  requiredStep('runbooks/pre-deploy/apex/readme.txt') === null && requiredStep('runbooks/pre-deploy/apex/old/01_x.apex') === null);
check('commands.txt needs the commands step, compared line by line',
  requiredStep('runbooks/post-deploy/sf/commands.txt')?.kind === 'commands' && requiredStep('runbooks/post-deploy/sf/commands.txt')?.compare === 'commands');
check('another file under sf/ needs the commands step outright',
  requiredStep('runbooks/pre-deploy/sf/01_deleteErrorFlowInterviews.apex')?.kind === 'commands' &&
  requiredStep('runbooks/pre-deploy/sf/01_deleteErrorFlowInterviews.apex')?.compare === null);
check('a destructive manifest needs the destruct step, compared member by member',
  requiredStep('deletePackage/post/destructiveChangesPost.xml')?.kind === 'destruct' && requiredStep('deletePackage/post/destructiveChangesPost.xml')?.compare === 'members');
check('a mismatched or other deletePackage file needs no step',
  requiredStep('deletePackage/pre/destructiveChangesPost.xml') === null && requiredStep('deletePackage/pre/package.xml') === null);
check('paths outside the stage folders need no step',
  ['runbooks/pre-deploy/sh/00_x.sh', 'force-app/main/default/flows/F.flow-meta.xml', 'deploy.yml'].every(p => requiredStep(p) === null));
check('an absolute path is read against the repository root',
  requiredStep(join(repo, 'runbooks/pre-deploy/apex/01_x.apex'), repo)?.value === 'runbooks/pre-deploy/apex');

console.log('Steps per shape');
const PATHS = {
  preMeta: 'runbooks/pre-deploy/metaData/classes/A.cls', preApex: 'runbooks/pre-deploy/apex/01_x.apex',
  preCmd: 'runbooks/pre-deploy/sf/commands.txt', preDestruct: 'deletePackage/pre/destructiveChangesPre.xml',
  postMeta: 'runbooks/post-deploy/metaData/classes/A.cls', postApex: 'runbooks/post-deploy/apex/01_x.apex',
  postCmd: 'runbooks/post-deploy/sf/commands.txt', postDestruct: 'deletePackage/post/destructiveChangesPost.xml'
};
const ALL = Object.fromEntries(Object.keys(PATHS).map(k => [k, true]));
const EXPECTED = {
  'all-steps-sf': ALL,
  'all-steps-sfdx': ALL,
  'pre-only-no-destruct': { preMeta: true, preApex: true, preCmd: true, preDestruct: false, postMeta: false, postApex: false, postCmd: true, postDestruct: false },
  'no-destruct': { ...ALL, preDestruct: false, postDestruct: false }
};
for (const [shape, want] of Object.entries(EXPECTED)) {
  const steps = parseDeploySteps(fixture(shape));
  for (const [name, path] of Object.entries(PATHS)) {
    check(`${shape}: ${name} ${want[name] ? 'runs' : 'does not run'}`, stepPresent(steps, requiredStep(path)) === want[name]);
  }
}
const loose = parseDeploySteps([
  'post:',
  '  metadata:',
  '    - sourceFolder: "runbooks/post-deploy/metaData"',
  "  runAnonymousScriptFromDir: './runbooks/post-deploy/apex/'",
  '  runSFCommandFromFile: ./runbooks/post-deploy/sf/commands.txt',
  '  metadata-destruct:',
  '    - destructiveChangesXml: ./deletePackage/post/destructiveChangesPost.xml'
].join('\n'));
check('./ and a trailing / are ignored', ['postMeta', 'postApex', 'postCmd', 'postDestruct'].every(n => stepPresent(loose, requiredStep(PATHS[n]))));
check('a sourceFolder naming another folder does not count',
  !stepPresent(parseDeploySteps('post:\n  metadata:\n    - sourceFolder: ./runbooks/post-deploy/other/\n'), requiredStep(PATHS.postMeta)));

console.log('Content compared with HEAD');
check('the version placeholder, blank lines and comments add no command', !addsCommand('version\n\n# later\n', null));
check('a real line adds a command', addsCommand('version\napex run --file ./runbooks/post-deploy/sf/01_x.apex\n', 'version'));
check('a line HEAD already has adds nothing', !addsCommand('apex run --file a\r\n', 'apex run --file a\n'));
check('a new member is added', JSON.stringify(addedMembers(xml(['ApexClass', ['A', 'B']]), xml(['ApexClass', ['A']]))) === '["ApexClass:B"]');
check('the same name under another type is added', addedMembers(xml(['Flow', ['A']]), xml(['ApexClass', ['A']])).length === 1);
check('a removed or reordered member adds nothing', addedMembers(xml(['ApexClass', ['B']]), xml(['ApexClass', ['A', 'B']])).length === 0);
check('every member of a file HEAD lacks is added', addedMembers(xml(['ApexClass', ['A']]), null).length === 1);
check('a placeholder manifest adds nothing', addedMembers(xml(), null).length === 0);

console.log('Missing-step lines');
const steps = parseDeploySteps(fixture('pre-only-no-destruct'));
const none = { content: () => null, head: () => null };
has('a post metaData file names the key and the stage that runs it', missingStep(PATHS.postMeta, steps, none),
  PATHS.postMeta, '`post.metadata[].sourceFolder`', '`pre` runs this step; `post` does not');
const destructLine = missingStep(PATHS.postDestruct, steps, { content: () => xml(['Flow', ['Old-1']]), head: () => xml() });
has('an added member in a stage with no destruct step is named', destructLine, PATHS.postDestruct, '`post.metadata-destruct[].destructiveChangesXml`');
check('no other stage is named when neither runs the step', !destructLine?.includes('runs this step'));
check('a destructive manifest with no added member needs nothing',
  missingStep(PATHS.postDestruct, steps, { content: () => xml(['ApexClass', ['A']]), head: () => xml(['ApexClass', ['A', 'B']]) }) === null);
check('a listed step needs nothing', missingStep(PATHS.preApex, steps, none) === null);
const noCommands = parseDeploySteps('pre:\n  runAnonymousScriptFromDir: runbooks/pre-deploy/apex\n');
check('a placeholder commands file needs nothing', missingStep(PATHS.postCmd, noCommands, { content: () => 'version', head: () => null }) === null);
has('a real command names both keys', missingStep(PATHS.postCmd, noCommands, { content: () => 'apex run --file x', head: () => 'version' }),
  '`post.runSFCommandFromFile` or `post.runSFDXCommandFromFile`');
check('content is not read for a path whose step is listed',
  missingStep(PATHS.postCmd, steps, { content: () => { throw new Error('read'); }, head: () => null }) === null);

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
