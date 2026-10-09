#!/usr/bin/env node
/**
 * Which commits the runbook stage gate refuses, for the deploy.yml shapes the
 * client repositories use.
 *
 * Each repository is a throwaway git repository carrying one of the
 * deploy.yml fixtures and the placeholder runbook files those repositories
 * keep. HOME and CLAUDE_CONFIG_DIR are throwaway folders and
 * CLAUDE_CODE_CHILD_SESSION is unset. No sf is called.
 *
 * Run: node hooks/__tests__/runbook-stage-gate.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOKS = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(HOOKS, 'runbook-stage-gate.mjs');
const FIXTURES = join(dirname(HOOKS), 'scripts', '__tests__', 'fixtures', 'deploy-yml');
const fixture = name => readFileSync(join(FIXTURES, `${name}.yml`), 'utf8');

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'runbook-stage-')));
const env = { ...process.env, HOME: join(sandbox, 'home'), CLAUDE_CONFIG_DIR: join(sandbox, 'config') };
delete env.CLAUDE_CODE_CHILD_SESSION;
mkdirSync(env.HOME);
mkdirSync(env.CLAUDE_CONFIG_DIR);

const write = (repo, rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const xml = (...types) => '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
  types.map(([t, ms]) => `    <types>\n${ms.map(m => `        <members>${m}</members>\n`).join('')}        <name>${t}</name>\n    </types>\n`).join('') +
  '    <version>63.0</version>\n</Package>\n';

const POST_META = 'runbooks/post-deploy/metaData/flowDefinitions/Old_Flow.flowDefinition-meta.xml';
const PRE_META = 'runbooks/pre-deploy/metaData/flowDefinitions/Old_Flow.flowDefinition-meta.xml';
const POST_APEX = 'runbooks/post-deploy/apex/01_backfill.apex';
const POST_CMD = 'runbooks/post-deploy/sf/commands.txt';
const PRE_CMD = 'runbooks/pre-deploy/sf/commands.txt';
const PRE_DESTRUCT = 'deletePackage/pre/destructiveChangesPre.xml';
const POST_DESTRUCT = 'deletePackage/post/destructiveChangesPost.xml';
const PLACED = 'runbooks/post-deploy/metaData/classes/ACME_Deployment.cls';
const PLACED_APEX = 'runbooks/post-deploy/apex/00_postdeployApexScript.apex';
const BASE_POST_DESTRUCT = xml(['ApexClass', ['ACME_Deployment']]);
const ADDED_POST_DESTRUCT = xml(['ApexClass', ['ACME_Deployment']], ['Flow', ['Old_Flow-1']]);

/** A throwaway repository shaped like a client repository: deploy.yml (unless null) and the placeholder runbook files. */
function makeRepo(name, deployYml) {
  const repo = join(sandbox, name);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'integration');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  if (deployYml !== null) write(repo, 'deploy.yml', deployYml);
  for (const s of ['pre', 'post']) {
    write(repo, `runbooks/${s}-deploy/sf/commands.txt`, 'version');
    write(repo, `runbooks/${s}-deploy/metaData/.keep`, '');
  }
  write(repo, PRE_DESTRUCT, xml());
  write(repo, POST_DESTRUCT, BASE_POST_DESTRUCT);
  write(repo, PLACED, 'public class ACME_Deployment {}\n');
  write(repo, PLACED_APEX, '// placeholder\n');
  write(repo, 'notes.txt', 'one\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'initial');
  return repo;
}
const reset = repo => { git(repo, 'reset', '-q', '--hard'); git(repo, 'clean', '-qfd'); };

/** Run the hook as Claude Code does before a Bash call: { deny, warn, context }, each null when absent. */
function hook(cwd, command) {
  const out = execFileSync(process.execPath, [HOOK], { env, encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 'test', cwd, tool_input: { command } }) });
  const o = out.trim() ? JSON.parse(out) : {};
  return {
    deny: o.hookSpecificOutput?.permissionDecision === 'deny' ? o.hookSpecificOutput.permissionDecisionReason : null,
    warn: o.systemMessage ?? null,
    context: o.hookSpecificOutput?.additionalContext ?? null
  };
}

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const has = (label, text, ...parts) => check(label, typeof text === 'string' && parts.every(p => text.includes(p)), `got ${JSON.stringify(text)}`);
const silent = r => r.deny === null && r.warn === null;
const REFUSED = '!! This commit records runbook files Jenkins never deploys or runs';
const NOT_RUN = '!! The runbook stage check did not run';
let r;

