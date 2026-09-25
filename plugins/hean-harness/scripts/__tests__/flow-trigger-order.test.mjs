#!/usr/bin/env node
/**
 * flow-trigger-order groups record-triggered flows by object and trigger
 * timing and lays each group out in the platform's real run order: triggerOrder
 * 1-1000 ascending, then flows with no triggerOrder, then 1001-2000 ascending,
 * with ties on the same value broken by API name. Getting that sequence wrong
 * is exactly the mistake this tool exists to prevent, so the ordering,
 * tie-marking and missing-order-marking are each checked directly against
 * fixture flow files rather than trusted from reading the source.
 *
 * Runs against a throwaway force-app tree. Touches nothing of yours.
 *
 * Run: node scripts/__tests__/flow-trigger-order.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { findFlowFiles, parseFlow, formatReport, repoRelative } from '../lib/flow-trigger-order.mjs';

// <plugin>/scripts/__tests__/ -> <plugin>/scripts
const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(SCRIPTS, 'flow-trigger-order.mjs');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

/** A minimal record-triggered flow file, just complete enough for the parser. */
function recordTriggeredFlow({ object, triggerType, order, scheduledPaths = [], status = 'Active' }) {
  const paths = scheduledPaths.map(pathType => `
        <scheduledPaths>
            <connector>
                <targetReference>Next</targetReference>
            </connector>
            ${pathType === 'scheduled' ? '<offsetNumber>1</offsetNumber>\n            <offsetUnit>Hours</offsetUnit>'
                                        : `<pathType>${pathType}</pathType>`}
        </scheduledPaths>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>60.0</apiVersion>
    <label>fixture</label>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <object>${object}</object>
        <recordTriggerType>CreateAndUpdate</recordTriggerType>${paths}
        <triggerType>${triggerType}</triggerType>
    </start>
    <status>${status}</status>${order !== null ? `\n    <triggerOrder>${order}</triggerOrder>` : ''}
</Flow>
`;
}

/** A screen flow: has a <start>, but no triggerType, so it is never record-triggered. */
function screenFlow() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>60.0</apiVersion>
    <label>fixture screen flow</label>
    <processType>Flow</processType>
    <start>
        <locationX>0</locationX>
        <locationY>0</locationY>
    </start>
    <status>Active</status>
</Flow>
`;
}

function writeFlow(root, relativeDir, name, xml) {
  const dir = join(root, relativeDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.flow-meta.xml`), xml);
}

/** All parsed record-triggered flows under root, repository-relative. */
function loadFlows(root) {
  const files = findFlowFiles(root);
  return files.map(f => parseFlow(readFileSync(f, 'utf8'), repoRelative(root, f))).filter(Boolean);
}

const root = mkdtempSync(join(tmpdir(), 'hean-flow-trigger-order-'));

