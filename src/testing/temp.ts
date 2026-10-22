import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function createTempDirectory(prefix = 'local-mcp-'): Promise<string> {
    return mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeDirectory(directory: string): Promise<void> {
    await rm(directory, {recursive: true, force: true});
}
