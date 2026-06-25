/**
 * MCP tool definitions + dispatch for agent-context (Graphify).
 *
 * Kept separate from the stdio server wiring (mcp_server.js) so the tool logic is
 * unit-testable without spawning a transport. Pure: handleTool() takes a name + args
 * and returns a plain object (or throws). No SDK imports here.
 *
 * Exposes the blast-radius capability as two tools a skill can call:
 *   - blast_radius : what depends on a file (dependents) + what it depends on
 *   - graph_summary: a one-line check that the repo is analyzable
 *
 * Security posture (proportional to a LOCAL, read-only, single-tenant stdio tool — the
 * full MCP-gateway pipeline is reserved for the untrusted REMOTE/paid tier). Two gateway
 * controls do apply here and are enforced:
 *   1. Root confinement — the trusted anchor is GRAPHIFY_ROOT (operator config) or the cwd
 *      the IDE launched us in. A per-call `root` argument is UNTRUSTED: it may narrow to a
 *      subdirectory but may never escape the anchor. (Gateway path-escape defense, scaled.)
 *   2. Per-call timeout — a pathological tree can't hang the caller's IDE. (Gateway lesson:
 *      every tool call is time-bounded.)
 */
import path from 'node:path';
import { GraphifyClient } from './Graphify.js';

// Per-call timeout (ms). A walk that exceeds this rejects rather than hanging the caller.
const TIMEOUT_MS = Number(process.env.GRAPHIFY_TIMEOUT_MS) || 15000;

// The trusted workspace anchor. Computed per call (not frozen at import) so operators and
// tests can set GRAPHIFY_ROOT at runtime. cwd is correct in an IDE: it's the workspace.
function getAnchor() {
  return path.resolve(process.env.GRAPHIFY_ROOT || process.cwd());
}

// Confine an untrusted `root` arg to the anchor. Relative args resolve against the anchor;
// any path (relative or absolute) that lands outside the anchor is rejected.
function resolveRoot(root) {
  const anchor = getAnchor();
  if (!root) return anchor;
  const resolved = path.resolve(anchor, root);
  if (resolved !== anchor && !resolved.startsWith(anchor + path.sep)) {
    throw new Error(`root escapes the allowed workspace (${anchor})`);
  }
  return resolved;
}

// One cached client per resolved root, so repeated calls reuse the already-built graph.
const _clients = new Map();
function clientFor(root) {
  const resolved = resolveRoot(root);
  if (!_clients.has(resolved)) _clients.set(resolved, new GraphifyClient(resolved));
  return _clients.get(resolved);
}

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)),
      TIMEOUT_MS
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const TOOLS = [
  {
    name: 'blast_radius',
    description:
      'Given a repo-relative file path, return its blast radius: the files that depend on it ' +
      '(dependents — these can break if it changes) and the files it depends on (dependencies). ' +
      'Call this before approving a change to see what it actually affects beyond the diff.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Repo-relative path of the file to analyze, e.g. "src/db.js".',
        },
        root: {
          type: 'string',
          description: 'Optional repo root to analyze. Defaults to the current workspace; cannot escape it.',
        },
      },
      required: ['file'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'graph_summary',
    description:
      'Return a one-line structural summary of the repo dependency graph (file count, edge count). ' +
      'Use to confirm the codebase is analyzable before relying on blast_radius.',
    inputSchema: {
      type: 'object',
      properties: {
        root: {
          type: 'string',
          description: 'Optional repo root. Defaults to the current workspace; cannot escape it.',
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'context_info',
    description:
      'Return this spoke\'s identity: server name, version, and the list of available tool names. ' +
      'Read-only introspection with no side effects; use it to confirm what the server exposes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

// Spoke identity, surfaced by the context_info introspection tool. Kept in sync with package.json.
export const SPOKE = { name: 'agent-context', version: '1.0.0' };

export async function handleTool(name, args = {}) {
  // Introspection short-circuits before any graph build: no client, no walk, no side effects.
  if (name === 'context_info') {
    return { name: SPOKE.name, version: SPOKE.version, tools: TOOLS.map((t) => t.name) };
  }

  const client = clientFor(args.root); // throws on root escape, before any walk

  switch (name) {
    case 'blast_radius': {
      if (!args.file) {
        throw new Error('blast_radius requires "file": a repo-relative path, e.g. "src/db.js".');
      }
      const n = await withTimeout(client.queryNeighbors(args.file), 'blast_radius');
      // Actionable empty result: an isolated file and a mistyped path look identical to
      // the caller otherwise. Point the agent at graph_summary to disambiguate.
      if (n.dependents.length === 0 && n.dependencies.length === 0) {
        return {
          target: n.target,
          dependents: [],
          dependencies: [],
          dependentCount: 0,
          dependencyCount: 0,
          note:
            `No edges found for "${args.file}". Either it is isolated, or the path is wrong ` +
            `(must be repo-relative, e.g. "src/db.js"). Run graph_summary to confirm the repo is indexed.`,
        };
      }
      return {
        target: n.target,
        dependents: n.dependents,
        dependencies: n.dependencies,
        dependentCount: n.dependents.length,
        dependencyCount: n.dependencies.length,
      };
    }
    case 'graph_summary': {
      const s = await withTimeout(client.getGraphSummary(), 'graph_summary');
      return { nodeCount: s.nodeCount, edgeCount: s.edgeCount };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
