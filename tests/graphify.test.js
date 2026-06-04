#!/usr/bin/env node
import { GraphifyClient } from '../src/Graphify.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

console.log('Agent-Context Test Suite\n');

const repoRoot = path.resolve(__dirname, '..');
const client = new GraphifyClient(repoRoot);

console.log('Test 1: Build graph of this repo');
const summary = await client.getGraphSummary();
assert(summary.nodeCount > 0, 'Graph has nodes');
assert(typeof summary.edgeCount === 'number', 'Edge count is a number');

console.log('\nTest 2: Query neighbors');
const neighbors = await client.queryNeighbors('demo/graph.js');
assert(Array.isArray(neighbors.dependents), 'Dependents is an array');
assert(Array.isArray(neighbors.dependencies), 'Dependencies is an array');

console.log('\nTest 3: Get context string');
const context = await client.getContextString('demo/blast-radius.js');
assert(typeof context === 'string', 'Context string is a string');

console.log('\nTest 4: Graph caches on second call');
const summary2 = await client.getGraphSummary();
assert(summary2.nodeCount === summary.nodeCount, 'Graph is cached (same node count)');

console.log(`\n${'─'.repeat(40)}`);
console.log(`Tests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
