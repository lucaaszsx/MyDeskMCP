import assert from 'node:assert/strict';
import {readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {startToolClient} from '../testing/tool-client.js';

test('move_path moves files and creates parent directories', async (t) => {
    const tools = await startToolClient(t);

    await writeFile(path.join(tools.directory, 'from.txt'), 'data');

    await tools.call('move_path', {from: 'from.txt', to: 'new/place/to.txt'});

    assert.equal(await readFile(path.join(tools.directory, 'new/place/to.txt'), 'utf8'), 'data');
    await assert.rejects(stat(path.join(tools.directory, 'from.txt')));
});

test('move_path refuses to overwrite unless asked', async (t) => {
    const tools = await startToolClient(t);

    await writeFile(path.join(tools.directory, 'a.txt'), 'a');
    await writeFile(path.join(tools.directory, 'b.txt'), 'b');

    const refused = await tools.call('move_path', {from: 'a.txt', to: 'b.txt'});

    assert.equal(refused.isError, true);
    assert.match(refused.text, /Destination already exists/);
    assert.equal(await readFile(path.join(tools.directory, 'b.txt'), 'utf8'), 'b');

    await tools.call('move_path', {from: 'a.txt', to: 'b.txt', overwrite: true});

    assert.equal(await readFile(path.join(tools.directory, 'b.txt'), 'utf8'), 'a');
});
