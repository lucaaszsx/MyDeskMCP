import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {z} from 'zod';
import type {Config} from '../config.js';
import type {BackgroundProcesses} from '../lib/background.js';
import type {FileVersions} from '../lib/file-versions.js';

export type ToolContext = Config['tools'] & {
    background: BackgroundProcesses;
    fileVersions: FileVersions;
};

export interface Tool {
    register(server: McpServer, context: ToolContext): void;
}

interface ToolDefinition<Shape extends z.ZodRawShape> {
    name: string;
    description: string;
    input: Shape;
    readOnly?: boolean;
    run(args: z.infer<z.ZodObject<Shape>>, context: ToolContext): Promise<string | CallToolResult>;
}

const HEAD_RATIO = 0.6;

function truncate(text: string, limit: number): string {
    if (text.length <= limit) return text;

    const head = Math.floor(limit * HEAD_RATIO);
    const tail = limit - head;
    const omitted = text.length - limit;

    return `${text.slice(0, head)}\n[... ${omitted} characters omitted ...]\n${text.slice(text.length - tail)}`;
}

function textResult(text: string, limit: number, isError = false): CallToolResult {
    return {content: [{type: 'text', text: truncate(text, limit)}], ...(isError && {isError})};
}

export function defineTool<Shape extends z.ZodRawShape>(definition: ToolDefinition<Shape>): Tool {
    return {
        register(server, context) {
            const handler = async (args: Record<string, unknown>): Promise<CallToolResult> => {
                try {
                    const output = await definition.run(
                        args as z.infer<z.ZodObject<Shape>>,
                        context,
                    );

                    return typeof output === 'string'
                        ? textResult(output, context.maxOutputChars)
                        : output;
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);

                    return textResult(message, context.maxOutputChars, true);
                }
            };

            const inputSchema: z.ZodRawShape = definition.input;

            server.registerTool(
                definition.name,
                {
                    description: definition.description,
                    inputSchema,
                    annotations: {readOnlyHint: definition.readOnly ?? false},
                },
                handler,
            );
        },
    };
}
