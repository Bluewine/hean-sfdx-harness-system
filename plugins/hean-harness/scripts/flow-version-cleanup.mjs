#!/usr/bin/env node
/**
 * Deletes the oldest non-Active versions of every flow at the platform's
 * 50-version limit, through the Tooling API from the Salesforce CLI.
 *
 *   flow-version-cleanup.mjs plan [--org <alias|username|sandbox name>] [--count <N>]
 *   flow-version-cleanup.mjs apply <plan file>
 *
 * plan only reads. apply refuses unless the org is a saved deploy target,
 * because the org write gate never sees the sf calls this script makes.
 * No Apex and no metadata deploy: Apex reaches the Tooling API only through
 * an HTTP callout, which needs a Remote Site Setting or Named Credential.
 *
 * Exit codes: 0 done; 1 could not run; 2 nothing to delete (plan);
 * 3 some versions failed (apply).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectedOrgs, defaultOrg, orgOf, projectRoot, readRoles, recordHome, refusal } from './lib/org-roles.mjs';
import { EXIT, FLOW_QUERY, buildBatches, checkComplete, isLockError, matchOrg, parseBatchResponse, parseCount,
         reconcile, renderPlan, renderReport, roleCommands, selectVersions, stillDeletable } from './lib/flow-version-cleanup.mjs';

const ROLES_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'org-roles.mjs');
const USAGE = 'Usage: flow-version-cleanup.mjs plan [--org <name>] [--count <N>]\n' +
              '       flow-version-cleanup.mjs apply <plan file>';
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const fail = reason => { console.log(`ERROR: ${reason}`); process.exit(EXIT.ERROR); };

/** Runs sf; the JSON is read from the first `{` of stdout, since the CLI can print a warning first. */
function sf(args) {
  const r = spawnSync('sf', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300_000 });
  const stdout = r.stdout ?? '';
  let json = null;
  const start = stdout.indexOf('{');
  if (start >= 0) { try { json = JSON.parse(stdout.slice(start)); } catch { /* the caller reports */ } }
  return { json, stdout, stderr: (r.stderr ?? '').trim() || r.error?.message || '', status: r.status };
}

function queryFlows(username) {
  const r = sf(['data', 'query', '--use-tooling-api', '--json', '-o', username, '-q', FLOW_QUERY]);
  if (r.json?.status !== 0) fail(`the flow query failed: ${r.json?.message || r.stderr || 'no output'}`);
  try { checkComplete(r.json.result); } catch (e) { fail(e.message); }
  return r.json.result.records;
}

function sfdxRoot() {
  const root = projectRoot(process.cwd());
  if (!root) fail('run this from inside an SFDX project, where the org roles are saved');
  return root;
}

function resolveOrg(root) {
  const name = opt('--org');
  if (name) {
    const found = matchOrg(name, connectedOrgs());
    if (!found.length) fail(`no org logged in on this machine matches "${name}"`);
    if (found.length > 1) {
      fail(`"${name}" matches more than one org: ${found.map(o => `${o.aliases[0] ?? o.username} (${o.username})`).join(', ')}`);
    }
    return { ...found[0], name: found[0].aliases[0] ?? found[0].username };
  }
  const d = defaultOrg(root);
  if (!d) fail('no org was given and no CLI default org is set');
  const org = orgOf(d.name);
  if (!org) fail(`the CLI default org ${d.name} is not logged in on this machine`);
  return { ...org, name: d.name };
}

