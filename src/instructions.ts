import os from 'node:os';
import type { ToolContext } from './tools/define.js';

type InstructionLimits = Pick<ToolContext, 'cwd' | 'commandTimeoutMs' | 'maxOutputChars'>;

export function buildInstructions(limits: InstructionLimits): string {
    const { username } = os.userInfo();
    const seconds = Math.round(limits.commandTimeoutMs / 1000);

    return [
        `MyDeskMCP gives you control of the user's own computer (${os.platform()}, account ${username}): their files, shell, long-running programs and desktop windows. Not a sandbox — everything runs as that account.`,
        '',
        `Default directory: ${limits.cwd} (relative paths resolve against it, ~ is home). Commands are killed after ${seconds}s; output over ${limits.maxOutputChars} characters is cut, keeping the start and the end.`
    ].join('\n');
}
