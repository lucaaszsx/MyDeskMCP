import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import {
    getOAuthProtectedResourceMetadataUrl,
    mcpAuthRouter
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, {
    type ErrorRequestHandler,
    type Express,
    type RequestHandler
} from 'express';
import type { Config } from './config.js';
import { createMcpServer } from './mcp.js';
import type { ToolContext } from './tools/define.js';

export function createApp(
    config: Config,
    provider: OAuthServerProvider,
    context: ToolContext,
    onError: (error: unknown) => void
): Express {
    const handleMcp: RequestHandler = async (req, res) => {
        const server = createMcpServer(config.server, context);
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined
        });

        res.on('close', () => {
            void transport.close();
            void server.close();
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    };

    const rejectMethod: RequestHandler = (_req, res) => {
        res.status(405).set('Allow', 'POST').end();
    };

    const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
        onError(error);

        if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    };

    const app = express();

    app.set('trust proxy', 1);

    app.use(
        mcpAuthRouter({
            provider,
            issuerUrl: config.server.publicUrl,
            resourceServerUrl: config.server.resourceUrl,
            resourceName: config.server.name,
            authorizationOptions: { rateLimit: config.auth.authorizeRateLimit }
        })
    );

    app.use(
        '/mcp',
        requireBearerAuth({
            verifier: provider,
            resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
                config.server.resourceUrl
            )
        })
    );

    app.use(express.json({ limit: config.server.bodyLimit }));

    app.post('/mcp', handleMcp);
    app.get('/mcp', rejectMethod);
    app.delete('/mcp', rejectMethod);

    app.use(handleError);

    return app;
}
