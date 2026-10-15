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

/** Every flow in `list` that writes `field` (case-insensitive), excluding `self`. */
const writersOf = (list, field, self = null) => list.filter(f => f !== self && hasField(f.writes, field));

/** Every flow in `list` that reads `field` (case-insensitive), excluding `self`. */
const readersOf = (list, field, self = null) => list.filter(f => f !== self && hasField(f.reads, field));

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
 * Writes: a `$Record.<Field>` assignment target in a before-save flow, or in
 * an after-save flow that saves the whole record (a <recordUpdates> with
 * inputReference $Record and no inputAssignments) — an after-save assignment
 * is otherwise never saved — or an `inputAssignments/field` on a
 * <recordUpdates> that updates `$Record` directly or updates the same object
 * filtered by Id = $Record.Id (either trigger timing).
 *
 * Reads: every <start> entry-filter field, plus every other
 * `$Record.<Field>` / `$Record__Prior.<Field>` reference in the file. A field
 * can be both a write and a read of the same flow (e.g. a
 * `$Record__Prior.Status` comparison in a flow that also sets Status) — only
 * the exact assignToReference text already counted as a write is stripped
 * before this second scan, so it is not also counted as a read of the same
 * occurrence; a different occurrence of the same field name is a genuine,
 * separate read and is kept. A read through a relationship
 * (`$Record.WorkType.Name`) is recorded as the lookup field (`WorkTypeId`).
 */
/**
 * The field that holds a lookup's value, from the relationship name a flow
 * uses to reach the related record: `WorkType` -> `WorkTypeId`,
 * `Location__r` -> `Location__c`. A write changes the lookup field, so a read
 * through the relationship has to be recorded under that field to match it.
 */
const lookupField = relationship =>
  relationship.endsWith('__r') ? `${relationship.slice(0, -3)}__c` : `${relationship}Id`;

function parseFlowDependencies(xmlText, object, triggerType) {
  const writes = [];
  // An after-save flow's $Record assignments are saved only by an Update
  // Records element that saves the whole record: inputReference $Record
  // with no field assignments of its own.
  const savesWholeRecord = [...xmlText.matchAll(/<recordUpdates>([\s\S]*?)<\/recordUpdates>/g)]
    .some(m => /<inputReference>\$Record<\/inputReference>/.test(m[1]) && !/<inputAssignments>/.test(m[1]));
  if (triggerType === 'RecordBeforeSave' || savesWholeRecord) {
    for (const m of xmlText.matchAll(/<assignToReference>\$Record\.([A-Za-z0-9_]+)/g)) writes.push(m[1]);
  }
  for (const m of xmlText.matchAll(/<recordUpdates>([\s\S]*?)<\/recordUpdates>/g)) {
    const body = m[1];
    const updatesRecord = /<inputReference>\$Record<\/inputReference>/.test(body);
    if (!updatesRecord && !updatesSameObjectById(body, object)) continue;
    for (const fa of body.matchAll(/<inputAssignments>([\s\S]*?)<\/inputAssignments>/g)) {
      const field = /<field>([A-Za-z0-9_]+)<\/field>/.exec(fa[1])?.[1];
      if (field) writes.push(field);
    }
  }

  const reads = [];
  const startBody = /<start>([\s\S]*?)<\/start>/.exec(xmlText)?.[1] ?? '';
  for (const m of startBody.matchAll(/<filters>([\s\S]*?)<\/filters>/g)) {
    const field = /<field>([A-Za-z0-9_]+)<\/field>/.exec(m[1])?.[1];
    if (field) reads.push(field);
  }
  // Strip the write-target occurrences out first so the same text is not
  // also picked up as a read of the field it just wrote — a field-name
  // filter would be wrong here, since a genuinely different occurrence of
  // the same field elsewhere in the file (e.g. $Record__Prior) is a real,
  // separate read.
  const withoutWriteAssigns = xmlText.replace(/<assignToReference>\$Record\.[A-Za-z0-9_]+/g, '');
  // `$Record.WorkType.Name` and the polymorphic `$Record.Owner:User.Email`
  // reach a related record; record the lookup field they go through.
  for (const m of withoutWriteAssigns.matchAll(/\$Record(?:__Prior)?\.([A-Za-z0-9_]+)([.:][A-Za-z])?/g)) {
    reads.push(m[2] ? lookupField(m[1]) : m[1]);
  }

  const subflows = [];
  for (const m of xmlText.matchAll(/<subflows>([\s\S]*?)<\/subflows>/g)) {
    const flowName = /<flowName>([^<]+)<\/flowName>/.exec(m[1])?.[1];
    if (flowName) subflows.push(flowName);
  }

  // Id is never written, so a scanned $Record.Id (e.g. the Id = $Record.Id
  // filter of an update-by-id recordUpdates) only adds noise, never a real
  // dependency on another flow.
  const realReads = dedupeFields(reads).filter(f => f.toLowerCase() !== 'id');

  return { writes: dedupeFields(writes), reads: realReads, subflows: dedupeFields(subflows) };
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

  const deps = parseFlowDependencies(xmlText, object, triggerType);

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
  // A Draft or Obsolete flow still gets its own row (fullLines shows it with
  // its status label), but it never actually runs, so it cannot cause a real
  // order conflict and is left out of this scan entirely.
  const flows = group.flows.filter(isActive);
  const messages = [];
  for (let i = 0; i < flows.length; i++) {
    const reader = flows[i];
    for (const field of reader.reads) {
      for (const writer of writersOf(flows.slice(i + 1), field)) {
        messages.push(`${reader.name} reads ${field} but runs before ${writer.name}, which writes ${field}`);
      }
    }
  }
  for (const field of dedupeFields(flows.flatMap(f => f.writes))) {
    const writers = writersOf(flows, field);
    if (writers.length < 2) continue;
    const last = writers[writers.length - 1];
    messages.push(`${writers.map(w => w.name).join(', ')} all write ${field} \u2014 ${last.name} runs last and sets the final value`);
  }
  return messages;
}