try {
  // Case · RecordAfterSave: two flows tied at 500 (in the 1-1000 range), one
  // with no triggerOrder, one at 1800 (in the 1001-2000 range) with both
  // kinds of extra path.
  writeFlow(root, 'force-app/main/default/flows', 'Case_Notify',
    recordTriggeredFlow({ object: 'Case', triggerType: 'RecordAfterSave', order: 500 }));
  writeFlow(root, 'force-app/main/default/flows', 'Case_Escalate',
    recordTriggeredFlow({ object: 'Case', triggerType: 'RecordAfterSave', order: 500 }));
  writeFlow(root, 'force-app/main/default/flows', 'Case_Legacy',
    recordTriggeredFlow({ object: 'Case', triggerType: 'RecordAfterSave', order: null }));
  writeFlow(root, 'force-app/main/default/flows', 'Case_Sync',
    recordTriggeredFlow({ object: 'Case', triggerType: 'RecordAfterSave', order: 1800,
                           scheduledPaths: ['AsyncAfterCommit', 'scheduled'] }));
  // Obsolete, but shares the 500 tie value with Case_Notify/Case_Escalate — it
  // must show its status and must not be counted in their tie marking.
  writeFlow(root, 'force-app/main/default/flows', 'Case_Obsolete',
    recordTriggeredFlow({ object: 'Case', triggerType: 'RecordAfterSave', order: 500, status: 'Obsolete' }));

  // Contact · RecordBeforeSave: a lone flow — a compact one-line group.
  writeFlow(root, 'force-app/main/default/flows', 'Contact_Validate',
    recordTriggeredFlow({ object: 'Contact', triggerType: 'RecordBeforeSave', order: 1200 }));

  // Lead · RecordBeforeDelete: a lone flow with no triggerOrder.
  writeFlow(root, 'force-app/main/default/flows', 'Lead_Before_Delete',
    recordTriggeredFlow({ object: 'Lead', triggerType: 'RecordBeforeDelete', order: null }));

  // A screen flow, in a second package directory — never record-triggered,
  // and proves the walk is not limited to one flows/ folder.
  writeFlow(root, 'force-app/vendor/main/default/flows', 'Screen_Flow', screenFlow());

  const flows = loadFlows(root);

  check('screen flow is excluded, only record-triggered flows are parsed', flows.length === 7,
        `found ${flows.length}`);

  const report = formatReport(flows);

  // ---- grouping by object and timing --------------------------------------
  check('groups by object and trigger timing', report.includes('Case · RecordAfterSave — 5 flows'));
  check('a lone flow\'s group is not given a "N flows" header',
        !/Contact.*flows, in platform run order/.test(report));

  // ---- run-order sorting across the three ranges --------------------------
  const caseBlock = report.split('Case · RecordAfterSave')[1].split(/\n(?=\S)/)[0];
  const posEscalate = caseBlock.indexOf('Case_Escalate');
  const posNotify = caseBlock.indexOf('Case_Notify');
  const posLegacy = caseBlock.indexOf('Case_Legacy');
  const posSync = caseBlock.indexOf('Case_Sync');
  check('the 1-1000 range (here tied at 500) comes before the no-order flow',
        posEscalate < posLegacy && posNotify < posLegacy);
  check('the no-order flow comes before the 1001-2000 range',
        posLegacy < posSync);
  check('flows tied on the same order are listed in API-name order',
        posEscalate < posNotify, `Escalate@${posEscalate} Notify@${posNotify}`);

  // ---- tie marking ----------------------------------------------------------
  check('tied flows are marked as tied',
        caseBlock.includes('order 500 (tied with another flow') );
  const syncLine = caseBlock.split('\n').find(l => l.includes('Case_Sync'));
  check('the untied 1800 flow is not marked as tied',
        syncLine?.includes('order 1800') && !syncLine.includes('tied'), syncLine);
  check('exactly two lines in the group carry the tie mark',
        (caseBlock.match(/tied with another flow/g) || []).length === 2);
  const obsoleteLine = caseBlock.split('\n').find(l => l.includes('Case_Obsolete'));
  check('an Obsolete flow shows its status and is not counted in tie marking',
        obsoleteLine?.includes('[Obsolete]') && !obsoleteLine.includes('tied'), obsoleteLine);

  // ---- missing order marking -------------------------------------------------
  check('the flow with no triggerOrder shows the literal value "none", marked',
        caseBlock.includes('none — position depends on created date'));
  const loneLeadLine = report.split('\n').find(l => l.includes('Lead_Before_Delete'));
  check('a lone flow with no triggerOrder shows the same literal "none" mark when compact',
        loneLeadLine?.includes('none — position depends on created date') === true, loneLeadLine);

  // ---- async / scheduled path listing ----------------------------------------
  check('both an AsyncAfterCommit and a scheduled path are listed for one flow',
        caseBlock.includes('Case_Sync') && caseBlock.includes('async: AsyncAfterCommit, scheduled'));
  check('a flow with no extra paths prints no async label',
        !/Case_Escalate.*async:/.test(caseBlock));

  // ---- compact single-flow groups --------------------------------------------
  const contactLine = report.split('\n').find(l => l.startsWith('Contact'));
  check('a lone flow is printed as one compact line with its order and path',
        contactLine?.includes('order 1200') && contactLine.includes('Contact_Validate') &&
        contactLine.includes('force-app/main/default/flows/Contact_Validate.flow-meta.xml'),
        contactLine);

  // ---- the object filter ------------------------------------------------------
  const filtered = formatReport(flows, 'Contact');
  check('filtering by object keeps only that object\'s flows',
        filtered.includes('Contact_Validate') && !filtered.includes('Case_') && !filtered.includes('Lead_'));
  check('filtering by an object with no record-triggered flow reports that plainly',
        formatReport(flows, 'NoSuchObject__c') === 'No record-triggered flow found for NoSuchObject__c under force-app/.');
  check('the object filter is case-insensitive',
        formatReport(flows, 'contact').includes('Contact_Validate'));

  console.log(`  --- report on the fixture tree ---\n${report.split('\n').map(l => `  ${l}`).join('\n')}`);

  // ---- the no-flows message, through the real CLI entry point ----------------
  const onlyScreenFlows = mkdtempSync(join(tmpdir(), 'hean-flow-trigger-order-none-'));
  try {
    writeFlow(onlyScreenFlows, 'force-app/main/default/flows', 'Screen_Only', screenFlow());
    const out = execFileSync('node', [SCRIPT], { cwd: onlyScreenFlows, encoding: 'utf8' }).trim();
    check('a force-app/ with no record-triggered flow prints one plain line',
          out === 'No record-triggered flow found under force-app/.', out);
  } finally {
    rmSync(onlyScreenFlows, { recursive: true, force: true });
  }

  const noForceApp = mkdtempSync(join(tmpdir(), 'hean-flow-trigger-order-empty-'));
  try {
    const out = execFileSync('node', [SCRIPT], { cwd: noForceApp, encoding: 'utf8' }).trim();
    check('no force-app/ folder prints one plain line and still exits 0',
          out === 'No force-app/ folder here. Run this from the repository root.', out);
  } finally {
    rmSync(noForceApp, { recursive: true, force: true });
  }

  // the real CLI entry point also honours the object argument end to end
  const cliOut = execFileSync('node', [SCRIPT, 'Contact'], { cwd: root, encoding: 'utf8' }).trim();
  check('the CLI passes its argument through as the object filter',
        cliOut.includes('Contact_Validate') && !cliOut.includes('Case_'), cliOut);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n  ${failures ? `${failures} failed` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
