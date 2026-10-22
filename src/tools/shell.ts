import { z } from 'zod';
import { resolveDirectory } from '../lib/paths.js';
import { executeCommand } from '../lib/process.js';
import { defineTool } from './define.js';

export const shellTools = [
    defineTool({
        name: 'bash',
        description:
            'Execute a command in a Bash login shell on the host machine and return its combined output. Fails with the output and exit code when the command exits non-zero.',
        input: {
            command: z.string().min(1),
            cwd: z
                .string()
                .optional()
                .describe(
                    "Working directory. Defaults to the server's default directory."
                ),
            timeout: z
                .number()
                .int()
                .min(1000)
                .optional()
                .describe('Timeout in milliseconds, capped by the server limit.')
        },
        async run({ command, cwd, timeout }, context) {
            const output = await executeCommand('bash', ['-lc', command], {
                cwd: await resolveDirectory(cwd ?? '.', context.cwd),
                timeoutMs: Math.min(
                    timeout ?? context.commandTimeoutMs,
                    context.commandTimeoutMs
                ),
                env: context.environment
            });

            return output || '(No output)';
        }
    })
];
