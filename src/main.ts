import {createApp} from './app.js';
import {LocalOAuthProvider} from './auth/provider.js';
import {AuthStore} from './auth/store.js';
import {loadConfig} from './config.js';
import {BackgroundProcesses} from './lib/background.js';
import {FileVersions} from './lib/file-versions.js';

function fail(error: unknown): never {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}

async function main(): Promise<void> {
    const config = loadConfig();
    const store = await AuthStore.open(config.auth.stateFile, config.auth.maxClients);
    const provider = new LocalOAuthProvider(config.auth, store);
    const background = new BackgroundProcesses(config.tools);
    const context = {...config.tools, background, fileVersions: new FileVersions()};
    const app = createApp(config, provider, context, (error) =>
        console.error('Request failed:', error),
    );
    const server = app.listen(config.server.port, config.server.host);

    server.once('error', fail);
    server.once('listening', () => {
        const {name, host, port} = config.server;

        console.error(`${name} listening on http://${host}:${port}/mcp`);
        console.error(`Default directory: ${config.tools.cwd}`);
    });

    async function shutdown(): Promise<void> {
        server.close();
        server.closeAllConnections();
        background.stopAll();
        await store.flush();
        process.exit(0);
    }

    for (const signal of ['SIGINT', 'SIGTERM'] as const)
        process.once(signal, () => void shutdown().catch(fail));
}

main().catch(fail);
