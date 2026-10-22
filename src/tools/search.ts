import { glob } from 'node:fs/promises';
import { z } from 'zod';
import { resolveDirectory, resolvePath } from '../lib/paths.js';
import { runCommand } from '../lib/process.js';
import { defineTool } from './define.js';

const MAX_LINE_COLUMNS = '500';

const MODE_FLAGS = {
    content: ['--line-number', '--no-heading'],
    files: ['--files-with-matches'],
    count: ['--count']
} as const;

export const searchTools = [
    defineTool({
        name: 'find_files',
        description:
            'Find files and directories by name with a glob pattern (for example **/*.ts) under a directory. Common dependency and build directories are skipped and the number of results is limited.',
        readOnly: true,
        input: {
            pattern: z.string().min(1).describe('Glob pattern, for example **/*.ts.'),
            path: z
                .string()
                .default('.')
                .describe('Directory to search. Defaults to the default directory.')
        },
        async run({ pattern, path: searchPath }, context) {
            const directory = await resolveDirectory(searchPath, context.cwd);
            const exclude = context.ignoredDirectories.map((name) => `**/${name}`);
            const matches: string[] = [];

            for await (const entry of glob(pattern, { cwd: directory, exclude })) {
                matches.push(entry);

                if (matches.length > context.maxSearchResults) break;
            }

            if (matches.length === 0) return 'No files found.';

            const shown = matches.slice(0, context.maxSearchResults).sort();
            const notice =
                matches.length > shown.length
                    ? `\n[Results limited to ${context.maxSearchResults}]`
                    : '';

            return shown.join('\n') + notice;
        }
    }),

    defineTool({
        name: 'search_text',
        description:
            'Search file contents with ripgrep. Matches literally by default; set regex for regular expressions. Modes: content (path:line:text, context lines as path-line-text), files (matching paths) and count (path:matching lines). Respects .gitignore and skips dependency and build directories; use bash to search ignored files. Results are sorted by path and paged by output line with offset and max_results.',
        readOnly: true,
        input: {
            query: z
                .string()
                .min(1)
                .describe('Text to look for, or a regular expression when regex is set.'),
            path: z
                .string()
                .default('.')
                .describe(
                    'Directory or file to search. Defaults to the default directory.'
                ),
            mode: z.enum(['content', 'files', 'count']).default('content'),
            regex: z.boolean().default(false),
            ignore_case: z.boolean().default(false),
            multiline: z
                .boolean()
                .default(false)
                .describe('Let a match span several lines, with . matching newlines.'),
            context_lines: z
                .number()
                .int()
                .min(0)
                .max(20)
                .default(0)
                .describe('Lines of context around each match. Content mode only.'),
            include: z
                .string()
                .optional()
                .describe('Only search files matching this glob.'),
            offset: z.number().int().min(0).default(0).describe('Output lines to skip.'),
            max_results: z.number().int().min(1).optional()
        },
        async run(
            {
                query,
                path: searchPath,
                mode,
                regex,
                ignore_case: ignoreCase,
                multiline,
                context_lines: contextLines,
                include,
                offset,
                max_results: maxResults
            },
            context
        ) {
            const args = [
                '--no-config',
                '--hidden',
                '--sort=path',
                '--with-filename',
                '--max-columns',
                MAX_LINE_COLUMNS,
                '--max-columns-preview',
                ...MODE_FLAGS[mode],
                ...context.ignoredDirectories.flatMap((name) => ['--glob', `!${name}`])
            ];

            if (!regex) args.push('--fixed-strings');

            if (ignoreCase) args.push('--ignore-case');

            if (multiline) args.push('--multiline', '--multiline-dotall');

            if (mode === 'content' && contextLines > 0)
                args.push('--context', String(contextLines));

            if (include) args.push('--glob', include);

            args.push('--', query, resolvePath(searchPath, context.cwd));

            const result = await runCommand('rg', args, {
                cwd: context.cwd,
                timeoutMs: context.commandTimeoutMs,
                env: context.environment
            });

            if (!result.stdout) {
                if (result.exitCode > 1)
                    throw new Error(result.stderr.trim() || 'rg failed.');

                return 'No matches found.';
            }

            const lines = result.stdout.split('\n').filter(Boolean);
            const limit = Math.min(
                maxResults ?? context.maxSearchResults,
                context.maxSearchResults
            );
            const page = lines.slice(offset, offset + limit);

            if (page.length === 0)
                throw new Error(
                    `Offset ${offset} is past the last of ${lines.length} results.`
                );

            if (page.length === lines.length) return page.join('\n');

            const next = offset + page.length;
            const more = next < lines.length ? `; continue with offset ${next}` : '';

            return `${page.join('\n')}\n[Showing results ${offset + 1}-${next} of ${lines.length}${more}]`;
        }
    })
];
