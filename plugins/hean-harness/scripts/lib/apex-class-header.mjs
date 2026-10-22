/**
 * Checks that a commit records a class comment that follows "Class header" in
 * apex-docstring-comments.md. A new class ends its class comment with
 * "@since <YYYY-MM-DD> <WORK-ID>" and never says "Initial setup". An edited
 * class carries a "@changes <YYYY-MM-DD> <WORK-ID>: <text>" line for the
 * branch's story (or a "@since" from that story). A class comment holds at
 * most 5 "@changes" lines.
 *
 * The class comment is the block comment starting "/**" directly before the
 * first top-level class, interface or enum declaration; annotations and
 * modifiers may sit between them. Source is scanned, not parsed: comments and
 * string literals are skipped, braces are counted to find the top level.
 *
 * Shared by the Claude Code hook and the git pre-commit hook. Setup copies this
 * file to <config>/hean-harness/hooks/scripts/lib/ with the files
 * install-manifest-check.mjs lists, so this file imports only node built-ins
 * and files in that list. --git-hook runs it as git's pre-commit hook.
 *
 * A branch with no work ID is not checked. When the check cannot run the
 * commit goes through with a "!!" line naming the reason.
 */

import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

import { tryGit } from './command-line.mjs';
import { MAX_BUFFER, WORK_ID } from './merge-base.mjs';
import { operationInProgress } from './manifest-check.mjs';
import { isSfdxRepo } from './paths.mjs';

const CLASS_FILE = /(^|\/)force-app\/.+\.cls$/;
const MAX_CHANGES = 5;
const DECLARATION = /^(class|interface|enum)\b/i;
const IDENT = /[A-Za-z0-9_]/;

/** Whether a path is an Apex class under force-app, at any depth. */
export const isApexClassFile = path => CLASS_FILE.test(path);

/** The text of the class comment of this source, or null when there is none. */
export function classComment(source) {
  let depth = 0;
  let lastDoc = null; // { text, end } of the latest /** */ comment at the top level
  for (let i = 0; i < source.length;) {
    const two = source.slice(i, i + 2);
    if (two === '//') { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (two === '/*') {
      const close = source.indexOf('*/', i + 2);
      const end = close < 0 ? source.length : close + 2;
      if (depth === 0 && source.startsWith('/**', i)) lastDoc = { text: source.slice(i, end), end };
      i = end;
      continue;
    }
    const ch = source[i];
    if (ch === "'") {
      for (i++; i < source.length && source[i] !== "'"; i++) if (source[i] === '\\') i++;
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && IDENT.test(ch) && !(i > 0 && IDENT.test(source[i - 1])) && DECLARATION.test(source.slice(i, i + 10))) {
      if (!lastDoc) return null;
      // between the comment and the declaration only annotations and modifiers may stand
      const between = source.slice(lastDoc.end, i)
        .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/@\w+(\s*\((?:'(?:\\.|[^'\\])*'|[^)'])*\))?/g, ' ')
        .replace(/\b(public|private|protected|global|virtual|abstract|with\s+sharing|without\s+sharing|inherited\s+sharing)\b/gi, ' ');
      return between.trim() === '' ? lastDoc.text : null;
    }
    i++;
  }
  return null;
}

/**
 * What is wrong with the class comment of one Apex class: [{ path, kind, count? }].
 * kind is 'since', 'initial-setup', 'changes' or 'too-many'. isNew says the
 * commit adds the file. A path outside force-app, a path that is not a class
 * and a missing work ID are not checked.
 */
export function headerFindings(source, { isNew, workId, path }) {
  if (!workId || !isApexClassFile(path)) return [];
  const comment = classComment(source) ?? '';
  const date = '\\d{4}-\\d{2}-\\d{2}';
  const id = workId.replace(/[^A-Za-z0-9-]/g, '');
  const since = new RegExp(`@since\\s+${date}\\s+${id}(?![\\w-])`).test(comment);
  const changes = new RegExp(`^[ \\t]*\\*?[ \\t]*@changes\\s+${date}\\s+${id}:[ \\t]*\\S`, 'm').test(comment);
  const findings = [];
  if (isNew) {
    if (!since) findings.push({ path, kind: 'since' });
    if (/initial setup/i.test(comment)) findings.push({ path, kind: 'initial-setup' });
  } else if (!since && !changes) {
    findings.push({ path, kind: 'changes' });
  }
  const count = (comment.match(/^[ \t]*\*?[ \t]*@changes\b/gm) ?? []).length;
  if (count > MAX_CHANGES) findings.push({ path, kind: 'too-many', count });
  return findings;
}

