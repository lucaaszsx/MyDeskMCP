import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';

export function digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function randomToken(): string {
    return randomBytes(32).toString('hex');
}

export function safeEqual(a: string, b: string): boolean {
    return timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
}
