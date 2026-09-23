#!/usr/bin/env node
/**
 * A reinstall must remove what the previous version shipped and keep everything
 * the person wrote themselves.
 *
 * Builds a sandbox home and repository, installs with one extra rule standing in
 * for a rule a later version drops, adds files of the person's own, drops that
 * rule from the plugin, and installs again.
 *
 * Run: node scripts/__tests__/clear-previous-install.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, existsSync,
         readFileSync, copyFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));       // scripts/
const PLUGIN = dirname(HERE);
const RULES_SRC = join(PLUGIN, 'assets', 'rules', 'user');
const DROPPED = join(RULES_SRC, 'zz-test-dropped-rule.md');

const work = mkdtempSync(join(tmpdir(), 'clear-prev-'));
const home = join(work, 'home');
const repo = join(work, 'repo');
mkdirSync(join(repo, 'force-app'), { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(home, '.zshrc'), '# my own notes\nkeep me\n');
execFileSync('git', ['init', '-q', repo]);

const env = { ...process.env, HOME: home, SHELL: '/bin/zsh',
              CLAUDE_CONFIG_DIR: join(home, '.claude') };
const setup = (...args) =>
  execFileSync('node', [join(HERE, 'setup.mjs'), '--repo', repo, ...args],
               { env, encoding: 'utf8', stdio: 'pipe' });

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

const memoryDir = () => {
  const projects = join(home, '.claude', 'projects');
  if (!existsSync(projects)) return null;
  for (const d of readdirSync(projects)) {
    const m = join(projects, d, 'memory');
    if (existsSync(m)) return m;
  }
  return null;
};

try {
  // a rule the "previous version" shipped and the next one will not
  copyFileSync(join(RULES_SRC, 'communication-protocol.md'), DROPPED);
  setup();
  const userRules = join(home, '.claude', 'rules');
  check('the previous version installed its rule', existsSync(join(userRules, 'zz-test-dropped-rule.md')));

  // the person's own content, in the same folders the plugin writes to
  writeFileSync(join(userRules, 'my-own-rule.md'), '# mine\nnever delete me\n');
  const mem = memoryDir();
  writeFileSync(join(mem, 'my_own_memory.md'), '---\nname: mine\n---\n\nmy own memory\n');
  appendFileSync(join(home, '.claude', 'CLAUDE.md'), '\n# my own CLAUDE.md line\n');

  // the new version drops the rule
  rmSync(DROPPED);
  setup();

  check('the dropped rule is gone', !existsSync(join(userRules, 'zz-test-dropped-rule.md')));
  check('their own rule survived', existsSync(join(userRules, 'my-own-rule.md')));
  check('their own memory survived', existsSync(join(mem, 'my_own_memory.md')));
  check('their CLAUDE.md line survived',
        readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8').includes('# my own CLAUDE.md line'));
  check('their .zshrc content survived',
        readFileSync(join(home, '.zshrc'), 'utf8').includes('keep me'));
  check('the current version is fully installed',
        existsSync(join(userRules, 'communication-protocol.md')) &&
        existsSync(join(repo, '.claude', 'rules')) &&
        readdirSync(join(repo, '.claude', 'rules')).length > 10);

  // a dry run must touch nothing
  const before = readdirSync(userRules).length;
  setup('--dry-run');
  check('a dry run changes nothing', readdirSync(userRules).length === before,
        `${before} rules before and after`);
} finally {
  if (existsSync(DROPPED)) rmSync(DROPPED);
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
