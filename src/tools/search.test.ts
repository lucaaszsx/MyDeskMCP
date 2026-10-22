import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { startToolClient, type ToolHarness } from '../testing/tool-client.js';

async function createFiles(
    tools: ToolHarness,
    files: Record<string, string>
): Promise<void> {
    for (const [name, content] of Object.entries(files)) {
        const target = path.join(tools.directory, name);

        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
    }
}

test('find_files matches globs and skips ignored directories', async (t) => {
    const tools = await startToolClient(t);

    await createFiles(tools, {
        'a.ts': '',
        'sub/b.ts': '',
        'sub/c.js': '',
        'node_modules/pkg/d.ts': '',
        '.git/e.ts': ''
    });

    const result = await tools.call('find_files', { pattern: '**/*.ts' });

    assert.equal(result.text, 'a.ts\nsub/b.ts');
});

test('find_files limits results and says so', async (t) => {
    const tools = await startToolClient(t, { maxSearchResults: 2 });

    await createFiles(tools, { '1.txt': '', '2.txt': '', '3.txt': '', '4.txt': '' });

    const lines = (await tools.call('find_files', { pattern: '*.txt' })).text.split('\n');

    assert.equal(lines.length, 3);
    assert.equal(lines[2], '[Results limited to 2]');
});

test('find_files reports when nothing matches', async (t) => {
    const tools = await startToolClient(t);

    assert.equal(
        (await tools.call('find_files', { pattern: '**/*.nope' })).text,
        'No files found.'
    );
});

test('search_text finds literal matches with path and line number', async (t) => {
    const tools = await startToolClient(t);

    await createFiles(tools, {
        'one.txt': 'first\nneedle here\nlast',
        'two.txt': 'nothing'
    });

    const result = await tools.call('search_text', { query: 'needle' });

    assert.equal(result.text, `${path.join(tools.directory, 'one.txt')}:2:needle here`);
});

test('search_text treats the query literally unless regex is set', async (t) => {
    const tools = await startToolClient(t);

    await createFiles(tools, { 'dots.txt': 'axb\na.b' });

    const literal = await tools.call('search_text', { query: 'a.b' });
    const pattern = await tools.call('search_text', { query: 'a.b', regex: true });

    assert.equal(literal.text.split('\n').length, 1);
    assert.equal(pattern.text.split('\n').length, 2);
});

test('search_text supports case-insensitive search and include filters', async (t) => {
    const tools = await startToolClient(t);

    await createFiles(tools, { 'a.md': 'Hello', 'b.txt': 'Hello' });

    assert.equal(
        (await tools.call('search_text', { query: 'hello' })).text,
        'No matches found.'
    );

    const insensitive = await tools.call('search_text', {
        query: 'hello',
        ignore_case: true,
        include: '*.md'
    });

    assert.equal(insensitive.text, `${path.join(tools.directory, 'a.md')}:1:Hello`);
});

test('search_text skips ignored directories and searches a single file', async (t) => {
    const tools = await startToolClient(t);

    await createFiles(tools, {
        'node_modules/x/lib.js': 'needle',
        'src/real.js': 'needle'
    });

    const all = await tools.call('search_text', { query: 'needle' });
    const single = await tools.call('search_text', {
        query: 'needle',
        path: 'src/real.js'
    });

    assert.equal(all.text, `${path.join(tools.directory, 'src/real.js')}:1:needle`);
    assert.equal(single.text, `${path.join(tools.directory, 'src/real.js')}:1:needle`);
});

