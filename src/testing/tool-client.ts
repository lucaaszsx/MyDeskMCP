import { realpath } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig, type Config } from '../config.js';
import { BackgroundProcesses } from '../lib/background.js';
import { FileVersions } from '../lib/file-versions.js';
import type { ToolContext } from '../tools/define.js';
import { registerTools } from '../tools/index.js';
import { createTempDirectory, removeDirectory } from './temp.js';

export interface ToolResult {
    text: string;
    isError: boolean;
    content: CallToolResult['content'];
}

export interface ToolHarness {
    directory: string;
    context: ToolContext;
    call(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
    listTools(): Promise<string[]>;
}

export function createToolContext(
    cwd: string,
    overrides: Partial<Config['tools']> = {}
): ToolContext {
    const config = loadConfig({
        ...process.env,
        MCP_PASSWORD: 'p'.repeat(16),
        MCP_PUBLIC_URL: 'https://host.example.ts.net',
        MCP_CWD: cwd
    });
    const tools = { ...config.tools, ...overrides };

    return {
        ...tools,
        background: new BackgroundProcesses(tools),
        fileVersions: new FileVersions()
    };
}

export async function startToolClient(
    t: TestContext,
    overrides: Partial<Config['tools']> = {}
): Promise<ToolHarness> {
    const directory = await realpath(await createTempDirectory());
    const context = createToolContext(directory, overrides);
    const server = new McpServer({ name: 'test-server', version: '0.0.0' });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    registerTools(server, context);
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    t.after(async () => {
        context.background.stopAll();
        await client.close();
        await server.close();
        await removeDirectory(directory);
    });

    return {
        directory,
        context,
        async call(name, args = {}) {
            const result = (await client.callTool({
                name,
                arguments: args
            })) as CallToolResult;
            const text = result.content
                .flatMap((block) => (block.type === 'text' ? [block.text] : []))
                .join('\n');

            return { text, isError: result.isError === true, content: result.content };
        },
        async listTools() {
            const { tools } = await client.listTools();

            return tools.map((tool) => tool.name).sort();
        }
    };
}
