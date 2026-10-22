import { z } from 'zod';
import { runCommand } from '../lib/process.js';
import { defineTool, type ToolContext } from './define.js';

const UNKNOWN = '-';

const windowIdParam = z.number().int().min(1).describe('Window id from window_list.');

const STATE_ACTIONS: Record<string, [property: string, add: boolean][]> = {
    maximize: [
        ['MAXIMIZED_VERT', true],
        ['MAXIMIZED_HORZ', true]
    ],
    restore: [
        ['MAXIMIZED_VERT', false],
        ['MAXIMIZED_HORZ', false]
    ],
    fullscreen: [['FULLSCREEN', true]],
    unfullscreen: [['FULLSCREEN', false]]
};

const SIMPLE_ACTIONS: Record<string, string> = {
    activate: 'windowactivate',
    minimize: 'windowminimize',
    close: 'windowquit',
    kill: 'windowkill'
};

function actionArgs(action: string, id: string): string[] {
    const simple = SIMPLE_ACTIONS[action];

    if (simple) return [simple, id];

    return STATE_ACTIONS[action]!.flatMap(([property, add]) => [
        'windowstate',
        add ? '--add' : '--remove',
        property,
        id
    ]);
}

function shellVars(output: string): Record<string, string> {
    const vars: Record<string, string> = {};

    for (const line of output.split('\n')) {
        const eq = line.indexOf('=');

        if (eq > 0) vars[line.slice(0, eq)] = line.slice(eq + 1);
    }

    return vars;
}

async function xdotool(args: string[], context: ToolContext): Promise<string> {
    const result = await runCommand('xdotool', args, {
        cwd: context.cwd,
        timeoutMs: context.commandTimeoutMs,
        env: context.environment
    });

    if (result.exitCode !== 0)
        throw new Error(
            result.stderr.trim() || `xdotool exited with code ${result.exitCode}.`
        );

    return result.stdout;
}

async function readAttribute(args: string[], context: ToolContext): Promise<string> {
    const result = await runCommand('xdotool', args, {
        cwd: context.cwd,
        timeoutMs: context.commandTimeoutMs,
        env: context.environment
    });

    if (result.exitCode !== 0) return UNKNOWN;

    const value = result.stdout.trim();

    return value === '' || value === '(null)' ? UNKNOWN : value;
}

async function describeWindow(id: string, context: ToolContext): Promise<string> {
    const [name, pid, className, geometry] = await Promise.all([
        readAttribute(['getwindowname', id], context),
        readAttribute(['getwindowpid', id], context),
        readAttribute(['getwindowclassname', id], context),
        readAttribute(['getwindowgeometry', '--shell', id], context)
    ]);
    const vars = geometry === UNKNOWN ? {} : shellVars(geometry);
    const size =
        vars.WIDTH && vars.HEIGHT
            ? `${vars.WIDTH}x${vars.HEIGHT}@${vars.X},${vars.Y}`
            : UNKNOWN;

    return `${id}\t${pid}\t${className}\t${size}\t${name === UNKNOWN ? '(untitled)' : name}`;
}

export const windowTools = [
    defineTool({
        name: 'window_list',
        description:
            'List desktop windows, one per line, as id, pid, class, size@position and title. Start here to get the id the other window tools need. pattern matches name, class, classname and role; omit to list every window. Only visible windows are listed unless all is set.',
        readOnly: true,
        input: {
            pattern: z.string().optional(),
            all: z
                .boolean()
                .default(false)
                .describe('Include windows that are not currently visible.')
        },
        async run({ pattern, all }, context) {
            const args = ['search'];

            if (!all) args.push('--onlyvisible');

            args.push(pattern ?? '.*');

            const result = await runCommand('xdotool', args, {
                cwd: context.cwd,
                timeoutMs: context.commandTimeoutMs,
                env: context.environment
            });

            if (result.exitCode > 1)
                throw new Error(result.stderr.trim() || 'xdotool search failed.');

            const ids = result.stdout.split('\n').filter(Boolean);

            if (ids.length === 0) return 'No windows found.';

            const rows = await Promise.all(ids.map((id) => describeWindow(id, context)));

            return rows.join('\n');
        }
    }),

    defineTool({
        name: 'window_action',
        description:
            "Change a window's state: activate (focus, raise and switch desktop), minimize, maximize, restore, fullscreen, unfullscreen, close (ask the app to close) or kill (force).",
        input: {
            id: windowIdParam,
            action: z.enum([
                'activate',
                'minimize',
                'maximize',
                'restore',
                'fullscreen',
                'unfullscreen',
                'close',
                'kill'
            ])
        },
        async run({ id, action }, context) {
            await xdotool(actionArgs(action, String(id)), context);

            return `Window ${id}: ${action}`;
        }
    }),

    defineTool({
        name: 'window_move_resize',
        description:
            'Move and/or resize a window. Only the given fields change; a resize with just one dimension keeps the other at its current value.',
        input: {
            id: windowIdParam,
            x: z.number().int().optional(),
            y: z.number().int().optional(),
            width: z.number().int().min(1).optional(),
            height: z.number().int().min(1).optional()
        },
        async run({ id, x, y, width, height }, context) {
            if (
                x === undefined &&
                y === undefined &&
                width === undefined &&
                height === undefined
            )
                throw new Error('Provide at least one of x, y, width or height.');

            const windowId = String(id);
            const args: string[] = [];

            if (x !== undefined || y !== undefined)
                args.push(
                    'windowmove',
                    windowId,
                    x === undefined ? 'x' : String(x),
                    y === undefined ? 'y' : String(y)
                );

            if (width !== undefined || height !== undefined) {
                let finalWidth = width;
                let finalHeight = height;

                if (finalWidth === undefined || finalHeight === undefined) {
                    const geometry = shellVars(
                        await xdotool(['getwindowgeometry', '--shell', windowId], context)
                    );

                    finalWidth ??= Number(geometry.WIDTH);
                    finalHeight ??= Number(geometry.HEIGHT);
                }

                args.push(
                    'windowsize',
                    windowId,
                    String(finalWidth),
                    String(finalHeight)
                );
            }

            await xdotool(args, context);

            return `Window ${id} updated.`;
        }
    })
];