/** The writes/reads/subflow-calls lines for one flow, each prefixed by `indent`. */
function dependencyLines(f, indent) {
  const lines = [`${indent}writes: ${fieldListLabel(f.writes)}`, `${indent}reads: ${fieldListLabel(f.reads)}`];
  if (f.subflows.length) lines.push(`${indent}subflow calls, not scanned: ${f.subflows.join(', ')}`);
  return lines;
}

function fullLines(group) {
  const lines = [`${group.object} \u00b7 ${group.triggerType} \u2014 ${group.flows.length} flows, in platform run order:`];
  for (const f of group.flows) {
    const async = asyncLabel(f);
    lines.push(`  ${orderLabel(f)}${statusLabel(f)}  ${f.name}` + (async ? `  ${async}` : '') + `  (${f.path})`);
    lines.push(...dependencyLines(f, '    '));
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
 * Every flow in `list` linked to `f`: by a write-read pair in either
 * direction, or by writing the same field `f` writes — two flows racing to
 * set the same field are related even with no read between them, since one
 * of them overwrites the other.
 */
function linkedFlows(list, f) {
  const out = new Set();
  for (const field of f.writes) for (const reader of readersOf(list, field, f)) out.add(reader);
  for (const field of f.reads) for (const writer of writersOf(list, field, f)) out.add(writer);
  for (const field of f.writes) for (const writer of writersOf(list, field, f)) out.add(writer);
  return out;
}

/**
 * Every other flow in `groupFlowsList` reachable from `target` through a
 * field link — one flow writes a field another reads, or both write the same
 * field (see `linkedFlows`) — directly or through other flows in the group:
 * a connected component over those links. `target` itself is not included
 * in the result.
 */
function relatedFlows(groupFlowsList, target) {
  const seen = new Set([target]);
  const queue = [target];
  while (queue.length) {
    const current = queue.pop();
    for (const neighbour of linkedFlows(groupFlowsList, current)) {
      if (!seen.has(neighbour)) { seen.add(neighbour); queue.push(neighbour); }
    }
  }
  seen.delete(target);
  return runOrder([...seen]);
}

/** `{ flow, field }` for every other flow in the group that writes a field `target` reads. */
const predecessorsOf = (groupFlowsList, target) =>
  target.reads.flatMap(field => writersOf(groupFlowsList, field, target).map(flow => ({ flow, field })));

/** `{ flow, field }` for every other flow in the group that reads a field `target` writes. */
const successorsOf = (groupFlowsList, target) =>
  target.writes.flatMap(field => readersOf(groupFlowsList, field, target).map(flow => ({ flow, field })));

const describeLink = ({ flow, field }) => `${flow.name} (order ${flow.order ?? 'none'}, ${field})`;

/** The other group flows' triggerOrder values, excluding `target` and anything with no value. */
const numericOrders = (groupFlowsList, target) => groupFlowsList.filter(f => f !== target && f.order !== null).map(f => f.order);

/**
 * The flow immediately after `anchor` in `list`'s real platform run order —
 * which may itself have no triggerOrder, since the no-order bucket runs
 * between every triggerOrder 1-1000 flow and every triggerOrder 1001-2000
 * flow, so it can be the true "next flow above" even when a purely numeric
 * search would skip past it to the next flow that does have a value. `list`
 * must already be in that run order (a group's `.flows`, or the same list
 * with some flows removed, order preserved). Returns null when `anchor` is
 * last, or not present in `list`.
 */
function nextInRunOrder(list, anchor) {
  const i = list.indexOf(anchor);
  return i === -1 || i === list.length - 1 ? null : list[i + 1];
}

/** The flow immediately before `anchor` in `list`'s real platform run order, by the same rule as `nextInRunOrder`. Returns null when `anchor` is first, or not present in `list`. */
function prevInRunOrder(list, anchor) {
  const i = list.indexOf(anchor);
  return i <= 0 ? null : list[i - 1];
}

/**
 * The integer nearest `start` that lies in [lo, hi] and is not in `taken`,
 * checking the lower candidate before the higher one at each distance out
 * (keeping `start`'s own "rounded down" bias on a tie). Returns null when
 * every integer in the range is taken.
 */
function nearestFreeInteger(start, lo, hi, taken) {
  if (Number.isInteger(start) && start >= lo && start <= hi && !taken.has(start)) return start;
  for (let delta = 1; start - delta >= lo || start + delta <= hi; delta++) {
    const down = start - delta;
    if (down >= lo && !taken.has(down)) return down;
    const up = start + delta;
    if (up <= hi && !taken.has(up)) return up;
  }
  return null;
}

/**
 * The allowed placement range and a suggested triggerOrder for `target`
 * within `groupFlowsList`, given its predecessors and successors. Either half
 * can come back as descriptive text instead of a number: an empty range, a
 * dependency with no triggerOrder, a genuine cycle, or no free integer to
 * suggest.
 */
function placementFor(groupFlowsList, target, predecessors, successors, related) {
  // A flow that is both a predecessor and a successor of `target` demands
  // target run after it and before it at once. No triggerOrder value can
  // satisfy that, regardless of what the other flows in the group allow, so
  // this is checked before anything numeric.
  const cyclePred = predecessors.find(p => successors.some(s => s.flow === p.flow));
  if (cyclePred) {
    const cycleSucc = successors.find(s => s.flow === cyclePred.flow);
    const text = `${target.name} and ${cyclePred.flow.name} depend on each other \u2014 ` +
      `${cyclePred.flow.name} writes ${cyclePred.field}, which ${target.name} reads, and ` +
      `${target.name} writes ${cycleSucc.field}, which ${cyclePred.flow.name} reads. ` +
      `triggerOrder cannot resolve this: confirm one dependency is not real, or restructure the flow logic.`;
    return { rangeText: text, suggestionText: text, suggestionValue: null };
  }

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
  const others = groupFlowsList.filter(f => f !== target);

  // An empty range here is always caused by different flows — a shared
  // culprit was already caught by the cycle check above.
  if (highestPred !== null && lowestSucc !== null && lowestSucc - highestPred <= 1) {
    const predAt = predecessors.filter(p => p.flow.order === highestPred).map(describeLink).join(', ');
    const succAt = successors.filter(s => s.flow.order === lowestSucc).map(describeLink).join(', ');
    const text = `empty \u2014 existing flows need renumbering: ${predAt} must run before this flow, which must run before ${succAt}`;
    return { rangeText: text, suggestionText: text, suggestionValue: null };
  }

  const lo = highestPred !== null ? highestPred + 1 : 1;
  const hi = lowestSucc !== null ? lowestSucc - 1 : 2000;
  const rangeText = `${lo}\u2013${hi}`;

  if (highestPred !== null && lowestSucc !== null) {
    // A gap between a predecessor and a successor: search outward from the
    // midpoint, rounded down, across the whole allowed range for the
    // nearest free integer.
    const suggestion = Math.floor((highestPred + lowestSucc) / 2);
    const freeValue = nearestFreeInteger(suggestion, lo, hi, takenValues);
    const suggestionText = freeValue === null ? 'no free integer fits in the allowed range' : String(freeValue);
    return { rangeText, suggestionText, suggestionValue: freeValue };
  }

  if (lowestSucc !== null) {
    // A successor with no predecessor: anchor on the real run-order
    // neighbour below the earliest successor at that value — not a numeric
    // filter, which would skip past a no-order flow sitting in between, the
    // same reason the no-successor branch below uses real run position.
    const succFlow = runOrder(successors.filter(s => s.flow.order === lowestSucc).map(s => s.flow))[0];
    const below = prevInRunOrder(others, succFlow);
    if (below && below.order === null) {
      const text = `cannot be given a number \u2014 ${below.name} runs immediately below ${succFlow.name} and has no triggerOrder`;
      return { rangeText, suggestionText: text, suggestionValue: null };
    }
    const suggestion = below !== null ? Math.floor((below.order + lowestSucc) / 2) : Math.max(lowestSucc - 100, 1);
    const freeValue = nearestFreeInteger(suggestion, lo, hi, takenValues);
    const suggestionText = freeValue === null ? 'no free integer fits in the allowed range' : String(freeValue);
    return { rangeText, suggestionText, suggestionValue: freeValue };
  }

  if (related.length) {
    // No successor: place after the last related flow, using its real run
    // position rather than its triggerOrder value — the flow immediately
    // above it in real run order can be a no-order flow, which a purely
    // numeric "next higher value" search would skip straight past. The free
    // integer search is scoped to this specific gap, not the whole allowed
    // range, so it can never land somewhere that runs before the anchor.
    const anchor = related[related.length - 1];
    if (anchor.order === null) {
      const text = `cannot be given a number \u2014 ${anchor.name}, the last related flow, has no triggerOrder itself`;
      return { rangeText, suggestionText: text, suggestionValue: null };
    }
    const above = nextInRunOrder(others, anchor);
    if (above && above.order === null) {
      const text = `cannot be given a number \u2014 ${above.name} runs immediately above ${anchor.name} and has no triggerOrder`;
      return { rangeText, suggestionText: text, suggestionValue: null };
    }
    const gapLo = anchor.order + 1;
    const gapHi = above ? above.order - 1 : 2000;
    const suggestion = above ? Math.floor((anchor.order + above.order) / 2) : Math.min(anchor.order + 100, 2000);
    const freeValue = gapLo <= gapHi ? nearestFreeInteger(suggestion, gapLo, gapHi, takenValues) : null;
    const aboveDesc = above ? `${above.name} (order ${above.order})` : 'triggerOrder 2000';
    const suggestionText = freeValue === null
      ? `no free integer between ${anchor.name} (order ${anchor.order}) and ${aboveDesc} \u2014 existing flows need renumbering`
      : String(freeValue);
    return { rangeText, suggestionText, suggestionValue: freeValue };
  }

  // No related flow at all: nothing else in the group depends on this flow's
  // fields, or vice versa, so its position relative to them is unconstrained
  // — there is nothing to suggest a new value against.
  const text = `no dependency on any other flow in this group, so order does not matter \u2014 keep the current triggerOrder (${target.order ?? 'none'})`;
  return { rangeText, suggestionText: text, suggestionValue: null };
}

/** Which flow's write of `field` would win if `target` ran at `order`; `positionLabel` says which order that is. */
function finalWriterAt(groupFlowsList, target, order, field, positionLabel) {
  const contenders = [...writersOf(groupFlowsList, field, target), { ...target, order }];
  const last = runOrder(contenders)[contenders.length - 1];
  return last.path === target.path ? `${target.name} (${positionLabel})` : last.name;
}

/**
 * The placement report for one record-triggered flow, for --flow placement:
 * its predecessors and successors within its own group, the group's
 * connected component of related flows, the allowed triggerOrder range, and
 * a suggested value.
 */
export function formatFlowPlacement(flows, target) {
  const group = groupFlows(flows).find(g => g.flows.includes(target));
  // A Draft or Obsolete flow in the group is never a real predecessor,
  // successor, related flow, or placement neighbour — it does not actually
  // run. It can still be the flow being placed; only the flows it is
  // compared against are filtered here.
  const activeFlows = group.flows.filter(f => f === target || isActive(f));

  const predecessors = predecessorsOf(activeFlows, target);
  const successors = successorsOf(activeFlows, target);
  const related = relatedFlows(activeFlows, target);

  const lines = [];
  lines.push(`${target.name} \u2014 ${group.object} \u00b7 ${group.triggerType}, current triggerOrder: ${target.order ?? 'none'}`);
  lines.push(...dependencyLines(target, '  '));
  lines.push('');
  lines.push('Predecessors:');
  lines.push(...(predecessors.length ? predecessors.map(p => `  ${describeLink(p)}`) : ['  (none)']));
  lines.push('Successors:');
  lines.push(...(successors.length ? successors.map(s => `  ${describeLink(s)}`) : ['  (none)']));
  lines.push(`Related flows: ${related.length ? related.map(f => f.name).join(', ') : '(none)'}`);
  lines.push('');

  const { rangeText, suggestionText, suggestionValue } = placementFor(activeFlows, target, predecessors, successors, related);
  lines.push(`Allowed range: ${rangeText}`);
  // A loop, an empty range and a neighbour with no triggerOrder come back as
  // one explanation for both lines; print it once.
  const suggestionShown = suggestionText === rangeText ? 'none — see Allowed range above' : suggestionText;
  lines.push(`Suggested triggerOrder: ${suggestionShown} (current: ${target.order ?? 'none'})`);

  // Printed whether or not a new number was suggested — a double write is a
  // fact about the flow's writes, not about whether this run happened to
  // find a free placement value.
  {
    const suggested = suggestionValue !== null && suggestionValue !== undefined;
    const orderForCheck = suggested ? suggestionValue : target.order;
    const positionLabel = suggested ? 'at the suggested position'
      : target.order === null ? 'with no triggerOrder' : `at its current triggerOrder ${target.order}`;
    for (const field of target.writes) {
      const otherWriters = writersOf(activeFlows, field, target);
      if (!otherWriters.length) continue;
      lines.push(`  ${field} is also written by ${otherWriters.map(w => w.name).join(', ')} \u2014 ${finalWriterAt(activeFlows, target, orderForCheck, field, positionLabel)} would set the final value`);
    }
  }

  lines.push('', SCHEDULED_PATH_NOTE);
  return lines.join('\n');
}

/** relative() with forward slashes, so the report reads the same on every OS. */
export const repoRelative = (root, file) => relative(root, file).split('\\').join('/');