const reason = (f, workId) => ({
  since: `no "@since <date> ${workId}"`,
  'initial-setup': '"Initial setup" in the class comment',
  changes: `no "@changes <date> ${workId}: …" line`,
  'too-many': `${f.count} @changes lines (at most ${MAX_CHANGES})`,
})[f.kind];

/** The refusal for a commit that records these findings. */
export function refusalText(findings, workId) {
  const lines = findings.map(f => `    ${f.path}: ${reason(f, workId)}`);
  return '!! This commit changes Apex classes whose class comment does not follow "Class header" in apex-docstring-comments.md:\n\n' +
         `${lines.join('\n')}\n\n` +
         `New class: end the class comment with "@since <YYYY-MM-DD> ${workId}". ` +
         `Edited class: add "@changes <YYYY-MM-DD> ${workId}: <what this story changed>" below the existing tags, ` +
         `keep at most ${MAX_CHANGES} @changes lines (delete the oldest), and never change @since. Then retry the commit.`;
}

/** The line a commit that goes through unchecked carries. */
export const notChecked = reason => `!! The Apex class header check did not run: ${String(reason).replace(/\.$/, '')}.`;

/**
 * --git-hook: run as git's pre-commit hook. git has built the index the commit
 * records, so the staged classes are read from it: added files are new,
 * modified and renamed files are changed. Exit 3 refuses the commit, and the
 * shell hook turns it into git's 1; any other code lets the commit through.
 * Every message goes to standard error, which git shows. A failure of the
 * check itself lets the commit through, as every other "cannot run" case does.
 */
if (process.argv[1] && basename(process.argv[1]) === 'apex-class-header.mjs' && process.argv.includes('--git-hook')) {
  try {
    // git names the index relative to the top of the working tree, where it starts the hook; the calls below use -C
    if (process.env.GIT_INDEX_FILE) process.env.GIT_INDEX_FILE = resolve(process.env.GIT_INDEX_FILE);
    const root = tryGit(process.cwd(), 'rev-parse', '--show-toplevel');
    if (!root) throw new Error('the current folder is not in a git repository');
    if (!isSfdxRepo(root) || operationInProgress(root)) process.exit(0);
    const branch = tryGit(root, 'branch', '--show-current');
    const workId = branch ? WORK_ID.exec(branch)?.[0] : null;
    if (!workId) process.exit(0);
    const names = filter => {
      const list = spawnSync('git', ['-C', root, 'diff', '--cached', '-M', '--name-only', `--diff-filter=${filter}`, '-z'],
                             { encoding: 'utf8', maxBuffer: MAX_BUFFER });
      if (list.status !== 0) throw new Error(`git could not list the staged files (${list.stderr.trim() || `exit ${list.status}`})`);
      return list.stdout.split('\0').filter(isApexClassFile);
    };
    const findings = [];
    for (const [isNew, filter] of [[true, 'A'], [false, 'MR']]) {
      for (const rel of names(filter)) {
        const blob = spawnSync('git', ['-C', root, 'show', `:${rel}`], { encoding: 'utf8', maxBuffer: MAX_BUFFER });
        if (blob.status !== 0) throw new Error(`git could not read ${rel} from the index`);
        findings.push(...headerFindings(blob.stdout, { isNew, workId, path: rel }));
      }
    }
    if (!findings.length) process.exit(0);
    process.stderr.write(`${refusalText(findings, workId)}\n`);
    process.exit(3);
  } catch (e) {
    process.stderr.write(`${notChecked(e.message)}\n`);
    process.exit(0);
  }
}
