import assert from 'node:assert/strict';
import test from 'node:test';
import { startToolClient } from '../testing/tool-client.js';

test('lists windows as tab-separated rows', async (t) => {
    const tools = await startToolClient(t);
    const result = await tools.call('window_list', {});

    assert.equal(result.isError, false);

    if (result.text !== 'No windows found.')
        for (const line of result.text.split('\n'))
            assert.equal(line.split('\t').length, 5, line);
});

test('reports no match for a pattern that matches nothing', async (t) => {
    const tools = await startToolClient(t);
    const result = await tools.call('window_list', { pattern: 'no-such-window-zzz' });

    assert.equal(result.isError, false);
    assert.equal(result.text, 'No windows found.');
});

test('fails to act on an unknown window id', async (t) => {
    const tools = await startToolClient(t);
    const result = await tools.call('window_action', {
        id: 999999999,
        action: 'activate'
    });

    assert.equal(result.isError, true);
});

test('requires at least one field to move or resize', async (t) => {
    const tools = await startToolClient(t);
    const result = await tools.call('window_move_resize', { id: 1 });

    assert.equal(result.isError, true);
    assert.match(result.text, /Provide at least one of x, y, width or height/);
});

test('fails to move or resize an unknown window id', async (t) => {
    const tools = await startToolClient(t);
    const result = await tools.call('window_move_resize', { id: 999999999, x: 0, y: 0 });

    assert.equal(result.isError, true);
});
