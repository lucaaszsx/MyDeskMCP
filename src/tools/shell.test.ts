import assert from 'node:assert/strict';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { startToolClient } from '../testing/tool-client.js';

test('bash returns the combined output', async (t) => {
    const tools = await startToolClient(t);
    const result = await tools.call('bash', { command: 'echo out; echo err >&2' });

    assert.equal(result.isError, false);
    assert.match(result.text, /out/);
    assert.match(result.text, /err/);
});

test('bash runs in the default directory and honors cwd', async (t) => {
    const tools = await startToolClient(t);
    const nested = path.join(tools.directory, 'nested');

    await mkdir(nested);

    assert.equal(
        (await tools.call('bash', { command: 'pwd' })).text.trim(),
        tools.directory
    );
    assert.equal(
        (await tools.call('bash', { command: 'pwd', cwd: 'nested' })).text.trim(),
        await realpath(nested)
    );
});

test('bash reports a non-zero exit as an error with the exit code', async (t) => {
    const tools = await startToolClient(t);
    const result = await tools.call('bash', { command: 'echo failing; exit 3' });

    assert.equal(result.isError, true);
    assert.match(result.text, /failing/);
    assert.match(result.text, /exit code 3/);
});

test('bash reports a missing working directory', async (t) => {
    const tools = await startToolClient(t);
    const result = await tools.call('bash', { command: 'pwd', cwd: 'missing' });

    assert.equal(result.isError, true);
    assert.match(result.text, /Directory does not exist/);
});

test('bash stops commands that exceed the timeout', async (t) => {
    const tools = await startToolClient(t, { commandTimeoutMs: 1000 });
    const result = await tools.call('bash', { command: 'sleep 10' });

    assert.equal(result.isError, true);
    assert.match(result.text, /timed out/);
});

test('bash does not leak MCP variables to commands', async (t) => {
    process.env.MCP_LEAK_CHECK = 'secret';

    try {
        const tools = await startToolClient(t);
        const result = await tools.call('bash', {
            command: 'echo "${MCP_LEAK_CHECK:-clean}"'
        });

        assert.equal(result.text.trim(), 'clean');
    } finally {
        delete process.env.MCP_LEAK_CHECK;
    }
});

test('long output is truncated keeping the start and the end', async (t) => {
    const tools = await startToolClient(t, { maxOutputChars: 200 });
    const result = await tools.call('bash', {
        command: "printf 'START'; head -c 2000 /dev/zero | tr '\\0' x; printf 'END'"
    });

    assert.match(result.text, /characters omitted/);
    assert.ok(result.text.startsWith('START'));
    assert.ok(result.text.trimEnd().endsWith('END'));
    assert.ok(result.text.length < 400);
});

test('bash runs git without waiting for an editor or credentials', async (t) => {
    const tools = await startToolClient(t);

    await tools.call('bash', { command: 'git init -q' });

    const commit = await tools.call('bash', {
        command: 'git -c user.name=t -c user.email=t@t commit --allow-empty'
    });
    const prompt = await tools.call('bash', { command: 'echo "$GIT_TERMINAL_PROMPT"' });

    assert.equal(commit.isError, true);
    assert.equal(prompt.text.trim(), '0');
});
