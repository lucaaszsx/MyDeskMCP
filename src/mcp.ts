import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from './config.js';
import type { ToolContext } from './tools/define.js';
import { registerTools } from './tools/index.js';

export function createMcpServer(
    config: Config['server'],
    context: ToolContext
): McpServer {
    const server = new McpServer({ name: config.name, version: config.version });

    registerTools(server, context);

    return server;
}
