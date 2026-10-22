import { cp, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { pathExists, resolvePath } from '../lib/paths.js';
import { defineTool } from './define.js';

export const filesystemTools = [
    defineTool({
        name: 'move_path',
        description:
            'Move or rename a file or directory, creating missing parent directories. Fails if the destination exists unless overwrite is true.',
        input: {
            from: z.string().min(1),
            to: z.string().min(1),
            overwrite: z.boolean().default(false)
        },
        async run({ from, to, overwrite }, context) {
            const source = resolvePath(from, context.cwd);
            const destination = resolvePath(to, context.cwd);

            if (!overwrite && (await pathExists(destination)))
                throw new Error(`Destination already exists: ${destination}`);

            await mkdir(path.dirname(destination), { recursive: true });

            try {
                await rename(source, destination);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;

                await cp(source, destination, { recursive: true, force: overwrite });
                await rm(source, { recursive: true });
            }

            return `Moved ${source} to ${destination}`;
        }
    })
];
