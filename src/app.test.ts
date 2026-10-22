import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {stat} from 'node:fs/promises';
import type {Server} from 'node:http';
import net from 'node:net';
import path from 'node:path';
import test, {type TestContext} from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createApp} from './app.js';
import {LocalOAuthProvider} from './auth/provider.js';
import {AuthStore} from './auth/store.js';
import {loadConfig} from './config.js';
import {BackgroundProcesses} from './lib/background.js';
import {FileVersions} from './lib/file-versions.js';
import {createTempDirectory, removeDirectory} from './testing/temp.js';

const PASSWORD = 'correct-horse-battery';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

interface Tokens {
    access_token: string;
    refresh_token: string;
}

async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();

        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const {port} = probe.address() as net.AddressInfo;

            probe.close(() => resolve(port));
        });
    });
}

async function startServer(t: TestContext) {
    const directory = await createTempDirectory();
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const config = loadConfig({
        MCP_PASSWORD: PASSWORD,
        MCP_PUBLIC_URL: base,
        MCP_PORT: String(port),
        MCP_CWD: directory,
        MCP_STATE_FILE: path.join(directory, 'state.json'),
    });
    const store = await AuthStore.open(config.auth.stateFile, config.auth.maxClients);
    const provider = new LocalOAuthProvider(config.auth, store);
    const background = new BackgroundProcesses(config.tools);
    const context = {...config.tools, background, fileVersions: new FileVersions()};
    const app = createApp(config, provider, context, () => undefined);
    const server = await new Promise<Server>((resolve) => {
        const listening = app.listen(port, '127.0.0.1', () => resolve(listening));
    });

    t.after(async () => {
        background.stopAll();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        await store.flush();
        await removeDirectory(directory);
    });

    return {base, config, directory};
}

function register(base: string, redirectUris: string[] = [REDIRECT]): Promise<Response> {
    return fetch(`${base}/register`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
            redirect_uris: redirectUris,
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            client_name: 'e2e',
        }),
    });
}

function pkce(): {verifier: string; challenge: string} {
    const verifier = randomBytes(32).toString('base64url');

    return {verifier, challenge: createHash('sha256').update(verifier).digest('base64url')};
}

function authorizeParams(clientId: string, challenge: string): URLSearchParams {
    return new URLSearchParams({
        client_id: clientId,
        redirect_uri: REDIRECT,
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'state-123',
    });
}

function postForm(url: string, body: URLSearchParams): Promise<Response> {
    return fetch(url, {
        method: 'POST',
        headers: {'content-type': 'application/x-www-form-urlencoded'},
        body,
        redirect: 'manual',
    });
}

async function obtainCode(base: string, clientId: string, challenge: string): Promise<string> {
    const params = authorizeParams(clientId, challenge);

    params.set('password', PASSWORD);

    const response = await postForm(`${base}/authorize`, params);

    assert.equal(response.status, 302);

    const location = new URL(response.headers.get('location') ?? '');

    assert.equal(`${location.origin}${location.pathname}`, REDIRECT);
    assert.equal(location.searchParams.get('state'), 'state-123');

    return location.searchParams.get('code') ?? '';
}

async function obtainTokens(base: string) {
    const client = (await (await register(base)).json()) as {client_id: string};
    const {verifier, challenge} = pkce();
    const code = await obtainCode(base, client.client_id, challenge);
    const response = await postForm(
        `${base}/token`,
        new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            code_verifier: verifier,
            client_id: client.client_id,
            redirect_uri: REDIRECT,
        }),
    );

    assert.equal(response.status, 200);

    return {clientId: client.client_id, tokens: (await response.json()) as Tokens};
}

function bearer(token: string): Record<string, string> {
    return {authorization: `Bearer ${token}`};
}

test('serves OAuth discovery metadata', async (t) => {
    const {base} = await startServer(t);
    const server = (await (
        await fetch(`${base}/.well-known/oauth-authorization-server`)
    ).json()) as Record<string, unknown>;
    const resource = (await (
        await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)
    ).json()) as Record<string, unknown>;

    assert.equal(server['issuer'], `${base}/`);
    assert.equal(server['token_endpoint'], `${base}/token`);
    assert.equal(server['authorization_endpoint'], `${base}/authorize`);
    assert.equal(server['registration_endpoint'], `${base}/register`);
    assert.deepEqual(server['code_challenge_methods_supported'], ['S256']);
    assert.equal(resource['resource'], `${base}/mcp`);
});

