/**
 * Selection, batching and report text for flow-version-cleanup.mjs.
 *
 * A flow holds at most 50 versions (Salesforce Help, "General Flow Limits");
 * at the limit, saving or deploying the flow fails. Versions are deleted
 * through the Tooling API from the Salesforce CLI, never from Apex: Apex
 * reaches the Tooling API only through an HTTP callout, which needs a Remote
 * Site Setting or Named Credential deployed to the org.
 */

import { formatRanges } from './apex-coverage.mjs';
import { shQuote } from './shell.mjs';

export const VERSION_LIMIT = 50;
export const BATCH_SIZE = 25;   // Composite Batch accepts at most 25 subrequests
export const DEFAULT_COUNT = 5;
export const EXIT = { OK: 0, ERROR: 1, NOTHING: 2, FAILED: 3 };
export const FLOW_QUERY = 'SELECT Id, DefinitionId, Definition.DeveloperName, VersionNumber, Status FROM Flow';

/** The --count value: 5 when absent; a whole number of 1 or more, or an Error. */
export function parseCount(value) {
  if (value === undefined) return DEFAULT_COUNT;
  if (!/^[1-9]\d*$/.test(String(value))) throw new Error(`--count must be a whole number of 1 or more, got "${value}"`);
  return Number(value);
}

/**
 * The logged-in orgs a name matches, ignoring case: by alias or username first,
 * then by sandbox name (the part of a sandbox username after its last dot).
 */
export function matchOrg(name, orgs) {
  const n = String(name).toLowerCase();
  const exact = orgs.filter(o => o.username.toLowerCase() === n || o.aliases.some(a => a.toLowerCase() === n));
  if (exact.length) return exact;
  return orgs.filter(o => o.isSandbox && o.username.slice(o.username.lastIndexOf('.') + 1).toLowerCase() === n);
}

/** Throws unless the query result holds every version: a plan from a partial list could miss a flow at the limit. */
export function checkComplete(result) {
  if (!result || !Array.isArray(result.records)) throw new Error('the flow query returned no records list');
  if (result.done === false || result.records.length < result.totalSize) {
    throw new Error(`the flow query returned ${result.records.length} of ${result.totalSize} versions; ` +
                    'refusing to plan from a partial list');
  }
}

