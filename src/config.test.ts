import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {loadConfig} from './config.js';

const valid = {MCP_PASSWORD: 'a'.repeat(16), MCP_PUBLIC_URL: 'https://host.example.ts.net'};

test('applies defaults', () => {
    const config = loadConfig(valid);

    assert.equal(config.server.name, 'local-mcp');
    assert.equal(config.server.host, '127.0.0.1');
    assert.equal(config.server.port, 3000);
    assert.equal(config.server.resourceUrl.href, 'https://host.example.ts.net/mcp');
    assert.equal(config.tools.cwd, os.homedir());
    assert.equal(config.auth.stateFile, path.resolve('.oauth-state.json'));
});

test('reads overrides from the environment', () => {
    const config = loadConfig({
        ...valid,
        MCP_HOST: '0.0.0.0',
        MCP_PORT: '4100',
        MCP_CWD: '/tmp',
        MCP_STATE_FILE: '/var/lib/state.json',
    });

    assert.equal(config.server.host, '0.0.0.0');
    assert.equal(config.server.port, 4100);
    assert.equal(config.tools.cwd, '/tmp');
    assert.equal(config.auth.stateFile, '/var/lib/state.json');
});

test('rejects a short password', () => {
    assert.throws(() => loadConfig({...valid, MCP_PASSWORD: 'short'}), /Invalid configuration/);
});

test('rejects a missing public url', () => {
    assert.throws(() => loadConfig({MCP_PASSWORD: valid.MCP_PASSWORD}), /MCP_PUBLIC_URL/);
});

test('rejects a non http public url', () => {
    assert.throws(
        () => loadConfig({...valid, MCP_PUBLIC_URL: 'ftp://host.example'}),
        /MCP_PUBLIC_URL/,
    );
});

test('rejects an invalid port', () => {
    assert.throws(() => loadConfig({...valid, MCP_PORT: '70000'}), /MCP_PORT/);
});

test('keeps MCP variables out of the child environment', () => {
    const config = loadConfig({...valid, PATH: '/usr/bin', HOME: '/home/user'});

    assert.equal(config.tools.environment['PATH'], '/usr/bin');
    assert.equal(config.tools.environment['HOME'], '/home/user');
    assert.ok(!Object.keys(config.tools.environment).some((key) => key.startsWith('MCP_')));
});

test('makes git non-interactive in the child environment', () => {
    const config = loadConfig({...valid, GIT_EDITOR: 'vim'});

    assert.equal(config.tools.environment['GIT_TERMINAL_PROMPT'], '0');
    assert.equal(config.tools.environment['GIT_EDITOR'], 'true');
});
