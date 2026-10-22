import assert from 'node:assert/strict';
import test from 'node:test';
import {startToolClient, type ToolHarness} from '../testing/tool-client.js';

async function readUntil(tools: ToolHarness, id: number, pattern: RegExp): Promise<string> {
    let collected = '';

    for (let attempt = 0; attempt < 20; attempt++) {
        collected += (await tools.call('process_read', {id, wait_ms: 500})).text;

        if (pattern.test(collected)) return collected;
    }

    throw new Error(`Pattern ${pattern} not seen in:\n${collected}`);
}

test('starts a process, reads its output and stops it', async (t) => {
    const tools = await startToolClient(t);

    assert.equal(
        (await tools.call('process_start', {command: 'echo ready; sleep 30'})).text,
        'Started process 1',
    );
    assert.match(await readUntil(tools, 1, /ready/), /running/);
    assert.match(
        (await tools.call('process_list')).text,
        /^1\trunning\t\d+s\techo ready; sleep 30$/,
    );
    assert.equal((await tools.call('process_stop', {id: 1})).text, 'Sent SIGTERM to process 1');
    assert.match(await readUntil(tools, 1, /terminated by SIGTERM|exited with code/), /process 1/);
    assert.match((await tools.call('process_stop', {id: 1})).text, /Removed process 1/);
    assert.equal((await tools.call('process_list')).text, '(No background processes)');
});

test('reports normal completion with the exit code', async (t) => {
    const tools = await startToolClient(t);

    await tools.call('process_start', {command: 'echo done; exit 4'});

    assert.match(await readUntil(tools, 1, /exited with code 4/), /done/);
});

test('each read returns only new output', async (t) => {
    const tools = await startToolClient(t);

    await tools.call('process_start', {command: 'echo first; sleep 1; echo second'});

    const first = await readUntil(tools, 1, /first/);

    assert.ok(!first.includes('second'));
    assert.match(await readUntil(tools, 1, /second/), /second/);
});

test('fails for an unknown process id', async (t) => {
    const tools = await startToolClient(t);
    const result = await tools.call('process_read', {id: 99});

    assert.equal(result.isError, true);
    assert.match(result.text, /No background process with id 99/);
});

test('limits the number of tracked processes', async (t) => {
    const tools = await startToolClient(t, {maxBackgroundProcesses: 1});

    await tools.call('process_start', {command: 'sleep 30'});

    const result = await tools.call('process_start', {command: 'sleep 30'});

    assert.equal(result.isError, true);
    assert.match(result.text, /Too many tracked processes/);
});

test('writes to the input of a process and closes it', async (t) => {
    const tools = await startToolClient(t);

    await tools.call('process_start', {command: 'cat'});

    const written = await tools.call('process_write', {id: 1, text: 'hello\n'});

    assert.equal(written.text, 'Wrote 6 characters to process 1');
    assert.match(await readUntil(tools, 1, /hello/), /running/);

    const closed = await tools.call('process_write', {id: 1, text: 'bye\n', close_input: true});

    assert.equal(closed.text, 'Wrote 4 characters to process 1 and closed its input');
    assert.match(await readUntil(tools, 1, /exited with code 0/), /bye/);
});

test('refuses to write to a finished process', async (t) => {
    const tools = await startToolClient(t);

    await tools.call('process_start', {command: 'exit 0'});
    await readUntil(tools, 1, /exited with code 0/);

    const result = await tools.call('process_write', {id: 1, text: 'late'});

    assert.equal(result.isError, true);
    assert.match(result.text, /Process 1 has exited/);
});

test('refuses to write after the input was closed', async (t) => {
    const tools = await startToolClient(t);

    await tools.call('process_start', {command: 'sleep 30'});
    await tools.call('process_write', {id: 1, text: '', close_input: true});

    const result = await tools.call('process_write', {id: 1, text: 'more'});

    assert.equal(result.isError, true);
    assert.match(result.text, /Input of process 1 is closed/);
});

test('fails to write to an unknown process id', async (t) => {
    const tools = await startToolClient(t);
    const result = await tools.call('process_write', {id: 7, text: 'x'});

    assert.equal(result.isError, true);
    assert.match(result.text, /No background process with id 7/);
});
