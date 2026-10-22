import {stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function resolvePath(input: string, cwd: string): string {
    if (input === '~' || input.startsWith('~/')) return path.join(os.homedir(), input.slice(1));

    return path.resolve(cwd, input);
}

export async function pathExists(target: string): Promise<boolean> {
    return stat(target).then(
        () => true,
        () => false,
    );
}

export async function resolveDirectory(input: string, cwd: string): Promise<string> {
    const directory = resolvePath(input, cwd);
    const details = await stat(directory).catch(() => undefined);

    if (!details?.isDirectory()) throw new Error(`Directory does not exist: ${directory}`);

    return directory;
}