console.log('Pre only, no destruct: refused');
const preOnly = makeRepo('pre-only', fixture('pre-only-no-destruct'));
write(preOnly, POST_META, '<FlowDefinition/>\n');
git(preOnly, 'add', '--', POST_META);
r = hook(preOnly, 'git commit -m "x"');
has('a post metaData file is refused', r.deny, REFUSED, POST_META, '`post.metadata[].sourceFolder`', '`pre` runs this step; `post` does not');
has('the refusal says what to do and who decides deploy.yml', r.deny, 'Move each file to a stage that runs its step', "user's decision");
reset(preOnly);
write(preOnly, POST_APEX, 'System.debug(1);\n');
git(preOnly, 'add', '--', POST_APEX);
has('a post apex script is refused', hook(preOnly, 'git commit -m "x"').deny, POST_APEX, '`post.runAnonymousScriptFromDir`', '`pre` runs this step');
reset(preOnly);
write(preOnly, POST_DESTRUCT, ADDED_POST_DESTRUCT);
git(preOnly, 'add', '--', POST_DESTRUCT);
r = hook(preOnly, 'git commit -m "x"');
has('an added member in the post destructive manifest is refused', r.deny, POST_DESTRUCT, '`post.metadata-destruct[].destructiveChangesXml`');
check('no other stage is named when neither runs the step', !r.deny?.includes('runs this step'), r.deny);
reset(preOnly);
write(preOnly, PRE_DESTRUCT, xml(['Flow', ['Old_Flow-1']]));
git(preOnly, 'add', '--', PRE_DESTRUCT);
has('an added member in the pre destructive manifest is refused', hook(preOnly, 'git commit -m "x"').deny, PRE_DESTRUCT, '`pre.metadata-destruct[].destructiveChangesXml`');
reset(preOnly);
write(preOnly, POST_META, '<FlowDefinition/>\n');
write(preOnly, POST_APEX, 'System.debug(1);\n');
write(preOnly, POST_DESTRUCT, ADDED_POST_DESTRUCT);
write(preOnly, PRE_DESTRUCT, xml(['Flow', ['Old_Flow-1']]));
git(preOnly, 'add', '-A');
has('one refusal lists every offending path', hook(preOnly, 'git commit -m "x"').deny, POST_META, POST_APEX, POST_DESTRUCT, PRE_DESTRUCT);
reset(preOnly);

console.log('Pre only, no destruct: what the commit records');
write(preOnly, POST_APEX, 'System.debug(1);\n');
has('git add and commit in one call is refused', hook(preOnly, `git add -- ${POST_APEX} && git commit -m "x"`).deny, POST_APEX);
reset(preOnly);
write(preOnly, PLACED_APEX, '// changed\n');
has('commit -a with a changed tracked post script is refused', hook(preOnly, 'git commit -am "x"').deny, PLACED_APEX);
has('a commit by path naming it is refused', hook(preOnly, `git commit -m "x" -- ${PLACED_APEX}`).deny, PLACED_APEX);
write(preOnly, 'notes.txt', 'two\n');
git(preOnly, 'add', '--', PLACED_APEX);
check('a commit by path of other files leaves the staged script out', silent(hook(preOnly, 'git commit -m "x" -- notes.txt')));
reset(preOnly);
write(preOnly, POST_APEX, 'System.debug(1);\n');
git(preOnly, 'add', '--', POST_APEX);
has('a commit through git -C from another folder is refused', hook(sandbox, `git -C ${preOnly} commit -m "x"`).deny, POST_APEX);
has('a commit after cd is refused', hook(sandbox, `cd ${preOnly} && git commit -m "x"`).deny, POST_APEX);
check('a dry run is not checked', silent(hook(preOnly, 'git commit --dry-run -m "x"')));
check('a command that is not a commit is silent', silent(hook(preOnly, 'git status')));
r = hook(preOnly, 'git add "$F" && git commit -m "x"');
check('staging the text cannot name is allowed', r.deny === null, JSON.stringify(r));
has('... with a !! line', r.warn, NOT_RUN, 'does not name');
reset(preOnly);
write(preOnly, POST_DESTRUCT, ADDED_POST_DESTRUCT);
git(preOnly, 'add', '--', POST_DESTRUCT);
write(preOnly, POST_DESTRUCT, BASE_POST_DESTRUCT);
has('the staged content is checked, not the working tree', hook(preOnly, 'git commit -m "x"').deny, POST_DESTRUCT);
reset(preOnly);
write(preOnly, POST_DESTRUCT, ADDED_POST_DESTRUCT);
check('an unstaged change is not part of the commit', silent(hook(preOnly, 'git commit -m "x"')));
reset(preOnly);

