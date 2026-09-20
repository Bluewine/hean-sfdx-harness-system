import { execFileSync } from 'node:child_process';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// <plugin>/hooks/__tests__/ -> <plugin>/hooks/
const HOOK = join(dirname(dirname(fileURLToPath(import.meta.url))), 'git-add-force-guard.mjs');

function denies(command) {
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8'
  });
  return out.includes('"deny"');
}

const cases = [
  // [expected, label, command]
  [true,  'plain short flag',            'git add -f secret.env'],
  [true,  'long flag',                   'git add --force secret.env'],
  [true,  'bundled flag',                'git add -Af secret.env'],
  [true,  'force after a safe command',  'npm test && git add -f build/out.js'],
  [true,  'force on its own line',       'echo hi\ngit add -f secret.env\necho bye'],
  [true,  'equals form',                 'git add --force=x'],

  // the false positives that blocked real work in this session
  [false, 'test -f on another line',     'git add -A\nif test -f docs/x.md; then echo yes; fi'],
  [false, 'test -f, same line, before',  'test -f docs/x.md && git add -A'],
  [false, 'echo of the phrase',          "echo 'git add -f'"],
  [false, 'printf of the phrase',        'printf \'git add -f\\n\''],
  [false, 'comment mentioning it',       'git add -A   # never use git add -f here'],
  [false, 'commit message mentioning it','git commit -m "explain why git add -f is banned"'],
  [false, 'find with -f elsewhere',      'find . -name x -type f\ngit add -A'],
  [false, 'grep -f pattern file',        'grep -f patterns.txt list.txt\ngit add report.md'],

  // plain safe commands
  [false, 'ordinary add',                'git add -A'],
  [false, 'add by path',                 'git add docs/notes.md'],
  [false, 'no git at all',               'rm -f /tmp/scratch'],
  [false, 'empty command',               ''],
];

let pass = 0, fail = 0;
for (const [expected, label, command] of cases) {
  const got = denies(command);
  const ok = got === expected;
  ok ? pass++ : fail++;
  const shown = command.replace(/\n/g, ' \\n ') || '(empty)';
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${expected ? 'deny  ' : 'allow '} ${label.padEnd(28)} ${shown}`);
}
console.log(`\n  ${pass} passed, ${fail} failed`);

// malformed input must never crash or deny
for (const raw of ['', 'not json', '{}', '{"tool_input":null}', '{"tool_input":{"command":null}}']) {
  const out = execFileSync('node', [HOOK], { input: raw, encoding: 'utf8' });
  console.log(`  malformed input ${JSON.stringify(raw).padEnd(34)} -> ${out === '' ? 'silent, exit 0' : out}`);
}
process.exit(fail ? 1 : 0);