function plan() {
  const root = sfdxRoot();
  let count;
  try { count = parseCount(opt('--count')); } catch (e) { fail(e.message); }
  const org = resolveOrg(root);
  console.log(`ORG: ${org.name} (${org.username}, org ${org.orgId})`);
  const { flows, skipped } = selectVersions(queryFlows(org.username), count);
  console.log(renderPlan({ count, flows, skipped }));

  const saved = readRoles(recordHome(root))[org.orgId] ?? null;
  // org-roles.mjs resolves the name through this machine's aliases now; a saved alias that was renamed or
  // now names another org would open and reset the wrong one, so it is used only while it names this org.
  const who = saved?.alias && orgOf(saved.alias)?.orgId === org.orgId ? saved.alias : org.username;
  const roles = roleCommands(saved, who, ROLES_SCRIPT);
  if (roles.locked) {
    console.log(`!! ${org.name} is locked for writes: ${saved ? `saved as ${saved.role}, agents do not write` : 'no saved role'}.`);
    console.log(`ALLOW: ${roles.allow}`);
    console.log(`RESTORE: ${roles.restore}`);
  } else {
    console.log(`ROLE: ${org.name} is a saved deploy target.`);
  }

  if (!flows.some(f => f.delete.length)) { console.log('RESULT: nothing to delete'); process.exit(EXIT.NOTHING); }
  const file = join(mkdtempSync(join(tmpdir(), 'flow-version-cleanup-')), 'plan.json');
  writeFileSync(file, JSON.stringify({ org: { name: org.name, username: org.username, orgId: org.orgId }, count, flows, skipped }, null, 2));
  console.log(`PLAN_FILE: ${file}`);
  process.exit(EXIT.OK);
}

function apply() {
  const file = argv[1];
  if (!file) fail(USAGE);
  let saved;
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch { fail(`cannot read the plan file ${file}`); }
  // Temporary files go on every exit from here on. A plan file is removed with its folder only when plan made
  // that folder; a plan file a user placed elsewhere stays.
  const planDir = dirname(file);
  const cleanup = [];
  if (basename(planDir).startsWith('flow-version-cleanup-') && dirname(planDir) === tmpdir()) cleanup.push(planDir);
  process.on('exit', () => { for (const d of cleanup) rmSync(d, { recursive: true, force: true }); });
  const root = sfdxRoot();
  const { name, username } = saved.org;
  const refused = refusal(root, { name: username, from: 'flag' });
  if (refused) fail(`${name} is not a deploy target, so nothing was deleted.\n${refused}`);

  const display = sf(['org', 'display', '--json', '-o', username]);
  const api = display.json?.result?.apiVersion;
  if (!api) fail(`cannot read the API version of ${name}: ${display.json?.message || display.stderr || 'no output'}`);

  const before = queryFlows(username);
  const planned = saved.flows.flatMap(f => f.delete.map(v => ({ ...v, name: f.name, definitionId: f.definitionId })));
  const { keep, dropped } = stillDeletable(planned, before, saved.count);

  const dir = mkdtempSync(join(tmpdir(), 'flow-version-cleanup-batches-'));
  cleanup.push(dir);
  let sent = 0;
  // One request at a time: two requests deleting versions of the same flow at once fail with UNABLE_TO_LOCK_ROW.
  const send = versions => buildBatches(versions, api).flatMap(batch => {
    const body = join(dir, `batch-${String(++sent).padStart(3, '0')}.json`);
    writeFileSync(body, JSON.stringify(batch.body));
    console.error(`batch ${sent}: deleting ${batch.versions.length} versions`);
    const r = sf(['api', 'request', 'rest', `/services/data/v${api}/tooling/composite/batch`,
                  '--method', 'POST', '--body', `@${body}`, '-o', username]);
    return parseBatchResponse(batch.versions, r.stdout, r.stderr);
  });

  let results = send(keep);
  const locked = results.filter(r => !r.ok && isLockError(r.error));
  if (locked.length) {
    console.error(`retrying ${locked.length} versions that were locked`);
    const retried = new Map(send(locked.map(({ ok, error, ...v }) => v)).map(r => [r.id, r]));
    results = results.map(r => retried.get(r.id) ?? r);
  }

  const after = queryFlows(username);
  results = reconcile(results, after);
  console.log(renderReport({ name, results, dropped, skipped: saved.skipped, before, after }));
  process.exit(results.some(r => !r.ok) ? EXIT.FAILED : EXIT.OK);
}

if (argv[0] === 'plan') plan();
else if (argv[0] === 'apply') apply();
else fail(USAGE);
