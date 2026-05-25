'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { Server }               = require('@modelcontextprotocol/sdk/server');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const generateTool = require('./tools/generate');
const previewTool  = require('./tools/preview');
const publishTool  = require('./tools/publish');
const queueTool    = require('./tools/queue');

// Single-tool modules: { definition, execute(args) }
// Multi-tool modules:  { definitions, execute(toolName, args) }
const TOOLS = [
  { definition: generateTool.definition, execute: args => generateTool.execute(args) },
  { definition: previewTool.definition,  execute: args => previewTool.execute(args) },
  ...publishTool.definitions.map(def => ({
    definition: def,
    execute: args => publishTool.execute(def.name, args),
  })),
  ...queueTool.definitions.map(def => ({
    definition: def,
    execute: args => queueTool.execute(def.name, args),
  })),
];

const server = new Server(
  { name: 'instagram-pipeline', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(t => t.definition),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = TOOLS.find(t => t.definition.name === name);

  if (!tool) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }

  try {
    const result = await tool.execute(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[instagram-pipeline] MCP server ready');
}

main().catch(err => {
  console.error('[instagram-pipeline] Fatal:', err.message);
  process.exit(1);
});
