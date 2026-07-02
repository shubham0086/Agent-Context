import fs from 'fs/promises';
import path from 'path';

/**
 * GraphifyClient
 *
 * Builds a structural dependency graph for any codebase.
 * Extracts imports/requires across JS/TS/JSX/TSX/Python/Go,
 * computes blast radius (who depends on a file and what it depends on),
 * and formats the result as a compact LLM context string.
 *
 * Extracted from Agency OS / AIOps production pipeline.
 */
export class GraphifyClient {
  constructor(projectRoot) {
    this.projectRoot = path.resolve(projectRoot);
    this.graphCache = null;
    // Fingerprint of the file set + mtimes the cached graph was built from. Lets a
    // long-lived server (MCP stdio session) detect that files changed and rebuild,
    // instead of silently serving a stale blast radius. (Persistent-but-fresh: hold
    // the parsed graph in memory, but re-validate cheaply before trusting it.)
    this.graphFingerprint = null;
  }

  /**
   * Generates or loads the structural dependency graph for the workspace.
   *
   * Two-phase so a long-lived process stays both fast and correct:
   *   1. Walk the tree (cheap: stat only) → file list + a freshness fingerprint.
   *   2. Read + parse each file (expensive) — skipped entirely when the fingerprint
   *      matches the cached graph, so repeat queries reuse the parsed graph but a
   *      changed file still forces a rebuild rather than returning stale edges.
   */
  async buildGraph() {
    const analyzable = (await this._walkDir(this.projectRoot))
      .filter((entry) => this._isAnalyzable(entry.path));
    const fingerprint = this._fingerprint(analyzable);

    // Cache hit: same files, same mtimes — the parsed graph is still valid.
    if (this.graphCache && this.graphFingerprint === fingerprint) {
      return this.graphCache;
    }

    // Real file nodes (repo-relative, forward-slashed). Import targets are written
    // WITHOUT an extension (a relative import './utils/redact' resolves to the
    // string 'src/utils/redact'), but the actual node is 'src/utils/redact.js'.
    // Resolving specifiers to real nodes here is what makes reverse edges
    // (dependents) match — without it, "what depends on X" always returned 0.
    const nodeSet = new Set(
      analyzable.map(({ path: file }) =>
        path.relative(this.projectRoot, file).replace(/\\/g, '/'))
    );

    const graph = { nodes: {}, edges: [] };
    for (const { path: file } of analyzable) {
      const relPath = path.relative(this.projectRoot, file).replace(/\\/g, '/');
      try {
        const content = await fs.readFile(file, 'utf-8');
        const deps = this._extractDependencies(content, relPath);

        graph.nodes[relPath] = {
          type: path.extname(relPath),
          dependencyCount: deps.length
        };

        for (const dep of deps) {
          // Unify 'utils/redact' with the real node 'utils/redact.js'.
          // Unresolvable specifiers (npm packages, stdlib) stay raw.
          graph.edges.push({ from: relPath, to: this._resolveToNode(dep, nodeSet) });
        }
      } catch (_) {
        // Skip unreadable files
      }
    }

    this.graphCache = graph;
    this.graphFingerprint = fingerprint;
    return graph;
  }

  /**
   * Queries the graph for structural neighbors (blast radius) of a file.
   * @param {string} targetPath - Relative file path to query.
   * @returns {{ target: string, dependents: string[], dependencies: string[] }}
   */
  async queryNeighbors(targetPath) {
    const graph = await this.buildGraph();
    const normalizedTarget = targetPath.replace(/\\/g, '/');

    const dependents = new Set();
    const dependencies = new Set();

    // Edges now reference real file nodes, so compare on a bare key (extension
    // stripped from both sides). This unifies 'utils/redact' with 'utils/redact.js'
    // and tolerates a query that omits the extension, without the old endsWith
    // fuzzy match that produced false positives across unrelated directories.
    const targetKey = this._bareKey(normalizedTarget);
    for (const edge of graph.edges) {
      if (this._bareKey(edge.to) === targetKey) dependents.add(edge.from);
      if (this._bareKey(edge.from) === targetKey) dependencies.add(edge.to);
    }

    return {
      target: normalizedTarget,
      dependents: [...dependents],
      dependencies: [...dependencies]
    };
  }

  /**
   * Returns the full dependency graph summary.
   * @returns {{ nodeCount: number, edgeCount: number, nodes: Object, edges: Array }}
   */
  async getGraphSummary() {
    const graph = await this.buildGraph();
    return {
      nodeCount: Object.keys(graph.nodes).length,
      edgeCount: graph.edges.length,
      nodes: graph.nodes,
      edges: graph.edges
    };
  }

  /**
   * Formats blast radius result as a compact LLM context string.
   * This is what gets injected into the agent's prompt.
   * @param {string} targetPath
   * @returns {string}
   */
  async getContextString(targetPath) {
    try {
      const neighbors = await this.queryNeighbors(targetPath);
      if (neighbors.dependents.length === 0 && neighbors.dependencies.length === 0) {
        return '';
      }

      let context = `\n\n### GRAPHIFY STRUCTURAL CONTEXT FOR [${targetPath}]\n`;
      if (neighbors.dependencies.length > 0) {
        context += `- Dependencies (what this file uses): ${neighbors.dependencies.join(', ')}\n`;
      }
      if (neighbors.dependents.length > 0) {
        context += `- Dependents (what relies on this file): ${neighbors.dependents.join(', ')}\n`;
      }
      context += `\nRule: If you modify this file, be aware of the blast radius affecting its dependents.\n`;

      return context;
    } catch (_) {
      return '';
    }
  }