/** The flows at the limit and, for each with an Active version, its `count` lowest-numbered non-Active versions. */
export function selectVersions(records, count) {
  const byFlow = new Map();
  for (const r of records) {
    const f = byFlow.get(r.DefinitionId) ??
      { definitionId: r.DefinitionId, name: r.Definition?.DeveloperName ?? r.DefinitionId, versions: [] };
    f.versions.push({ id: r.Id, version: r.VersionNumber, status: r.Status });
    byFlow.set(r.DefinitionId, f);
  }
  const flows = [];
  const skipped = [];
  for (const f of [...byFlow.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    if (f.versions.length < VERSION_LIMIT) continue;
    const active = f.versions.find(v => v.status === 'Active');
    if (!active) {
      skipped.push({ definitionId: f.definitionId, name: f.name, present: f.versions.length });
      continue;
    }
    const candidates = f.versions.filter(v => v.status !== 'Active').sort((a, b) => a.version - b.version);
    flows.push({ definitionId: f.definitionId, name: f.name, present: f.versions.length,
                 activeVersion: active.version, delete: candidates.slice(0, count) });
  }
  return { flows, skipped };
}

/**
 * Splits planned versions by the org now: a version already gone, now Active, or no longer among the
 * `count` oldest non-Active versions of a flow still at the limit with an Active version is not sent.
 */
export function stillDeletable(planned, records, count) {
  const now = new Map(records.map(r => [r.Id, r.Status]));
  const selected = count === undefined ? null
    : new Set(selectVersions(records, count).flows.flatMap(f => f.delete.map(v => v.id)));
  const keep = [];
  const dropped = [];
  for (const v of planned) {
    const status = now.get(v.id);
    if (status === undefined) dropped.push({ ...v, reason: 'already deleted' });
    else if (status === 'Active') dropped.push({ ...v, reason: 'now Active' });
    else if (selected && !selected.has(v.id)) dropped.push({ ...v, reason: 'no longer selected' });
    else keep.push(v);
  }
  return { keep, dropped };
}

/** Composite Batch request bodies of at most 25 DELETE subrequests, in the given order. */
export function buildBatches(versions, apiVersion) {
  const batches = [];
  for (let i = 0; i < versions.length; i += BATCH_SIZE) {
    const chunk = versions.slice(i, i + BATCH_SIZE);
    batches.push({ versions: chunk, body: { batchRequests: chunk.map(v =>
      ({ method: 'DELETE', url: `v${apiVersion}/tooling/sobjects/Flow/${v.id}` })) } });
  }
  return batches;
}

/**
 * Each version with ok, or ok false and the error. The JSON is read from the
 * first `{`, because the CLI can print a warning before it. A response that
 * is missing, unreadable or holds a different number of results fails every
 * version in the batch.
 */
export function parseBatchResponse(versions, stdout, stderr = '') {
  const text = String(stdout ?? '');
  const start = text.indexOf('{');
  let json = null;
  if (start >= 0) { try { json = JSON.parse(text.slice(start)); } catch { /* whole-request failure below */ } }
  const results = json?.results;
  if (!Array.isArray(results) || results.length !== versions.length) {
    const why = (String(stderr).trim() || text.trim()).split('\n')[0] || 'no response';
    return versions.map(v => ({ ...v, ok: false, error: `whole request failed: ${why}` }));
  }
  return versions.map((v, i) => {
    const r = results[i];
    if (r.statusCode === 204) return { ...v, ok: true };
    const e = Array.isArray(r.result) ? r.result[0] : r.result;
    return { ...v, ok: false, error: e?.errorCode ? `${e.errorCode}: ${e.message}` : `status ${r.statusCode}` };
  });
}

export const isLockError = error => String(error ?? '').startsWith('UNABLE_TO_LOCK_ROW');

/** A failed version the org no longer holds was deleted anyway (a request stopped mid-way still completes). */
export function reconcile(results, records) {
  const present = new Set(records.map(r => r.Id));
  return results.map(r => !r.ok && !present.has(r.id)
    ? { ...r, ok: true, note: `deleted; the response said ${r.error}` } : r);
}

/**
 * The org-roles.mjs commands that open the org for this run and put the saved
 * state back. None when the org is already a deploy target. An org with no
 * saved role is opened as research and its entry removed afterwards.
 */
export function roleCommands(previous, name, rolesScript) {
  if (previous?.deploy === true) return { locked: false, allow: null, restore: null };
  const base = `node ${shQuote(rolesScript)}`;
  const who = shQuote(name);
  const branch = previous?.branch ? ` --branch ${shQuote(previous.branch)}` : '';
  return {
    locked: true,
    allow: `${base} set ${who} --role ${previous?.role ?? 'research'} --deploy yes${branch}`,
    restore: previous ? `${base} set ${who} --role ${previous.role} --deploy no${branch}` : `${base} remove ${who}`
  };
}

const skippedLines = skipped => skipped.length
  ? ['', 'SKIPPED (no Active version)', ...skipped.map(s => `${s.name}: ${s.present} versions`)] : [];

export function renderPlan({ count, flows, skipped }) {
  const total = flows.reduce((n, f) => n + f.delete.length, 0);
  const lines = [`COUNT: ${count} oldest non-Active versions per flow`,
                 `AT LIMIT: ${flows.length + skipped.length} flows with ${VERSION_LIMIT} or more versions`];
  if (flows.length) {
    lines.push('', 'Flow | Versions | Active | To delete | Version numbers');
    for (const f of flows) {
      lines.push(`${f.name} | ${f.present} | v${f.activeVersion} | ${f.delete.length} | ${formatRanges(f.delete.map(v => v.version)) || '-'}`);
    }
    lines.push('', `TOTAL: ${total} versions from ${flows.filter(f => f.delete.length).length} flows`);
  }
  return [...lines, ...skippedLines(skipped)].join('\n');
}

export function renderReport({ name, results, dropped, skipped, before, after }) {
  const deleted = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);
  const count = (records, id) => records.filter(r => r.DefinitionId === id).length;
  const lines = [`RESULT: ${deleted.length} deleted, ${failed.length} failed in ${name}`, '', 'Flow | Before | After'];
  for (const [id, flowName] of new Map(results.map(r => [r.definitionId, r.name]))) {
    lines.push(`${flowName} | ${count(before, id)} | ${count(after, id)}`);
  }
  if (failed.length) lines.push('', 'FAILED', ...failed.map(f => `${f.name} v${f.version}: ${f.error}`));
  const noted = deleted.filter(r => r.note);
  if (noted.length) lines.push('', 'DELETED DESPITE AN ERROR RESPONSE', ...noted.map(n => `${n.name} v${n.version}: ${n.note}`));
  if (dropped.length) lines.push('', 'NOT SENT', ...dropped.map(d => `${d.name} v${d.version}: ${d.reason}`));
  return [...lines, ...skippedLines(skipped)].join('\n');
}
