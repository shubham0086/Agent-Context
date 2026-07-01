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

console.log('\nTest 5: Cache invalidates when a file changes (staleness check)');
{
  const fs = await import('fs/promises');
  const tmpFile = path.join(repoRoot, 'tests', '__staleness_probe.js');
  await fs.writeFile(tmpFile, '// probe v1, no imports\n');
  const v1 = await client.getGraphSummary();
  // Bump mtime + content so the fingerprint must change; v2 adds one import edge.
  await new Promise((r) => setTimeout(r, 10));
  await fs.writeFile(tmpFile, "import x from './nonexistent.js';\n// probe v2\n");
  const v2 = await client.getGraphSummary();
  assert(v2.edgeCount === v1.edgeCount + 1, 'Content change is detected (new edge, not stale)');
  assert(v2.nodeCount === v1.nodeCount, 'Same file set after content-only change');
  await fs.unlink(tmpFile);
  const cleaned = await client.getGraphSummary();
  assert(cleaned.nodeCount === v1.nodeCount - 1, 'Cache invalidates when a file is removed');
}

console.log('\nTest 6: Dependents resolve across extensionless imports (reverse-edge bug)');
{
  const fs = await import('fs/promises');
  const depFile = path.join(repoRoot, 'tests', '__br_dep.js');
  const srcFile = path.join(repoRoot, 'tests', '__br_src.js');
  await fs.writeFile(depFile, 'export const x = 1;\n');
  // Extensionless require — the exact shape that previously returned 0 dependents.
  await fs.writeFile(srcFile, "const { x } = require('./__br_dep');\n");
  const n = await client.queryNeighbors('tests/__br_dep.js');
  assert(n.dependents.includes('tests/__br_src.js'),
    'dependents includes the extensionless importer (was 0 before the fix)');
  // A query that omits the extension must also work.
  const n2 = await client.queryNeighbors('tests/__br_dep');
  assert(n2.dependents.includes('tests/__br_src.js'),
    'dependents resolve even when the query omits the extension');
  await fs.unlink(depFile);
  await fs.unlink(srcFile);
}

console.log(`\n${'─'.repeat(40)}`);
console.log(`Tests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
