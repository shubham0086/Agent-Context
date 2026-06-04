#!/usr/bin/env node
/**
 * Demo: Print the dependency graph of any repo.
 * Usage: node demo/graph.js <path-to-repo>
 * Example: node demo/graph.js .
 */

import { GraphifyClient } from '../src/Graphify.js';

const targetPath = process.argv[2] || '.';

console.log(`\nGraphify: scanning ${targetPath}...\n`);

const client = new GraphifyClient(targetPath);
const summary = await client.getGraphSummary();

console.log(`Found ${summary.nodeCount} files, ${summary.edgeCount} dependency edges\n`);

if (summary.nodeCount === 0) {
  console.log('No analyzable files found (.js .ts .jsx .tsx .py .go)');
  process.exit(0);
}

console.log('Files and their dependency count:');
const sorted = Object.entries(summary.nodes).sort((a, b) => b[1].dependencyCount - a[1].dependencyCount);
for (const [file, info] of sorted.slice(0, 20)) {
  const bar = '█'.repeat(Math.min(info.dependencyCount, 20));
  console.log(`  ${bar} ${info.dependencyCount} deps  ${file}`);
}

if (sorted.length > 20) {
  console.log(`  ... and ${sorted.length - 20} more files`);
}

console.log('\nTop edges (dependencies):');
for (const edge of summary.edges.slice(0, 15)) {
  console.log(`  ${edge.from} -> ${edge.to}`);
}
if (summary.edges.length > 15) {
  console.log(`  ... and ${summary.edges.length - 15} more edges`);
}

console.log('\nDone. Run demo/blast-radius.js <file> to see the blast radius for a specific file.\n');
