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

/**
 * A minimal record-triggered flow file, just complete enough for the parser.
 * The dependency-scan fields (default empty) each add one XML construct that
 * task-1-brief.md item 1 defines as a write or a read:
 *   - startFilterFields: <start> entry filters — a read.
 *   - assignToRecordFields: a before-save `$Record.<field>` assignment — a write.
 *   - updateRecordFields: a <recordUpdates> with inputReference $Record — a write.
 *   - updateByIdFields: a <recordUpdates> on the same object filtered by Id = $Record.Id — a write.
 *   - formulaReadFields: a formula referencing `$Record.<field>` — a read.
 *   - priorReadFields: a formula referencing `$Record__Prior.<field>` — a read.
 *   - subflowNames: <subflows> calls — listed, never scanned.
 */
function recordTriggeredFlow({
  object, triggerType, order, scheduledPaths = [], status = 'Active',
  startFilterFields = [], assignToRecordFields = [], updateRecordFields = [], updateByIdFields = [],
  formulaReadFields = [], priorReadFields = [], subflowNames = [],
}) {
  const paths = scheduledPaths.map(pathType => `
        <scheduledPaths>
            <connector>
                <targetReference>Next</targetReference>
            </connector>
            ${pathType === 'scheduled' ? '<offsetNumber>1</offsetNumber>\n            <offsetUnit>Hours</offsetUnit>'
                                        : `<pathType>${pathType}</pathType>`}
        </scheduledPaths>`).join('');
  const startFilters = startFilterFields.map(field => `
        <filters>
            <field>${field}</field>
            <operator>EqualTo</operator>
            <value>
                <stringValue>x</stringValue>
            </value>
        </filters>`).join('');
  const assignments = assignToRecordFields.length ? `
    <assignments>
        <name>Set_Fields</name>
        <label>Set Fields</label>
        <locationX>0</locationX>
        <locationY>0</locationY>${assignToRecordFields.map(field => `
        <assignmentItems>
            <assignToReference>$Record.${field}</assignToReference>
            <operator>Assign</operator>
            <value>
                <stringValue>x</stringValue>
            </value>
        </assignmentItems>`).join('')}
    </assignments>` : '';
  const inputAssignments = fields => fields.map(field => `
        <inputAssignments>
            <field>${field}</field>
            <value>
                <stringValue>x</stringValue>
            </value>
        </inputAssignments>`).join('');
  const updateRecord = updateRecordFields.length ? `
    <recordUpdates>
        <name>Update_This_Record</name>
        <label>Update This Record</label>
        <locationX>0</locationX>
        <locationY>0</locationY>${inputAssignments(updateRecordFields)}
        <inputReference>$Record</inputReference>
    </recordUpdates>` : '';
  const updateById = updateByIdFields.length ? `
    <recordUpdates>
        <name>Update_By_Id</name>
        <label>Update By Id</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <filterLogic>1</filterLogic>
        <filters>
            <field>Id</field>
            <operator>EqualTo</operator>
            <value>
                <elementReference>$Record.Id</elementReference>
            </value>
        </filters>${inputAssignments(updateByIdFields)}
        <object>${object}</object>
    </recordUpdates>` : '';
  const formulas = [...formulaReadFields.map(field => ({ field, prefix: '$Record' })),
                    ...priorReadFields.map(field => ({ field, prefix: '$Record__Prior' }))]
    .map(({ field, prefix }, i) => `
    <formulas>
        <name>Formula_${i}</name>
        <dataType>String</dataType>
        <expression>TEXT({!${prefix}.${field}})</expression>
    </formulas>`).join('');
  const subflows = subflowNames.map(name => `
    <subflows>
        <name>Call_${name}</name>
        <label>Call ${name}</label>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <flowName>${name}</flowName>
    </subflows>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>60.0</apiVersion>
    <label>fixture</label>
    <processType>AutoLaunchedFlow</processType>${assignments}${updateRecord}${updateById}${formulas}${subflows}
    <start>
        <locationX>0</locationX>
        <locationY>0</locationY>
        <object>${object}</object>
        <recordTriggerType>CreateAndUpdate</recordTriggerType>${paths}${startFilters}
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

  // ==== field dependency analysis (task-1-brief.md item 1-3) =================
  // Dep_Reader (100) reads a field via each of the three read mechanisms, plus
  // SharedField__c (also written by both later flows, for the conflict and
  // double-write checks), and calls a subflow. Dep_WriterAssign (200) writes
  // SharedField__c via a before-save assignment. Dep_WriterUpdate (300) writes
  // SharedField__c and AfterSaveField__c via a $Record recordUpdate (the
  // after-save form). Dep_WriterById (400) writes IdUpdateField__c via a
  // recordUpdate on the same object filtered by Id = $Record.Id.
  writeFlow(root, 'force-app/main/default/flows', 'Dep_Reader',
    recordTriggeredFlow({
      object: 'Depend__c', triggerType: 'RecordBeforeSave', order: 100,
      startFilterFields: ['FilterField__c'], formulaReadFields: ['FormulaField__c', 'SharedField__c'],
      priorReadFields: ['PriorField__c'], subflowNames: ['My_Subflow'],
    }));
  writeFlow(root, 'force-app/main/default/flows', 'Dep_WriterAssign',
    recordTriggeredFlow({
      object: 'Depend__c', triggerType: 'RecordBeforeSave', order: 200,
      assignToRecordFields: ['SharedField__c'],
    }));
  writeFlow(root, 'force-app/main/default/flows', 'Dep_WriterUpdate',
    recordTriggeredFlow({
      object: 'Depend__c', triggerType: 'RecordBeforeSave', order: 300,
      updateRecordFields: ['AfterSaveField__c', 'SharedField__c'],
    }));
  writeFlow(root, 'force-app/main/default/flows', 'Dep_WriterById',
    recordTriggeredFlow({
      object: 'Depend__c', triggerType: 'RecordBeforeSave', order: 400,
      updateByIdFields: ['IdUpdateField__c'],
    }));
  // Fix round 1, Important 1: a field can be both a write and a read of the
  // same flow — a $Record__Prior comparison against a field this same flow
  // also sets must still show up as a read.
  writeFlow(root, 'force-app/main/default/flows', 'Dep_ReadPriorOfWritten',
    recordTriggeredFlow({
      object: 'Depend__c', triggerType: 'RecordBeforeSave', order: 50,
      assignToRecordFields: ['StatusField__c'], priorReadFields: ['StatusField__c'],
    }));
  // Fix round 1, Controller ruling B: an Obsolete flow that writes the same
  // field as two active flows must still show up in the listing with its
  // status, but must never join the double-write or conflict scans.
  writeFlow(root, 'force-app/main/default/flows', 'Dep_Obsolete_Writer',
    recordTriggeredFlow({
      object: 'Depend__c', triggerType: 'RecordBeforeSave', order: 250, status: 'Obsolete',
      assignToRecordFields: ['SharedField__c'],
    }));

  const flowsWithDeps = loadFlows(root);
  const depBlock = formatReport(flowsWithDeps, 'Depend__c');
  const depLines = depBlock.split('\n');
  // Each flow's header line is "  order N  <Name>  (<path>)"; the file path
  // repeats the flow name, so splitting the report text on the bare name
  // would cut at that second occurrence instead. Anchoring on "  <Name>  ("
  // — the header's own two-space-delimited name field — finds the one line
  // that actually opens that flow's block.
  const blockFor = name => {
    const i = depLines.findIndex(l => l.includes(`  ${name}  (`));
    return i === -1 ? [] : depLines.slice(i, i + 4);
  };

  const readerBlock = blockFor('Dep_Reader');
  check('reads via entry filter, formula and $Record__Prior all show up',
        readerBlock.some(l => l.startsWith('    reads:') && l.includes('FilterField__c') &&
                               l.includes('FormulaField__c') && l.includes('PriorField__c')),
        readerBlock.join(' | '));
  check('a subflow call is listed as not scanned',
        readerBlock.some(l => l.includes('subflow calls, not scanned: My_Subflow')), readerBlock.join(' | '));

  const writerAssignBlock = blockFor('Dep_WriterAssign');
  check('writes via a before-save $Record assignment show up',
        writerAssignBlock.some(l => l.startsWith('    writes:') && l.includes('SharedField__c')), writerAssignBlock.join(' | '));

  const writerUpdateBlock = blockFor('Dep_WriterUpdate');
  check('writes via an after-save recordUpdate on $Record show up',
        writerUpdateBlock.some(l => l.startsWith('    writes:') && l.includes('AfterSaveField__c') && l.includes('SharedField__c')),
        writerUpdateBlock.join(' | '));

  const writerByIdBlock = blockFor('Dep_WriterById');
  check('writes via a recordUpdate on the same object filtered by Id show up',
        writerByIdBlock.some(l => l.startsWith('    writes:') && l.includes('IdUpdateField__c')), writerByIdBlock.join(' | '));

  check('an existing order conflict is flagged: a reader running before its writer',
        depBlock.includes('Dep_Reader reads SharedField__c but runs before Dep_WriterAssign, which writes SharedField__c') &&
        depBlock.includes('Dep_Reader reads SharedField__c but runs before Dep_WriterUpdate, which writes SharedField__c'),
        depBlock);
  check('a same-field double write names the flow that runs last',
        depBlock.includes('Dep_WriterAssign, Dep_WriterUpdate all write SharedField__c') &&
        depBlock.includes('Dep_WriterUpdate runs last and sets the final value'),
        depBlock);

  const priorWriteBlock = blockFor('Dep_ReadPriorOfWritten');
  check('Important 1: a field written by this flow can still show up as a read (e.g. via $Record__Prior)',
        priorWriteBlock.some(l => l.startsWith('    writes:') && l.includes('StatusField__c')) &&
        priorWriteBlock.some(l => l.startsWith('    reads:') && l.includes('StatusField__c')),
        priorWriteBlock.join(' | '));

  const obsoleteWriterLine = depLines.find(l => l.includes('  Dep_Obsolete_Writer  ('));
  const doubleWriteLine = depLines.find(l => l.includes('all write SharedField__c'));
  check('Controller ruling B: an Obsolete flow is still listed with its status and its own writes',
        obsoleteWriterLine?.includes('[Obsolete]') === true, obsoleteWriterLine);
  check('Controller ruling B: an Obsolete writer never joins the double-write scan',
        doubleWriteLine === '    Dep_WriterAssign, Dep_WriterUpdate all write SharedField__c — Dep_WriterUpdate runs last and sets the final value',
        doubleWriteLine);
  check('Controller ruling B: an Obsolete writer never joins the existing-order-conflict scan',
        !depBlock.includes('runs before Dep_Obsolete_Writer'), depBlock);

  // ==== --flow placement (task-1-brief.md item 4), the four fixture cases ====
  // Case 1: C reads F2 written by A only -> predecessor A, no successor,
  // suggestion after the last related flow (B): 1700.
  writeFlow(root, 'force-app/main/default/flows', 'DepCase1_A',
    recordTriggeredFlow({ object: 'DepCase1__c', triggerType: 'RecordAfterSave', order: 1500, updateRecordFields: ['F1', 'F2'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase1_B',
    recordTriggeredFlow({ object: 'DepCase1__c', triggerType: 'RecordAfterSave', order: 1600, formulaReadFields: ['F1'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase1_C',
    recordTriggeredFlow({ object: 'DepCase1__c', triggerType: 'RecordAfterSave', order: null, formulaReadFields: ['F2'] }));

  const case1Out = execFileSync('node', [SCRIPT, '--flow', 'DepCase1_C'], { cwd: root, encoding: 'utf8' });
  check('case 1: predecessor A only, no successor, suggestion 1700 (last related flow + 100)',
        case1Out.includes('Predecessors:\n  DepCase1_A') && case1Out.includes('Successors:\n  (none)') &&
        case1Out.includes('Related flows: DepCase1_A, DepCase1_B') && case1Out.includes('Suggested triggerOrder: 1700'),
        case1Out);

  // Case 2: A and B both write F2, C reads F2 -> predecessors A and B, suggestion 1700.
  writeFlow(root, 'force-app/main/default/flows', 'DepCase2_A',
    recordTriggeredFlow({ object: 'DepCase2__c', triggerType: 'RecordAfterSave', order: 1500, updateRecordFields: ['F2'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase2_B',
    recordTriggeredFlow({ object: 'DepCase2__c', triggerType: 'RecordAfterSave', order: 1600, updateRecordFields: ['F2'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase2_C',
    recordTriggeredFlow({ object: 'DepCase2__c', triggerType: 'RecordAfterSave', order: null, formulaReadFields: ['F2'] }));

  const case2Out = execFileSync('node', [SCRIPT, '--flow', 'DepCase2_C'], { cwd: root, encoding: 'utf8' });
  check('case 2: predecessors A and B, suggestion 1700',
        case2Out.includes('DepCase2_A') && case2Out.includes('DepCase2_B') &&
        case2Out.split('Predecessors:')[1].split('Successors:')[0].includes('DepCase2_A') &&
        case2Out.split('Predecessors:')[1].split('Successors:')[0].includes('DepCase2_B') &&
        case2Out.includes('Suggested triggerOrder: 1700'),
        case2Out);

  // Case 3: A writes F2, C reads F2 and writes F3, B reads F3 -> predecessor A,
  // successor B, range 1501-1599, suggestion 1550.
  writeFlow(root, 'force-app/main/default/flows', 'DepCase3_A',
    recordTriggeredFlow({ object: 'DepCase3__c', triggerType: 'RecordAfterSave', order: 1500, updateRecordFields: ['F2'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase3_B',
    recordTriggeredFlow({ object: 'DepCase3__c', triggerType: 'RecordAfterSave', order: 1600, formulaReadFields: ['F3'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase3_C',
    recordTriggeredFlow({ object: 'DepCase3__c', triggerType: 'RecordAfterSave', order: null, formulaReadFields: ['F2'], updateRecordFields: ['F3'] }));

  const case3Out = execFileSync('node', [SCRIPT, '--flow', 'DepCase3_C'], { cwd: root, encoding: 'utf8' });
  check('case 3: predecessor A, successor B, range 1501–1599, suggestion 1550',
        case3Out.includes('Allowed range: 1501–1599') && case3Out.includes('Suggested triggerOrder: 1550'),
        case3Out);

  // Case 4: B writes F2, C reads F2 and writes F1 -> predecessor B (1600),
  // successor B (reads F1) -> empty range, renumbering message. No A.
  writeFlow(root, 'force-app/main/default/flows', 'DepCase4_B',
    recordTriggeredFlow({ object: 'DepCase4__c', triggerType: 'RecordAfterSave', order: 1600, updateRecordFields: ['F2'], formulaReadFields: ['F1'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase4_C',
    recordTriggeredFlow({ object: 'DepCase4__c', triggerType: 'RecordAfterSave', order: null, formulaReadFields: ['F2'], updateRecordFields: ['F1'] }));

  const case4Out = execFileSync('node', [SCRIPT, '--flow', 'DepCase4_C'], { cwd: root, encoding: 'utf8' });
  check('case 4: predecessor and successor are the same flow -> empty range, renumbering message',
        case4Out.includes('Allowed range: empty') && case4Out.includes('renumbering'),
        case4Out);

  // ==== Fix round 1, Important 3: search outward for the nearest free =======
  // integer instead of only trying the midpoint. A(1500) predecessor,
  // B(1600) successor, U(1550) unrelated but sitting exactly on the naive
  // midpoint -> the nearest free integer either side (1549) must be found
  // instead of reporting no free integer.
  writeFlow(root, 'force-app/main/default/flows', 'DepCase6_A',
    recordTriggeredFlow({ object: 'DepCase6__c', triggerType: 'RecordAfterSave', order: 1500, updateRecordFields: ['F2'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase6_B',
    recordTriggeredFlow({ object: 'DepCase6__c', triggerType: 'RecordAfterSave', order: 1600, formulaReadFields: ['F3'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase6_U',
    recordTriggeredFlow({ object: 'DepCase6__c', triggerType: 'RecordAfterSave', order: 1550 }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase6_C',
    recordTriggeredFlow({ object: 'DepCase6__c', triggerType: 'RecordAfterSave', order: null, formulaReadFields: ['F2'], updateRecordFields: ['F3'] }));

  const case6Out = execFileSync('node', [SCRIPT, '--flow', 'DepCase6_C'], { cwd: root, encoding: 'utf8' });
  check('Important 3: the naive midpoint (1550) is taken by an unrelated flow, so the nearest free integer (1549) is suggested',
        case6Out.includes('Allowed range: 1501–1599') && case6Out.includes('Suggested triggerOrder: 1549'),
        case6Out);

  // ==== Fix round 1, Important 2: real run positions for "next flow above" ===
  // and "last related flow", not a purely numeric search that skips a
  // no-order flow sitting in between.
  // Repro 1: related P=950, unnumbered N, next numbered Q=1500 -> the real
  // next flow above P is N, not Q, and N has no triggerOrder, so no number
  // can be suggested (not 1225).
  writeFlow(root, 'force-app/main/default/flows', 'DepCase7_P',
    recordTriggeredFlow({ object: 'DepCase7__c', triggerType: 'RecordAfterSave', order: 950, updateRecordFields: ['F1'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase7_N',
    recordTriggeredFlow({ object: 'DepCase7__c', triggerType: 'RecordAfterSave', order: null }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase7_Q',
    recordTriggeredFlow({ object: 'DepCase7__c', triggerType: 'RecordAfterSave', order: 1500 }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase7_C',
    recordTriggeredFlow({ object: 'DepCase7__c', triggerType: 'RecordAfterSave', order: null, formulaReadFields: ['F1'] }));

  const case7Out = execFileSync('node', [SCRIPT, '--flow', 'DepCase7_C'], { cwd: root, encoding: 'utf8' });
  check('Important 2 repro 1: the real next flow above P (N, unnumbered) blocks a number, instead of skipping to Q for 1225',
        !case7Out.includes('1225') && !case7Out.includes('no free integer fits') &&
        case7Out.includes('DepCase7_N') && /Suggested triggerOrder: cannot be given a number/.test(case7Out),
        case7Out);

  // Repro 2: related P=500, unnumbered R runs immediately after P -> no
  // number can be suggested (not 600), since R's real position blocks it.
  writeFlow(root, 'force-app/main/default/flows', 'DepCase8_P',
    recordTriggeredFlow({ object: 'DepCase8__c', triggerType: 'RecordAfterSave', order: 500, updateRecordFields: ['F1'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase8_R',
    recordTriggeredFlow({ object: 'DepCase8__c', triggerType: 'RecordAfterSave', order: null }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase8_C',
    recordTriggeredFlow({ object: 'DepCase8__c', triggerType: 'RecordAfterSave', order: null, formulaReadFields: ['F1'] }));

  const case8Out = execFileSync('node', [SCRIPT, '--flow', 'DepCase8_C'], { cwd: root, encoding: 'utf8' });
  check('Important 2 repro 2: the real next flow above P (R, unnumbered) blocks a number, instead of suggesting 600',
        !case8Out.includes('600') && !case8Out.includes('no free integer fits') &&
        case8Out.includes('DepCase8_R') && /Suggested triggerOrder: cannot be given a number/.test(case8Out),
        case8Out);

  // ==== Fix round 1, Controller ruling A: a fully isolated flow -> keep the ==
  // current triggerOrder, give no new number, instead of "last flow + 100".
  writeFlow(root, 'force-app/main/default/flows', 'DepCase9_Other',
    recordTriggeredFlow({ object: 'DepCase9__c', triggerType: 'RecordAfterSave', order: 1500, formulaReadFields: ['OtherOnlyField__c'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase9_C',
    recordTriggeredFlow({ object: 'DepCase9__c', triggerType: 'RecordAfterSave', order: 1300, formulaReadFields: ['COnlyField__c'] }));

  const case9Out = execFileSync('node', [SCRIPT, '--flow', 'DepCase9_C'], { cwd: root, encoding: 'utf8' });
  check('Controller ruling A: no dependency on any other group flow -> keep the current triggerOrder, no new number',
        case9Out.includes('Predecessors:\n  (none)') && case9Out.includes('Successors:\n  (none)') &&
        case9Out.includes('Related flows: (none)') &&
        case9Out.includes('no dependency on any other flow in this group') &&
        case9Out.includes('keep the current triggerOrder (1300)'),
        case9Out);

  // ==== Fix round 1, Controller ruling B: Draft/Obsolete excluded from ======
  // predecessors, successors, related flows, range and neighbours (not just
  // from the plain listing's conflict scan, already covered above for the
  // Depend__c group).
  writeFlow(root, 'force-app/main/default/flows', 'DepCase10_ActivePred',
    recordTriggeredFlow({ object: 'DepCase10__c', triggerType: 'RecordAfterSave', order: 1500, updateRecordFields: ['F2'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase10_ObsoletePred',
    recordTriggeredFlow({ object: 'DepCase10__c', triggerType: 'RecordAfterSave', order: 1800, status: 'Obsolete', updateRecordFields: ['F2'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase10_ObsoleteSucc',
    recordTriggeredFlow({ object: 'DepCase10__c', triggerType: 'RecordAfterSave', order: 1700, status: 'Obsolete', formulaReadFields: ['F3'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase10_C',
    recordTriggeredFlow({ object: 'DepCase10__c', triggerType: 'RecordAfterSave', order: null, formulaReadFields: ['F2'], updateRecordFields: ['F3'] }));

  const case10Out = execFileSync('node', [SCRIPT, '--flow', 'DepCase10_C'], { cwd: root, encoding: 'utf8' });
  check('Controller ruling B: an Obsolete predecessor/successor/related flow is excluded from --flow placement',
        case10Out.includes('Predecessors:\n  DepCase10_ActivePred') &&
        !case10Out.includes('DepCase10_ObsoletePred') &&
        case10Out.includes('Successors:\n  (none)') &&
        !case10Out.includes('DepCase10_ObsoleteSucc') &&
        case10Out.includes('Related flows: DepCase10_ActivePred') &&
        case10Out.includes('Allowed range: 1501–2000') &&
        case10Out.includes('Suggested triggerOrder: 1600'),
        case10Out);
  const case10ListOut = execFileSync('node', [SCRIPT, 'DepCase10__c'], { cwd: root, encoding: 'utf8' });
  check('Controller ruling B: the Obsolete flows still appear in the plain listing with their status',
        case10ListOut.includes('DepCase10_ObsoletePred') && case10ListOut.includes('DepCase10_ObsoleteSucc') &&
        (case10ListOut.match(/\[Obsolete\]/g) || []).length === 2,
        case10ListOut);

  // ==== Fix round 2, item 2: the free-integer search must stay in the gap ===
  // after the last related flow, not the whole allowed range. A=1500 writes
  // F1 and F2, B=1600 reads F1 (so B is related, via A, to C below), unrelated
  // U=1601 sits immediately above B with no gap at all -> the round-1 code
  // searched the whole 1501-2000 range from the 1600/1601 midpoint (1600,
  // already taken) outward and landed on 1599, which runs BEFORE B. The fix
  // must instead see there is no room in the gap between B and U and say so.
  writeFlow(root, 'force-app/main/default/flows', 'DepCase13_A',
    recordTriggeredFlow({ object: 'DepCase13__c', triggerType: 'RecordAfterSave', order: 1500, updateRecordFields: ['F1', 'F2'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase13_B',
    recordTriggeredFlow({ object: 'DepCase13__c', triggerType: 'RecordAfterSave', order: 1600, formulaReadFields: ['F1'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase13_U',
    recordTriggeredFlow({ object: 'DepCase13__c', triggerType: 'RecordAfterSave', order: 1601 }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase13_C',
    recordTriggeredFlow({ object: 'DepCase13__c', triggerType: 'RecordAfterSave', order: null, formulaReadFields: ['F2'] }));

  const case13Out = execFileSync('node', [SCRIPT, '--flow', 'DepCase13_C'], { cwd: root, encoding: 'utf8' });
  check('Item 2: no room between the last related flow (B) and the next flow above it (U) -> renumbering, not 1599',
        !case13Out.includes('1599') && !case13Out.includes('no free integer fits in the allowed range') &&
        case13Out.includes('DepCase13_B') && case13Out.includes('DepCase13_U') && case13Out.includes('renumbering'),
        case13Out);

  // ==== Fix round 2, item 3: the successor-without-predecessor branch must ==
  // use the real run-order neighbour below the successor, not a numeric
  // filter. X=500 (low bucket), Y unnumbered (runs right after X, before the
  // successor S=1200), C writes F1 which S reads. The real neighbour
  // immediately below S is Y, which has no triggerOrder, so no number can be
  // suggested (a numeric filter would wrongly find X and suggest 850).
  writeFlow(root, 'force-app/main/default/flows', 'DepCase11_X',
    recordTriggeredFlow({ object: 'DepCase11__c', triggerType: 'RecordAfterSave', order: 500 }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase11_Y',
    recordTriggeredFlow({ object: 'DepCase11__c', triggerType: 'RecordAfterSave', order: null }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase11_S',
    recordTriggeredFlow({ object: 'DepCase11__c', triggerType: 'RecordAfterSave', order: 1200, formulaReadFields: ['F1'] }));
  writeFlow(root, 'force-app/main/default/flows', 'DepCase11_C',
    recordTriggeredFlow({ object: 'DepCase11__c', triggerType: 'RecordAfterSave', order: null, updateRecordFields: ['F1'] }));

  const case11Out = execFileSync('node', [SCRIPT, '--flow', 'DepCase11_C'], { cwd: root, encoding: 'utf8' });
  check('Item 3: the real run-order neighbour below the successor (Y, unnumbered) blocks a number, instead of suggesting 850 via X',
        !case11Out.includes('850') && !case11Out.includes('no free integer fits in the allowed range') &&
        case11Out.includes('DepCase11_Y') && /Suggested triggerOrder: cannot be given a number/.test(case11Out),
        case11Out);

  // ---- --flow error cases -----------------------------------------------------
  const notFoundOut = execFileSync('node', [SCRIPT, '--flow', 'No_Such_Flow'], { cwd: root, encoding: 'utf8' }).trim();
  check('a --flow name that does not exist reports one plain line',
        notFoundOut === 'No flow named No_Such_Flow found under force-app/.', notFoundOut);

  const notRecordTriggeredOut = execFileSync('node', [SCRIPT, '--flow', 'Screen_Flow'], { cwd: root, encoding: 'utf8' }).trim();
  check('a --flow name that exists but is not record-triggered reports one plain line',
        notRecordTriggeredOut === 'Screen_Flow is not a record-triggered flow.', notRecordTriggeredOut);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n  ${failures ? `${failures} failed` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