  // --- Internal Helpers ---

  // Walk the tree returning { path, mtimeMs } per file. mtime is collected during the
  // same stat we already do, so the freshness fingerprint costs nothing extra.
  async _walkDir(dir, fileList = []) {
    const skipDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'venv', '.venv', '__pycache__', '.pytest_cache'];
    const files = await fs.readdir(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        if (!skipDirs.includes(file)) await this._walkDir(filePath, fileList);
      } else {
        fileList.push({ path: filePath, mtimeMs: stat.mtimeMs });
      }
    }
    return fileList;
  }

  // Cheap, order-independent signature of the analyzable file set. Changes whenever a
  // file is added, removed, or modified — so a stale in-memory graph is detected before
  // it's trusted. Sorted so directory-listing order can't produce false invalidations.
  _fingerprint(entries) {
    return entries
      .map((e) => `${e.path.replace(/\\/g, '/')}:${e.mtimeMs}`)
      .sort()
      .join('|');
  }

  _isAnalyzable(filePath) {
    const validExts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.mjs', '.cjs'];
    return validExts.includes(path.extname(filePath));
  }

  // Source extensions used for import resolution and bare-key comparison.
  static get _EXTS() {
    return ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go'];
  }

  // Map an import specifier to a real graph node. Tries the bare specifier, each
  // source extension, then a directory index file. Also handles Python dotted
  // module names (utils.redact -> utils/redact). Returns the raw specifier when
  // nothing matches (an external npm/stdlib dependency).
  _resolveToNode(spec, nodeSet) {
    if (nodeSet.has(spec)) return spec;
    for (const ext of GraphifyClient._EXTS) if (nodeSet.has(spec + ext)) return spec + ext;
    for (const ext of GraphifyClient._EXTS) if (nodeSet.has(spec + '/index' + ext)) return spec + '/index' + ext;
    if (spec.includes('.') && !spec.includes('/')) {
      const asPath = spec.replace(/\./g, '/');
      if (nodeSet.has(asPath)) return asPath;
      for (const ext of GraphifyClient._EXTS) if (nodeSet.has(asPath + ext)) return asPath + ext;
    }
    return spec;
  }

  // A path with any trailing source extension removed, so 'a/b.js' and 'a/b'
  // compare equal. Full-path comparison (not endsWith) avoids false positives.
  _bareKey(p) {
    for (const ext of GraphifyClient._EXTS) if (p.endsWith(ext)) return p.slice(0, -ext.length);
    return p;
  }

  _extractDependencies(content, currentPath) {
    const deps = [];
    const ext = path.extname(currentPath);

    if (ext === '.py') {
      // `\s` in the capture must NOT include newlines, or `import os` greedily
      // eats the following lines (produced the noisy 'os\nfrom typing...' deps).
      const pyImpRegex1 = /^[ \t]*(?:import)[ \t]+([a-zA-Z0-9_\., \t]+)/gm;
      const pyImpRegex2 = /^[ \t]*from[ \t]+([a-zA-Z0-9_\.]+)[ \t]+import/gm;

      let match;
      while ((match = pyImpRegex1.exec(content)) !== null) {
        const parts = match[1].split(',').map(p => p.trim());
        for (const p of parts) deps.push(p);
      }
      while ((match = pyImpRegex2.exec(content)) !== null) {
        deps.push(match[1]);
      }
    } else {
      const reqRegex = /require\(['"]([^'"]+)['"]\)/g;
      const impRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
      const goRegex = /import\s+['"]([^'"]+)['"]/g;

      let match;
      while ((match = reqRegex.exec(content)) !== null) deps.push(match[1]);
      while ((match = impRegex.exec(content)) !== null) deps.push(match[1]);
      if (ext === '.go') {
        while ((match = goRegex.exec(content)) !== null) deps.push(match[1]);
      }
    }

    const dir = path.dirname(currentPath);
    const resolvedDeps = deps.map(d => {
      // Python relative import: leading dots are PACKAGE levels, not path segments.
      // One dot = current package (this dir); each extra dot = one parent up. The
      // remainder is a dotted module path. `from .engine` -> 'src/engine', NOT
      // 'src/.engine' (the bug the Phase 4 benchmark exposed).
      if (ext === '.py' && d.startsWith('.')) {
        const m = d.match(/^(\.+)(.*)$/);
        let base = dir;
        for (let i = 0; i < m[1].length - 1; i++) base = path.dirname(base);
        const rest = m[2].replace(/\./g, '/');
        return path.join(base, rest).replace(/\\/g, '/');
      }
      if (d.startsWith('.')) {
        return path.join(dir, d).replace(/\\/g, '/');
      }
      return d;
    });

    return [...new Set(resolvedDeps)];
  }
}
