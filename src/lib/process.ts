import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';

const MAX_CAPTURE_CHARS = 10_000_000;
const PIPE_CLOSE_GRACE_MS = 200;

export interface CommandOptions {
    cwd: string;
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
}

export interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

function append(buffer: string, chunk: string): string {
    return buffer.length >= MAX_CAPTURE_CHARS ? buffer : buffer + chunk;
}

export function spawnCommand(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv
): ChildProcessWithoutNullStreams {
    const child = spawn(command, args, { cwd, env, detached: true });

    child.stdin.on('error', () => undefined);

    return child;
}

export function killProcessGroup(
    pid: number | undefined,
    signal: NodeJS.Signals = 'SIGKILL'
): boolean {
    if (pid === undefined) return false;

    try {
        process.kill(-pid, signal);
        return true;
    } catch {
        return false;
    }
}

export function formatOutput(result: Pick<CommandResult, 'stdout' | 'stderr'>): string {
    return [result.stdout, result.stderr].filter(Boolean).join('\n');
}

export function runCommand(
    command: string,
    args: string[],
    options: CommandOptions
): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const child = spawnCommand(command, args, options.cwd, options.env);

        child.stdin.end();

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
            stdout = append(stdout, chunk);
        });
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
            stderr = append(stderr, chunk);
        });

        const timer = setTimeout(() => {
            timedOut = true;
            killProcessGroup(child.pid);
        }, options.timeoutMs);

        child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });

        child.once('exit', () => {
            setTimeout(() => {
                child.stdout.destroy();
                child.stderr.destroy();
            }, PIPE_CLOSE_GRACE_MS).unref();
        });

        child.once('close', (code, signal) => {
            clearTimeout(timer);

            if (timedOut) {
                const output = formatOutput({ stdout, stderr });
                reject(
                    new Error(
                        `${output}\n[timed out after ${options.timeoutMs} ms]`.trim()
                    )
                );
                return;
            }

            const signalNumber = signal ? os.constants.signals[signal] : 0;
            resolve({ stdout, stderr, exitCode: code ?? 128 + signalNumber });
        });
    });
}

export async function executeCommand(
    command: string,
    args: string[],
    options: CommandOptions
): Promise<string> {
    const result = await runCommand(command, args, options);
    const output = formatOutput(result);

    if (result.exitCode !== 0)
        throw new Error(`${output}\n[exit code ${result.exitCode}]`.trim());

    return output;
}
