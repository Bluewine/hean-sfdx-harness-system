#!/usr/bin/env node
/**
 * What the Flow description gate must let through, and what it must stop,
 * including commands that stage Flow files and commit them in the same call.
 *
 * Every run uses a throwaway CLAUDE_CONFIG_DIR for the verified-changes record,
 * and a throwaway git repository holding one Flow.
 *
 * Run: node hooks/__tests__/flow-description-gate.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOK = join(dirname(dirname(fileURLToPath(import.meta.url))), 'flow-description-gate.mjs');

const sandbox = mkdtempSync(join(tmpdir(), 'flow-gate-'));
const env = { ...process.env, CLAUDE_CONFIG_DIR: join(sandbox, 'config') };
const REPO = join(sandbox, 'repo');
const ELSEWHERE = join(sandbox, 'elsewhere');
mkdirSync(ELSEWHERE);
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', env }).trim();

const FLOWS = 'force-app/main/default/flows';
const FLOW = `${FLOWS}/Account_After_Save.flow-meta.xml`;
const NEW_FLOW = `${FLOWS}/Brand_New.flow-meta.xml`;
const write = (rel, text) => { mkdirSync(dirname(join(REPO, rel)), { recursive: true }); writeFileSync(join(REPO, rel), text); };

mkdirSync(REPO);
git('init', '-q', '-b', 'main');
git('config', 'user.email', 't@example.com');
git('config', 'user.name', 'T');
write(FLOW, '<Flow><description>2026-01-01: first</description></Flow>\n');
write('notes.txt', 'one\n');
git('add', '.');
git('commit', '-q', '-m', 'base');

/** Put the working tree in a known state: optionally a changed Flow, a new Flow, a changed note. */
function reset({ flow = false, newFlow = false, note = false, stageFlow = false } = {}) {
  git('reset', '-q', '--hard');
  git('clean', '-qfd');
  if (flow) write(FLOW, '<Flow><description>2026-01-01: first</description><x/></Flow>\n');
  if (newFlow) write(NEW_FLOW, '<Flow/>\n');
  if (note) write('notes.txt', 'two\n');
  if (stageFlow) git('add', '--', FLOW);
}

/** Run the gate exactly as Claude Code does; the refusal text, or null when allowed. */
function refusal(command, cwd = REPO) {
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }), encoding: 'utf8', env
  });
  const o = JSON.parse(out || '{}').hookSpecificOutput;
  return o?.permissionDecision === 'deny' ? o.permissionDecisionReason : null;
}

let pass = 0, fail = 0;
const expect = (label, got, want) => {
  const ok = want === null ? got === null : got !== null && got.includes(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}\n        expected ${want === null ? 'allow' : `deny containing ${JSON.stringify(want)}`}, got ${got === null ? 'allow' : JSON.stringify(got)}`);
};
const SAME = 'same call';
const UNCHECKED = 'have not been checked';

console.log('Staged in the same call');
reset({ flow: true });
expect('git add <flow> && git commit', refusal(`git add -- ${FLOW} && git diff --cached --stat && git commit -q -m "x"`), SAME);
expect('the refusal names the file', refusal(`git add -- ${FLOW} && git commit -m "x"`), FLOW);
expect('git add . && git commit', refusal('git add . && git commit -m "x"'), SAME);
expect('git add -A && git commit', refusal('git add -A && git commit -m "x"'), SAME);
expect('git add -u && git commit', refusal('git add -u && git commit -m "x"'), SAME);
expect('git add of the folder', refusal(`git add ${FLOWS} && git commit -m "x"`), SAME);
expect('git stage', refusal(`git stage ${FLOW} && git commit -m "x"`), SAME);
expect('git commit -am', refusal('git commit -am "x"'), SAME);
expect('git commit -a -m', refusal('git commit -a -m "x"'), SAME);
expect('git commit --all', refusal('git commit --all -m "x"'), SAME);
expect('git commit with a path', refusal(`git commit -m "x" -- ${FLOW}`), SAME);
expect('pathspec as a variable', refusal('git add "$FILES" && git commit -m "x"'), SAME);
expect('cd into the repository first', refusal(`cd ${REPO} && git add -A && git commit -m "x"`, ELSEWHERE), SAME);
expect('git -C the repository', refusal(`git -C ${REPO} add -A && git -C ${REPO} commit -m "x"`, ELSEWHERE), SAME);
reset({ newFlow: true });
expect('a new, untracked Flow', refusal(`git add ${FLOWS} && git commit -m "x"`), SAME);
expect('commit -a leaves untracked files alone', refusal('git commit -am "x"'), null);

console.log('Allowed');
reset({ flow: true, note: true });
expect('staging only a non-Flow file', refusal('git add notes.txt && git commit -m "x"'), null);
expect('a dry-run add', refusal('git add -n . && git commit -m "x"'), null);
expect('staging with no commit', refusal(`git add -- ${FLOW}`), null);
expect('the message mentions a flow path', refusal(`git add notes.txt && git commit -m "${FLOW}"`), null);
expect('git commit inside an echo', refusal('echo "git add -A && git commit -m x"'), null);
reset({ note: true });
expect('no Flow changes at all', refusal('git add -A && git commit -m "x"'), null);
expect('outside any repository', refusal('git add -A && git commit -m "x"', ELSEWHERE), null);

console.log('Already staged');
reset({ flow: true, stageFlow: true });
expect('staged Flow, unchecked', refusal('git commit -m "x"'), UNCHECKED);
expect('staged Flow, commit through git -C from elsewhere', refusal(`git -C ${REPO} commit -m "x"`, ELSEWHERE), UNCHECKED);
execFileSync('node', [HOOK, '--mark-verified'], { cwd: REPO, env, encoding: 'utf8' });
expect('staged Flow, checked', refusal('git commit -m "x"'), null);
expect('checked, and the add in the call stages nothing new', refusal(`git add ${FLOWS} && git commit -m "x"`), null);
write(FLOW, '<Flow><description>2026-01-01: first</description><y/></Flow>\n');
expect('checked, then changed again and staged in the call', refusal(`git add ${FLOWS} && git commit -m "x"`), SAME);

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
