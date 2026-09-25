/**
 * Reads record-triggered flows out of an SFDX project's force-app/ tree and
 * lays them out in the order the platform actually runs them.
 *
 * Salesforce runs every record-triggered flow on the same object and the same
 * trigger timing (RecordBeforeSave, RecordAfterSave, RecordBeforeDelete) in
 * one sequence: triggerOrder 1-1000 ascending, then flows with no triggerOrder
 * in created-date order, then triggerOrder 1001-2000 ascending. Flows tied on
 * the same triggerOrder value run in API-name order. The source XML holds
 * created date nowhere, so a flow with no triggerOrder can only be marked as
 * uncertain, never actually placed.
 *
 * Everything here works on parsed flow XML text, not on a connected org: it
 * reports what the repository declares, which is what an agent editing this
 * repository needs, not what happens to be deployed right now.
 */

import { readdirSync, lstatSync, existsSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

export const TIMINGS = ['RecordBeforeSave', 'RecordAfterSave', 'RecordBeforeDelete'];

/**
 * Every *.flow-meta.xml path under <root>/force-app, or null when force-app
 * itself does not exist. Paths are absolute; the caller makes them
 * repository-relative once it knows what "the repository" means to it.
 */
export function findFlowFiles(root) {
  const flowsRoot = join(root, 'force-app');
  if (!existsSync(flowsRoot)) return null;
  const out = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (lstatSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.flow-meta.xml')) out.push(p);
    }
  };
  walk(flowsRoot);
  return out.sort();
}

/**
 * The one flow fact this tool needs from a flow file, or null when the flow
 * is not record-triggered. relativePath is what the report prints, so the
 * caller decides what it is relative to.
 */
export function parseFlow(xmlText, relativePath) {
  const startMatch = /<start>([\s\S]*?)<\/start>/.exec(xmlText);
  if (!startMatch) return null;
  const start = startMatch[1];

  const triggerType = /<triggerType>([^<]+)<\/triggerType>/.exec(start)?.[1] ?? null;
  if (!TIMINGS.includes(triggerType)) return null;

  const object = /<object>([^<]+)<\/object>/.exec(start)?.[1] ?? null;
  const orderMatch = /<triggerOrder>(\d+)<\/triggerOrder>/.exec(xmlText);
  const order = orderMatch ? Number(orderMatch[1]) : null;
  const status = /<status>([^<]+)<\/status>/.exec(xmlText)?.[1] ?? null;

  // scheduledPaths with a pathType is the immediate async-after-commit path;
  // one with no pathType is a time-based scheduled path (the schema leaves
  // pathType out for that case rather than naming it).
  const asyncPaths = [...start.matchAll(/<scheduledPaths>([\s\S]*?)<\/scheduledPaths>/g)]
    .map(m => /<pathType>([^<]+)<\/pathType>/.exec(m[1])?.[1] ?? 'scheduled');

  return { object, triggerType, order, status, asyncPaths, name: basename(relativePath, '.flow-meta.xml'), path: relativePath };
}

const byName = (a, b) => a.name.localeCompare(b.name);

// A flow with no <status> is treated as active, matching the field being
// mandatory on every real flow this tool has ever parsed.
const isActive = f => !f.status || f.status === 'Active';

/**
 * Marks bucket entries that share a triggerOrder value with `tie: true`. An
 * Obsolete or Draft flow does not actually run, so it is never marked tied
 * and never makes another flow's order count as tied.
 */
function markTies(bucket) {
  const active = bucket.filter(isActive);
  for (const f of bucket) f.tie = isActive(f) && active.filter(g => g.order === f.order).length > 1;
}

/**
 * One group's flows (same object, same trigger timing) in platform run
 * order, each carrying `tie` and `noOrder` so the report can mark them.
 */
function orderGroup(list) {
  const low = list.filter(f => f.order !== null && f.order <= 1000).sort((a, b) => a.order - b.order || byName(a, b));
  const none = list.filter(f => f.order === null).sort(byName);
  const high = list.filter(f => f.order !== null && f.order > 1000).sort((a, b) => a.order - b.order || byName(a, b));
  markTies(low);
  markTies(high);
  for (const f of none) f.noOrder = true;
  return [...low, ...none, ...high];
}

/**
 * Flows grouped by object and trigger timing, each group's flows in platform
 * run order. Groups are sorted by object name, then by timing in the order
 * flows actually run through a request (before-save, after-save, before-delete).
 */
export function groupFlows(flows) {
  const byKey = new Map();
  for (const f of flows) {
    const key = `${f.object}\u0000${f.triggerType}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(f);
  }
  const groups = [...byKey.entries()].map(([key, list]) => {
    const [object, triggerType] = key.split('\u0000');
    return { object, triggerType, flows: orderGroup(list) };
  });
  groups.sort((a, b) => a.object.localeCompare(b.object) || TIMINGS.indexOf(a.triggerType) - TIMINGS.indexOf(b.triggerType));
  return groups;
}

function orderLabel(f) {
  if (f.noOrder) return 'none — position depends on created date, which the flow file does not hold';
  return f.tie ? `order ${f.order} (tied with another flow — relative order decided by API name)` : `order ${f.order}`;
}

// A flow that is not Active is listed with its status, so a Draft or
// Obsolete flow is never mistaken for one the platform actually runs.
const statusLabel = f => isActive(f) ? '' : `  [${f.status}]`;

const asyncLabel = f => f.asyncPaths.length ? `async: ${f.asyncPaths.join(', ')}` : null;

function compactLine(group) {
  const f = group.flows[0];
  const async = asyncLabel(f);
  return `${group.object} \u00b7 ${group.triggerType}: ${f.name} \u2014 ${orderLabel(f)}${statusLabel(f)}` +
    (async ? `, ${async}` : '') + `  (${f.path})`;
}

function fullLines(group) {
  const lines = [`${group.object} \u00b7 ${group.triggerType} \u2014 ${group.flows.length} flows, in platform run order:`];
  for (const f of group.flows) {
    const async = asyncLabel(f);
    lines.push(`  ${orderLabel(f)}${statusLabel(f)}  ${f.name}` + (async ? `  ${async}` : '') + `  (${f.path})`);
  }
  return lines;
}

/**
 * The full plain-text report for `flows` (already parsed, record-triggered
 * only), narrowed to `objectFilter` when given. Returns the one-line "nothing
 * found" message when the result is empty.
 */
export function formatReport(flows, objectFilter = null) {
  // Salesforce API names are case-insensitive, so "account" must match "Account".
  const scoped = objectFilter
    ? flows.filter(f => f.object?.toLowerCase() === objectFilter.toLowerCase())
    : flows;
  if (!scoped.length) {
    return objectFilter
      ? `No record-triggered flow found for ${objectFilter} under force-app/.`
      : 'No record-triggered flow found under force-app/.';
  }
  const groups = groupFlows(scoped);
  const lines = [];
  for (const group of groups) {
    lines.push(...(group.flows.length === 1 ? [compactLine(group)] : fullLines(group)));
  }
  return lines.join('\n');
}

/** relative() with forward slashes, so the report reads the same on every OS. */
export const repoRelative = (root, file) => relative(root, file).split('\\').join('/');