test('search_text limits results and pages with offset', async (t) => {
    const tools = await startToolClient(t);
    const file = path.join(tools.directory, 'many.txt');

    await createFiles(tools, { 'many.txt': 'hit\nhit\nhit\nhit\nhit' });

    const first = (
        await tools.call('search_text', { query: 'hit', max_results: 2 })
    ).text.split('\n');
    const second = (
        await tools.call('search_text', { query: 'hit', max_results: 2, offset: 2 })
    ).text.split('\n');
    const last = (
        await tools.call('search_text', { query: 'hit', max_results: 2, offset: 4 })
    ).text;

    assert.deepEqual(first, [
        `${file}:1:hit`,
        `${file}:2:hit`,
        '[Showing results 1-2 of 5; continue with offset 2]'
    ]);
    assert.equal(second[0], `${file}:3:hit`);
    assert.equal(second[2], '[Showing results 3-4 of 5; continue with offset 4]');
    assert.equal(last, `${file}:5:hit\n[Showing results 5-5 of 5]`);
});

test('search_text rejects an offset past the last result', async (t) => {
    const tools = await startToolClient(t);

    await createFiles(tools, { 'one.txt': 'hit' });

    const result = await tools.call('search_text', { query: 'hit', offset: 5 });

    assert.equal(result.isError, true);
    assert.match(result.text, /Offset 5 is past the last of 1 results/);
});

test('search_text lists matching files and counts matching lines', async (t) => {
    const tools = await startToolClient(t);

    await createFiles(tools, { 'a.txt': 'hit\nhit', 'b.txt': 'miss', 'c.txt': 'hit' });

    const files = await tools.call('search_text', { query: 'hit', mode: 'files' });
    const count = await tools.call('search_text', { query: 'hit', mode: 'count' });

    assert.equal(
        files.text,
        [path.join(tools.directory, 'a.txt'), path.join(tools.directory, 'c.txt')].join(
            '\n'
        )
    );
    assert.equal(
        count.text,
        `${path.join(tools.directory, 'a.txt')}:2\n${path.join(tools.directory, 'c.txt')}:1`
    );
});

test('search_text shows context lines around matches', async (t) => {
    const tools = await startToolClient(t);
    const file = path.join(tools.directory, 'ctx.txt');

    await createFiles(tools, { 'ctx.txt': 'one\ntwo\nneedle\nfour\nfive' });

    const result = await tools.call('search_text', { query: 'needle', context_lines: 1 });

    assert.equal(result.text, `${file}-2-two\n${file}:3:needle\n${file}-4-four`);
});

test('search_text matches across lines in multiline mode', async (t) => {
    const tools = await startToolClient(t);
    const file = path.join(tools.directory, 'blocks.txt');

    await createFiles(tools, { 'blocks.txt': 'start\nmiddle\nend\nother' });

    const single = await tools.call('search_text', { query: 'start.*end', regex: true });
    const multi = await tools.call('search_text', {
        query: 'start.*end',
        regex: true,
        multiline: true
    });

    assert.equal(single.text, 'No matches found.');
    assert.equal(multi.text, `${file}:1:start\n${file}:2:middle\n${file}:3:end`);
});

test('search_text searches hidden files and respects gitignore', async (t) => {
    const tools = await startToolClient(t);

    await createFiles(tools, {
        '.hidden.txt': 'needle',
        'ignored/out.txt': 'needle',
        'kept/in.txt': 'needle',
        '.gitignore': 'ignored/\n'
    });
    await tools.call('bash', { command: 'git init -q' });

    const result = await tools.call('search_text', { query: 'needle', mode: 'files' });

    assert.equal(
        result.text,
        [
            path.join(tools.directory, '.hidden.txt'),
            path.join(tools.directory, 'kept/in.txt')
        ].join('\n')
    );
});

test('search_text cuts very long lines', async (t) => {
    const tools = await startToolClient(t);

    await createFiles(tools, { 'long.txt': `needle ${'x'.repeat(5000)}` });

    const result = await tools.call('search_text', { query: 'needle' });

    assert.ok(result.text.length < 1000);
});

test('search_text reports invalid regular expressions', async (t) => {
    const tools = await startToolClient(t);

    await createFiles(tools, { 'a.txt': 'x' });

    const result = await tools.call('search_text', { query: '(', regex: true });

    assert.equal(result.isError, true);
});
