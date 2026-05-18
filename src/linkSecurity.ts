import * as path from 'path';

/** Matches main.js HTTP_SCHEME_RE — http/https links handled by extension policy */
export const HTTP_SCHEME_RE = /^https?:/i;

/** Matches main.js EXTERNAL_SCHEME_RE — any URI with a scheme */
export const EXTERNAL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export type HrefKind = 'http' | 'scheme' | 'relative';

export function classifyHref(href: string): HrefKind {
    if (HTTP_SCHEME_RE.test(href)) {
        return 'http';
    }
    if (EXTERNAL_SCHEME_RE.test(href)) {
        return 'scheme';
    }
    return 'relative';
}

export type LinkBlockReason = 'absolute-path' | 'traversal';

export type ResolveRelativeLinkResult =
    | { ok: true; targetPath: string; fragment?: string }
    | { ok: false; reason: LinkBlockReason; urlPath: string };

/**
 * Resolves a relative SVG link against the document directory and enforces workspace bounds.
 * Mirrors handleOpenLink in svgEditorProvider.ts.
 */
export function resolveRelativeSvgLink(
    documentFsPath: string,
    href: string,
    workspaceRootFsPath: string | undefined,
    blockAbsolutePaths = true
): ResolveRelativeLinkResult {
    const [urlPath, fragment] = href.split('#');

    if (blockAbsolutePaths && path.isAbsolute(urlPath)) {
        return { ok: false, reason: 'absolute-path', urlPath };
    }

    const documentDir = path.dirname(documentFsPath);
    const targetPath = path.isAbsolute(urlPath)
        ? urlPath
        : path.resolve(documentDir, urlPath);
    const rootDir = workspaceRootFsPath ?? documentDir;
    const relativePath = path.relative(rootDir, targetPath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return { ok: false, reason: 'traversal', urlPath };
    }

    return {
        ok: true,
        targetPath,
        fragment: fragment || undefined,
    };
}

export type ScriptPolicy = 'strict' | 'prompt' | 'permissive';

export function getEffectiveAllowScripts(
    policy: ScriptPolicy,
    documentUri: string,
    allowedDocuments: ReadonlySet<string>
): boolean {
    if (policy === 'permissive') {
        return true;
    }
    if (policy === 'strict') {
        return false;
    }
    return allowedDocuments.has(documentUri);
}

export function buildScriptCsp(allowScripts: boolean, cspSource: string): string {
    return allowScripts ? `'unsafe-inline' ${cspSource}` : cspSource;
}

export function svgContainsScriptTag(svgContent: string): boolean {
    return svgContent.includes('<script');
}

export type ExternalLinkPolicy = 'block' | 'openExternal';

export function shouldBlockExternalLink(policy: ExternalLinkPolicy): boolean {
    return policy === 'block';
}

/** Non-http(s) URIs (vscode://, file://, …) must never reach native webview navigation. */
export function isNonHttpSchemeHref(href: string): boolean {
    return classifyHref(href) === 'scheme';
}

export function shouldBlockSchemeLinks(blockSchemeLinks: boolean): boolean {
    return blockSchemeLinks;
}

export type CanonicalHttpHrefResult =
    | { ok: true; href: string }
    | { ok: false };

/** Normalize http(s) URLs before handing them to the OS browser opener. */
export function canonicalizeHttpExternalHref(href: string): CanonicalHttpHrefResult {
    try {
        const url = new URL(href);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return { ok: false };
        }
        return { ok: true, href: url.href };
    } catch {
        return { ok: false };
    }
}
