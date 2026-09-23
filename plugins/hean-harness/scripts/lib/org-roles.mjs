/**
 * Which role each Salesforce org plays for one project, and whether an agent
 * may write to it.
 *
 * The roles are discovered once per project (.claude/rules/org-roles.md says
 * how) and saved under the `orgs` key of the repository's hean-harness.json,
 * keyed by org ID. An alias is a name each developer picks on their own machine
 * and can change on the next login; the org ID cannot, so a saved role outlives
 * an alias change.
 *
 * The org write gate calls refusal() before every command that writes to an
 * org. It reads the Salesforce CLI's own files rather than starting `sf`,
 * which takes seconds, so a command that writes nothing pays nothing and one
 * that does pays a few file reads:
 *
 *   ~/.sfdx/alias.json         alias -> username
 *   ~/.sfdx/<username>.json    the login, which carries the org ID
 *   <project>/.sf/config.json  the project's default org, then ~/.sf/config.json
 *   (.sfdx/sfdx-config.json    the same settings under their older names)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { isLiteral } from './command-line.mjs';
import { readSettings, writeSetting, settingsFile } from './settings.mjs';

export const ROLES = ['development', 'pipeline', 'research', 'production'];
export const RULE = '.claude/rules/org-roles.md';
export const SKILL = '/hean-harness:org-roles';

const sfdxDir = () => join(homedir(), '.sfdx');
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/** alias -> username, for every alias set on this machine. */
export const aliases = () => readJson(join(sfdxDir(), 'alias.json'))?.orgs ?? {};

/**
 * The org an alias or username names, or null when it is not logged in on this
 * machine: { username, orgId, instanceUrl, isSandbox, isScratch }.
 */
export function orgOf(name) {
  if (!name || /[/\\]/.test(name)) return null;
  const username = aliases()[name] ?? name;
  const auth = readJson(join(sfdxDir(), `${username}.json`));
  if (!auth?.orgId) return null;
  return {
    username,
    orgId: auth.orgId,
    instanceUrl: auth.instanceUrl ?? null,
    isSandbox: auth.isSandbox === true,
    isScratch: auth.isScratch === true
  };
}

/** Every org logged in on this machine, each with the aliases that name it. */
export function connectedOrgs() {
  let files = [];
  try { files = readdirSync(sfdxDir()).filter(f => f.endsWith('.json')); } catch { return []; }
  const byUser = new Map();
  for (const f of files) {
    const org = orgOf(f.slice(0, -'.json'.length));
    if (org) byUser.set(org.username, { ...org, aliases: [] });
  }
  for (const [alias, username] of Object.entries(aliases())) byUser.get(username)?.aliases.push(alias);
  return [...byUser.values()];
}

/** The SFDX project a folder belongs to: the nearest folder holding sfdx-project.json, or null. */
export function projectRoot(dir) {
  for (let cur = dir; cur; cur = dirname(cur)) {
    if (existsSync(join(cur, 'sfdx-project.json'))) return cur;
    if (dirname(cur) === cur) return null;
  }
  return null;
}

/**
 * The folder whose hean-harness.json holds the project's roles: the top of the
 * git repository, where setup saves its other answers, or the project itself
 * when it is not in one.
 */
export function recordHome(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return root; }
}

/**
 * The org the CLI writes to when a command names none, and where that came
 * from, or null when none is set. The CLI's own order: the environment, the
 * project's config, then the machine-wide config.
 */
export function defaultOrg(root, env = process.env) {
  if (env.SF_TARGET_ORG) return { name: env.SF_TARGET_ORG, from: 'the SF_TARGET_ORG variable' };
  const places = [
    root && [join(root, '.sf', 'config.json'), 'target-org', 'the project config'],
    root && [join(root, '.sfdx', 'sfdx-config.json'), 'defaultusername', 'the project config'],
    [join(homedir(), '.sf', 'config.json'), 'target-org', 'the machine-wide config'],
    [join(sfdxDir(), 'sfdx-config.json'), 'defaultusername', 'the machine-wide config']
  ].filter(Boolean);
  for (const [file, key, from] of places) {
    const name = readJson(file)?.[key];
    if (name) return { name, from };
  }
  return null;
}

/** Saved roles, keyed by org ID; {} when none are saved. */
export function readRoles(home) {
  const orgs = readSettings(home).orgs;
  return orgs && typeof orgs === 'object' && !Array.isArray(orgs) ? orgs : {};
}

export function saveRole(home, org, { role, deploy, branch = null, alias = null }) {
  const orgs = readRoles(home);
  orgs[org.orgId] = { alias, username: org.username, role, deploy, branch };
  writeSetting(home, 'orgs', orgs);
}

export function removeRole(home, orgId) {
  const orgs = readRoles(home);
  delete orgs[orgId];
  writeSetting(home, 'orgs', orgs);
}

const label = (id, r) => r?.alias ? `${r.alias} (${r.username})` : r?.username ?? id;

/**
 * Why an agent may not run a write against this org from this project, or null
 * when it may.
 *
 * target is { name, from } — the org the command names and where that came
 * from: 'flag' when the command names it, otherwise the default's source — or
 * null when the command names none and no default is set, which the CLI
 * refuses by itself.
 */
export function refusal(root, target) {
  if (!target) return null;
  const home = recordHome(root);
  const how = `Follow ${RULE}: work out each org's role, confirm it with the user, and save it ` +
              `with ${SKILL}. Then run the command again.`;

  if (!isLiteral(target.name)) {
    return `The target org is given as ${target.name}, which the org write gate cannot read.\n\n` +
           `Resolve the org first, say its alias to the user, then run the command again with ` +
           `the alias written out.`;
  }

  const org = orgOf(target.name);
  if (!org) return null;   // not logged in on this machine: the CLI refuses by itself

  const roles = readRoles(home);
  const saved = roles[org.orgId];
  if (saved?.deploy === true) return null;

  const targets = Object.entries(roles).filter(([, r]) => r.deploy === true);
  const named = `${target.name} (${org.username}, org ${org.orgId})`;
  const lines = [];

  if (target.from !== 'flag' && targets.length) {
    lines.push(`!! The CLI default org is now ${target.name}, set in ${target.from}. It is not the ` +
               `saved deploy org: ${targets.map(([id, r]) => label(id, r)).join(', ')}.`);
    lines.push('!! Stop and tell the user the default org changed before doing anything else.');
    lines.push('');
  }

  if (!Object.keys(roles).length) {
    lines.push(`No org roles are saved for the project at ${root}, so no write to any org is allowed yet.`);
  } else if (saved) {
    lines.push(`${named} is saved as ${saved.role}${saved.branch ? `, fed by the ${saved.branch} branch` : ''}, ` +
               `and agents do not write to it.`);
    if (targets.length) lines.push(`Deploy targets saved for this project: ${targets.map(([id, r]) => label(id, r)).join(', ')}.`);
    lines.push('');
    lines.push(`Read-only work — query, retrieve, describe, run an already-deployed test — is allowed there. ` +
               `Only the user changes a saved role, with ${SKILL}.`);
    return lines.join('\n');
  } else {
    lines.push(`${named} has no saved role in this project.`);
  }
  lines.push('');
  lines.push(how);
  lines.push(`Saved roles: ${settingsFile(home)}`);
  return lines.join('\n');
}
