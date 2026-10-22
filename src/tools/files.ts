import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {pathExists, resolvePath} from '../lib/paths.js';
import {defineTool, type ToolContext} from './define.js';

const IMAGE_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};

const BINARY_SAMPLE_BYTES = 8192;

const editSchema = z.object({
    path: z.string().min(1),
    old_str: z.string().min(1),
    new_str: z.string(),
    replace_all: z.boolean().default(false),
});

type Edit = z.infer<typeof editSchema>;

interface PendingFile {
    original: string;
    content: string;
    replaced: number;
}

async function applyEdits(edits: Edit[], context: ToolContext): Promise<string> {
    const files = new Map<string, PendingFile>();

    for (const [index, edit] of edits.entries()) {
        const target = resolvePath(edit.path, context.cwd);
        const label = edits.length > 1 ? `Edit ${index + 1}: ` : '';
        let file = files.get(target);

        if (!file) {
            await context.fileVersions.assertCurrent(target);

            const original = await readFile(target, 'utf8');

            file = {original, content: original, replaced: 0};
            files.set(target, file);
        }

        const occurrences = file.content.split(edit.old_str).length - 1;

        if (occurrences === 0) throw new Error(`${label}old_str was not found in ${target}.`);

        if (occurrences > 1 && !edit.replace_all)
            throw new Error(
                `${label}old_str matches ${occurrences} times in ${target}; add more context or set replace_all.`,
            );

        file.content = file.content.split(edit.old_str).join(edit.new_str);
        file.replaced += occurrences;
    }

    const written: [string, string][] = [];

    try {
        for (const [target, file] of files) {
            written.push([target, file.original]);
            await writeFile(target, file.content, 'utf8');
        }
    } catch (error) {
        for (const [target, original] of written)
            await writeFile(target, original, 'utf8').catch(() => undefined);

        throw error;
    }

    for (const target of files.keys()) context.fileVersions.remember(target, await stat(target));

    return [...files]
        .map(([target, file]) => `Replaced ${file.replaced} occurrence(s) in ${target}`)
        .join('\n');
}

export const fileTools = [
    defineTool({
        name: 'read_file',
        description:
            'Read a UTF-8 text file, optionally limited to a 1-based inclusive line range. Relative paths resolve against the default directory; `~` is the home directory. Binary and very large files are refused. A file must be read before it can be overwritten or edited.',
        readOnly: true,
        input: {
            path: z.string().min(1),
            start_line: z.number().int().min(1).optional(),
            end_line: z.number().int().min(1).optional(),
        },
        async run({path: filePath, start_line: startLine, end_line: endLine}, context) {
            const source = resolvePath(filePath, context.cwd);
            const stats = await stat(source);

            if (stats.size > context.maxReadBytes)
                throw new Error(
                    `File is larger than ${context.maxReadBytes} bytes. Read it in parts with bash.`,
                );

            const buffer = await readFile(source);

            if (buffer.subarray(0, BINARY_SAMPLE_BYTES).includes(0))
                throw new Error('File appears to be binary.');

            context.fileVersions.remember(source, stats);

            const content = buffer.toString('utf8');

            if (startLine === undefined && endLine === undefined) return content;

            const lines = content.split('\n');
            const start = startLine ?? 1;
            const end = endLine ?? lines.length;

            if (start > end) throw new Error('start_line must not be greater than end_line.');

            return lines.slice(start - 1, end).join('\n');
        },
    }),

    defineTool({
        name: 'read_image',
        description: 'Read a png, jpg, gif or webp image so it can be viewed.',
        readOnly: true,
        input: {
            path: z.string().min(1),
        },
        async run({path: filePath}, context) {
            const source = resolvePath(filePath, context.cwd);
            const mimeType = IMAGE_TYPES[path.extname(source).toLowerCase()];

            if (!mimeType) throw new Error('Unsupported image type. Use png, jpg, gif or webp.');

            const {size} = await stat(source);

            if (size > context.maxImageBytes)
                throw new Error(`Image is larger than ${context.maxImageBytes} bytes.`);

            return {
                content: [{type: 'image', data: await readFile(source, 'base64'), mimeType}],
            };
        },
    }),

    defineTool({
        name: 'write_file',
        description:
            'Create or overwrite a UTF-8 text file, creating missing parent directories. An existing file must have been read with read_file and not changed since, otherwise the write is refused.',
        input: {
            path: z.string().min(1),
            content: z.string(),
        },
        async run({path: filePath, content}, context) {
            const destination = resolvePath(filePath, context.cwd);

            if (await pathExists(destination))
                await context.fileVersions.assertCurrent(destination);

            await mkdir(path.dirname(destination), {recursive: true});
            await writeFile(destination, content, 'utf8');
            context.fileVersions.remember(destination, await stat(destination));

            return `File written: ${destination}`;
        },
    }),

    defineTool({
        name: 'edit_file',
        description:
            'Replace an exact string in a file. Fails if old_str is missing or ambiguous unless replace_all is true. The file must have been read with read_file and not changed since.',
        input: editSchema.shape,
        async run(edit, context) {
            return applyEdits([edit], context);
        },
    }),

    defineTool({
        name: 'multi_edit',
        description:
            'Apply several exact string replacements, in order, across one or more files. Later edits see the result of earlier ones. Nothing is written unless every edit applies, and a failed write restores the files already written. Each file must have been read with read_file and not changed since.',
        input: {
            edits: z.array(editSchema).min(1),
        },
        async run({edits}, context) {
            return applyEdits(edits, context);
        },
    }),
];
