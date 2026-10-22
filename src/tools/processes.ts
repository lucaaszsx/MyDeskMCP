import { z } from 'zod';
import { resolveDirectory } from '../lib/paths.js';
import { defineTool } from './define.js';

const processIdParam = z.number().int().min(1).describe('Id returned by process_start.');

export const processTools = [
    defineTool({
        name: 'process_start',
        description:
            'Start a long-running or interactive command in the background (dev server, watcher, REPL, long build) and return its process id. Its input stays open: use process_read to collect output, process_write to send text and process_stop to end it.',
        input: {
            command: z.string().min(1),
            cwd: z
                .string()
                .optional()
                .describe(
                    "Working directory. Defaults to the server's default directory."
                )
        },
        async run({ command, cwd }, context) {
            const directory = await resolveDirectory(cwd ?? '.', context.cwd);
            const id = context.background.start(command, directory);

            return `Started process ${id}`;
        }
    }),

    defineTool({
        name: 'process_read',
        description:
            'Return the output a background process produced since the last read, followed by its status. Set wait_ms to wait for new output instead of polling.',
        readOnly: true,
        input: {
            id: processIdParam,
            wait_ms: z
                .number()
                .int()
                .min(0)
                .max(60_000)
                .default(0)
                .describe('Maximum time to wait for new output when none is available.')
        },
        async run({ id, wait_ms: waitMs }, context) {
            return context.background.read(id, waitMs);
        }
    }),

    defineTool({
        name: 'process_write',
        description:
            'Write text to the standard input of a background process, for example to answer a prompt or feed a REPL. No newline is added: end the text with \\n when the program expects a line. Set close_input to send end-of-input after the text.',
        input: {
            id: processIdParam,
            text: z.string(),
            close_input: z.boolean().default(false)
        },
        async run({ id, text, close_input: closeInput }, context) {
            return context.background.write(id, text, closeInput);
        }
    }),

    defineTool({
        name: 'process_list',
        description:
            'List the background processes started with process_start, including finished ones not yet removed. Each line is: id, status, elapsed time, command.',
        readOnly: true,
        input: {},
        async run(_args, context) {
            return context.background.list();
        }
    }),

    defineTool({
        name: 'process_stop',
        description:
            'Send a signal (SIGTERM by default) to a background process started with process_start. If the process already finished, remove it from the list instead.',
        input: {
            id: processIdParam,
            signal: z.enum(['SIGTERM', 'SIGINT', 'SIGKILL']).default('SIGTERM')
        },
        async run({ id, signal }, context) {
            return context.background.stop(id, signal);
        }
    })
];
