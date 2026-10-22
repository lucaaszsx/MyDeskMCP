import {readFile, rename, writeFile} from 'node:fs/promises';
import type {OAuthClientInformationFull} from '@modelcontextprotocol/sdk/shared/auth.js';
import {nowSeconds} from '../lib/time.js';

export interface TokenRecord {
    clientId: string;
    scopes: string[];
    expiresAt: number;
}

export interface CodeRecord extends TokenRecord {
    codeChallenge: string;
    redirectUri: string;
}

interface PersistedState {
    clients: [string, OAuthClientInformationFull][];
    accessTokens: [string, TokenRecord][];
    refreshTokens: [string, TokenRecord][];
}

function isExpired(record: {expiresAt: number}): boolean {
    return record.expiresAt <= nowSeconds();
}

function dropExpired<Record extends {expiresAt: number}>(records: Map<string, Record>): void {
    for (const [key, record] of records) if (isExpired(record)) records.delete(key);
}

function toMap<Value>(entries: [string, Value][] | undefined): Map<string, Value> {
    return new Map(Array.isArray(entries) ? entries : []);
}

async function readState(file: string): Promise<Partial<PersistedState>> {
    let raw: string;

    try {
        raw = await readFile(file, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};

        throw error;
    }

    try {
        return JSON.parse(raw) as Partial<PersistedState>;
    } catch {
        throw new Error(`State file is not valid JSON: ${file}`);
    }
}

async function writeAtomically(file: string, data: string): Promise<void> {
    const temporary = `${file}.tmp`;

    await writeFile(temporary, data, {mode: 0o600});
    await rename(temporary, file);
}

export class AuthStore {
    private readonly clients: Map<string, OAuthClientInformationFull>;
    private readonly accessTokens: Map<string, TokenRecord>;
    private readonly refreshTokens: Map<string, TokenRecord>;
    private readonly codes = new Map<string, CodeRecord>();
    private pending: Promise<void> = Promise.resolve();

    private constructor(
        private readonly file: string,
        private readonly maxClients: number,
        state: Partial<PersistedState>,
    ) {
        this.clients = toMap(state.clients);
        this.accessTokens = toMap(state.accessTokens);
        this.refreshTokens = toMap(state.refreshTokens);
        dropExpired(this.accessTokens);
        dropExpired(this.refreshTokens);
    }

    static async open(file: string, maxClients: number): Promise<AuthStore> {
        return new AuthStore(file, maxClients, await readState(file));
    }

    getClient(clientId: string): OAuthClientInformationFull | undefined {
        return this.clients.get(clientId);
    }

    async saveClient(client: OAuthClientInformationFull): Promise<void> {
        this.clients.set(client.client_id, client);

        for (const clientId of this.clients.keys()) {
            if (this.clients.size <= this.maxClients) break;

            this.clients.delete(clientId);
        }

        await this.persist();
    }

    saveCode(code: string, record: CodeRecord): void {
        dropExpired(this.codes);
        this.codes.set(code, record);
    }

    findCode(code: string, clientId: string): CodeRecord | undefined {
        const record = this.codes.get(code);

        if (!record || record.clientId !== clientId || isExpired(record)) return undefined;

        return record;
    }

    takeCode(code: string, clientId: string): CodeRecord | undefined {
        const record = this.findCode(code, clientId);

        if (record) this.codes.delete(code);

        return record;
    }

    async saveTokens(access: [string, TokenRecord], refresh: [string, TokenRecord]): Promise<void> {
        this.accessTokens.set(...access);
        this.refreshTokens.set(...refresh);
        await this.persist();
    }

    findAccessToken(hash: string): TokenRecord | undefined {
        const record = this.accessTokens.get(hash);

        return record && !isExpired(record) ? record : undefined;
    }

    takeRefreshToken(hash: string, clientId: string): TokenRecord | undefined {
        const record = this.refreshTokens.get(hash);

        if (!record || record.clientId !== clientId || isExpired(record)) return undefined;

        this.refreshTokens.delete(hash);

        return record;
    }

    async flush(): Promise<void> {
        await this.pending.catch(() => undefined);
    }

    private persist(): Promise<void> {
        dropExpired(this.accessTokens);
        dropExpired(this.refreshTokens);

        const state: PersistedState = {
            clients: [...this.clients],
            accessTokens: [...this.accessTokens],
            refreshTokens: [...this.refreshTokens],
        };
        const data = JSON.stringify(state);

        this.pending = this.pending
            .catch(() => undefined)
            .then(() => writeAtomically(this.file, data));

        return this.pending;
    }
}
