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
 *
 * Field dependency detection is a text scan over the whole flow file, not a
 * walk of the connector graph, so it cannot tell a synchronous element from
 * one reachable only through a scheduledPaths connector. That distinction
 * would need every element type's own connector to be parsed and traced from
 * <start>, which this regex-based reader does not do. A dependency found this
 * way must be confirmed against the flow file before it is trusted.
 */

import { readdirSync, lstatSync, existsSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

export const SCHEDULED_PATH_NOTE =
  'Note: reads and writes are scanned across the whole flow file, including anything reachable only ' +
  'from a scheduledPaths connector — this reader does not trace the connector graph to isolate the ' +
  'synchronous path. Confirm every dependency against the flow files directly.';

/** Field names deduped case-insensitively, keeping the first casing seen. */
function dedupeFields(fields) {
  const seen = new Map();
  for (const f of fields) {
    const key = f.toLowerCase();
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()];
}

/** Whether `field` (case-insensitive) is present in `fields`. */
const hasField = (fields, field) => fields.some(f => f.toLowerCase() === field.toLowerCase());

/**
 * True when a <recordUpdates> block updates the flow's own object by filtering
 * on Id = $Record.Id — the "update this same record through Get/Update
 * Records" pattern, as opposed to updating a different object.
 */
function updatesSameObjectById(body, object) {
  if (!object) return false;
  const updatedObject = /<object>([^<]+)<\/object>/.exec(body)?.[1];
  if (!updatedObject || updatedObject.toLowerCase() !== object.toLowerCase()) return false;
  return [...body.matchAll(/<filters>([\s\S]*?)<\/filters>/g)]
    .some(m => /<field>Id<\/field>/.test(m[1]) && /<elementReference>\$Record\.Id<\/elementReference>/.test(m[1]));
}

/**
 * The fields a record-triggered flow writes and reads on the triggering
 * record, plus any subflow calls (never scanned, only named). See the module
 * comment: this is a whole-file text scan, not a synchronous-path walk.
 *
 * Writes: a before-save `$Record.<Field>` assignment target, or an
 * `inputAssignments/field` on a <recordUpdates> that updates `$Record`
 * directly or updates the same object filtered by Id = $Record.Id.
 *
 * Reads: every <start> entry-filter field, plus every other
 * `$Record.<Field>` / `$Record__Prior.<Field>` reference in the file whose
 * field is not already a write target of this same flow.
 */
function parseFlowDependencies(xmlText, object) {
  const writes = [];
  for (const m of xmlText.matchAll(/<assignToReference>\$Record\.([A-Za-z0-9_]+)/g)) writes.push(m[1]);
  for (const m of xmlText.matchAll(/<recordUpdates>([\s\S]*?)<\/recordUpdates>/g)) {
    const body = m[1];
    const updatesRecord = /<inputReference>\$Record<\/inputReference>/.test(body);
    if (!updatesRecord && !updatesSameObjectById(body, object)) continue;
    for (const fa of body.matchAll(/<inputAssignments>([\s\S]*?)<\/inputAssignments>/g)) {
      const field = /<field>([A-Za-z0-9_]+)<\/field>/.exec(fa[1])?.[1];
      if (field) writes.push(field);
    }
  }
  const writeSet = new Set(writes.map(f => f.toLowerCase()));

  const reads = [];
  const startBody = /<start>([\s\S]*?)<\/start>/.exec(xmlText)?.[1] ?? '';
  for (const m of startBody.matchAll(/<filters>([\s\S]*?)<\/filters>/g)) {
    const field = /<field>([A-Za-z0-9_]+)<\/field>/.exec(m[1])?.[1];
    if (field) reads.push(field);
  }
  // Strip the write-target occurrences out first so the same text is not
  // also picked up as a read of the field it just wrote.
  const withoutWriteAssigns = xmlText.replace(/<assignToReference>\$Record\.[A-Za-z0-9_]+/g, '');
  for (const m of withoutWriteAssigns.matchAll(/\$Record(?:__Prior)?\.([A-Za-z0-9_]+)/g)) {
    if (!writeSet.has(m[1].toLowerCase())) reads.push(m[1]);
  }

  const subflows = [];
  for (const m of xmlText.matchAll(/<subflows>([\s\S]*?)<\/subflows>/g)) {
    const flowName = /<flowName>([^<]+)<\/flowName>/.exec(m[1])?.[1];
    if (flowName) subflows.push(flowName);
  }

  return { writes: dedupeFields(writes), reads: dedupeFields(reads), subflows: dedupeFields(subflows) };
}

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

  const deps = parseFlowDependencies(xmlText, object);

  return {
    object, triggerType, order, status, asyncPaths,
    name: basename(relativePath, '.flow-meta.xml'), path: relativePath,
    writes: deps.writes, reads: deps.reads, subflows: deps.subflows,
  };
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
 * `list` split into the three platform buckets, each already in the order
 * the platform runs that bucket: triggerOrder ascending (ties by API name)
 * for `low` and `high`, API name alone for `none`.
 */
function sortByPlatformOrder(list) {
  const byOrder = (a, b) => a.order - b.order || byName(a, b);
  const low = list.filter(f => f.order !== null && f.order <= 1000).sort(byOrder);
  const none = list.filter(f => f.order === null).sort(byName);
  const high = list.filter(f => f.order !== null && f.order > 1000).sort(byOrder);
  return { low, none, high };
}

/**
 * `list` in platform run order — used wherever only the resulting order
 * matters (conflict checks, "who wins a double write"), with no tie or
 * noOrder marking.
 */
function runOrder(list) {
  const { low, none, high } = sortByPlatformOrder(list);
  return [...low, ...none, ...high];
}

/**
 * One group's flows (same object, same trigger timing) in platform run
 * order, each carrying `tie` and `noOrder` so the report can mark them.
 */
function orderGroup(list) {
  const { low, none, high } = sortByPlatformOrder(list);
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

const fieldListLabel = fields => fields.length ? fields.join(', ') : '(none)';

/**
 * Every conflict within a group's actual run order: a flow that reads a
 * field before a later flow in the same group writes it, and two or more
 * flows that write the same field (naming the one that runs last, since its
 * write is the one that survives).
 */
function detectConflicts(group) {
  const flows = group.flows;
  const messages = [];
  for (let i = 0; i < flows.length; i++) {
    const reader = flows[i];
    for (const field of reader.reads) {
      for (let j = i + 1; j < flows.length; j++) {
        const writer = flows[j];
        if (hasField(writer.writes, field)) {
          messages.push(`${reader.name} reads ${field} but runs before ${writer.name}, which writes ${field}`);
        }
      }
    }
  }
  const writersByField = new Map();
  for (const f of flows) {
    for (const field of f.writes) {
      const key = field.toLowerCase();
      if (!writersByField.has(key)) writersByField.set(key, { field, writers: [] });
      writersByField.get(key).writers.push(f);
    }
  }
  for (const { field, writers } of writersByField.values()) {
    if (writers.length < 2) continue;
    const last = writers[writers.length - 1];
    messages.push(`${writers.map(w => w.name).join(', ')} all write ${field} \u2014 ${last.name} runs last and sets the final value`);
  }
  return messages;
}

function fullLines(group) {
  const lines = [`${group.object} \u00b7 ${group.triggerType} \u2014 ${group.flows.length} flows, in platform run order:`];
  for (const f of group.flows) {
    const async = asyncLabel(f);
    lines.push(`  ${orderLabel(f)}${statusLabel(f)}  ${f.name}` + (async ? `  ${async}` : '') + `  (${f.path})`);
    lines.push(`    writes: ${fieldListLabel(f.writes)}`);
    lines.push(`    reads: ${fieldListLabel(f.reads)}`);
    if (f.subflows.length) lines.push(`    subflow calls, not scanned: ${f.subflows.join(', ')}`);
  }
  const conflicts = detectConflicts(group);
  if (conflicts.length) {
    lines.push('  existing order conflicts:');
    for (const c of conflicts) lines.push(`    ${c}`);
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
  let showedFields = false;
  for (const group of groups) {
    if (group.flows.length === 1) {
      lines.push(compactLine(group));
    } else {
      lines.push(...fullLines(group));
      showedFields = true;
    }
  }
  if (showedFields) lines.push('', SCHEDULED_PATH_NOTE);
  return lines.join('\n');
}

/** The flow file whose basename (without .flow-meta.xml) matches `flowApiName`, case-insensitively. */
export function findFlowFileByName(files, flowApiName) {
  return files.find(f => basename(f, '.flow-meta.xml').toLowerCase() === flowApiName.toLowerCase()) ?? null;
}

/**
 * Every other flow in `groupFlowsList` reachable from `target` through a
 * write-read link (one flow writes a field another reads), directly or
 * through other flows in the group — a connected component over those
 * links. `target` itself is not included in the result.
 */
function relatedFlows(groupFlowsList, target) {
  const linked = f => groupFlowsList.filter(g => g !== f &&
    (f.writes.some(field => hasField(g.reads, field)) || g.writes.some(field => hasField(f.reads, field))));
  const seen = new Set([target]);
  const queue = [target];
  while (queue.length) {
    const current = queue.pop();
    for (const neighbour of linked(current)) {
      if (!seen.has(neighbour)) { seen.add(neighbour); queue.push(neighbour); }
    }
  }
  seen.delete(target);
  return runOrder([...seen]);
}

/** `{ flow, field }` for every other flow in the group that writes a field `target` reads. */
const predecessorsOf = (groupFlowsList, target) =>
  target.reads.flatMap(field => groupFlowsList.filter(f => f !== target && hasField(f.writes, field)).map(flow => ({ flow, field })));

/** `{ flow, field }` for every other flow in the group that reads a field `target` writes. */
const successorsOf = (groupFlowsList, target) =>
  target.writes.flatMap(field => groupFlowsList.filter(f => f !== target && hasField(f.reads, field)).map(flow => ({ flow, field })));

const describeLink = ({ flow, field }) => `${flow.name} (order ${flow.order ?? 'none'}, ${field})`;

/** The other group flows' triggerOrder values, excluding `target` and anything with no value. */
const numericOrders = (groupFlowsList, target) => groupFlowsList.filter(f => f !== target && f.order !== null).map(f => f.order);

/**
 * The allowed placement range and a suggested triggerOrder for `target`
 * within `groupFlowsList`, given its predecessors and successors. Either half
 * can come back as descriptive text instead of a number, per the rules in
 * task-1-brief.md item 4: an empty range, a dependency with no triggerOrder,
 * or no free integer to suggest.
 */
function placementFor(groupFlowsList, target, predecessors, successors, related) {
  const predOrders = predecessors.map(p => p.flow.order);
  const succOrders = successors.map(s => s.flow.order);
  const predWithNoOrder = predecessors.find(p => p.flow.order === null);
  const succWithNoOrder = successors.find(s => s.flow.order === null);

  if (predWithNoOrder || succWithNoOrder) {
    const culprit = predWithNoOrder ?? succWithNoOrder;
    const text = `cannot be given a number \u2014 ${culprit.flow.name} has no triggerOrder itself (${describeLink(culprit)})`;
    return { rangeText: text, suggestionText: text, suggestionValue: null };
  }

  const highestPred = predOrders.length ? Math.max(...predOrders) : null;
  const lowestSucc = succOrders.length ? Math.min(...succOrders) : null;
  const allOrders = numericOrders(groupFlowsList, target);
  const takenValues = new Set(allOrders);

  if (highestPred !== null && lowestSucc !== null && lowestSucc - highestPred <= 1) {
    const predAt = predecessors.filter(p => p.flow.order === highestPred).map(describeLink).join(', ');
    const succAt = successors.filter(s => s.flow.order === lowestSucc).map(describeLink).join(', ');
    const text = `empty \u2014 existing flows need renumbering: ${predAt} must run before this flow, which must run before ${succAt}`;
    return { rangeText: text, suggestionText: text, suggestionValue: null };
  }

  const lo = highestPred !== null ? highestPred + 1 : 1;
  const hi = lowestSucc !== null ? lowestSucc - 1 : 2000;
  const rangeText = `${lo}\u2013${hi}`;
  const fitsFreeValue = value => value !== null && Number.isInteger(value) && value >= lo && value <= hi && !takenValues.has(value);

  let suggestion;
  if (highestPred !== null && lowestSucc !== null) {
    // A gap between a predecessor and a successor: the midpoint, rounded down.
    suggestion = Math.floor((highestPred + lowestSucc) / 2);
  } else if (lowestSucc !== null) {
    // A successor with no predecessor: anchor on the nearest group flow
    // below it, mirroring the no-successor branch's use of its nearest
    // neighbour above.
    const below = allOrders.filter(o => o < lowestSucc);
    const anchor = below.length ? Math.max(...below) : null;
    suggestion = anchor !== null ? Math.floor((anchor + lowestSucc) / 2) : Math.max(lowestSucc - 100, 1);
  } else if (related.length) {
    const relatedOrders = related.map(f => f.order).filter(o => o !== null);
    const anchor = relatedOrders.length ? Math.max(...relatedOrders) : null;
    if (anchor === null) {
      suggestion = null; // every related flow lacks a triggerOrder — reported as "no free integer" below
    } else {
      const above = allOrders.filter(o => o > anchor);
      suggestion = above.length ? Math.floor((anchor + Math.min(...above)) / 2) : Math.min(anchor + 100, 2000);
    }
  } else {
    // No dependency at all: task-1-brief.md item 4 gives no case for a fully
    // isolated flow. global-constraints.md's default ("after the last
    // related flow") has nothing to anchor on, so this places it after the
    // last flow in the group instead, the closest reading of that default.
    const anchor = allOrders.length ? Math.max(...allOrders) : null;
    suggestion = anchor === null ? 100 : Math.min(anchor + 100, 2000);
  }

  const suggestionText = fitsFreeValue(suggestion) ? String(suggestion) : 'no free integer fits in the allowed range';
  return { rangeText, suggestionText, suggestionValue: fitsFreeValue(suggestion) ? suggestion : null };
}

/** Which flow's write of `field` would win if `target` ran at `suggestedOrder`. */
function finalWriterAt(groupFlowsList, target, suggestedOrder, field) {
  const otherWriters = groupFlowsList.filter(f => f !== target && hasField(f.writes, field));
  const contenders = [...otherWriters, { ...target, order: suggestedOrder }];
  const last = runOrder(contenders)[contenders.length - 1];
  return last.path === target.path ? `${target.name} (at the suggested position)` : last.name;
}

/**
 * The placement report for one record-triggered flow (task-1-brief.md item
 * 4): its predecessors and successors within its own group, the group's
 * connected component of related flows, the allowed triggerOrder range, and
 * a suggested value.
 */
export function formatFlowPlacement(flows, target) {
  const group = groupFlows(flows).find(g => g.flows.includes(target));
  const groupFlowsList = group.flows;

  const predecessors = predecessorsOf(groupFlowsList, target);
  const successors = successorsOf(groupFlowsList, target);
  const related = relatedFlows(groupFlowsList, target);

  const lines = [];
  lines.push(`${target.name} \u2014 ${group.object} \u00b7 ${group.triggerType}, current triggerOrder: ${target.order ?? 'none'}`);
  lines.push(`  writes: ${fieldListLabel(target.writes)}`);
  lines.push(`  reads: ${fieldListLabel(target.reads)}`);
  if (target.subflows.length) lines.push(`  subflow calls, not scanned: ${target.subflows.join(', ')}`);
  lines.push('');
  lines.push('Predecessors:');
  lines.push(...(predecessors.length ? predecessors.map(p => `  ${describeLink(p)}`) : ['  (none)']));
  lines.push('Successors:');
  lines.push(...(successors.length ? successors.map(s => `  ${describeLink(s)}`) : ['  (none)']));
  lines.push(`Related flows: ${related.length ? related.map(f => f.name).join(', ') : '(none)'}`);
  lines.push('');

  const { rangeText, suggestionText, suggestionValue } = placementFor(groupFlowsList, target, predecessors, successors, related);
  lines.push(`Allowed range: ${rangeText}`);
  lines.push(`Suggested triggerOrder: ${suggestionText} (current: ${target.order ?? 'none'})`);

  if (suggestionValue !== null && suggestionValue !== undefined) {
    for (const field of target.writes) {
      const otherWriters = groupFlowsList.filter(f => f !== target && hasField(f.writes, field));
      if (!otherWriters.length) continue;
      lines.push(`  ${field} is also written by ${otherWriters.map(w => w.name).join(', ')} \u2014 ${finalWriterAt(groupFlowsList, target, suggestionValue, field)} would set the final value`);
    }
  }

  lines.push('', SCHEDULED_PATH_NOTE);
  return lines.join('\n');
}

/** relative() with forward slashes, so the report reads the same on every OS. */
export const repoRelative = (root, file) => relative(root, file).split('\\').join('/');
