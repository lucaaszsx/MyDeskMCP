import assert from 'node:assert/strict';
import test from 'node:test';
import { startToolClient } from '../testing/tool-client.js';

test('exposes the full tool catalog', async (t) => {
    const tools = await startToolClient(t);

    assert.deepEqual(await tools.listTools(), [
        'bash',
        'edit_file',
        'find_files',
        'move_path',
        'multi_edit',
        'process_list',
        'process_read',
        'process_start',
        'process_stop',
        'process_write',
        'read_file',
        'read_image',
        'search_text',
        'window_action',
        'window_list',
        'window_move_resize',
        'write_file'
    ]);
});
