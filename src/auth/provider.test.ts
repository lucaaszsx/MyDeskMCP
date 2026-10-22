import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
    InvalidClientMetadataError,
    InvalidGrantError,
    InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {OAuthClientInformationFull} from '@modelcontextprotocol/sdk/shared/auth.js';
import {loadConfig} from '../config.js';
import {nowSeconds} from '../lib/time.js';
import {createTempDirectory, removeDirectory} from '../testing/temp.js';
import {LocalOAuthProvider} from './provider.js';
import {AuthStore} from './store.js';

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

async function setup(t: test.TestContext) {
    const directory = await createTempDirectory();

    t.after(() => removeDirectory(directory));

    const file = path.join(directory, 'state.json');
    const config = loadConfig({
        MCP_PASSWORD: 'p'.repeat(16),
        MCP_PUBLIC_URL: 'https://host.example.ts.net',
        MCP_STATE_FILE: file,
    });
    const store = await AuthStore.open(file, config.auth.maxClients);
    const provider = new LocalOAuthProvider(config.auth, store);
    const client: OAuthClientInformationFull = {
        client_id: 'client-1',
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'none',
    };

    function issueCode(code = 'code-1'): void {
        store.saveCode(code, {
            clientId: client.client_id,
            scopes: ['mcp'],
            codeChallenge: 'challenge',
            redirectUri: REDIRECT,
            expiresAt: nowSeconds() + 60,
        });
    }

    return {file, store, provider, client, issueCode};
}

test('registers clients that use Claude callback URLs', async (t) => {
    const {provider, store, client} = await setup(t);

    await provider.clientsStore.registerClient?.(client);

    assert.equal(store.getClient('client-1')?.client_id, 'client-1');
});

test('rejects clients with foreign or missing redirect URIs', async (t) => {
    const {provider, client} = await setup(t);
    const register = provider.clientsStore.registerClient?.bind(provider.clientsStore);

    await assert.rejects(
        async () => register?.({...client, redirect_uris: ['https://evil.example/callback']}),
        InvalidClientMetadataError,
    );
    await assert.rejects(
        async () => register?.({...client, redirect_uris: []}),
        InvalidClientMetadataError,
    );
});

test('exchanges a code for tokens and verifies the access token', async (t) => {
    const {provider, client, issueCode} = await setup(t);

    issueCode();

    assert.equal(await provider.challengeForAuthorizationCode(client, 'code-1'), 'challenge');

    const tokens = await provider.exchangeAuthorizationCode(client, 'code-1', undefined, REDIRECT);
    const info = await provider.verifyAccessToken(tokens.access_token);

    assert.equal(tokens.token_type, 'Bearer');
    assert.equal(tokens.scope, 'mcp');
    assert.equal(info.clientId, 'client-1');
    assert.deepEqual(info.scopes, ['mcp']);
});

test('a code cannot be exchanged twice', async (t) => {
    const {provider, client, issueCode} = await setup(t);

    issueCode();
    await provider.exchangeAuthorizationCode(client, 'code-1', undefined, REDIRECT);

    await assert.rejects(
        provider.exchangeAuthorizationCode(client, 'code-1', undefined, REDIRECT),
        InvalidGrantError,
    );
    await assert.rejects(
        provider.challengeForAuthorizationCode(client, 'code-1'),
        InvalidGrantError,
    );
});

test('rejects a mismatched redirect uri', async (t) => {
    const {provider, client, issueCode} = await setup(t);

    issueCode();

    await assert.rejects(
        provider.exchangeAuthorizationCode(client, 'code-1', undefined, 'https://claude.com/other'),
        InvalidGrantError,
    );
});

test('rotates refresh tokens', async (t) => {
    const {provider, client, issueCode} = await setup(t);

    issueCode();

    const first = await provider.exchangeAuthorizationCode(client, 'code-1', undefined, REDIRECT);
    const second = await provider.exchangeRefreshToken(client, first.refresh_token ?? '');

    assert.notEqual(second.access_token, first.access_token);
    assert.equal((await provider.verifyAccessToken(second.access_token)).clientId, 'client-1');

    await assert.rejects(
        provider.exchangeRefreshToken(client, first.refresh_token ?? ''),
        InvalidGrantError,
    );
});

test('rejects unknown access tokens', async (t) => {
    const {provider} = await setup(t);

    await assert.rejects(provider.verifyAccessToken('unknown'), InvalidTokenError);
});

test('never stores raw tokens on disk', async (t) => {
    const {provider, client, issueCode, store, file} = await setup(t);

    issueCode();

    const tokens = await provider.exchangeAuthorizationCode(client, 'code-1', undefined, REDIRECT);

    await store.flush();

    const saved = await readFile(file, 'utf8');

    assert.ok(!saved.includes(tokens.access_token));
    assert.ok(!saved.includes(tokens.refresh_token ?? 'missing'));
});
