#!/usr/bin/env node
/**
 * Refuses a new Apex class or Lightning Web Component whose name does not
 * match the repository's saved naming answer (naming.apex / naming.lwc in the
 * main checkout's .claude/hean-harness.json).
 *
 * Checked: a Write of a .cls or .cls-meta.xml file that does not exist yet in
 * a package folder's classes folder or a subfolder of it; a Write into a package folder's
 * lwc/<name>/ when that folder does not exist yet; `sf apex generate class`
 * and `sf lightning generate component --type lwc`, their `sf template generate`
 * forms and their sfdx aliases.
 * Also checked: `mkdir` (with or without -p) that creates a new lwc/<name>
 * folder in a package folder. `cp -r` and heredoc-created folders are not
 * checked.
 * Never checked: existing files, edits, renames, triggers, Aura, and Apex or
 * LWC files written through Bash (`cat > … <<EOF`, `tee`, redirects).
 *
 * Any error allows the call: this hook never blocks work it cannot read.
 */

import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const refusalText = (type, name, m) => {
  const key = `naming.${type}`;
  const label = type === 'apex' ? 'Apex class' : 'Lightning Web Component';
  return `This ${label} name does not match the project's saved naming answer: ${m.reason}.\n` +
         `Expected: ${m.expected} (a test name adds Test at the end).\n` +
         `A production name that itself ends in Test is read as a test name; avoid Test at the end of a production name.\n` +
         `The answer is saved in .claude/hean-harness.json under ${key}. Rename to the expected form. ` +
         `Only the user changes the saved answer: ask them (they can rerun /hean-harness:setup or run naming.mjs set ${type}).`;
};

/** True when rel (relative to root) is inside one of the project's package folders. */
function inPackageFolder(rel, root, packageDirectories) {
  if (rel.startsWith('..')) return false;
  return packageDirectories(root).some(p => {
    const q = relative(root, resolve(root, p));
    return q === '' || rel === q || rel.startsWith(q + sep);
  });
}

/** The new Apex class or LWC name a Write (or, with isDir, a mkdir) creates, or null. */
function nameFromWrite(file, root, packageDirectories, isDir = false) {
  const rel = relative(root, file);
  if (!inPackageFolder(rel, root, packageDirectories)) return null;
  const parts = rel.split(sep);
  const base = parts[parts.length - 1];
  const apex = isDir ? null : base.match(/^(.+)\.cls(-meta\.xml)?$/);
  if (apex && parts.slice(0, -1).includes('classes')) {
    const dir = dirname(file);
    const exists = existsSync(join(dir, `${apex[1]}.cls`)) || existsSync(join(dir, `${apex[1]}.cls-meta.xml`));
    return exists ? null : { type: 'apex', name: apex[1] };
  }
  const i = parts.lastIndexOf('lwc');
  if (i >= 0 && !parts.slice(0, i).includes('staticresources') && parts.length >= i + (isDir ? 2 : 3)) {
    const folder = join(root, ...parts.slice(0, i + 2));
    // Folders starting with "_" (__mocks__, __tests__) are tooling folders, not components.
    return existsSync(folder) || parts[i + 1].startsWith('_') ? null : { type: 'lwc', name: parts[i + 1] };
  }
  return null;
}

const flag = (args, names) => {
  for (let i = 0; i < args.length; i++) {
    if (names.includes(args[i])) return args[i + 1];
    for (const n of names) if (args[i].startsWith(`${n}=`)) return args[i].slice(n.length + 1);
  }
  return undefined;
};

/** The names an sf / sfdx generate command or a mkdir creates. */
function namesFromCommand(command, cwd, root_, packageDirectories, commandsIn) {
  const out = [];
  for (const { words: all, dir } of commandsIn(command, cwd)) {
    const base = dir ?? cwd;
    let w = all;
    while (['npx', 'command'].includes(w[0])) w = w.slice(1);
    if (!w.length) continue;
    const tool = basename(w[0]);
    if (tool === 'mkdir') {
      for (const a of w.slice(1).filter(x => !x.startsWith('-') && !x.includes('{'))) {
        const target = resolve(base, a);
        const root = root_(target);
        const t = root && nameFromWrite(target, root, packageDirectories, true);
        if (t) out.push({ ...t, root });
      }
      continue;
    }
    if (!['sf', 'sfdx'].includes(tool)) continue;
    const topic = [];
    let i = 1;
    for (; i < w.length && !w[i].startsWith('-'); i++) topic.push(...w[i].split(':'));
    const t = topic.join(' ');
    const args = w.slice(i);
    const name = flag(args, ['--name', '-n', '--classname', '--componentname']);
    if (!name) continue;
    let type = null;
    if (['apex generate class', 'template generate apex class', 'force apex class create'].includes(t)) type = 'apex';
    else if (['lightning generate component', 'template generate lightning component', 'force lightning component create'].includes(t)
             && flag(args, ['--type']) === 'lwc') type = 'lwc';
    if (!type) continue;
    const out_ = flag(args, ['--output-dir', '-d']);
    if (out_ !== undefined) {
      const target = resolve(base, out_);
      const root = root_(target);
      if (!root || !inPackageFolder(relative(root, target), root, packageDirectories)) continue;
      out.push({ type, name, root });
    } else {
      const root = root_(base);
      if (root) out.push({ type, name, root });
    }
  }
  return out;
}

/** The refusal text for this tool call, or null. */
export async function check(input) {
  const { projectRoot } = await import('../scripts/lib/org-roles.mjs');
  const { packageDirectories } = await import('../scripts/lib/apex-coverage.mjs');
  const { readNaming, matchName } = await import('../scripts/lib/naming.mjs');
  const { commandsIn } = await import('../scripts/lib/command-line.mjs');
  const cwd = input?.cwd || process.cwd();
  let targets = [];
  if (input?.tool_name === 'Write' && input.tool_input?.file_path) {
    const file = input.tool_input.file_path;
    const root = projectRoot(dirname(file));
    const t = root && nameFromWrite(file, root, packageDirectories);
    if (t) targets.push({ ...t, root });
  } else if (input?.tool_name === 'Bash' && input.tool_input?.command) {
    targets = namesFromCommand(input.tool_input.command, cwd, projectRoot, packageDirectories, commandsIn);
  }
  for (const t of targets) {
    const answer = readNaming(t.root)[t.type];
    const m = matchName(t.type, answer, t.name);
    if (!m.ok) return refusalText(t.type, t.name, m);
  }
  return null;
}

const isMain = process.argv[1] && process.argv[1].endsWith('naming-check.mjs');
if (isMain) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const reason = await check(input);
    if (reason) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }
      }));
    }
  } catch { /* fail open */ }
  process.exit(0);
}
