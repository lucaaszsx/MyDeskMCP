import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool, ToolContext } from './define.js';
import { fileTools } from './files.js';
import { filesystemTools } from './filesystem.js';
import { processTools } from './processes.js';
import { searchTools } from './search.js';
import { shellTools } from './shell.js';
import { windowTools } from './window.js';

const tools: Tool[] = [
    ...shellTools,
    ...processTools,
    ...fileTools,
    ...filesystemTools,
    ...searchTools,
    ...windowTools
];

export function registerTools(server: McpServer, context: ToolContext): void {
    for (const tool of tools) tool.register(server, context);
}
