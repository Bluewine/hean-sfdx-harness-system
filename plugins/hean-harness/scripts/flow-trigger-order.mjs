#!/usr/bin/env node
/**
 * Lists every record-triggered flow under force-app/, grouped by object and
 * trigger timing, in the order the platform actually runs them — so an agent
 * can see which flows share an object and timing and how they will run,
 * without opening every flow file.
 *
 * Usage: flow-trigger-order.mjs [ObjectApiName] [--flow FlowApiName]
 *
 * Run from the repository root. Lists every object when no object is given.
 * With --flow, reports one flow's predecessors, successors, related flows
 * and allowed triggerOrder placement within its own group instead.
 */

import { readFileSync } from 'node:fs';
import { findFlowFiles, parseFlow, formatReport, formatFlowPlacement, findFlowFileByName, repoRelative } from './lib/flow-trigger-order.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
let objectFilter = null;
let flowOption = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--flow') flowOption = args[++i] ?? null;
  else if (objectFilter === null) objectFilter = args[i];
}

const files = findFlowFiles(root);
if (files === null) {
  console.log('No force-app/ folder here. Run this from the repository root.');
  process.exit(0);
}

const flows = files
  .map(f => parseFlow(readFileSync(f, 'utf8'), repoRelative(root, f)))
  .filter(Boolean);

if (flowOption) {
  const match = findFlowFileByName(files, flowOption);
  if (!match) {
    console.log(`No flow named ${flowOption} found under force-app/.`);
    process.exit(0);
  }
  const matchRelative = repoRelative(root, match);
  const target = flows.find(f => f.path === matchRelative);
  if (!target) {
    console.log(`${flowOption} is not a record-triggered flow.`);
    process.exit(0);
  }
  console.log(formatFlowPlacement(flows, target));
} else {
  console.log(formatReport(flows, objectFilter));
}
