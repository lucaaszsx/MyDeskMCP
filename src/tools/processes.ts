import {z} from 'zod';
import {resolveDirectory} from '../lib/paths.js';
import {defineTool} from './define.js';

export const processTools = [
    defineTool({
        name: 'process_start',
        description:
            'Start a command in the background and return its process id. Its input stays open: use process_write to send text, process_read to collect output and process_stop to end it.',
        input: {
            command: z.string().min(1),
            cwd: z
                .string()
                .optional()
                .describe("Working directory. Defaults to the server's default directory."),
        },
        async run({command, cwd}, context) {
            const directory = await resolveDirectory(cwd ?? '.', context.cwd);
            const id = context.background.start(command, directory);

            return `Started process ${id}`;
        },
    }),

    defineTool({
        name: 'process_read',
        description:
            'Return the output a background process produced since the last read, followed by its status. Optionally waits for new output.',
        readOnly: true,
        input: {
            id: z.number().int().min(1),
            wait_ms: z
                .number()
                .int()
                .min(0)
                .max(60_000)
                .default(0)
                .describe('Maximum time to wait for new output when none is available.'),
        },
        async run({id, wait_ms: waitMs}, context) {
            return context.background.read(id, waitMs);
        },
    }),

    defineTool({
        name: 'process_write',
        description:
            'Write text to the standard input of a background process. Set close_input to send end-of-input after the text.',
        input: {
            id: z.number().int().min(1),
            text: z.string(),
            close_input: z.boolean().default(false),
        },
        async run({id, text, close_input: closeInput}, context) {
            return context.background.write(id, text, closeInput);
        },
    }),

    defineTool({
        name: 'process_list',
        description:
            'List tracked background processes. Each line is: id, status, elapsed time, command.',
        readOnly: true,
        input: {},
        async run(_args, context) {
            return context.background.list();
        },
    }),

    defineTool({
        name: 'process_stop',
        description:
            'Send a signal to a background process. If the process already finished, remove it from the list instead.',
        input: {
            id: z.number().int().min(1),
            signal: z.enum(['SIGTERM', 'SIGINT', 'SIGKILL']).default('SIGTERM'),
        },
        async run({id, signal}, context) {
            return context.background.stop(id, signal);
        },
    }),
];