test('rejects MCP requests without a valid token', async (t) => {
    const {base} = await startServer(t);
    const anonymous = await fetch(`${base}/mcp`, {method: 'POST', body: '{}'});
    const invalid = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: bearer('not-a-token'),
        body: '{}',
    });

    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get('www-authenticate') ?? '', /resource_metadata=/);
    assert.equal(invalid.status, 401);
});

test('rejects client registration with foreign redirect URIs', async (t) => {
    const {base} = await startServer(t);
    const response = await register(base, ['https://evil.example/callback']);

    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as {error: string}).error, 'invalid_client_metadata');
});

test('shows the login form and refuses a wrong password', async (t) => {
    const {base} = await startServer(t);
    const client = (await (await register(base)).json()) as {client_id: string};
    const {challenge} = pkce();
    const params = authorizeParams(client.client_id, challenge);
    const form = await fetch(`${base}/authorize?${params}`);
    const html = await form.text();

    assert.equal(form.status, 200);
    assert.match(html, /type="password"/);
    assert.match(html, /name="code_challenge"/);
    assert.equal(form.headers.get('cache-control'), 'no-store');
    assert.match(form.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);

    params.set('password', 'wrong-password-value');

    const refused = await postForm(`${base}/authorize`, params);

    assert.equal(refused.status, 401);
    assert.match(await refused.text(), /Wrong password/);
    assert.equal(refused.headers.get('location'), null);
});

test('enforces PKCE when exchanging the code', async (t) => {
    const {base} = await startServer(t);
    const client = (await (await register(base)).json()) as {client_id: string};
    const {challenge} = pkce();
    const code = await obtainCode(base, client.client_id, challenge);
    const response = await postForm(
        `${base}/token`,
        new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            code_verifier: pkce().verifier,
            client_id: client.client_id,
            redirect_uri: REDIRECT,
        }),
    );

    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as {error: string}).error, 'invalid_grant');
});

test('completes the OAuth flow, serves tools and rotates refresh tokens', async (t) => {
    const {base, config, directory} = await startServer(t);
    const {clientId, tokens} = await obtainTokens(base);

    const connect = async (accessToken: string) => {
        const client = new Client({name: 'e2e-client', version: '0.0.0'});

        await client.connect(
            new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
                requestInit: {headers: bearer(accessToken)},
            }),
        );

        return client;
    };

    const client = await connect(tokens.access_token);
    const {tools} = await client.listTools();
    const output = await client.callTool({name: 'bash', arguments: {command: 'pwd'}});
    const text = (output.content as {type: string; text: string}[])[0]?.text ?? '';

    assert.equal(tools.length, 17);
    assert.equal(text.trim(), directory);
    await client.close();

    assert.equal((await fetch(`${base}/mcp`, {headers: bearer(tokens.access_token)})).status, 405);
    assert.equal(
        (await fetch(`${base}/mcp`, {method: 'DELETE', headers: bearer(tokens.access_token)}))
            .status,
        405,
    );

    const refresh = (refreshToken: string) =>
        postForm(
            `${base}/token`,
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: clientId,
            }),
        );

    const rotated = await refresh(tokens.refresh_token);
    const next = (await rotated.json()) as Tokens;

    assert.equal(rotated.status, 200);
    assert.notEqual(next.access_token, tokens.access_token);
    assert.equal((await refresh(tokens.refresh_token)).status, 400);

    const second = await connect(next.access_token);

    assert.equal((await second.listTools()).tools.length, 17);
    await second.close();

    const details = await stat(config.auth.stateFile);

    assert.equal(details.mode & 0o777, 0o600);
});

test('authorization state survives a restart', async (t) => {
    const {base, config} = await startServer(t);
    const {clientId, tokens} = await obtainTokens(base);
    const reopened = await AuthStore.open(config.auth.stateFile, config.auth.maxClients);
    const provider = new LocalOAuthProvider(config.auth, reopened);

    assert.equal(reopened.getClient(clientId)?.client_id, clientId);
    assert.equal((await provider.verifyAccessToken(tokens.access_token)).clientId, clientId);
});
