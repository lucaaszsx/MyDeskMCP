import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
    InvalidClientMetadataError,
    InvalidGrantError,
    InvalidTokenError
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
    AuthorizationParams,
    OAuthServerProvider
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
    OAuthClientInformationFull,
    OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Response } from 'express';
import type { Config } from '../config.js';
import { digest, randomToken, safeEqual } from '../lib/crypto.js';
import { nowSeconds } from '../lib/time.js';
import { renderLoginPage } from './login-page.js';
import type { AuthStore } from './store.js';

export class LocalOAuthProvider implements OAuthServerProvider {
    readonly clientsStore: OAuthRegisteredClientsStore;

    constructor(
        private readonly config: Config['auth'],
        private readonly store: AuthStore
    ) {
        this.clientsStore = {
            getClient: (clientId) => store.getClient(clientId),
            registerClient: async (metadata) => {
                const client = metadata as OAuthClientInformationFull;
                const uris = client.redirect_uris;

                if (
                    uris.length === 0 ||
                    !uris.every((uri) => this.isAllowedRedirect(uri))
                )
                    throw new InvalidClientMetadataError(
                        'redirect_uris must be Claude callback URLs'
                    );

                await store.saveClient(client);

                return client;
            }
        };
    }

    async authorize(
        client: OAuthClientInformationFull,
        params: AuthorizationParams,
        res: Response
    ): Promise<void> {
        const fields = {
            client_id: client.client_id,
            redirect_uri: params.redirectUri,
            response_type: 'code',
            code_challenge: params.codeChallenge,
            code_challenge_method: 'S256',
            state: params.state,
            scope: params.scopes?.join(' '),
            resource: params.resource?.href
        };

        res.set({
            'Cache-Control': 'no-store',
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy':
                "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"
        });

        if (res.req.method !== 'POST') {
            res.type('html').send(renderLoginPage(fields));
            return;
        }

        const submitted: unknown = res.req.body?.password;

        if (
            typeof submitted !== 'string' ||
            !safeEqual(submitted, this.config.password)
        ) {
            res.status(401).type('html').send(renderLoginPage(fields, 'Wrong password.'));
            return;
        }

        const code = randomToken();

        this.store.saveCode(code, {
            clientId: client.client_id,
            codeChallenge: params.codeChallenge,
            redirectUri: params.redirectUri,
            scopes: params.scopes ?? [],
            expiresAt: nowSeconds() + this.config.codeTtlSeconds
        });

        const target = new URL(params.redirectUri);

        target.searchParams.set('code', code);

        if (params.state) target.searchParams.set('state', params.state);

        res.redirect(302, target.href);
    }

    async challengeForAuthorizationCode(
        client: OAuthClientInformationFull,
        authorizationCode: string
    ): Promise<string> {
        const record = this.store.findCode(authorizationCode, client.client_id);

        if (!record) throw new InvalidGrantError('Invalid or expired authorization code');

        return record.codeChallenge;
    }

    async exchangeAuthorizationCode(
        client: OAuthClientInformationFull,
        authorizationCode: string,
        _codeVerifier?: string,
        redirectUri?: string
    ): Promise<OAuthTokens> {
        const record = this.store.takeCode(authorizationCode, client.client_id);

        if (!record) throw new InvalidGrantError('Invalid or expired authorization code');

        if (redirectUri !== undefined && redirectUri !== record.redirectUri)
            throw new InvalidGrantError('redirect_uri does not match');

        return this.issueTokens(client.client_id, record.scopes);
    }

    async exchangeRefreshToken(
        client: OAuthClientInformationFull,
        refreshToken: string
    ): Promise<OAuthTokens> {
        const record = this.store.takeRefreshToken(
            digest(refreshToken),
            client.client_id
        );

        if (!record) throw new InvalidGrantError('Invalid or expired refresh token');

        return this.issueTokens(client.client_id, record.scopes);
    }

    async verifyAccessToken(token: string): Promise<AuthInfo> {
        const record = this.store.findAccessToken(digest(token));

        if (!record) throw new InvalidTokenError('Invalid access token');

        return {
            token,
            clientId: record.clientId,
            scopes: record.scopes,
            expiresAt: record.expiresAt
        };
    }

    private isAllowedRedirect(uri: unknown): boolean {
        return this.config.allowedRedirectUris.has(String(uri));
    }

    private async issueTokens(clientId: string, scopes: string[]): Promise<OAuthTokens> {
        const accessToken = randomToken();
        const refreshToken = randomToken();
        const now = nowSeconds();

        await this.store.saveTokens(
            [
                digest(accessToken),
                { clientId, scopes, expiresAt: now + this.config.accessTtlSeconds }
            ],
            [
                digest(refreshToken),
                { clientId, scopes, expiresAt: now + this.config.refreshTtlSeconds }
            ]
        );

        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: this.config.accessTtlSeconds,
            refresh_token: refreshToken,
            scope: scopes.join(' ')
        };
    }
}
