#!/usr/bin/env node
/**
 * Lists every record-triggered flow under force-app/, grouped by object and
 * trigger timing, in the order the platform actually runs them — so an agent
 * can see which flows share an object and timing and how they will run,
 * without opening every flow file.
 *
 * Usage: flow-trigger-order.mjs [ObjectApiName]
 *
 * Run from the repository root. Lists every object when none is given.
 */

import { readFileSync } from 'node:fs';
import { findFlowFiles, parseFlow, formatReport, repoRelative } from './lib/flow-trigger-order.mjs';

const root = process.cwd();
const objectFilter = process.argv[2] || null;

const files = findFlowFiles(root);
if (files === null) {
  console.log('No force-app/ folder here. Run this from the repository root.');
  process.exit(0);
}

const flows = files
  .map(f => parseFlow(readFileSync(f, 'utf8'), repoRelative(root, f)))
  .filter(Boolean);

console.log(formatReport(flows, objectFilter));
