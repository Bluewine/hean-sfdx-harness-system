#!/usr/bin/env node
/**
 * What site-publish.mjs writes to the post-deploy commands file and prints.
 *
 * Each case runs the script in a throwaway repository holding a deploy.yml,
 * an sfdx-project.json and, when the case needs them, Network files. No org
 * is called.
 *
 * Run: node scripts/__tests__/site-publish.test.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(dirname(SCRIPTS), 'skills', 'site-publish', 'scripts', 'site-publish.mjs');
const COMMANDS = 'runbooks/post-deploy/sf/commands.txt';
const PUB = site => `force:community:publish --name '${site}' -u $TARGET_ORG_UNAME`;
const POST_SF = 'post:\n  runSFCommandFromFile: runbooks/post-deploy/sf/commands.txt\n';
const PRE_ONLY = 'pre:\n  runSFDXCommandFromFile: runbooks/pre-deploy/sf/commands.txt\n';

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'site-publish-')));

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

let n = 0;
/** A repository: deploy.yml text (null for none), commands.txt text (null for none), Network names per package folder. */
function repo({ deploy = POST_SF, commands = 'version\n', networks = {} } = {}) {
  const root = join(sandbox, `repo-${++n}`);
  mkdirSync(root);
  writeFileSync(join(root, 'sfdx-project.json'), JSON.stringify({ packageDirectories: Object.keys(networks).length
    ? Object.keys(networks).map(path => ({ path })) : [{ path: 'force-app' }] }));
  if (deploy !== null) writeFileSync(join(root, 'deploy.yml'), deploy);
  if (commands !== null) {
    mkdirSync(join(root, dirname(COMMANDS)), { recursive: true });
    writeFileSync(join(root, COMMANDS), commands);
  }
  for (const [pkg, names] of Object.entries(networks)) {
    const dir = join(root, pkg, 'main', 'default', 'networks');
    mkdirSync(dir, { recursive: true });
    for (const name of names) writeFileSync(join(dir, `${name}.network-meta.xml`), '<Network/>\n');
  }
  return root;
}
const run = (root, ...args) => spawnSync('node', [CLI, ...args], { cwd: root, encoding: 'utf8' });
const read = root => (existsSync(join(root, COMMANDS)) ? readFileSync(join(root, COMMANDS), 'utf8') : null);
const show = r => `exit ${r.status}\n${r.stdout}${r.stderr}`;

console.log('Adding a site');
let root = repo({ networks: { 'force-app': ['ABC_Portal'] } });
let r = run(root, '--site', 'ABC_Portal');
check('one site: exit 0', r.status === 0, show(r));
check('one site: the line is appended', read(root) === `version\n${PUB('ABC_Portal')}\n`, JSON.stringify(read(root)));
check('one site: the file is printed as it now reads', r.stdout.includes(`version\n${PUB('ABC_Portal')}\n`), r.stdout);
check('one site: the site is reported added', /ADDED: ABC_Portal/.test(r.stdout), r.stdout);
check('one site: reported written', /^WRITTEN: runbooks\/post-deploy\/sf\/commands\.txt$/m.test(r.stdout), r.stdout);
check('one site with a Network file: no note', !/NOTE:/.test(r.stdout), r.stdout);

root = repo({ commands: `version\n${PUB('ABC_Portal')}\n`, networks: { 'force-app': ['ABC_Portal'] } });
r = run(root, '--site', 'ABC_Portal');
check('already present: exit 0', r.status === 0, show(r));
check('already present: the file is unchanged', read(root) === `version\n${PUB('ABC_Portal')}\n`, JSON.stringify(read(root)));
check('already present: reported, nothing added', /ALREADY PRESENT: ABC_Portal/.test(r.stdout) && !/ADDED:/.test(r.stdout), r.stdout);
check('already present: reported unchanged', /^UNCHANGED: runbooks\/post-deploy\/sf\/commands\.txt$/m.test(r.stdout) && !/WRITTEN:/.test(r.stdout), r.stdout);

root = repo({ commands: `version\n\n${PUB('ABC_Portal')}\n` });
r = run(root, '--site', 'ABC_Portal');
check('publish line after an empty line: joined, not doubled', r.status === 0 && read(root) === `version\n${PUB('ABC_Portal')}\n`, show(r));
check('publish line after an empty line: reported as now running',
  /^NOW RUNS: ABC_Portal — its publish line was after an empty line$/m.test(r.stdout) && !/ALREADY PRESENT/.test(r.stdout), r.stdout);
check('publish line after an empty line: reported written', /^WRITTEN: /m.test(r.stdout), r.stdout);

root = repo({ commands: null });
r = run(root, '--site', 'ABC_Portal');
check('no commands file and no Network file: the file is created with a note',
  r.status === 0 && read(root) === `version\n${PUB('ABC_Portal')}\n` && /NOTE: .*ABC_Portal/.test(r.stdout), show(r));

