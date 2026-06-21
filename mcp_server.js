#!/usr/bin/env node
/**
 * agent-context MCP server (stdio).
 *
 * Exposes Graphify's blast-radius capability as MCP tools any Claude/GPT agent can call.
 * Transport: stdio (works with Claude Code, Claude Desktop, Cursor, any MCP client).
 *
 * Tool logic lives in src/mcp_tools.js (pure + testable); this file only wires the SDK.
 * Launched in production as: npx github:shubham0086/agent-context
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { TOOLS, handleTool } from './src/mcp_tools.js';

const server = new Server(
  { name: 'agent-context', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

await server.connect(new StdioServerTransport());
