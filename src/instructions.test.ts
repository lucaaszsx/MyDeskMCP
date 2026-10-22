import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInstructions } from './instructions.js';

const limits = { cwd: '/home/user', commandTimeoutMs: 120_000, maxOutputChars: 100_000 };

test('mentions the default directory and the timeout in seconds', () => {
    const instructions = buildInstructions(limits);

    assert.match(instructions, /\/home\/user/);
    assert.match(instructions, /120s/);
    assert.match(instructions, /100000 characters/);
});

test('stays well short of the tool description budget', () => {
    assert.ok(buildInstructions(limits).length < 700);
});