console.log('Refusals and warnings');
root = repo({ deploy: PRE_ONLY });
r = run(root, '--site', 'ABC_Portal');
check('missing post key: exit 2', r.status === 2, show(r));
check('missing post key: a !! line naming the key to add',
  /^!! .*post\.runSFDXCommandFromFile/m.test(r.stdout) && r.stdout.includes(COMMANDS), r.stdout);
check('missing post key: the file is unchanged', read(root) === 'version\n');

root = repo({ deploy: null });
r = run(root, '--site', 'ABC_Portal');
check('no deploy.yml: exit 2 with a !! line, nothing written', r.status === 2 && /^!! /m.test(r.stdout) && read(root) === 'version\n', show(r));

root = repo({ commands: 'version\n\napex run --file ./runbooks/post-deploy/sf/01_x.apex\n' });
r = run(root, '--site', 'ABC_Portal');
check('revived command: exit 0 and the empty line removed',
  r.status === 0 && read(root) === `version\napex run --file ./runbooks/post-deploy/sf/01_x.apex\n${PUB('ABC_Portal')}\n`, show(r));
check('revived command: a !! line names it', /^!! .*apex run --file \.\/runbooks\/post-deploy\/sf\/01_x\.apex/m.test(r.stdout), r.stdout);

root = repo({ commands: ['version', ...Array.from({ length: 9 }, (_, i) => `apex run --file f${i}.apex`)].join('\n') + '\n' });
r = run(root, '--site', 'ABC_Portal');
check('over the limit: a !! line names the count and SFDX_CMD_LIMIT', r.status === 0 && /^!! .*\b11\b.*SFDX_CMD_LIMIT/m.test(r.stdout), show(r));
root = repo({ commands: ['version', ...Array.from({ length: 8 }, (_, i) => `apex run --file f${i}.apex`)].join('\n') + '\n' });
r = run(root, '--site', 'ABC_Portal');
check('at the limit: no warning', r.status === 0 && !/SFDX_CMD_LIMIT/.test(r.stdout), show(r));

console.log('Dry run');
root = repo({ commands: 'version\n\napex run --file a.apex\n' });
r = run(root, '--site', 'ABC_Portal', '--dry-run');
check('dry run: exit 0 and prints the would-be file',
  r.status === 0 && r.stdout.includes(`version\napex run --file a.apex\n${PUB('ABC_Portal')}\n`), show(r));
check('dry run: says what it would write', /^DRY RUN: would write runbooks\/post-deploy\/sf\/commands\.txt$/m.test(r.stdout) && !/^WRITTEN:/m.test(r.stdout), r.stdout);
check('dry run: writes nothing', read(root) === 'version\n\napex run --file a.apex\n', JSON.stringify(read(root)));

root = repo({ commands: `version\n${PUB('ABC_Portal')}\n` });
r = run(root, '--site', 'ABC_Portal', '--dry-run');
check('dry run, nothing to change: says it would leave the file', /^DRY RUN: would leave runbooks\/post-deploy\/sf\/commands\.txt unchanged$/m.test(r.stdout), r.stdout);

root = repo({ commands: 'version\n   \napex run --file a.apex\n' });
r = run(root, '--site', 'ABC_Portal');
check('command after a whitespace-only line: no revived warning', r.status === 0 && !/^!! /m.test(r.stdout) &&
  read(root) === `version\napex run --file a.apex\n${PUB('ABC_Portal')}\n`, show(r));

console.log('Listing sites');
r = run(repo(), '--list');
check('--list, no Network file: exit 0 and no names', r.status === 0 && r.stdout.trim() === '', show(r));
r = run(repo({ networks: { 'force-app': ['ABC_Portal'] } }), '--list');
check('--list, one Network file: its name', r.status === 0 && r.stdout === 'ABC_Portal\n', show(r));
r = run(repo({ networks: { 'force-app': ['ABC_Portal'], 'second-pkg': ['B_Site'] } }), '--list');
check('--list, two Network files in two package folders: both names', r.status === 0 && r.stdout === 'ABC_Portal\nB_Site\n', show(r));

console.log('Usage');
r = run(repo());
check('no --site and no --list: exit 1', r.status === 1 && /ERROR:/.test(r.stdout), show(r));
r = run(repo(), '--site');
check('--site with no name: exit 1', r.status === 1 && /ERROR:/.test(r.stdout), show(r));
root = repo();
r = run(root, '--site', "ABC's_Portal");
check("a site name holding ' is refused: exit 1, nothing written", r.status === 1 && /ERROR:.*'/.test(r.stdout) && read(root) === 'version\n', show(r));
r = run(repo({ networks: { 'force-app': ['ABC_Portal'] } }), '--list', '--site', 'ABC_Portal');
check('--list with --site is refused: exit 1', r.status === 1 && /ERROR:.*--list/.test(r.stdout) && !/^ABC_Portal$/m.test(r.stdout), show(r));

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
