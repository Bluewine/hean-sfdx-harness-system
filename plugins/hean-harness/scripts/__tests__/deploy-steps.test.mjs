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
  parseDeploySteps, readDeploySteps, requiredStep, stepPresent, missingStep, addsCommand, addedMembers,
  jenkinsLines, publishedSites, withPublishLines
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

console.log('Lines Jenkins runs');
check('lines are trimmed and # lines skipped', JSON.stringify(jenkinsLines('version\n  # note\n  apex run --file a  \n')) === '["version","apex run --file a"]',
  JSON.stringify(jenkinsLines('version\n  # note\n  apex run --file a  \n')));
check('reading stops at the first empty line', JSON.stringify(jenkinsLines('version\na\n\nb\n')) === '["version","a"]');
check('a whitespace-only line is skipped, not a stop', JSON.stringify(jenkinsLines('version\n   \nb')) === '["version","b"]',
  JSON.stringify(jenkinsLines('version\n   \nb')));
check('a CRLF blank line is not a stop', JSON.stringify(jenkinsLines('version\r\n\r\nb\r\n')) === '["version","b"]',
  JSON.stringify(jenkinsLines('version\r\n\r\nb\r\n')));
check('CRLF reads the same', JSON.stringify(jenkinsLines('version\r\na\r\n')) === '["version","a"]');
check('a missing or empty file runs nothing', jenkinsLines(null).length === 0 && jenkinsLines('').length === 0);

const PUB = "force:community:publish --name 'ABC_Portal' -u $TARGET_ORG_UNAME";
const names = text => JSON.stringify([...publishedSites(text)].sort());
check('the line the skill writes publishes its site', names(`version\n${PUB}\n`) === '["ABC_Portal"]', names(`version\n${PUB}\n`));
check('quoted, unquoted and = forms, -n, and community publish all count', names([
  'force:community:publish --name "Double Quoted" -u x',
  'force:community:publish --name Unquoted',
  "force:community:publish --name='Equals_Quoted'",
  'community publish --name=Equals_Bare --target-org x',
  "community publish -n 'Short_Flag'",
  'community  publish -o x -n Short_Late'
].join('\n')) === '["Double Quoted","Equals_Bare","Equals_Quoted","Short_Flag","Short_Late","Unquoted"]', names([
  'force:community:publish --name "Double Quoted" -u x', 'force:community:publish --name Unquoted', "force:community:publish --name='Equals_Quoted'",
  'community publish --name=Equals_Bare --target-org x', "community publish -n 'Short_Flag'", 'community  publish -o x -n Short_Late'].join('\n')));
check('a publish line after an empty line is not published', names(`version\n\n${PUB}\n`) === '[]');
check('a publish line after a whitespace-only line is published', names(`version\n  \n${PUB}\n`) === '["ABC_Portal"]');
check('a commented-out publish line is not published', names(`version\n# ${PUB}\n`) === '[]');
check('another command naming --name is not a publish line', names('version\ncommunity create --name ABC_Portal\n') === '[]');

const B_PUB = PUB.replace('ABC_Portal', 'B_Site');
let r = withPublishLines('version\n', ['ABC_Portal']);
check('a site is appended after the last command', r.text === `version\n${PUB}\n` && JSON.stringify(r.added) === '["ABC_Portal"]' && r.revived.length === 0,
  JSON.stringify(r));
r = withPublishLines(`version\n${PUB}\n`, ['ABC_Portal']);
check('a site already published is not added again', r.text === `version\n${PUB}\n` && r.added.length === 0, JSON.stringify(r));
r = withPublishLines("version\ncommunity publish -n ABC_Portal", ['ABC_Portal', 'B_Site']);
check('only the unpublished site is added, and a missing trailing newline is added',
  r.text === `version\ncommunity publish -n ABC_Portal\n${B_PUB}\n` && JSON.stringify(r.added) === '["B_Site"]', JSON.stringify(r));
r = withPublishLines('version\napex run --file a', ['ABC_Portal']);
check('a file with no trailing newline gets the line on its own line', r.text === `version\napex run --file a\n${PUB}\n`, JSON.stringify(r));
r = withPublishLines('version\n\n# later steps\napex run --file a\n\n\napex run --file b\n\n\n', ['ABC_Portal']);
check('several empty lines are removed and the comment keeps its place',
  r.text === `version\n# later steps\napex run --file a\napex run --file b\n${PUB}\n`, JSON.stringify(r.text));
check('commands after the first empty line are revived', JSON.stringify(r.revived) === '["apex run --file a","apex run --file b"]', JSON.stringify(r.revived));
r = withPublishLines(`version\n\n${PUB}\n`, ['ABC_Portal']);
check('a publish line after an empty line is revived, not doubled',
  r.text === `version\n${PUB}\n` && r.added.length === 0 && JSON.stringify(r.revived) === JSON.stringify([PUB]), JSON.stringify(r));
r = withPublishLines('version\n   \napex run --file a\n', ['ABC_Portal']);
check('a command after a whitespace-only line is not revived, and the line is removed',
  r.text === `version\napex run --file a\n${PUB}\n` && r.revived.length === 0, JSON.stringify(r));
r = withPublishLines('version\r\n\r\napex run --file a\r\n', ['ABC_Portal']);
check('a command after a CRLF blank line is not revived', r.text === `version\napex run --file a\n${PUB}\n` && r.revived.length === 0, JSON.stringify(r));
r = withPublishLines(null, ['ABC_Portal']);
check('a missing file becomes version plus the line', r.text === `version\n${PUB}\n` && JSON.stringify(r.added) === '["ABC_Portal"]', JSON.stringify(r));
check('an empty file becomes version plus the line', withPublishLines('', ['ABC_Portal']).text === `version\n${PUB}\n`);
r = withPublishLines('version\r\napex run --file a\r\n', ['ABC_Portal', 'ABC_Portal']);
check('CRLF is written as LF and a repeated site is added once', r.text === `version\napex run --file a\n${PUB}\n` && r.added.length === 1, JSON.stringify(r));

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
