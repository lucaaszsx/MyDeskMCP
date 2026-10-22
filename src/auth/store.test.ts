import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { nowSeconds } from '../lib/time.js';
import { createTempDirectory, removeDirectory } from '../testing/temp.js';
import { AuthStore, type TokenRecord } from './store.js';

function client(id: string): OAuthClientInformationFull {
    return {
        client_id: id,
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        token_endpoint_auth_method: 'none'
    };
}

function token(clientId: string, ttlSeconds: number): TokenRecord {
    return { clientId, scopes: ['mcp'], expiresAt: nowSeconds() + ttlSeconds };
}

async function setup(t: test.TestContext): Promise<string> {
    const directory = await createTempDirectory();

    t.after(() => removeDirectory(directory));

    return path.join(directory, 'state.json');
}

test('starts empty when the state file is missing', async (t) => {
    const store = await AuthStore.open(await setup(t), 10);

    assert.equal(store.getClient('missing'), undefined);
    assert.equal(store.findAccessToken('missing'), undefined);
});

test('persists clients and tokens across reopen', async (t) => {
    const file = await setup(t);
    const store = await AuthStore.open(file, 10);

    await store.saveClient(client('a'));
    await store.saveTokens(
        ['access-hash', token('a', 60)],
        ['refresh-hash', token('a', 600)]
    );
    await store.flush();

    const reopened = await AuthStore.open(file, 10);

    assert.equal(reopened.getClient('a')?.client_id, 'a');
    assert.equal(reopened.findAccessToken('access-hash')?.clientId, 'a');
    assert.equal(reopened.takeRefreshToken('refresh-hash', 'a')?.clientId, 'a');
});

test('writes the state file with mode 0600 and leaves no temporary file', async (t) => {
    const file = await setup(t);
    const store = await AuthStore.open(file, 10);

    await store.saveClient(client('a'));

    const details = await stat(file);

    assert.equal(details.mode & 0o777, 0o600);
    assert.deepEqual(await readdir(path.dirname(file)), ['state.json']);
});

test('reads the legacy state format', async (t) => {
    const file = await setup(t);
    const legacy = {
        clients: [
            [
                'legacy',
                { ...client('legacy'), client_id_issued_at: 1, client_secret: 's' }
            ]
        ],
        accessTokens: [['hash', token('legacy', 60)]],
        refreshTokens: [['refresh', token('legacy', 600)]]
    };

    await writeFile(file, JSON.stringify(legacy), { mode: 0o600 });

    const store = await AuthStore.open(file, 10);

    assert.equal(store.getClient('legacy')?.client_id, 'legacy');
    assert.equal(store.findAccessToken('hash')?.clientId, 'legacy');
});

test('drops expired tokens on load and ignores them on lookup', async (t) => {
    const file = await setup(t);
    const state = {
        clients: [],
        accessTokens: [['old', token('a', -10)]],
        refreshTokens: [['old-refresh', token('a', -10)]]
    };

    await writeFile(file, JSON.stringify(state));

    const store = await AuthStore.open(file, 10);

    assert.equal(store.findAccessToken('old'), undefined);
    assert.equal(store.takeRefreshToken('old-refresh', 'a'), undefined);

    await store.saveTokens(['short', token('a', -1)], ['long', token('a', 600)]);

    assert.equal(store.findAccessToken('short'), undefined);
});

test('refresh tokens are single use and bound to the client', async (t) => {
    const store = await AuthStore.open(await setup(t), 10);

    await store.saveTokens(['access', token('a', 60)], ['refresh', token('a', 600)]);

    assert.equal(store.takeRefreshToken('refresh', 'other'), undefined);
    assert.equal(store.takeRefreshToken('refresh', 'a')?.clientId, 'a');
    assert.equal(store.takeRefreshToken('refresh', 'a'), undefined);
});

test('authorization codes are single use, bound to the client and expire', async (t) => {
    const store = await AuthStore.open(await setup(t), 10);
    const record = {
        ...token('a', 60),
        codeChallenge: 'challenge',
        redirectUri: 'https://claude.ai/api/mcp/auth_callback'
    };

    store.saveCode('code', record);
    store.saveCode('expired', { ...record, expiresAt: nowSeconds() - 1 });

    assert.equal(store.findCode('code', 'other'), undefined);
    assert.equal(store.findCode('code', 'a')?.codeChallenge, 'challenge');
    assert.equal(store.takeCode('code', 'a')?.codeChallenge, 'challenge');
    assert.equal(store.takeCode('code', 'a'), undefined);
    assert.equal(store.takeCode('expired', 'a'), undefined);
});

test('evicts the oldest clients beyond the limit', async (t) => {
    const store = await AuthStore.open(await setup(t), 2);

    await store.saveClient(client('one'));
    await store.saveClient(client('two'));
    await store.saveClient(client('three'));

    assert.equal(store.getClient('one'), undefined);
    assert.equal(store.getClient('two')?.client_id, 'two');
    assert.equal(store.getClient('three')?.client_id, 'three');
});

test('concurrent saves end with the latest state on disk', async (t) => {
    const file = await setup(t);
    const store = await AuthStore.open(file, 50);

    void Promise.all(['a', 'b', 'c', 'd', 'e'].map((id) => store.saveClient(client(id))));
    await store.flush();

    const saved = JSON.parse(await readFile(file, 'utf8')) as { clients: unknown[] };

    assert.equal(saved.clients.length, 5);
});

test('fails clearly when the state file is not valid JSON', async (t) => {
    const file = await setup(t);

    await writeFile(file, '{broken');

    await assert.rejects(AuthStore.open(file, 10), /not valid JSON/);
});
