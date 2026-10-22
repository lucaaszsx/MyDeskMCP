import type {Writable} from 'node:stream';
import type {Config} from '../config.js';
import {killProcessGroup, spawnCommand} from './process.js';

interface Entry {
    id: number;
    command: string;
    pid: number | undefined;
    stdin: Writable;
    startedAt: number;
    output: string;
    dropped: number;
    delivered: number;
    exited: boolean;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    waiters: Set<() => void>;
}

export class BackgroundProcesses {
    private readonly entries = new Map<number, Entry>();
    private nextId = 1;

    constructor(private readonly limits: Config['tools']) {}

    start(command: string, cwd: string): number {
        if (this.entries.size >= this.limits.maxBackgroundProcesses)
            throw new Error('Too many tracked processes. Remove finished ones with process_stop.');

        const child = spawnCommand('bash', ['-lc', command], cwd, this.limits.environment);
        const entry: Entry = {
            id: this.nextId++,
            command,
            pid: child.pid,
            stdin: child.stdin,
            startedAt: Date.now(),
            output: '',
            dropped: 0,
            delivered: 0,
            exited: false,
            exitCode: null,
            signal: null,
            waiters: new Set(),
        };

        this.entries.set(entry.id, entry);

        child.stdout.setEncoding('utf8').on('data', (chunk: string) => this.append(entry, chunk));
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => this.append(entry, chunk));
        child.once('error', (error) => {
            this.append(entry, `${error.message}\n`);
            this.finish(entry, 127, null);
        });
        child.once('exit', (code, signal) => this.finish(entry, code, signal));

        return entry.id;
    }

    async read(id: number, waitMs: number): Promise<string> {
        const entry = this.get(id);

        if (waitMs > 0 && !entry.exited && this.unread(entry) === 0)
            await this.waitForActivity(entry, waitMs);

        const lost = Math.max(entry.dropped - entry.delivered, 0);
        const text = entry.output.slice(Math.max(entry.delivered - entry.dropped, 0));

        entry.delivered = entry.dropped + entry.output.length;

        return [
            lost > 0 ? `[... ${lost} characters lost ...]` : '',
            text,
            `[${this.describe(entry)}]`,
        ]
            .filter(Boolean)
            .join('\n');
    }

    async write(id: number, text: string, closeInput: boolean): Promise<string> {
        const entry = this.get(id);

        if (entry.exited) throw new Error(`Process ${id} has exited.`);

        if (!entry.stdin.writable) throw new Error(`Input of process ${id} is closed.`);

        await new Promise<void>((resolve, reject) => {
            entry.stdin.write(text, (error) => (error ? reject(error) : resolve()));
        });

        if (closeInput) entry.stdin.end();

        return `Wrote ${text.length} characters to process ${id}${closeInput ? ' and closed its input' : ''}`;
    }

    stop(id: number, signal: NodeJS.Signals): string {
        const entry = this.get(id);

        if (entry.exited) {
            this.entries.delete(id);
            return `Removed process ${id} (${this.status(entry)})`;
        }

        killProcessGroup(entry.pid, signal);

        return `Sent ${signal} to process ${id}`;
    }

    list(): string {
        const lines = [...this.entries.values()].map((entry) => {
            const seconds = Math.round((Date.now() - entry.startedAt) / 1000);

            return `${entry.id}\t${this.status(entry)}\t${seconds}s\t${entry.command}`;
        });

        return lines.join('\n') || '(No background processes)';
    }

    stopAll(): void {
        for (const entry of this.entries.values())
            if (!entry.exited) killProcessGroup(entry.pid, 'SIGTERM');
    }

    private get(id: number): Entry {
        const entry = this.entries.get(id);

        if (!entry) throw new Error(`No background process with id ${id}.`);

        return entry;
    }

    private append(entry: Entry, chunk: string): void {
        entry.output += chunk;

        const excess = entry.output.length - this.limits.backgroundBufferChars;

        if (excess > 0) {
            entry.output = entry.output.slice(excess);
            entry.dropped += excess;
        }

        this.wake(entry);
    }

    private finish(entry: Entry, code: number | null, signal: NodeJS.Signals | null): void {
        if (entry.exited) return;

        entry.exited = true;
        entry.exitCode = code;
        entry.signal = signal;
        this.wake(entry);
    }

    private wake(entry: Entry): void {
        for (const waiter of [...entry.waiters]) waiter();
    }

    private unread(entry: Entry): number {
        return entry.dropped + entry.output.length - entry.delivered;
    }

    private waitForActivity(entry: Entry, timeoutMs: number): Promise<void> {
        return new Promise((resolve) => {
            const done = (): void => {
                clearTimeout(timer);
                entry.waiters.delete(done);
                resolve();
            };
            const timer = setTimeout(done, timeoutMs);

            entry.waiters.add(done);
        });
    }

    private status(entry: Entry): string {
        if (!entry.exited) return 'running';

        return entry.signal
            ? `terminated by ${entry.signal}`
            : `exited with code ${entry.exitCode}`;
    }

    private describe(entry: Entry): string {
        return `process ${entry.id}: ${this.status(entry)}${entry.exited ? '' : `, pid ${entry.pid}`}`;
    }
}
