/**
 * The lines this plugin owns in a memory folder's MEMORY.md index.
 *
 * An index line belongs to the plugin exactly when its link target, the
 * "(file.md)" in "- [Title](file.md) — hook", is the name of a memory the plugin
 * ships into that folder. Ownership used to be a marked block, but Claude Code's
 * memory writer rewrites MEMORY.md as a whole file and drops the markers. After
 * that, setup could not find its block and added every line a second time, and
 * uninstall had nothing to remove. The link target is the one part of a line
 * that any rewrite keeping the index working has to keep.
 *
 * Every other line — the person's own entries, headings, blank lines, prose —
 * is never changed, moved or removed here.
 *
 * Pure text in and text out, apart from reading a memory's frontmatter, so the
 * installer, the revert and doctor all share one reading of the file.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';

export const INDEX = 'MEMORY.md';
export const HEADING = '# Memory Index';

/** The file an index line links to, or null when the line is not a link entry. */
export function linkTarget(line) {
  const m = /^\s*[-*]\s+\[.*?\]\(\s*(?:\.\/)?([^)\s]+)\s*\)/.exec(line);
  return m ? m[1] : null;
}

const isListItem = line => /^\s*[-*]\s/.test(line);

// YAML scalars as the shipped memories write them: plain, or quoted with the
// quote character escaped inside
function unquote(s) {
  if (s.length > 1 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (s.length > 1 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/**
 * The index line for one memory, built from its frontmatter. The frontmatter is
 * the one source for the title and hook, so a hand-kept index cannot fall out
 * of step with the memories it lists. Throws when either field is missing,
 * because an entry with an empty title would still claim the file.
 */
export function indexLine(path) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, 'utf8'))?.[1] ?? '';
  const field = key => unquote(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(fm)?.[1].trim() ?? '');
  const name = field('name');
  const description = field('description');
  if (!name || !description) {
    throw new Error(`${path} has no name or description in its frontmatter, so its index line cannot be written.`);
  }
  return `- [${name}](${basename(path)}) — ${description}`;
}

// Split into lines without the final newline, and say whether there was one,
// so the file is written back with or without it exactly as it came.
function splitLines(text) {
  const endsNL = text === '' || text.endsWith('\n');
  const lines = text.split('\n');
  if (endsNL) lines.pop();
  return { lines, endsNL };
}

const joinLines = ({ lines, endsNL }) => lines.join('\n') + (endsNL && lines.length ? '\n' : '');

/**
 * Put the plugin's lines into an index.
 *
 *   text      the file's content, or null when it does not exist yet
 *   entries   [{ file, line }] in the order to append missing ones
 *   drop      exact lines (trimmed) to remove wherever they are: the old markers
 *   retired   file names the plugin owned before and no longer ships; their
 *             lines go, since nothing else will ever remove them
 *
 * A line linking to a shipped memory is replaced where it sits; any further
 * line linking to the same memory is deleted. A memory with no line gets one
 * after the last list entry, or at the end when the file ends in something
 * other than a list, so no blank line lands inside the list.
 */
export function mergeIndex(text, entries, { drop = [], retired = [] } = {}) {
  const parsed = splitLines(text ?? `${HEADING}\n\n`);
  const lineFor = new Map(entries.map(e => [e.file, e.line]));
  const dropped = new Set(drop);
  const gone = new Set(retired.filter(f => !lineFor.has(f)));
  const seen = new Set();

  const lines = parsed.lines.flatMap(l => {
    if (dropped.has(l.trim())) return [];
    const target = linkTarget(l);
    if (gone.has(target)) return [];
    if (!lineFor.has(target)) return [l];
    if (seen.has(target)) return [];
    seen.add(target);
    return [lineFor.get(target)];
  });

  const missing = entries.filter(e => !seen.has(e.file)).map(e => e.line);
  if (missing.length) {
    let last = lines.length - 1;
    while (last >= 0 && lines[last].trim() === '') last--;
    lines.splice(last >= 0 && isListItem(lines[last]) ? last + 1 : lines.length, 0, ...missing);
  }
  return joinLines({ lines, endsNL: parsed.endsNL || text === null });
}

/** Remove the lines linking to any of these files; every other line stays. */
export function stripIndex(text, files) {
  const owned = new Set(files);
  const parsed = splitLines(text);
  return joinLines({ ...parsed, lines: parsed.lines.filter(l => !owned.has(linkTarget(l))) });
}

/** True when nothing but the heading and blank lines is left. */
export const onlyHeading = text =>
  text.split('\n').every(l => l.trim() === '' || l.trim() === HEADING);

/** The files an index links to, read from the folder's MEMORY.md. */
export function indexedFiles(dir) {
  const p = join(dir, INDEX);
  if (!existsSync(p)) return new Set();
  return new Set(readFileSync(p, 'utf8').split('\n').map(linkTarget).filter(Boolean));
}

/** Memory files in a folder that no index line links to, sorted by name. */
export function unindexed(dir) {
  if (!existsSync(dir)) return [];
  const linked = indexedFiles(dir);
  return readdirSync(dir).filter(f => f.endsWith('.md') && f !== INDEX && !linked.has(f)).sort();
}
