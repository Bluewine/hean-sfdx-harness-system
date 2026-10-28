#!/usr/bin/env node
/**
 * Adds the line that republishes an Experience Cloud site to the post-deploy
 * commands file, so the Jenkins post stage publishes the site after the
 * deploy. Run from the repository root.
 *
 *   site-publish.mjs --site <Name> [--site <Name>]... [--dry-run]
 *   site-publish.mjs --list
 *
 * --list prints the repository's Network names, one per line. Never calls an
 * org: the publish runs in the pipeline.
 *
 * Exit codes: 0 done; 1 could not run; 2 refused (the post stage runs no
 * commands file).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { COMMAND_KEYS, readDeploySteps, stepFor, stepPresent, jenkinsLines, publishedSites, withPublishLines } from '../../../scripts/lib/deploy-steps.mjs';
import { packageDirectories } from '../../../scripts/lib/apex-coverage.mjs';

const COMMANDS = 'runbooks/post-deploy/sf/commands.txt';
const LIMIT = 10;
const USAGE = 'Usage: site-publish.mjs --site <Name> [--site <Name>]... [--dry-run]\n       site-publish.mjs --list';
const fail = (reason, usage = false) => { console.log(`ERROR: ${reason}${usage ? `\n${USAGE}` : ''}`); process.exit(1); };

const argv = process.argv.slice(2);
const sites = [];
let list = false, dryRun = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--list') list = true;
  else if (argv[i] === '--dry-run') dryRun = true;
  else if (argv[i] === '--site') {
    const name = argv[++i];
    if (!name || name.startsWith('--')) fail('--site needs a site name', true);
    // the line wraps the name in single quotes, so a ' in it would end the quoting early
    if (name.includes("'")) fail(`the site name ${name} holds a ', which would break the quoted --name in the publish line`);
    sites.push(name);
  } else fail(`unknown argument ${argv[i]}`, true);
}
if (list && sites.length) fail('pass either --list or --site, not both', true);

const root = process.cwd();

/** The Network names under the package folders: every networks/<Name>.network-meta.xml. */
function networkNames() {
  const names = new Set();
  const walk = dir => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules') continue;
      const sub = join(dir, e.name);
      if (e.name === 'networks') {
        for (const f of readdirSync(sub)) if (f.endsWith('.network-meta.xml')) names.add(f.slice(0, -'.network-meta.xml'.length));
      } else walk(sub);
    }
  };
  for (const pkg of packageDirectories(root)) walk(join(root, pkg));
  return [...names].sort();
}

if (list) {
  for (const name of networkNames()) console.log(name);
  process.exit(0);
}
if (!sites.length) fail('name at least one site with --site, or pass --list', true);

const deploy = readDeploySteps(root);
if (deploy.error) fail(deploy.error);
if (!deploy.steps || !stepPresent(deploy.steps, stepFor('post', 'commands'))) {
  // suggest the key the pre stage already uses, so both stages run under the same prefix
  const key = COMMAND_KEYS.find(k => typeof deploy.steps?.pre?.[k] === 'string') ?? 'runSFCommandFromFile';
  const why = deploy.missing ? 'This repository has no deploy.yml'
    : `deploy.yml lists neither \`post.runSFCommandFromFile\` nor \`post.runSFDXCommandFromFile\` for ${COMMANDS}`;
  console.log(`!! ${why}, so the post stage runs no commands file and a publish line there never runs. ` +
              `Add \`post.${key}: ${COMMANDS}\` to deploy.yml. Nothing was changed.`);
  process.exit(2);
}

const file = join(root, COMMANDS);
let before = null;
if (existsSync(file)) {
  try { before = readFileSync(file, 'utf8'); } catch (e) { fail(`${COMMANDS} could not be read (${e.message})`); }
}
const { text, added, revived } = withPublishLines(before, sites);
const changed = text !== before;
if (!dryRun && changed) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  } catch (e) { fail(`${COMMANDS} could not be written (${e.message})`); }
}

console.log(`${COMMANDS} ${dryRun ? 'would read' : 'now reads'}:`);
process.stdout.write(text);
if (dryRun) console.log(`DRY RUN: would ${changed ? `write ${COMMANDS}` : `leave ${COMMANDS} unchanged`}`);
else console.log(`${changed ? 'WRITTEN' : 'UNCHANGED'}: ${COMMANDS}`);
const ran = publishedSites(before);
const known = new Set(networkNames());
for (const site of [...new Set(sites)]) {
  if (added.includes(site)) console.log(`ADDED: ${site}`);
  else if (ran.has(site)) console.log(`ALREADY PRESENT: ${site} (a line Jenkins runs already publishes it; nothing added)`);
  else console.log(`NOW RUNS: ${site} — its publish line was after an empty line`);
  if (!known.has(site)) console.log(`NOTE: no Network file in this repository is named ${site}; the line uses the name as given, since the site may exist only in the org.`);
}
for (const cmd of revived) {
  console.log(`!! "${cmd}" sat after an empty line, so Jenkins never ran it. With the empty line removed, it now runs in the post stage.`);
}
const count = jenkinsLines(text).length;
if (count > LIMIT) {
  console.log(`!! ${COMMANDS} holds ${count} commands, counting \`version\`. The validator allows ${LIMIT} unless SFDX_CMD_LIMIT raises it.`);
}
