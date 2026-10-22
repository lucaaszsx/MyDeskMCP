import assert from 'node:assert/strict';
import {chmod, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {startToolClient} from '../testing/tool-client.js';

const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('write_file creates parent directories and read_file reads it back', async (t) => {
    const tools = await startToolClient(t);
    const written = await tools.call('write_file', {
        path: 'deep/er/note.txt',
        content: 'hello\nworld',
    });

    assert.equal(written.text, `File written: ${path.join(tools.directory, 'deep/er/note.txt')}`);
    assert.equal(
        await readFile(path.join(tools.directory, 'deep/er/note.txt'), 'utf8'),
        'hello\nworld',
    );
    assert.equal((await tools.call('read_file', {path: 'deep/er/note.txt'})).text, 'hello\nworld');
});

test('read_file honors line ranges and validates them', async (t) => {
    const tools = await startToolClient(t);

    await writeFile(path.join(tools.directory, 'lines.txt'), 'one\ntwo\nthree\nfour');

    assert.equal(
        (await tools.call('read_file', {path: 'lines.txt', start_line: 2, end_line: 3})).text,
        'two\nthree',
    );
    assert.equal(
        (await tools.call('read_file', {path: 'lines.txt', start_line: 3})).text,
        'three\nfour',
    );
    assert.equal((await tools.call('read_file', {path: 'lines.txt', end_line: 1})).text, 'one');

    const invalid = await tools.call('read_file', {path: 'lines.txt', start_line: 4, end_line: 2});

    assert.equal(invalid.isError, true);
    assert.match(invalid.text, /start_line must not be greater/);
});

test('read_file accepts absolute paths', async (t) => {
    const tools = await startToolClient(t);
    const file = path.join(tools.directory, 'absolute.txt');

    await writeFile(file, 'content');

    assert.equal((await tools.call('read_file', {path: file})).text, 'content');
});

test('read_file refuses binary and oversized files', async (t) => {
    const tools = await startToolClient(t, {maxReadBytes: 64});

    await writeFile(path.join(tools.directory, 'binary.bin'), Buffer.from([1, 2, 0, 3]));
    await writeFile(path.join(tools.directory, 'big.txt'), 'x'.repeat(100));

    const binary = await tools.call('read_file', {path: 'binary.bin'});
    const big = await tools.call('read_file', {path: 'big.txt'});

    assert.equal(binary.isError, true);
    assert.match(binary.text, /binary/);
    assert.equal(big.isError, true);
    assert.match(big.text, /larger than 64 bytes/);
});

test('read_file reports a missing file', async (t) => {
    const tools = await startToolClient(t);
    const result = await tools.call('read_file', {path: 'missing.txt'});

    assert.equal(result.isError, true);
    assert.match(result.text, /ENOENT/);
});

test('edit_file replaces a unique match', async (t) => {
    const tools = await startToolClient(t);
    const file = path.join(tools.directory, 'edit.txt');

    await writeFile(file, 'alpha beta gamma');
    await tools.call('read_file', {path: 'edit.txt'});

    const result = await tools.call('edit_file', {
        path: 'edit.txt',
        old_str: 'beta',
        new_str: 'BETA',
    });

    assert.match(result.text, /Replaced 1 occurrence/);
    assert.equal(await readFile(file, 'utf8'), 'alpha BETA gamma');
});

test('edit_file fails when the text is missing or ambiguous', async (t) => {
    const tools = await startToolClient(t);
    const file = path.join(tools.directory, 'edit.txt');

    await writeFile(file, 'x x');
    await tools.call('read_file', {path: 'edit.txt'});

    const missing = await tools.call('edit_file', {path: 'edit.txt', old_str: 'y', new_str: 'z'});
    const ambiguous = await tools.call('edit_file', {path: 'edit.txt', old_str: 'x', new_str: 'z'});

    assert.equal(missing.isError, true);
    assert.match(missing.text, /was not found/);
    assert.equal(ambiguous.isError, true);
    assert.match(ambiguous.text, /matches 2 times/);
    assert.equal(await readFile(file, 'utf8'), 'x x');
});

test('edit_file replaces every match with replace_all', async (t) => {
    const tools = await startToolClient(t);
    const file = path.join(tools.directory, 'edit.txt');

    await writeFile(file, 'x x');
    await tools.call('read_file', {path: 'edit.txt'});

    const result = await tools.call('edit_file', {
        path: 'edit.txt',
        old_str: 'x',
        new_str: 'z',
        replace_all: true,
    });

    assert.match(result.text, /Replaced 2 occurrence/);
    assert.equal(await readFile(file, 'utf8'), 'z z');
});

test('read_image returns the image content', async (t) => {
    const tools = await startToolClient(t);

    await writeFile(path.join(tools.directory, 'pixel.png'), Buffer.from(PNG_BASE64, 'base64'));

    const result = await tools.call('read_image', {path: 'pixel.png'});

    assert.equal(result.isError, false);
    assert.deepEqual(result.content, [{type: 'image', data: PNG_BASE64, mimeType: 'image/png'}]);
});

test('read_image rejects unsupported and oversized images', async (t) => {
    const tools = await startToolClient(t, {maxImageBytes: 10});

    await writeFile(path.join(tools.directory, 'note.txt'), 'text');
    await writeFile(path.join(tools.directory, 'big.png'), Buffer.alloc(50));

    const unsupported = await tools.call('read_image', {path: 'note.txt'});
    const oversized = await tools.call('read_image', {path: 'big.png'});

    assert.equal(unsupported.isError, true);
    assert.match(unsupported.text, /Unsupported image type/);
    assert.equal(oversized.isError, true);
    assert.match(oversized.text, /larger than 10 bytes/);
});

test('write_file refuses to overwrite a file that was not read', async (t) => {
    const tools = await startToolClient(t);
    const file = path.join(tools.directory, 'existing.txt');

    await writeFile(file, 'original');

    const result = await tools.call('write_file', {path: 'existing.txt', content: 'new'});

    assert.equal(result.isError, true);
    assert.match(result.text, /has not been read yet/);
    assert.equal(await readFile(file, 'utf8'), 'original');
});

test('write_file overwrites a file that was read and is unchanged', async (t) => {
    const tools = await startToolClient(t);
    const file = path.join(tools.directory, 'existing.txt');

    await writeFile(file, 'original');
    await tools.call('read_file', {path: 'existing.txt'});

    assert.equal(
        (await tools.call('write_file', {path: 'existing.txt', content: 'new'})).isError,
        false,
    );
    assert.equal(
        (await tools.call('write_file', {path: 'existing.txt', content: 'newer'})).isError,
        false,
    );
    assert.equal(await readFile(file, 'utf8'), 'newer');
});

test('write_file refuses to overwrite a file changed after it was read', async (t) => {
    const tools = await startToolClient(t);
    const file = path.join(tools.directory, 'existing.txt');

    await writeFile(file, 'original');
    await tools.call('read_file', {path: 'existing.txt'});
    await writeFile(file, 'changed elsewhere');

    const result = await tools.call('write_file', {path: 'existing.txt', content: 'new'});

    assert.equal(result.isError, true);
    assert.match(result.text, /changed since it was last read/);
    assert.equal(await readFile(file, 'utf8'), 'changed elsewhere');
});

test('edit_file refuses unread and stale files', async (t) => {
    const tools = await startToolClient(t);
    const file = path.join(tools.directory, 'guarded.txt');

    await writeFile(file, 'alpha');

    const unread = await tools.call('edit_file', {
        path: 'guarded.txt',
        old_str: 'alpha',
        new_str: 'beta',
    });

    await tools.call('read_file', {path: 'guarded.txt', start_line: 1, end_line: 1});
    await writeFile(file, 'alpha again');

    const stale = await tools.call('edit_file', {
        path: 'guarded.txt',
        old_str: 'alpha',
        new_str: 'beta',
    });

    assert.match(unread.text, /has not been read yet/);
    assert.match(stale.text, /changed since it was last read/);
    assert.equal(await readFile(file, 'utf8'), 'alpha again');
});

test('edit_file can be repeated after its own write', async (t) => {
    const tools = await startToolClient(t);
    const file = path.join(tools.directory, 'chain.txt');

    await writeFile(file, 'one');
    await tools.call('read_file', {path: 'chain.txt'});
    await tools.call('edit_file', {path: 'chain.txt', old_str: 'one', new_str: 'two'});

    const second = await tools.call('edit_file', {
        path: 'chain.txt',
        old_str: 'two',
        new_str: 'three',
    });

    assert.equal(second.isError, false);
    assert.equal(await readFile(file, 'utf8'), 'three');
});

test('multi_edit applies edits in order across files', async (t) => {
    const tools = await startToolClient(t);
    const first = path.join(tools.directory, 'first.txt');
    const second = path.join(tools.directory, 'second.txt');

    await writeFile(first, 'alpha beta');
    await writeFile(second, 'gamma');
    await tools.call('read_file', {path: 'first.txt'});
    await tools.call('read_file', {path: 'second.txt'});

    const result = await tools.call('multi_edit', {
        edits: [
            {path: 'first.txt', old_str: 'alpha', new_str: 'one'},
            {path: 'second.txt', old_str: 'gamma', new_str: 'two'},
            {path: 'first.txt', old_str: 'one beta', new_str: 'one two'},
        ],
    });

    assert.equal(result.isError, false);
    assert.equal(
        result.text,
        `Replaced 2 occurrence(s) in ${first}\nReplaced 1 occurrence(s) in ${second}`,
    );
    assert.equal(await readFile(first, 'utf8'), 'one two');
    assert.equal(await readFile(second, 'utf8'), 'two');
});

test('multi_edit writes nothing when one edit fails', async (t) => {
    const tools = await startToolClient(t);
    const first = path.join(tools.directory, 'first.txt');
    const second = path.join(tools.directory, 'second.txt');

    await writeFile(first, 'alpha');
    await writeFile(second, 'gamma');
    await tools.call('read_file', {path: 'first.txt'});
    await tools.call('read_file', {path: 'second.txt'});

    const result = await tools.call('multi_edit', {
        edits: [
            {path: 'first.txt', old_str: 'alpha', new_str: 'one'},
            {path: 'second.txt', old_str: 'missing', new_str: 'two'},
        ],
    });

    assert.equal(result.isError, true);
    assert.match(result.text, /Edit 2: old_str was not found/);
    assert.equal(await readFile(first, 'utf8'), 'alpha');
    assert.equal(await readFile(second, 'utf8'), 'gamma');
});

test('multi_edit restores written files when a later write fails', async (t) => {
    const tools = await startToolClient(t);
    const first = path.join(tools.directory, 'first.txt');
    const second = path.join(tools.directory, 'second.txt');

    await writeFile(first, 'alpha');
    await writeFile(second, 'gamma');
    await tools.call('read_file', {path: 'first.txt'});
    await tools.call('read_file', {path: 'second.txt'});
    await chmod(second, 0o444);

    const result = await tools.call('multi_edit', {
        edits: [
            {path: 'first.txt', old_str: 'alpha', new_str: 'one'},
            {path: 'second.txt', old_str: 'gamma', new_str: 'two'},
        ],
    });

    assert.equal(result.isError, true);
    assert.equal(await readFile(first, 'utf8'), 'alpha');
    assert.equal(await readFile(second, 'utf8'), 'gamma');
});
