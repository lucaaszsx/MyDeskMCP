import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const RESERVED_ENV_PREFIX = 'MCP_';

const NON_INTERACTIVE_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' };

const environmentSchema = z.object({
    MCP_PASSWORD: z.string().min(16),
    MCP_PUBLIC_URL: z.url({ protocol: /^https?$/ }),
    MCP_HOST: z.string().min(1).default('127.0.0.1'),
    MCP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    MCP_CWD: z.string().min(1).default(os.homedir()),
    MCP_STATE_FILE: z.string().min(1).default('.oauth-state.json')
});

export interface Config {
    server: {
        name: string;
        title: string;
        description: string;
        version: string;
        host: string;
        port: number;
        publicUrl: URL;
        resourceUrl: URL;
        bodyLimit: string;
    };
    auth: {
        password: string;
        stateFile: string;
        allowedRedirectUris: ReadonlySet<string>;
        codeTtlSeconds: number;
        accessTtlSeconds: number;
        refreshTtlSeconds: number;
        authorizeRateLimit: { windowMs: number; limit: number };
        maxClients: number;
    };
    tools: {
        cwd: string;
        environment: NodeJS.ProcessEnv;
        maxOutputChars: number;
        commandTimeoutMs: number;
        maxImageBytes: number;
        maxReadBytes: number;
        maxSearchResults: number;
        maxBackgroundProcesses: number;
        backgroundBufferChars: number;
        ignoredDirectories: readonly string[];
    };
}

function childEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return {
        ...Object.fromEntries(
            Object.entries(environment).filter(
                ([key]) => !key.startsWith(RESERVED_ENV_PREFIX)
            )
        ),
        ...NON_INTERACTIVE_ENV
    };
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
    const parsed = environmentSchema.safeParse(environment);

    if (!parsed.success)
        throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);

    const env = parsed.data;
    const publicUrl = new URL(env.MCP_PUBLIC_URL);
    const { version } = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { version: string };

    return {
        server: {
            name: 'local-mcp',
            title: 'MyDeskMCP',
            description:
                "Shell, files, search, background processes and desktop windows on the user's own computer.",
            version,
            host: env.MCP_HOST,
            port: env.MCP_PORT,
            publicUrl,
            resourceUrl: new URL('/mcp', publicUrl),
            bodyLimit: '2mb'
        },
        auth: {
            password: env.MCP_PASSWORD,
            stateFile: path.resolve(env.MCP_STATE_FILE),
            allowedRedirectUris: new Set([
                'https://claude.ai/api/mcp/auth_callback',
                'https://claude.com/api/mcp/auth_callback'
            ]),
            codeTtlSeconds: 5 * 60,
            accessTtlSeconds: 60 * 60,
            refreshTtlSeconds: 30 * 24 * 60 * 60,
            authorizeRateLimit: { windowMs: 15 * 60 * 1000, limit: 20 },
            maxClients: 50
        },
        tools: {
            cwd: path.resolve(env.MCP_CWD),
            environment: childEnvironment(environment),
            maxOutputChars: 100_000,
            commandTimeoutMs: 120_000,
            maxImageBytes: 5 * 1024 * 1024,
            maxReadBytes: 10 * 1024 * 1024,
            maxSearchResults: 500,
            maxBackgroundProcesses: 16,
            backgroundBufferChars: 1_000_000,
            ignoredDirectories: ['.git', 'node_modules', '.venv', 'dist', 'build']
        }
    };
}
