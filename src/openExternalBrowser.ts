import { spawn } from 'child_process';
import { canonicalizeHttpExternalHref } from './linkSecurity';

export type OpenHttpExternalResult = 'opened' | 'invalid-url' | 'spawn-failed';

/**
 * Open http(s) URLs via a detached OS process. On some Linux/Cursor builds,
 * `vscode.env.openExternal` never settles and can wedge or crash the host.
 */
export function openHttpExternalHref(href: string): OpenHttpExternalResult {
    const parsed = canonicalizeHttpExternalHref(href);
    if (!parsed.ok) {
        return 'invalid-url';
    }

    try {
        openHttpHrefDetached(parsed.href);
        return 'opened';
    } catch {
        return 'spawn-failed';
    }
}

function openHttpHrefDetached(canonicalHref: string): void {
    if (process.platform === 'win32') {
        spawn('cmd', ['/c', 'start', '', canonicalHref], { detached: true, stdio: 'ignore' }).unref();
        return;
    }
    if (process.platform === 'darwin') {
        spawn('open', [canonicalHref], { detached: true, stdio: 'ignore' }).unref();
        return;
    }
    spawn('xdg-open', [canonicalHref], { detached: true, stdio: 'ignore' }).unref();
}
