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
  }

  /**
   * Generates or loads the structural dependency graph for the workspace.
   * Cached after first build.
   */
  async buildGraph() {
    if (this.graphCache) return this.graphCache;

    const graph = { nodes: {}, edges: [] };
    const allFiles = await this._walkDir(this.projectRoot);

    for (const file of allFiles) {
      if (!this._isAnalyzable(file)) continue;
      const relPath = path.relative(this.projectRoot, file).replace(/\\/g, '/');
      try {
        const content = await fs.readFile(file, 'utf-8');
        const deps = this._extractDependencies(content, relPath);

        graph.nodes[relPath] = {
          type: path.extname(relPath),
          dependencyCount: deps.length
        };

        for (const dep of deps) {
          graph.edges.push({ from: relPath, to: dep });
        }
      } catch (_) {
        // Skip unreadable files
      }
    }

    this.graphCache = graph;
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

    for (const edge of graph.edges) {
      if (edge.to === normalizedTarget || normalizedTarget.endsWith(edge.to) || edge.to.endsWith(normalizedTarget)) {
        dependents.add(edge.from);
      }
      if (edge.from === normalizedTarget) {
        dependencies.add(edge.to);
      }
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

  async _walkDir(dir, fileList = []) {
    const skipDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'venv', '.venv', '__pycache__', '.pytest_cache'];
    const files = await fs.readdir(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        if (!skipDirs.includes(file)) await this._walkDir(filePath, fileList);
      } else {
        fileList.push(filePath);
      }
    }
    return fileList;
  }

  _isAnalyzable(filePath) {
    const validExts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.mjs', '.cjs'];
    return validExts.includes(path.extname(filePath));
  }

  _extractDependencies(content, currentPath) {
    const deps = [];
    const ext = path.extname(currentPath);

    if (ext === '.py') {
      const pyImpRegex1 = /^\s*(?:import)\s+([a-zA-Z0-9_\.,\s]+)/gm;
      const pyImpRegex2 = /^\s*from\s+([a-zA-Z0-9_\.]+)\s+import/gm;

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

    const resolvedDeps = deps.map(d => {
      if (d.startsWith('.')) {
        return path.join(path.dirname(currentPath), d).replace(/\\/g, '/');
      }
      return d;
    });

    return [...new Set(resolvedDeps)];
  }
}
