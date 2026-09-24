#!/usr/bin/env node
/**
 * A memory index must stay correct after Claude Code's memory writer rewrites it.
 *
 * That writer rewrites MEMORY.md as a whole file and drops the markers an
 * earlier version of setup put around its lines. Setup then added every line a
 * second time and uninstall had nothing to remove. Lines are now owned by the
 * file they link to. This test fails if a rewrite, a second setup or an
 * uninstall touches any line that is not the plugin's.
 *
 * Runs against a throwaway home directory. Touches nothing of yours.
 *
 * Run: node scripts/__tests__/memory-index.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { mergeIndex, stripIndex, linkTarget, indexLine, titleFrom } from '../lib/memory-index.mjs';
import { markers, note } from '../lib/manifest.mjs';

// <plugin>/scripts/__tests__/ -> <plugin>/scripts
const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const MEMORIES = join(dirname(SCRIPTS), 'assets', 'memories');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

const { open, close } = markers('hean-harness', 'html');
const NOTE = note('hean-harness', 'html');
const entry = (file, hook = 'new hook') => ({ file, line: `- [${file}](${file}) — ${hook}` });
const targets = text => text.split('\n').map(linkTarget).filter(Boolean);

// ---- the text rules --------------------------------------------------------

{
  const text = `# Memory Index\n\n- [mine](mine.md) — my own\n\n${open}\n${NOTE}\n- [a](a.md) — old\n${close}\n`;
  const out = mergeIndex(text, [entry('a.md')], { drop: [open, close, NOTE] });
  check('the old markers are removed and the lines between them kept',
        out === '# Memory Index\n\n- [mine](mine.md) — my own\n\n- [a.md](a.md) — new hook\n', JSON.stringify(out));
}
{
  const text = '# Memory Index\n\n- [a](a.md) — old\n- [mine](mine.md) — my own\n- [b](b.md) — old\n';
  const out = mergeIndex(text, [entry('a.md'), entry('b.md')]);
  check('a plugin line is replaced where it sits',
        out === '# Memory Index\n\n- [a.md](a.md) — new hook\n- [mine](mine.md) — my own\n- [b.md](b.md) — new hook\n',
        JSON.stringify(out));
}
{
  const text = '# Memory Index\n- [a](a.md) — first\n- [mine](mine.md) — my own\n- [a again](a.md) — second\n* [a third](./a.md) — third\n';
  const out = mergeIndex(text, [entry('a.md')]);
  check('duplicates of a plugin line are removed, the first kept in place',
        out === '# Memory Index\n- [a.md](a.md) — new hook\n- [mine](mine.md) — my own\n', JSON.stringify(out));
}
{
  const text = '# Memory Index\n\n- [mine](mine.md) — my own\n\n';
  const out = mergeIndex(text, [entry('a.md'), entry('b.md')]);
  check('missing lines go after the last entry, with no blank line inside the list',
        out === '# Memory Index\n\n- [mine](mine.md) — my own\n- [a.md](a.md) — new hook\n- [b.md](b.md) — new hook\n\n',
        JSON.stringify(out));
  check('a new index starts with the heading and a blank line',
        mergeIndex(null, [entry('a.md')]) === '# Memory Index\n\n- [a.md](a.md) — new hook\n');
  check('a file with no final newline is written back without one',
        mergeIndex('# Memory Index\n- [a](a.md) — old', [entry('a.md')]) === '# Memory Index\n- [a.md](a.md) — new hook');
}
{
  const user = ['# My Index', '', '## Mine', 'Some prose with a [link](a.md) inline.', '- [mine](mine.md) — my own',
                '  - nested note', '', '## More', '- [other](other.md) — also mine'];
  const out = mergeIndex(user.join('\n') + '\n', [entry('a.md'), entry('b.md')]);
  const kept = out.split('\n').filter(l => !['a.md', 'b.md'].includes(linkTarget(l)));
  check('user lines and headings are untouched byte for byte', kept.join('\n') === user.join('\n') + '\n',
        JSON.stringify(out));
  check('uninstall removes only plugin lines', stripIndex(out, ['a.md', 'b.md']) === user.join('\n') + '\n');
}
{
  const out = mergeIndex('- [a](a.md) — x\n- [gone](gone.md) — dropped\n- [mine](mine.md) — y\n', [entry('a.md')],
                         { retired: ['a.md', 'gone.md'] });
  check('a line for a memory the plugin stopped shipping is removed',
        out === '- [a.md](a.md) — new hook\n- [mine](mine.md) — y\n', JSON.stringify(out));
}
{
  const src = join(MEMORIES, 'project', 'feedback_avoid_deferred_wording_for_completed_moves.md');
  check('a quoted description is unquoted, with its escaped quotes kept',
        indexLine(src).includes('as "deferred" when'), indexLine(src));
}
check('a dashed slug becomes a title without its type word', titleFrom('feedback-no-duplicated-code') === 'No duplicated code',
      titleFrom('feedback-no-duplicated-code'));
check('an underscored slug becomes a title', titleFrom('explicit_target_org') === 'Explicit target org',
      titleFrom('explicit_target_org'));
check('a slug keeps a type word that is not the first word',
      titleFrom('reference_workstep_object_perms_unsettable') === 'Workstep object perms unsettable');
check('a name that is only a type word is kept as it is',
      titleFrom('feedback-') === 'feedback-' && titleFrom('project_') === 'project_',
      `${titleFrom('feedback-')} ${titleFrom('project_')}`);
check('a name that is already readable is used as it is',
      titleFrom('Always merge with --no-ff') === 'Always merge with --no-ff');

// ---- setup, doctor and uninstall in a sandbox ------------------------------

const root = mkdtempSync(join(tmpdir(), 'hean-index-'));
const home = join(root, 'home');
const repo = join(root, 'repo');
mkdirSync(join(home, '.claude'), { recursive: true });
mkdirSync(repo, { recursive: true });
execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main']);

const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude') };
const run = (script, args = []) =>
  execFileSync('node', [join(SCRIPTS, script), ...args], { env, encoding: 'utf8', stdio: 'pipe' });
const manifest = () => JSON.parse(readFileSync(join(home, '.claude', 'hean-harness', 'install-manifest.json'), 'utf8'));
const shipped = dir => readdirSync(dir).filter(f => f.endsWith('.md')).sort();

const memDir = join(home, '.claude', 'projects', repo.replace(/[/.]/g, '-'), 'memory');
const index = join(memDir, 'MEMORY.md');
const agentIndex = join(repo, '.claude', 'agent-memory', 'sfdx-deployer', 'MEMORY.md');
const projectShipped = shipped(join(MEMORIES, 'project'));

try {
  // What an earlier version left: the person's own lines, then its marked block,
  // then Claude Code's writer rewrote the file and dropped the markers.
  const USER_TOP = '# Memory Index\n\n- [My own note](my_note.md) — mine\n';
  const USER_BOTTOM = '\n## Later\n- [Another of mine](another.md) — also mine\n';
  const oldLines = projectShipped.slice(0, 3).map(f => `- [Old title](${f}) — old hook`).join('\n');
  mkdirSync(memDir, { recursive: true });
  run('lib/manifest.mjs', ['record', '--type', 'marker-block', '--target', index, '--marker', 'hean-harness',
                           '--style', 'html', '--existed-before', 'true']);
  writeFileSync(index, `${USER_TOP}\n${oldLines}\n${USER_BOTTOM}`);

  run('install-memories.mjs', ['--repo', repo]);
  const repaired = readFileSync(index, 'utf8');
  const links = targets(repaired);
  check('a rewrite without markers is repaired with no duplicate lines', links.length === new Set(links).size,
        `${links.length} lines, ${new Set(links).size} targets`);
  check('every shipped project memory has a line', projectShipped.every(f => links.includes(f)),
        `${projectShipped.filter(f => links.includes(f)).length}/${projectShipped.length}`);
  check('the person\'s own lines are all still there, in order',
        repaired.startsWith(USER_TOP) && repaired.includes(USER_BOTTOM.trimEnd()));
  check('a stale line is replaced in place with the generated one',
        !repaired.includes('Old title') && repaired.indexOf(projectShipped[0]) < repaired.indexOf('## Later'));
  const entries = manifest().changes.filter(c => c.target === index);
  check('the old marked-block entry is replaced by one index-lines entry',
        entries.length === 1 && entries[0].type === 'index-lines' && entries[0].existedBefore === true,
        JSON.stringify(entries.map(c => c.type)));

  run('install-memories.mjs', ['--repo', repo]);
  check('a second setup leaves the index as it was', readFileSync(index, 'utf8') === repaired);

  const agentText = readFileSync(agentIndex, 'utf8');
  check('an agent index gets one generated line per shipped agent memory',
        agentText === '# Memory Index\n\n' +
          shipped(join(MEMORIES, 'agent', 'sfdx-deployer'))
            .map(f => indexLine(join(MEMORIES, 'agent', 'sfdx-deployer', f)) + '\n').join(''),
        JSON.stringify(agentText));
  const devIndex = join(repo, '.claude', 'agent-memory', 'developer', 'MEMORY.md');
  writeFileSync(devIndex, readFileSync(devIndex, 'utf8') + '- [Team note](team_note.md) — the team\'s\n');

  writeFileSync(join(memDir, 'stray_memory.md'), '---\nname: stray\ndescription: x\n---\n');
  const doctor = (() => { try { return run('doctor.mjs'); } catch (e) { return String(e.stdout ?? ''); } })();
  const section = doctor.slice(doctor.indexOf('Memory indexes'));
  check('doctor reports a memory file no index line links to',
        /\n\s+1\s+not in the index\s+\S+memory\n\s+stray_memory\.md\n/.test(section), section.split('\n\n')[0]);

  const revert = JSON.parse(run('lib/manifest.mjs', ['revert']));
  check('every recorded change reverses', revert.every(c => c.ok),
        JSON.stringify(revert.filter(c => !c.ok)));
  check('uninstall leaves only the person\'s own lines in an index they had',
        readFileSync(index, 'utf8') === `${USER_TOP}\n${USER_BOTTOM}`, JSON.stringify(readFileSync(index, 'utf8')));
  check('an index setup created is deleted once only the heading is left', !existsSync(agentIndex));
  check('an index setup created is kept when it holds someone else\'s line',
        readFileSync(devIndex, 'utf8') === '# Memory Index\n\n- [Team note](team_note.md) — the team\'s\n',
        JSON.stringify(existsSync(devIndex) && readFileSync(devIndex, 'utf8')));

  // A MEMORY.md that still has the earlier version's markers around its lines.
  const home2 = join(root, 'home2');
  const repo2 = join(root, 'repo2');
  mkdirSync(join(home2, '.claude'), { recursive: true });
  mkdirSync(repo2, { recursive: true });
  execFileSync('git', ['-C', repo2, 'init', '-q', '-b', 'main']);
  const env2 = { ...env, HOME: home2, CLAUDE_CONFIG_DIR: join(home2, '.claude') };
  const memDir2 = join(home2, '.claude', 'projects', repo2.replace(/[/.]/g, '-'), 'memory');
  const index2 = join(memDir2, 'MEMORY.md');
  const MINE = '# Memory Index\n\n- [My own note](my_note.md) — mine\n## Notes\nprose of my own\n';
  mkdirSync(memDir2, { recursive: true });
  writeFileSync(index2, MINE);
  const oldBody = projectShipped.map(f => `- [Old title](${f}) — old hook`).join('\n');
  execFileSync('node', ['--input-type=module', '-e',
    `import { installBlock } from ${JSON.stringify(join(SCRIPTS, 'lib', 'install.mjs'))};
     installBlock(process.argv[1], 'hean-harness', process.argv[2], 'html');`, index2, oldBody],
    { env: env2, stdio: 'pipe' });
  const manifest2 = () => JSON.parse(readFileSync(join(home2, '.claude', 'hean-harness', 'install-manifest.json'), 'utf8'))
    .changes.filter(c => c.target === index2);
  check('the old block format is in place before the new install',
        readFileSync(index2, 'utf8').includes(open) && manifest2().map(c => c.type).join() === 'marker-block');

  execFileSync('node', [join(SCRIPTS, 'install-memories.mjs'), '--repo', repo2], { env: env2, stdio: 'pipe' });
  const migrated = readFileSync(index2, 'utf8');
  const links2 = targets(migrated);
  check('the markers and their note are removed',
        ![open, close, NOTE].some(l => migrated.includes(l)), JSON.stringify(migrated.slice(0, 300)));
  check('a marked file has no duplicate lines after the new install',
        links2.length === new Set(links2).size && projectShipped.every(f => links2.includes(f)),
        `${links2.length} lines, ${new Set(links2).size} targets`);
  check('the person\'s lines in a marked file are unchanged', migrated.startsWith(MINE), JSON.stringify(migrated.slice(0, 200)));
  const kinds = manifest2().map(c => c.type);
  check('the manifest holds one index-lines entry and no marker-block entry for the file',
        kinds.join() === 'index-lines', JSON.stringify(kinds));
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n  ${failures ? `${failures} failed` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