console.log('Pre only, no destruct: allowed');
write(preOnly, PRE_META, '<FlowDefinition/>\n');
write(preOnly, POST_CMD, 'version\napex run --file ./runbooks/post-deploy/sf/01_cleanup.apex\n');
write(preOnly, 'runbooks/post-deploy/sf/01_cleanup.apex', 'System.debug(1);\n');
write(preOnly, 'runbooks/post-deploy/metaData/.keep', 'x\n');
write(preOnly, PRE_CMD, 'version\n# nothing yet\n\n');
git(preOnly, 'add', '-A');
r = hook(preOnly, 'git commit -m "x"');
check('pre metaData, a real post command, its script, .keep and a placeholder commands file are allowed', silent(r), JSON.stringify(r));
reset(preOnly);
git(preOnly, 'rm', '-q', '--', PLACED, PLACED_APEX);
write(preOnly, POST_DESTRUCT, xml());
git(preOnly, 'add', '--', POST_DESTRUCT);
check('deleting post files and removing a destructive member are allowed', silent(hook(preOnly, 'git commit -m "x"')));
reset(preOnly);
mkdirSync(join(preOnly, 'runbooks/pre-deploy/metaData/classes'), { recursive: true });   // git mv needs the destination folder
git(preOnly, 'mv', PLACED, 'runbooks/pre-deploy/metaData/classes/ACME_Deployment.cls');
check('moving a file to a stage that runs its step is allowed', silent(hook(preOnly, 'git commit -m "x"')));
reset(preOnly);
write(preOnly, 'notes.txt', 'two\n');
git(preOnly, 'add', '--', 'notes.txt');
check('a commit that leaves the placeholders untouched is silent', silent(hook(preOnly, 'git commit -m "x"')));
reset(preOnly);
git(preOnly, 'checkout', '-q', '-b', 'other');
write(preOnly, POST_APEX, 'System.debug(1);\n');
git(preOnly, 'add', '-A');
git(preOnly, 'commit', '-q', '-m', 'other');
git(preOnly, 'checkout', '-q', 'integration');
git(preOnly, 'merge', '-q', '--no-ff', '--no-commit', 'other');
check('a merge in progress is not checked', silent(hook(preOnly, 'git commit -m "x"')));
git(preOnly, 'merge', '--abort');

console.log('No destruct');
{
  const noDestruct = makeRepo('no-destruct', fixture('no-destruct'));
  write(noDestruct, PRE_DESTRUCT, xml(['Flow', ['Old_Flow-1']]));
  git(noDestruct, 'add', '--', PRE_DESTRUCT);
  has('an added member in the pre destructive manifest is refused', hook(noDestruct, 'git commit -m "x"').deny,
    REFUSED, PRE_DESTRUCT, '`pre.metadata-destruct[].destructiveChangesXml`');
  reset(noDestruct);
  write(noDestruct, POST_DESTRUCT, ADDED_POST_DESTRUCT);
  git(noDestruct, 'add', '--', POST_DESTRUCT);
  has('an added member in the post destructive manifest is refused', hook(noDestruct, 'git commit -m "x"').deny,
    REFUSED, POST_DESTRUCT, '`post.metadata-destruct[].destructiveChangesXml`');
  reset(noDestruct);
  write(noDestruct, POST_META, '<FlowDefinition/>\n');
  write(noDestruct, POST_APEX, 'System.debug(1);\n');
  git(noDestruct, 'add', '--', POST_META, POST_APEX);
  r = hook(noDestruct, 'git commit -m "x"');
  check('post metaData and a post apex script are allowed', silent(r), JSON.stringify(r));
  reset(noDestruct);
  git(noDestruct, 'rm', '-q', '--', PRE_DESTRUCT);
  git(noDestruct, 'commit', '-q', '-m', 'drop the pre manifest');
  write(noDestruct, PRE_DESTRUCT, xml(['Flow', ['Old_Flow-1']]));
  git(noDestruct, 'add', '--', PRE_DESTRUCT);
  has('a new destructive manifest HEAD lacks, with a member, is refused', hook(noDestruct, 'git commit -m "x"').deny, PRE_DESTRUCT);
}

