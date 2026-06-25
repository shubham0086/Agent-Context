#!/usr/bin/env node
/**
 * Generates the MCP Tools section of README.md from the TOOLS array in src/mcp_tools.js.
 * Run: node scripts/gen-tool-docs.mjs
 *
 * Replaces content between the two sentinel comments in README.md:
 *   <!-- TOOLS-START -->
 *   <!-- TOOLS-END -->
 * so the rest of the README is never touched.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { TOOLS } = await import('../src/mcp_tools.js');

const rows = TOOLS.map((t) => {
  const params = Object.entries(t.inputSchema.properties || {})
    .map(([k, v]) => {
      const required = (t.inputSchema.required || []).includes(k);
      return required ? `\`${k}\`` : `\`${k}?\``;
    })
    .join(', ');
  const sig = `\`${t.name}(${params})\``;
  return `| ${sig} | ${t.description} |`;
});

const generated = [
  '| Tool | Description |',
  '|------|-------------|',
  ...rows,
].join('\n');

const readmePath = path.join(root, 'README.md');
const readme = readFileSync(readmePath, 'utf8');

const START = '<!-- TOOLS-START -->';
const END = '<!-- TOOLS-END -->';

if (!readme.includes(START) || !readme.includes(END)) {
  console.error(`Sentinels ${START} / ${END} not found in README.md — add them first.`);
  process.exit(1);
}

const updated = readme.replace(
  new RegExp(`${START}[\\s\\S]*?${END}`),
  `${START}\n${generated}\n${END}`
);

writeFileSync(readmePath, updated, 'utf8');
console.log(`Updated README.md with ${TOOLS.length} tools.`);
TOOLS.forEach((t) => console.log(`  - ${t.name}`));
