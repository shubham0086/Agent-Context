#!/usr/bin/env node
/**
 * Demo: Show the blast radius of a specific file.
 * What breaks if you touch it? What does it depend on?
 * Also shows the compact LLM context string it would inject.
 *
 * Usage: node demo/blast-radius.js <file-path> [repo-root]
 * Example: node demo/blast-radius.js src/Graphify.js .
 */

import { GraphifyClient } from '../src/Graphify.js';

const targetFile = process.argv[2];
const repoRoot = process.argv[3] || '.';

if (!targetFile) {
  console.log('Usage: node demo/blast-radius.js <file-path> [repo-root]');
  console.log('Example: node demo/blast-radius.js src/Graphify.js .');
  process.exit(1);
}

console.log(`\nGraphify: blast radius for "${targetFile}" in "${repoRoot}"\n`);

const client = new GraphifyClient(repoRoot);
const neighbors = await client.queryNeighbors(targetFile);

console.log(`Target: ${neighbors.target}`);
console.log(`Dependencies (what this file imports): ${neighbors.dependencies.length}`);
for (const dep of neighbors.dependencies) {
  console.log(`  <- ${dep}`);
}

console.log(`\nDependents (files that will break if you change this): ${neighbors.dependents.length}`);
for (const dep of neighbors.dependents) {
  console.log(`  -> ${dep}`);
}

const contextString = await client.getContextString(targetFile);
if (contextString) {
  console.log('\nLLM context string (what gets injected into the agent prompt):');
  console.log('─'.repeat(60));
  console.log(contextString);
  console.log('─'.repeat(60));
  console.log(`\nToken estimate: ~${Math.floor(contextString.length / 4)} tokens`);
} else {
  console.log('\nNo context string generated (file has no tracked neighbors).');
}

console.log();
