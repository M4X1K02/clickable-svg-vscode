import * as vscode from 'vscode';
import { classifyHref, evaluateSchemeLink, getHrefScheme, isSchemeAlwaysBlocked } from './linkSecurity';

export type OpenSchemeHrefResult = 'opened' | 'invalid' | 'blocked';

/**
 * Open non-http(s) scheme URIs via the extension host (never the webview).
 * Caller must pass evaluateSchemeLink result; this re-checks as defense in depth.
 */
export function openSchemeHref(
    href: string,
    blockSchemeLinks: boolean,
    workspaceTrusted: boolean
): OpenSchemeHrefResult {
    if (classifyHref(href) !== 'scheme') {
        return 'invalid';
    }

    const decision = evaluateSchemeLink(href, blockSchemeLinks, workspaceTrusted);
    if (decision.action === 'block') {
        return 'blocked';
    }

    const scheme = getHrefScheme(href);
    if (!scheme || isSchemeAlwaysBlocked(scheme)) {
        return 'blocked';
    }

    try {
        const uri = vscode.Uri.parse(href, true);
        void vscode.env.openExternal(uri);
        return 'opened';
    } catch {
        return 'invalid';
    }
}
