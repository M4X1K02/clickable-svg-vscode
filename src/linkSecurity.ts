import { realpath as fsRealpath } from 'fs/promises';
import * as path from 'path';

/** Matches main.js HTTP_SCHEME_RE — http/https links handled by extension policy */
export const HTTP_SCHEME_RE = /^https?:/i;

/** Matches main.js EXTERNAL_SCHEME_RE — any URI with a scheme */
export const EXTERNAL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Case-insensitive detection for script prompt (mirrors SVG_SCRIPT_TAG_RE in tests). */
export const SVG_SCRIPT_TAG_RE = /<script[\s>/]/i;

/** Never opened even when blockSchemeLinks is false (editor command execution). */
export const ALWAYS_BLOCKED_URI_SCHEMES = new Set(['vscode', 'command']);

/** Schemes permitted when blockSchemeLinks is false and workspace is trusted. */
export const SCHEME_LINK_ALLOWLIST = new Set(['file', 'mailto', 'tel']);

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

export type LinkBlockReason = 'absolute-path' | 'traversal' | 'symlink-escape' | 'unresolvable';

export type ResolveRelativeLinkResult =
    | { ok: true; targetPath: string; fragment?: string }
    | { ok: false; reason: Exclude<LinkBlockReason, 'symlink-escape' | 'unresolvable'>; urlPath: string };

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

export function isPathContainedInRoot(resolvedPath: string, rootDir: string): boolean {
    const relative = path.relative(rootDir, resolvedPath);
    if (relative === '') {
        return true;
    }
    return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export type VerifyResolvedPathResult =
    | { ok: true; resolvedPath: string }
    | { ok: false; reason: 'symlink-escape' | 'unresolvable' };

export type RealpathFn = (targetPath: string) => Promise<string>;

/**
 * Resolves symlinks and ensures the final path stays inside the workspace (or SVG directory).
 */
export async function verifyResolvedPathInWorkspace(
    targetPath: string,
    workspaceRootFsPath: string | undefined,
    realpath: RealpathFn = fsRealpath
): Promise<VerifyResolvedPathResult> {
    const rootDir = workspaceRootFsPath ?? path.dirname(targetPath);
    try {
        const [resolvedTarget, resolvedRoot] = await Promise.all([
            realpath(targetPath),
            realpath(rootDir),
        ]);
        if (!isPathContainedInRoot(resolvedTarget, resolvedRoot)) {
            return { ok: false, reason: 'symlink-escape' };
        }
        return { ok: true, resolvedPath: resolvedTarget };
    } catch {
        return { ok: false, reason: 'unresolvable' };
    }
}

export type ScriptPolicy = 'strict' | 'prompt' | 'permissive';

export function getEffectiveScriptPolicy(
    configured: ScriptPolicy,
    workspaceTrusted: boolean
): ScriptPolicy {
    if (!workspaceTrusted) {
        return 'strict';
    }
    return configured;
}

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
    return SVG_SCRIPT_TAG_RE.test(svgContent);
}

export type ExternalLinkPolicy = 'block' | 'openExternal';

export function getEffectiveExternalLinkPolicy(
    configured: ExternalLinkPolicy,
    workspaceTrusted: boolean
): ExternalLinkPolicy {
    if (!workspaceTrusted) {
        return 'block';
    }
    return configured;
}

export function shouldBlockExternalLink(policy: ExternalLinkPolicy): boolean {
    return policy === 'block';
}

export function getEffectiveBlockAbsolutePaths(
    configured: boolean,
    workspaceTrusted: boolean
): boolean {
    if (!workspaceTrusted) {
        return true;
    }
    return configured;
}

/** Non-http(s) URIs (vscode://, file://, …) must never reach native webview navigation. */
export function isNonHttpSchemeHref(href: string): boolean {
    return classifyHref(href) === 'scheme';
}

export function getHrefScheme(href: string): string | undefined {
    if (classifyHref(href) !== 'scheme') {
        return undefined;
    }
    try {
        return new URL(href).protocol.replace(/:$/, '').toLowerCase();
    } catch {
        const match = /^([a-z][a-z0-9+.-]*):/i.exec(href.trim());
        return match ? match[1].toLowerCase() : undefined;
    }
}

export function isSchemeAlwaysBlocked(scheme: string): boolean {
    return ALWAYS_BLOCKED_URI_SCHEMES.has(scheme.toLowerCase());
}

export function isSchemeAllowlisted(scheme: string): boolean {
    return SCHEME_LINK_ALLOWLIST.has(scheme.toLowerCase());
}

export type SchemeLinkBlockReason =
    | 'untrusted-workspace'
    | 'blocked-by-setting'
    | 'dangerous-scheme'
    | 'not-allowlisted';

export type EvaluateSchemeLinkResult =
    | { action: 'open' }
    | { action: 'block'; reason: SchemeLinkBlockReason };

/**
 * Scheme links: blocked by default; when unblocked, only allowlisted schemes;
 * vscode/command always blocked.
 */
export function evaluateSchemeLink(
    href: string,
    blockSchemeLinks: boolean,
    workspaceTrusted: boolean
): EvaluateSchemeLinkResult {
    if (!workspaceTrusted) {
        return { action: 'block', reason: 'untrusted-workspace' };
    }
    if (blockSchemeLinks) {
        return { action: 'block', reason: 'blocked-by-setting' };
    }

    const scheme = getHrefScheme(href);
    if (!scheme || isSchemeAlwaysBlocked(scheme)) {
        return { action: 'block', reason: 'dangerous-scheme' };
    }
    if (!isSchemeAllowlisted(scheme)) {
        return { action: 'block', reason: 'not-allowlisted' };
    }
    return { action: 'open' };
}

/** @deprecated Use evaluateSchemeLink — kept for simple boolean checks in legacy tests */
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
