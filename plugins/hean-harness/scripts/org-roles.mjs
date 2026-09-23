#!/usr/bin/env node
/**
 * Shows and saves the role each Salesforce org plays for the SFDX project in
 * the current folder. The org write gate reads what this saves.
 *
 *   org-roles.mjs status
 *   org-roles.mjs set <alias|username> --role <role> --deploy yes|no [--branch <name>]
 *   org-roles.mjs remove <alias|username|org ID>
 *
 * Roles: development, pipeline, research, production. --deploy says whether
 * agents may write to the org; --branch names the branch whose pipeline deploys
 * to it, for a pipeline org.
 */

import { ROLES, projectRoot, recordHome, connectedOrgs, defaultOrg, orgOf, readRoles, saveRole, removeRole }
  from './lib/org-roles.mjs';
import { settingsFile } from './lib/settings.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const log = (...a) => console.log(...a);
const fail = msg => { console.error(msg); process.exit(1); };

const USAGE = 'Usage: org-roles.mjs status\n' +
              '       org-roles.mjs set <alias|username> --role <role> --deploy yes|no [--branch <name>]\n' +
              '       org-roles.mjs remove <alias|username|org ID>';

function describe(r) {
  if (!r) return 'no saved role';
  return `${r.role}${r.branch ? `, fed by ${r.branch}` : ''}, ${r.deploy ? 'agents may deploy' : 'agents do not write'}`;
}

function status(root, home) {
  const roles = readRoles(home);
  const def = defaultOrg(root);
  const orgs = connectedOrgs();

  log(`Project        ${root}`);
  log(`Saved roles    ${settingsFile(home)}${Object.keys(roles).length ? '' : '  (none saved)'}`);
  if (def) {
    const org = orgOf(def.name);
    log(`CLI default    ${def.name}${org ? ` (${org.username})` : ', not logged in on this machine'}, set in ${def.from}`);
    if (org) log(`               ${describe(roles[org.orgId])}`);
  } else {
    log('CLI default    none set');
  }
  log('');
  log('Orgs logged in on this machine:');
  for (const o of orgs) {
    const kind = o.isScratch ? 'scratch org' : o.isSandbox ? 'sandbox' : 'production or developer edition';
    log(`  ${o.aliases.join(', ') || '(no alias)'}`);
    log(`    ${o.username}  org ${o.orgId}  ${kind}`);
    log(`    ${o.instanceUrl ?? ''}`);
    log(`    ${describe(roles[o.orgId])}`);
  }
  const loggedIn = new Set(orgs.map(o => o.orgId));
  const elsewhere = Object.entries(roles).filter(([id]) => !loggedIn.has(id));
  if (elsewhere.length) {
    log('');
    log('Saved but not logged in on this machine:');
    for (const [id, r] of elsewhere) log(`  ${r.alias ?? r.username}  org ${id}  ${describe(r)}`);
  }
}

function main() {
  if (!['status', 'set', 'remove'].includes(cmd)) fail(USAGE);
  const root = projectRoot(process.cwd());
  if (!root) fail(`Not in an SFDX project: no sfdx-project.json in ${process.cwd()} or above it.`);
  const home = recordHome(root);

  if (cmd === 'status') return status(root, home);

  const name = argv[1];
  if (!name || name.startsWith('--')) fail(USAGE);

  if (cmd === 'remove') {
    const roles = readRoles(home);
    const id = roles[name] ? name : orgOf(name)?.orgId;
    if (!id || !roles[id]) fail(`No saved role for ${name}.`);
    removeRole(home, id);
    log(`Removed the saved role for ${roles[id].alias ?? roles[id].username} (org ${id}).`);
    return;
  }

  const role = opt('--role');
  const deploy = opt('--deploy');
  const branch = opt('--branch') ?? null;
  if (!ROLES.includes(role)) fail(`--role must be one of: ${ROLES.join(', ')}.`);
  if (!['yes', 'no'].includes(deploy)) fail('--deploy must be yes or no.');
  const org = orgOf(name);
  if (!org) fail(`${name} is not logged in on this machine. Log in first, then save its role.`);
  const alias = org.username === name ? null : name;

  saveRole(home, org, { role, deploy: deploy === 'yes', branch, alias });
  log(`Saved          ${alias ?? org.username} (${org.username}, org ${org.orgId})`);
  log(`               ${describe(readRoles(home)[org.orgId])}`);
  log(`In             ${settingsFile(home)}`);
}

main();
