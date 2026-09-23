#!/usr/bin/env node
/**
 * Holds a background job's turn until its reply carries a completion marker.
 *
 * A background job's status is read from the text of its messages, never from
 * tool output, and only three strings count: `result:` for finished work,
 * `needs input:` for a turn that is waiting on the person, `failed:` for a task
 * that cannot be done. A reply that ends with "done" instead leaves the job
 * looking unfinished forever, and nothing on screen says why.
 *
 * Wording in a rule file can be missed. This cannot, so the marker lives here
 * and the wording lives beside it as the explanation.
 *
 * Reads the Stop hook payload on standard input. Either blocks once with a
 * reason, or says nothing.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Only these three, each at the start of its own line. */
export const MARKERS = [/^result:/m, /^needs input:/m, /^failed:/m];

export const hasMarker = text => MARKERS.some(re => re.test(text ?? ''));

/**
 * The text of the last thing the assistant said.
 *
 * A transcript line holds one message, and a message's content is a list of
 * blocks — text, tool calls, thinking. Only the text blocks are the reply, so a
 * turn that ended in a tool call has no text to check and is left alone.
 */
export function lastAssistantText(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  let text = null;
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const m = d?.message;
    if (m?.role !== 'assistant') continue;
    const c = m.content;
    if (typeof c === 'string') { text = c; continue; }
    if (!Array.isArray(c)) continue;
    const blocks = c.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text);
    if (blocks.length) text = blocks.join('\n');
  }
  return text;
}

/**
 * The final reply of this turn.
 *
 * Taken from the payload's `last_assistant_message`. The transcript file is
 * written asynchronously and can lag the conversation, so at the moment this
 * hook runs it may not hold the reply yet; reading it there returns the text
 * before the last tool call, and a reply that carries its marker is blocked as
 * though it had none. The transcript is read only when the field is absent.
 */
export function replyText(payload) {
  const m = payload?.last_assistant_message;
  return typeof m === 'string' ? m : lastAssistantText(payload?.transcript_path);
}

/**
 * Block at most once per turn.
 *
 * A hook that blocks every time turns a missing marker into a session that
 * cannot end. The payload's own `stop_hook_active` flag says a block already
 * happened; a file under the job directory covers the case where it is absent,
 * keyed to the turn's `prompt_id` so the next turn starts clean. Without one,
 * the key falls back to the session and the reply's length.
 */
function alreadyBlocked(payload) {
  if (payload?.stop_hook_active) return true;
  const dir = process.env.CLAUDE_JOB_DIR;
  if (!dir) return false;
  const stamp = join(dir, '.result-marker-gate');
  const turn = payload?.prompt_id
    ? `prompt:${payload.prompt_id}`
    : String(payload?.session_id ?? '') + ':' + (replyText(payload) ?? '').length;
  try {
    if (existsSync(stamp) && readFileSync(stamp, 'utf8') === turn) return true;
    mkdirSync(dir, { recursive: true });
    writeFileSync(stamp, turn);
  } catch { /* a stamp we cannot write is not a reason to block twice */ }
  return false;
}

const REASON =
  'This reply has no completion marker, and a background job\'s status is read from message text ' +
  'only. Add one line, at the start of its own line:\n\n' +
  '  result: <one-line headline someone who never saw the ask could read>\n' +
  '  needs input: <exactly what is missing, when one action from the user unblocks this>\n' +
  '  failed: <why the task cannot be done — wrong repository, missing binary, false premise>\n\n' +
  'Use "result:" only for work that has settled; a push or deploy still running is a status update. ' +
  'If this turn was a greeting or a clarifying question, no marker is needed — say so and stop.';

const isMain = process.argv[1] && process.argv[1].endsWith('result-marker-gate.mjs');
if (isMain) {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

  // foreground sessions are read by a person, who needs no marker
  if (!process.env.CLAUDE_JOB_DIR) process.exit(0);

  const text = replyText(payload);
  // nothing said this turn, or a marker already there
  if (!text || !text.trim() || hasMarker(text)) process.exit(0);
  if (alreadyBlocked(payload)) process.exit(0);

  process.stdout.write(JSON.stringify({ decision: 'block', reason: REASON }));
  process.exit(0);
}
