#!/usr/bin/env node
/**
 * What the completion-marker gate must hold, and what it must let through.
 *
 * Run: node hooks/__tests__/result-marker-gate.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HOOK = join(dirname(dirname(fileURLToPath(import.meta.url))), 'result-marker-gate.mjs');
const work = mkdtempSync(join(tmpdir(), 'marker-gate-'));

/** Build a transcript whose last assistant message says `text`, then run the hook. */
function blocked(text, { job = true, stopActive = false, blocks = null, last, promptId, jobDir } = {}) {
  const tp = join(work, `t-${Math.random().toString(36).slice(2)}.jsonl`);
  const content = blocks ?? (text === null ? [{ type: 'tool_use', name: 'Bash' }]
                                           : [{ type: 'text', text }]);
  writeFileSync(tp, [
    JSON.stringify({ message: { role: 'user', content: 'do the thing' } }),
    JSON.stringify({ message: { role: 'assistant', content } })
  ].join('\n') + '\n');

  const env = { ...process.env, CLAUDE_JOB_DIR: jobDir ?? join(work, 'job-' + Math.random().toString(36).slice(2)) };
  if (!job) delete env.CLAUDE_JOB_DIR;

  const payload = { transcript_path: tp, session_id: 's1', stop_hook_active: stopActive };
  if (last !== undefined) payload.last_assistant_message = last;
  if (promptId !== undefined) payload.prompt_id = promptId;
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8', env
  });
  if (!out.trim()) return false;
  return JSON.parse(out).decision === 'block';
}

const ALLOW = [
  ['result: on its own line',        'Did the work.\n\nresult: ported two rules into the plugin'],
  ['needs input:',                   'Stuck on one thing.\n\nneeds input: which sandbox to deploy to'],
  ['failed:',                        'Cannot proceed.\n\nfailed: this is not a git repository'],
  ['marker is the whole reply',      'result: done'],
  ['marker after a long body',       'a\nb\nc\nd\n\nresult: all three tests pass'],
  ['not a background job',           'Plain reply, no marker at all'],
  ['turn ended in a tool call',      null],
  ['empty reply',                    '   '],
  ['already blocked once',           'no marker here'],
];

const DENY = [
  ['prose instead of a marker',      'All done, everything works.'],
  ['"finished" is not a marker',     'Finished the port.'],
  ['marker mid-line',                'The result: is that it works.'],
  ['marker in a sentence',           'I would call that a result: success.'],
  ['wrong marker word',             'outcome: ported two rules'],
  ['a question with no marker',      'Which org did you mean?'],
];

let pass = 0, fail = 0;
const check = (label, want, text, opts) => {
  const got = blocked(text, opts);
  const ok = got === want;
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}: expected ${want ? 'block' : 'allow'}, got ${got ? 'block' : 'allow'}`);
};

console.log('Allowed through');
for (const [label, text] of ALLOW) {
  const opts = label === 'not a background job' ? { job: false }
             : label === 'already blocked once' ? { stopActive: true } : {};
  check(label, false, text, opts);
}
console.log('Held');
for (const [label, text] of DENY) check(label, true, text);

// The transcript is written asynchronously; at Stop time it can still end with
// the text before the last tool call. The payload's own copy of the reply wins.
console.log('Reply taken from the payload');
check('transcript lags, payload reply has the marker', false,
      'Checking the report first.', { last: 'Confirmed.\n\nneeds input: whether to build the fix' });
check('payload reply has no marker, transcript does', true,
      'result: an older reply', { last: 'All done, everything works.' });

console.log('Once per turn');
const jobDir = join(work, 'job-shared');
check('first stop of a turn is held',        true,  'no marker', { promptId: 'p1', jobDir });
check('second stop of the same turn passes', false, 'no marker, still', { promptId: 'p1', jobDir });
check('the next turn is held again',         true,  'no marker', { promptId: 'p2', jobDir });

console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total`);
rmSync(work, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
