import * as vscode from 'vscode';
import { classifyHref } from './linkSecurity';

export type OpenSchemeHrefResult = 'opened' | 'invalid';

/**
 * Open non-http(s) scheme URIs via the extension host (never the webview).
 * User must opt in via `clickableSvg.blockSchemeLinks: false`.
 */
export function openSchemeHref(href: string): OpenSchemeHrefResult {
    if (classifyHref(href) !== 'scheme') {
        return 'invalid';
    }

    try {
        const uri = vscode.Uri.parse(href, true);
        void vscode.env.openExternal(uri);
        return 'opened';
    } catch {
        return 'invalid';
    }
}
