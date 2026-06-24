/**
 * Smoke test for the MCP tool layer (src/mcp_tools.js).
 *
 * Exercises the exact code path Claude Code invokes, without spawning an MCP client.
 * Runs against agent-context's OWN source tree: src/Graphify.js is imported by the demos,
 * the tests, and src/mcp_tools.js, so it must show dependents.
 *
 * Run: node tests/mcp.test.js
 */
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the repo root from this file, so the test is independent of the cwd it runs in,
// and set it as the trusted anchor BEFORE importing the tool layer (anchor reads the env).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.GRAPHIFY_ROOT = repoRoot;

const { TOOLS, handleTool } = await import('../src/mcp_tools.js');

let passed = 0;
function ok(name) {
  console.log(`  ✓ ${name}`);
  passed++;
}

// 1. Tool definitions are well-formed.
assert.equal(TOOLS.length, 3, 'expected exactly 3 tools');
assert.ok(
  TOOLS.every((t) => t.name && t.description && t.inputSchema && t.inputSchema.type === 'object'),
  'every tool needs name + description + object inputSchema'
);
assert.deepEqual(TOOLS.map((t) => t.name).sort(), ['blast_radius', 'context_info', 'graph_summary']);
ok('exposes blast_radius + graph_summary + context_info with valid schemas');

// 1b. Every tool carries MCP annotation hints (read-only query surface).
assert.ok(
  TOOLS.every((t) => t.annotations && t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false),
  'every tool is annotated read-only + non-destructive'
);
ok('all tools carry read-only, non-destructive annotation hints');

// 1c. context_info introspection: name, version, tool list; no graph build.
const info = await handleTool('context_info', {});
assert.equal(info.name, 'agent-context');
assert.ok(info.version, 'reports a version');
assert.deepEqual(info.tools.sort(), ['blast_radius', 'context_info', 'graph_summary']);
ok(`context_info reports ${info.name}@${info.version} with ${info.tools.length} tools`);

// 2. blast_radius finds real dependents of Graphify.js in this repo.
const br = await handleTool('blast_radius', { file: 'src/Graphify.js', root: repoRoot });
assert.equal(br.target, 'src/Graphify.js');
assert.ok(br.dependentCount >= 1, `expected >=1 dependent, got ${br.dependentCount}`);
assert.ok(
  br.dependents.some((d) => d.includes('blast-radius') || d.includes('mcp_tools')),
  `expected a known importer in dependents, got: ${br.dependents.join(', ')}`
);
ok(`blast_radius: ${br.dependentCount} dependents, ${br.dependencyCount} dependencies of src/Graphify.js`);

// 3. graph_summary reports a non-empty, analyzable graph.
const gs = await handleTool('graph_summary', { root: repoRoot });
assert.ok(gs.nodeCount > 0, 'expected a positive node count');
assert.ok(gs.edgeCount >= 1, 'expected at least one edge');
ok(`graph_summary: ${gs.nodeCount} files, ${gs.edgeCount} edges`);

// 4. blast_radius without a file is rejected.
await assert.rejects(() => handleTool('blast_radius', { file: undefined }), /requires "file"/);
ok('blast_radius rejects a missing file arg');

// 5. Unknown tool is rejected.
await assert.rejects(() => handleTool('nope', {}), /Unknown tool/);
ok('unknown tool rejects');

// 6. Root confinement: a root that escapes the anchor is rejected before any walk.
const escape = path.resolve(repoRoot, '..', '..', '..');
await assert.rejects(() => handleTool('graph_summary', { root: escape }), /escapes the allowed workspace/);
ok('root confinement rejects a path that escapes the workspace');

console.log(`\n${passed} checks passed`);
