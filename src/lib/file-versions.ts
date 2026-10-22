import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';

type Version = Pick<Stats, 'mtimeMs' | 'size'>;

function signature(version: Version): string {
    return `${version.mtimeMs}:${version.size}`;
}

export class FileVersions {
    private readonly versions = new Map<string, string>();

    remember(target: string, version: Version): void {
        this.versions.set(target, signature(version));
    }

    async assertCurrent(target: string): Promise<void> {
        const current = signature(await stat(target));
        const known = this.versions.get(target);

        if (known === undefined)
            throw new Error(
                `${target} has not been read yet. Read it with read_file first.`
            );

        if (known !== current)
            throw new Error(
                `${target} changed since it was last read. Read it again with read_file.`
            );
    }
}