console.log('A stage with no commands step');
{
  const noCommands = makeRepo('no-post-commands', [
    'pre:',
    '  runSFDXCommandFromFile: "runbooks/pre-deploy/sf/commands.txt"',
    'post:',
    '  metadata:',
    '    - sourceFolder: ./runbooks/post-deploy/metaData/',
    ''
  ].join('\n'));
  write(noCommands, POST_CMD, 'version\napex run --file ./runbooks/post-deploy/sf/01_cleanup.apex\n');
  git(noCommands, 'add', '--', POST_CMD);
  has('a real line added to the post commands file is refused', hook(noCommands, 'git commit -m "x"').deny,
    REFUSED, POST_CMD, '`post.runSFCommandFromFile` or `post.runSFDXCommandFromFile`', '`pre` runs this step');
  reset(noCommands);
  write(noCommands, POST_CMD, 'version\n\n');
  git(noCommands, 'add', '--', POST_CMD);
  r = hook(noCommands, 'git commit -m "x"');
  check('a placeholder-only change to the post commands file is allowed', silent(r), JSON.stringify(r));
  reset(noCommands);
  write(noCommands, 'runbooks/post-deploy/sf/01_cleanup.apex', 'System.debug(1);\n');
  git(noCommands, 'add', '--', 'runbooks/post-deploy/sf/01_cleanup.apex');
  has('another file under the post sf folder is refused', hook(noCommands, 'git commit -m "x"').deny, 'runbooks/post-deploy/sf/01_cleanup.apex');
}

console.log('A first commit');
{
  const fresh = join(sandbox, 'fresh');
  mkdirSync(fresh);
  git(fresh, 'init', '-q', '-b', 'integration');
  write(fresh, 'deploy.yml', fixture('pre-only-no-destruct'));
  write(fresh, POST_APEX, 'System.debug(1);\n');
  git(fresh, 'add', '-A');
  has('a first commit is checked', hook(fresh, 'git commit -m "x"').deny, POST_APEX);
}

console.log('Other shapes');
for (const shape of ['all-steps-sf', 'all-steps-sfdx']) {
  const repo = makeRepo(shape, fixture(shape));
  write(repo, POST_META, '<FlowDefinition/>\n');
  write(repo, POST_APEX, 'System.debug(1);\n');
  write(repo, POST_DESTRUCT, ADDED_POST_DESTRUCT);
  write(repo, PRE_DESTRUCT, xml(['Flow', ['Old_Flow-1']]));
  git(repo, 'add', '-A');
  r = hook(repo, 'git commit -m "x"');
  check(`${shape}: every stage folder is allowed`, silent(r), JSON.stringify(r));
}
{
  const bare = makeRepo('bare', null);
  write(bare, POST_APEX, 'System.debug(1);\n');
  git(bare, 'add', '-A');
  check('a repository without deploy.yml is silent', silent(hook(bare, 'git commit -m "x"')));
}

console.log('Unreadable deploy.yml');
{
  const broken = makeRepo('broken', 'pre:\n\tmetadata:\n');
  write(broken, 'notes.txt', 'two\n');
  git(broken, 'add', '--', 'notes.txt');
  check('a commit with no stage-folder file is silent', silent(hook(broken, 'git commit -m "x"')));
  write(broken, POST_APEX, 'System.debug(1);\n');
  git(broken, 'add', '--', POST_APEX);
  r = hook(broken, 'git commit -m "x"');
  check('a commit with a stage-folder file is allowed', r.deny === null, JSON.stringify(r));
  has('... with a !! line naming the reason', r.warn, NOT_RUN, 'deploy.yml could not be read', 'line 2');
  has('... that Claude sees too', r.context, 'deploy.yml could not be read');
}
{
  const noStage = makeRepo('no-stage', 'other:\n  key: x\n');
  write(noStage, POST_APEX, 'System.debug(1);\n');
  git(noStage, 'add', '--', POST_APEX);
  r = hook(noStage, 'git commit -m "x"');
  check('a deploy.yml with neither pre nor post allows the commit', r.deny === null, JSON.stringify(r));
  has('... with a !! line naming the reason', r.warn, NOT_RUN, 'deploy.yml could not be read', 'neither a pre: nor a post:');
}

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
