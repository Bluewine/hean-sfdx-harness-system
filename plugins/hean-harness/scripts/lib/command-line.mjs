/**
 * Reads a Bash tool call's command text the way the shell would split it, so
 * the hooks can find the commands in it and the folder each one runs in.
 *
 * Shared by the commit message gate and the org write gate. Both need the same
 * answer to "which command runs where", and two copies of a parser drift.
 */

import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * Split a shell command into its simple commands, each a list of words.
 *
 * Quotes are removed and their contents kept whole, so `-m "two words"` is one
 * word. Outside quotes, ; & | and a newline end a command, a # at the start of a
 * word starts a comment, ( at the start of a word opens a subshell and ) closes
 * one, reported as their own entries so a `cd` inside one can be undone.
 * A $( ... ) substitution stays inside the word it belongs to.
 */
export function simpleCommands(source) {
  const out = [];
  let cmd = [];
  let cur = '';
  let started = false;
  let quote = null;
  const pushWord = () => { if (started) { cmd.push(cur); cur = ''; started = false; } };
  const pushCmd = () => { pushWord(); if (cmd.length) out.push(cmd); cmd = []; };

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (quote === '"' && c === '\\' && source[i + 1] !== undefined) { cur += source[++i]; continue; }
      if (c === quote) { quote = null; continue; }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; started = true; continue; }
    if (c === '\\' && source[i + 1] !== undefined) {
      if (source[i + 1] === '\n') { i++; continue; }   // line continuation
      cur += source[++i]; started = true; continue;
    }
    if (c === '$' && source[i + 1] === '(') {
      let depth = 0;
      for (; i < source.length; i++) {
        cur += source[i];
        if (source[i] === '(') depth++;
        else if (source[i] === ')' && --depth === 0) break;
      }
      started = true;
      continue;
    }
    if (c === '#' && !started) { while (i < source.length && source[i] !== '\n') i++; pushCmd(); continue; }
    if ((c === '(' && !started) || c === ')') { pushCmd(); out.push([c]); continue; }
    if (c === '\n' || c === ';' || c === '|' || c === '&') { pushCmd(); continue; }
    if (/\s/.test(c)) { pushWord(); continue; }
    cur += c; started = true;
  }
  pushCmd();
  return out;
}

/** Can the text alone say what this word is? Not when a variable or glob decides it. */
export const isLiteral = word => word !== undefined && !/[$`*?]/.test(word);

/** A folder named in the command, or null when the text cannot say which. */
export function folder(word, base) {
  if (base === null || !isLiteral(word)) return null;
  if (word === '~' || word.startsWith('~/')) return join(homedir(), word.slice(1));
  return isAbsolute(word) ? word : resolve(base, word);
}

/**
 * Every simple command in the script, with the folder it runs in.
 *
 * Yields { words, env, dir }: the command's words after any leading NAME=value
 * assignments, those assignments, and the folder, or null when a `cd` earlier in
 * the script names a folder the text cannot resolve. `cd` and `pushd` move the
 * folder, a subshell's `cd` is undone when it closes, and `popd` loses track.
 */
export function* commandsIn(script, cwd) {
  let dir = cwd;
  const stack = [];
  for (const words of simpleCommands(script)) {
    if (words[0] === '(') { stack.push(dir); continue; }
    if (words[0] === ')') { if (stack.length) dir = stack.pop(); continue; }

    // leading NAME=value assignments apply to this command only
    let i = 0;
    const env = {};
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) {
      const eq = words[i].indexOf('=');
      env[words[i].slice(0, eq)] = words[i].slice(eq + 1);
      i++;
    }
    const w = words.slice(i);
    if (!w.length) continue;

    if (w[0] === 'cd' || w[0] === 'pushd') {
      dir = w[1] === undefined ? homedir() : folder(w[1], dir);
      continue;
    }
    if (w[0] === 'popd') { dir = null; continue; }
    yield { words: w, env, dir };
  }
}
