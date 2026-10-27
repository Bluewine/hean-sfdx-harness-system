#!/usr/bin/env node
/**
 * The global prompt is a Markdown file that ~/.claude/CLAUDE.md imports from a
 * block at the top, and the claude alias no longer appends it.
 *
 * Part 1 drives installBlock and stripBlock directly. Part 2 runs setup in a
 * throwaway home, including a rerun over an install made with the old .txt name.
 *
 * Run: node scripts/__tests__/claude-md-import.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));       // scripts/
const PLUGIN = dirname(HERE);

const work = mkdtempSync(join(tmpdir(), 'claude-md-import-'));
// Removed on every exit, including a crash before the try block and an interrupt.
process.on('exit', () => { if (work.startsWith(tmpdir())) rmSync(work, { recursive: true, force: true }); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const home = join(work, 'home');
const repo = join(work, 'repo');
mkdirSync(join(repo, 'force-app'), { recursive: true });
mkdirSync(join(home, '.claude'), { recursive: true });
writeFileSync(join(repo, 'sfdx-project.json'), '{"packageDirectories":[{"path":"force-app","default":true}]}\n');
writeFileSync(join(home, '.zshrc'), '# my own notes\nkeep me\n');

// /usr/bin/git on macOS is a shim that starts xcrun on every call (about 3 times the cost of the
// binary). The folder goes on PATH, not a link to git: a link makes git init lose its template folder.
const CLT_BIN = '/Library/Developer/CommandLineTools/usr/bin';
// The whole Command Line Tools folder goes first on PATH; no check reads any of its other tools.
if (existsSync(join(CLT_BIN, 'git'))) process.env.PATH = `${CLT_BIN}:${process.env.PATH}`;
// claude, sf, java and ego-browser stand-ins that print nothing and exit 0: no check reads their output,
// and the real claude clones marketplaces from github.com. A link, not a script: a script start costs
// about 100 ms on a machine with endpoint security agents.
const standIns = join(work, 'bin');
mkdirSync(standIns);
const TRUE_BIN = existsSync('/usr/bin/true') ? '/usr/bin/true' : '/bin/true';
for (const cmd of ['claude', 'sf', 'java', 'ego-browser']) symlinkSync(TRUE_BIN, join(standIns, cmd));
process.env.PATH = `${standIns}:${process.env.PATH}`;
execFileSync('git', ['init', '-q', repo]);

// the library reads these when it loads
process.env.HOME = home;
process.env.CLAUDE_CONFIG_DIR = join(home, '.claude');
const env = { ...process.env, SHELL: '/bin/zsh' };

const { installBlock } = await import('../lib/install.mjs');
const { init, stripBlock, markers } = await import('../lib/manifest.mjs');
const { claudeCommand, aliasLine } = await import('../lib/shell.mjs');
const { open, close } = markers('hean-harness', 'html');

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

const BODY = '@~/.claude/hean-harness/global-system-prompt.md\n\nImported.';
const sandbox = name => join(work, name);
const firstLine = f => readFileSync(f, 'utf8').split('\n')[0];

try {
  init();

  // ---- Part 1: placement
  const fresh = sandbox('fresh.md');
  installBlock(fresh, 'hean-harness', BODY, 'html', { top: true });
  const freshText = readFileSync(fresh, 'utf8');
  check('a file that does not exist is created with only the block',
        freshText.startsWith(open + '\n') && freshText.trimEnd().endsWith(close) && freshText.split('\n').length === 7,
        JSON.stringify(freshText));
  stripBlock(fresh, 'hean-harness', 'html', { top: true });
  check('stripping a block that is the whole file leaves an empty file', readFileSync(fresh, 'utf8') === '');

  const mine = sandbox('mine.md');
  const MINE = '# My notes\n\nline one\n';
  writeFileSync(mine, MINE);
  installBlock(mine, 'hean-harness', BODY, 'html', { top: true });
  const mineText = readFileSync(mine, 'utf8');
  check('an existing file gets the block before its own content',
        firstLine(mine) === open && mineText.endsWith(`${close}\n\n${MINE}`), JSON.stringify(mineText));
  installBlock(mine, 'hean-harness', BODY, 'html', { top: true });
  check('installing again leaves the file as it was', readFileSync(mine, 'utf8') === mineText);
  stripBlock(mine, 'hean-harness', 'html', { top: true });
  check('uninstall gives the user\'s content back byte for byte', readFileSync(mine, 'utf8') === MINE);

  const lower = sandbox('lower.md');
  writeFileSync(lower, MINE);
  installBlock(lower, 'hean-harness', 'old body', 'html');           // the old behaviour: appended
  check('the default still appends the block', !readFileSync(lower, 'utf8').startsWith(open));
  installBlock(lower, 'hean-harness', BODY, 'html', { top: true });
  const lowerText = readFileSync(lower, 'utf8');
  check('a block found lower in the file moves to the top',
        firstLine(lower) === open && lowerText.endsWith(`${close}\n\n${MINE}`) && !lowerText.includes('old body'),
        JSON.stringify(lowerText));
  check('exactly one block remains', lowerText.split(open).length === 2);

  // ---- alias
  check('the alias command adds no system prompt flag',
        claudeCommand() === 'claude --dangerously-skip-permissions' &&
        !aliasLine().includes('append-system-prompt-file'), aliasLine());
  check('the alias without the permission bypass is plain claude',
        claudeCommand({ skipPermissions: false }) === 'claude');

  // ---- Part 2: setup in a throwaway home
  const stateDir = join(home, '.claude', 'hean-harness');
  const claudeMd = join(home, '.claude', 'CLAUDE.md');
  const manifestPath = join(stateDir, 'install-manifest.json');
  const OLD_TERMINALS = '!! Every terminal opened before this run still has the old claude alias and fails with "Append system prompt file not found" until you reload its shell (source the startup file or open a new terminal).';
  const setup = () => execFileSync('node', [join(PLUGIN, 'skills', 'setup', 'scripts', 'setup.mjs'), '--repo', repo],
                                   { env, encoding: 'utf8', stdio: 'pipe' });
  const zshrc = () => readFileSync(join(home, '.zshrc'), 'utf8');
  const USER_MD = '# my own CLAUDE.md\nkeep this line\n';
  writeFileSync(claudeMd, USER_MD);

  const freshOut = setup();
  check('a fresh install does not print the old-terminals line', !freshOut.includes(OLD_TERMINALS));
  const md = readFileSync(claudeMd, 'utf8');
  check('setup puts the import block first in CLAUDE.md', firstLine(claudeMd) === open, firstLine(claudeMd));
  check('the block holds the import as a plain line',
        md.split('\n').includes('@~/.claude/hean-harness/global-system-prompt.md'));
  check('the block keeps the repeated rules under the import',
        md.indexOf('@~/.claude/hean-harness/global-system-prompt.md') < md.indexOf('## Rules') &&
        md.includes('still apply if the import cannot load.') && md.includes('### Always') &&
        md.includes('Longer conventions are in `~/.claude/rules/`.'));
  check('the user\'s own CLAUDE.md content follows the block', md.endsWith(`${close}\n\n${USER_MD}`));
  check('the .md prompt is installed', existsSync(join(stateDir, 'global-system-prompt.md')));
  check('no .txt prompt is installed', !existsSync(join(stateDir, 'global-system-prompt.txt')));
  check('the alias carries no system prompt flag',
        zshrc().includes('alias claude="claude --dangerously-skip-permissions"') &&
        !zshrc().includes('append-system-prompt-file'));

  // Turn the install into one made by the old version: .txt copy, old alias, block at the end.
  const old = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const copy = old.changes.find(c => c.type === 'file-copy' && c.target.endsWith('global-system-prompt.md'));
  const txt = join(stateDir, 'global-system-prompt.txt');
  writeFileSync(txt, readFileSync(copy.target));
  rmSync(copy.target);
  copy.target = txt;
  writeFileSync(manifestPath, JSON.stringify(old, null, 2) + '\n');
  writeFileSync(join(home, '.zshrc'), zshrc().replace('alias claude="claude --dangerously-skip-permissions"',
    `alias claude="claude --dangerously-skip-permissions --append-system-prompt-file '${txt}'"`));
  writeFileSync(claudeMd, USER_MD + '\n' + md.slice(0, md.indexOf(`${close}\n`) + close.length + 1).replace(/^\n+/, ''));
  check('the old-install fixture has the .txt copy and the old alias',
        existsSync(txt) && zshrc().includes('append-system-prompt-file') && firstLine(claudeMd) !== open);

  const upgradeOut = setup();
  check('an upgrade from a .txt install prints the old-terminals line', upgradeOut.includes(OLD_TERMINALS));
  check('a rerun over the .txt install leaves only the .md prompt',
        existsSync(join(stateDir, 'global-system-prompt.md')) && !existsSync(txt));
  check('the rerun leaves an alias without the system prompt flag',
        zshrc().includes('alias claude="claude --dangerously-skip-permissions"') &&
        !zshrc().includes('append-system-prompt-file'));
  check('the rerun puts the block first and keeps one block',
        firstLine(claudeMd) === open && readFileSync(claudeMd, 'utf8').split(open).length === 2);
  check('the rerun keeps the user\'s CLAUDE.md content', readFileSync(claudeMd, 'utf8').endsWith(`\n\n${USER_MD}`));

  check('a second rerun does not print the old-terminals line', !setup().includes(OLD_TERMINALS));

  // ---- SessionStart notice for an out-of-date setup
  const hook = () => execFileSync('node', [join(PLUGIN, 'hooks', 'check-installed.mjs')],
                                  { env, encoding: 'utf8', stdio: 'pipe' });
  const running = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const rec = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const matchOut = hook();
  check('the hook is silent about versions when they match', !matchOut.includes('setup was last run with'), matchOut);
  rec.version = '0.0.1';
  writeFileSync(manifestPath, JSON.stringify(rec, null, 2) + '\n');
  const olderOut = hook();
  check('the hook names both versions when setup is older',
        olderOut.includes(`hean-harness setup was last run with 0.0.1; this plugin is ${running}. Run /hean-harness:setup to install the new rules.`),
        olderOut);
  rec.version = running;
  writeFileSync(manifestPath, JSON.stringify(rec, null, 2) + '\n');

  // uninstall
  const revert = JSON.parse(execFileSync('node', [join(PLUGIN, 'scripts', 'lib', 'manifest.mjs'), 'revert'],
                                         { env, encoding: 'utf8', stdio: 'pipe' }));
  check('every recorded change reverses', revert.every(c => c.ok), `${revert.filter(c => c.ok).length}/${revert.length}`);
  check('uninstall removes the .md prompt', !existsSync(join(stateDir, 'global-system-prompt.md')));
  check('uninstall removes the block and gives CLAUDE.md back as the user had it',
        readFileSync(claudeMd, 'utf8') === USER_MD, JSON.stringify(readFileSync(claudeMd, 'utf8')));
  check('uninstall removes the alias', !zshrc().includes('alias claude='));
} finally {
  if (work.startsWith(tmpdir())) rmSync(work, { recursive: true, force: true });
}

// A SIGINT or SIGTERM that arrived during the synchronous run waits for an event-loop turn, and Node does not
// keep the loop alive for a signal listener. One turn here runs its handler (exit 130) before a pass is reported.
await new Promise(resolve => setImmediate(resolve));
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
