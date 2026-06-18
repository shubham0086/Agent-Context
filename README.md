# Agent-Context

> **IMPORTANT**: This repository contains real, production-ready, battle-tested code extracted directly from active commercial systems (like Agency OS or Founder Growth OS), rather than simplified mock learning artifacts.
>
> For project walkthroughs, architecture flowcharts, and system context, visit the live landing page: [my-portfolio-github-io-beta-five.vercel.app/projects/agent-context.html](https://my-portfolio-github-io-beta-five.vercel.app/projects/agent-context.html)

**Give your agent the 200 tokens it needs about your codebase, not 8,000 tokens of noise.**

Agent-Context walks any project, builds a dependency graph, and tells an agent exactly which files depend on a given file and which files it depends on. The blast radius, compact enough to fit in a prompt.

Extracted from 18 months of production Agency OS.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/Node-18%2B-brightgreen.svg)](package.json)
[![Zero dependencies](https://img.shields.io/badge/dependencies-zero-blue.svg)]()

---

## Quick Start

```bash
git clone https://github.com/shubham0086/Agent-Context
cd Agent-Context

# Map the dependency graph of any repo
node demo/graph.js .

# Show blast radius for a specific file
node demo/blast-radius.js src/Graphify.js .
```

No install needed. Zero external dependencies.

---

## What It Does

1. **Walks your project** skipping `node_modules`, `.git`, `dist`, `venv` and similar noise
2. **Extracts imports** from JS, TS, JSX, TSX, Python, Go
3. **Builds a graph**: nodes are files, edges are dependencies
4. **Answers blast radius**: touch `auth.js` — what else breaks?
5. **Formats for LLM injection**: a compact context string the agent reads before acting

### The Context String (what gets injected into the prompt)

```
### GRAPHIFY STRUCTURAL CONTEXT FOR [src/auth.js]
- Dependencies (what this file uses): src/db.js, src/utils/crypto.js
- Dependents (what relies on this file): src/routes/login.js, src/routes/signup.js, src/middleware/guard.js

Rule: If you modify this file, be aware of the blast radius affecting its dependents.
```

An agent that reads this before editing `auth.js` knows it needs to check 3 downstream files. An agent that doesn't will break them silently.

---

## API

### `new GraphifyClient(projectRoot)`

```js
import { GraphifyClient } from 'agent-context';
const client = new GraphifyClient('./my-project');
```

### `buildGraph()` / `getGraphSummary()`

```js
const summary = await client.getGraphSummary();
// { nodeCount: 42, edgeCount: 87, nodes: {...}, edges: [...] }
```

### `queryNeighbors(filePath)`

```js
const { target, dependents, dependencies } = await client.queryNeighbors('src/auth.js');
// dependents: files that import auth.js (will break if you change it)
// dependencies: files that auth.js imports (must exist for auth.js to work)
```

### `getContextString(filePath)`

```js
const context = await client.getContextString('src/auth.js');
// Returns compact LLM-ready string, or '' if file has no tracked neighbors
```

---

## Languages Supported

| Language | Import detection |
|----------|-----------------|
| JavaScript / Node.js | `require()` and `import from` |
| TypeScript | `import from` |
| JSX / TSX | `import from` |
| Python | `import` and `from X import` |
| Go | `import "..."` |

---

## Security & Sandboxing (MCP)

When exposing tool context to LLMs via Model Context Protocol (MCP) servers, validate query paths to mitigate injection risks:
- **Normalizes Paths**: Ensures all paths are normalized (removing `../` sequences) before traversing dependencies.
- **Enforces Sandboxing**: Matches files against an allowlisted workspace root sandbox to prevent path traversal (CVE-2025-53110) or symlink bypasses (CVE-2025-53109).

## Where This Fits

```
AI-systems-evolution   ← start here (rung 03: agent needs context)
    |
    └─► agentic-patterns  ← Pattern 04 (graph-based agent context)
            |
            └─► Agent-Context  ← THIS REPO (the runnable dependency graph)
```

For the full orchestration stack that uses Graphify in production: see [agentkernel](https://github.com/shubham0086/agentkernel).

**Theory companion:** [Pattern 04: GraphDB for Agent Context](https://github.com/shubham0086/agentic-patterns/blob/main/docs/04-graphdb-for-agent-context.md)

---

<div align="center">

Built by [Shubham Prajapati](https://github.com/shubham0086) ·
[Portfolio](https://my-portfolio-github-io-beta-five.vercel.app/)
· MIT

Extracted from 18 months of production Agency OS.

</div>
