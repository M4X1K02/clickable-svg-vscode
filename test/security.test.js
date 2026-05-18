'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    classifyHref,
    resolveRelativeSvgLink,
    getEffectiveAllowScripts,
    buildScriptCsp,
    svgContainsScriptTag,
    shouldBlockExternalLink,
    shouldBlockSchemeLinks,
    isNonHttpSchemeHref,
    canonicalizeHttpExternalHref,
    HTTP_SCHEME_RE,
    EXTERNAL_SCHEME_RE,
} = require('../out/linkSecurity.js');

const MAIN_JS_PATH = path.join(__dirname, '..', 'media', 'main.js');

function readMainJsPatterns() {
    const source = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    const httpMatch = source.match(/const HTTP_SCHEME_RE = (.+);/);
    const externalMatch = source.match(/const EXTERNAL_SCHEME_RE = (.+);/);
    assert.ok(httpMatch, 'HTTP_SCHEME_RE must exist in media/main.js');
    assert.ok(externalMatch, 'EXTERNAL_SCHEME_RE must exist in media/main.js');
    return {
        http: new RegExp(httpMatch[1].slice(1, -1)),
        external: new RegExp(externalMatch[1].slice(1, -1)),
    };
}

describe('href classification (shared with webview)', () => {
    const mainPatterns = readMainJsPatterns();

    it('main.js regexes stay in sync with linkSecurity.ts', () => {
        const samples = [
            'https://example.com',
            'http://example.com/foo',
            'vscode://command/foo',
            'file:///etc/passwd',
            './relative.svg',
            '/etc/passwd',
        ];
        for (const href of samples) {
            assert.equal(
                HTTP_SCHEME_RE.test(href),
                mainPatterns.http.test(href),
                `HTTP_SCHEME mismatch for ${href}`
            );
            assert.equal(
                EXTERNAL_SCHEME_RE.test(href),
                mainPatterns.external.test(href),
                `EXTERNAL_SCHEME mismatch for ${href}`
            );
        }
    });

    it('routes http/https to extension policy (not native webview)', () => {
        assert.equal(classifyHref('https://google.com'), 'http');
        assert.equal(classifyHref('http://example.com/&calc.exe'), 'http');
    });

    it('classifies other schemes for extension blocking (not native webview)', () => {
        assert.equal(
            classifyHref('vscode://command/workbench.action.terminal.sendSequence'),
            'scheme'
        );
        assert.equal(classifyHref('file:///etc/passwd'), 'scheme');
        assert.equal(
            isNonHttpSchemeHref('vscode://command/workbench.action.terminal.new'),
            true
        );
        assert.equal(isNonHttpSchemeHref('https://example.com'), false);
        assert.equal(isNonHttpSchemeHref('./relative.svg'), false);
    });

    it('treats path-only hrefs as relative (extension openLink path)', () => {
        assert.equal(classifyHref('/etc/passwd'), 'relative');
        assert.equal(classifyHref('./other.svg'), 'relative');
        assert.equal(classifyHref('../secret.txt'), 'relative');
    });
});

describe('relative link resolution (workspace sandbox)', () => {
    const workspace = '/home/user/project';
    const svgPath = path.join(workspace, 'test-vectors', 'test-link-matrix.svg');

    it('allows links inside the workspace', () => {
        const result = resolveRelativeSvgLink(svgPath, '../README.md', workspace);
        assert.equal(result.ok, true);
        assert.equal(result.targetPath, path.join(workspace, 'README.md'));
    });

    it('blocks absolute filesystem paths when blockAbsolutePaths is enabled', () => {
        const result = resolveRelativeSvgLink(svgPath, '/etc/passwd', workspace, true);
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'absolute-path');
        assert.equal(result.urlPath, '/etc/passwd');
    });

    it('allows absolute paths inside the workspace when blockAbsolutePaths is disabled', () => {
        const absoluteInside = path.join(workspace, 'readme.md');
        const result = resolveRelativeSvgLink(svgPath, absoluteInside, workspace, false);
        assert.equal(result.ok, true);
        assert.equal(result.targetPath, absoluteInside);
    });

    it('still blocks absolute paths outside the workspace when blockAbsolutePaths is disabled', () => {
        const result = resolveRelativeSvgLink(svgPath, '/etc/passwd', workspace, false);
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'traversal');
    });

    it('blocks directory traversal outside workspace', () => {
        const result = resolveRelativeSvgLink(svgPath, '../../../etc/passwd', workspace);
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'traversal');
    });

    it('blocks traversal via encoded-looking relative paths', () => {
        const result = resolveRelativeSvgLink(svgPath, '../../outside.txt', workspace);
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'traversal');
    });

    it('uses SVG directory as root when no workspace folder', () => {
        const result = resolveRelativeSvgLink(svgPath, './test-link-matrix.svg', undefined);
        assert.equal(result.ok, true);
        assert.equal(result.targetPath, svgPath);
    });

    it('preserves URL fragments on allowed links', () => {
        const result = resolveRelativeSvgLink(svgPath, '../README.md#features', workspace);
        assert.equal(result.ok, true);
        assert.equal(result.fragment, 'features');
    });
});

describe('script policy', () => {
    const docUri = 'file:///ws/test.svg';

    it('strict never allows scripts', () => {
        assert.equal(getEffectiveAllowScripts('strict', docUri, new Set([docUri])), false);
    });

    it('permissive always allows scripts', () => {
        assert.equal(getEffectiveAllowScripts('permissive', docUri, new Set()), true);
    });

    it('prompt allows only after explicit opt-in', () => {
        assert.equal(getEffectiveAllowScripts('prompt', docUri, new Set()), false);
        assert.equal(getEffectiveAllowScripts('prompt', docUri, new Set([docUri])), true);
    });

    it('omits unsafe-inline from CSP when scripts are disallowed', () => {
        assert.equal(buildScriptCsp(false, 'vscode-webview://abc'), 'vscode-webview://abc');
        assert.equal(
            buildScriptCsp(true, 'vscode-webview://abc'),
            "'unsafe-inline' vscode-webview://abc"
        );
    });

    it('detects embedded script tags in SVG source', () => {
        assert.equal(svgContainsScriptTag('<svg><script>alert(1)</script></svg>'), true);
        assert.equal(svgContainsScriptTag('<svg><rect/></svg>'), false);
    });
});

describe('external link policy', () => {
    it('blocks http/https when policy is block (default)', () => {
        assert.equal(shouldBlockExternalLink('block'), true);
        assert.equal(shouldBlockExternalLink('openExternal'), false);
    });
});

describe('scheme link policy', () => {
    it('blocks scheme links when blockSchemeLinks is enabled (default)', () => {
        assert.equal(shouldBlockSchemeLinks(true), true);
        assert.equal(shouldBlockSchemeLinks(false), false);
    });
});

describe('http external URL canonicalization', () => {
    it('accepts http and https URLs', () => {
        assert.deepEqual(canonicalizeHttpExternalHref('https://google.com'), {
            ok: true,
            href: 'https://google.com/',
        });
        assert.deepEqual(canonicalizeHttpExternalHref('http://example.com/path?q=1'), {
            ok: true,
            href: 'http://example.com/path?q=1',
        });
    });

    it('rejects non-http schemes', () => {
        assert.equal(canonicalizeHttpExternalHref('vscode://command/foo').ok, false);
        assert.equal(canonicalizeHttpExternalHref('file:///etc/passwd').ok, false);
    });

    it('rejects malformed URLs', () => {
        assert.equal(canonicalizeHttpExternalHref('not a url').ok, false);
    });
});

describe('link matrix security outcomes', () => {
    const workspace = '/home/user/project';
    const matrixSvg = path.join(workspace, 'test-vectors', 'test-link-matrix.svg');

    it('vector 1: vscode:// is a scheme link (blocked when blockSchemeLinks is true)', () => {
        const href =
            'vscode://command/workbench.action.terminal.sendSequence?%5B%7B%22text%22%3A%22touch%20%2Ftmp%2Fpwned_by_vscode_uri%5Cn%22%7D%5D';
        assert.equal(classifyHref(href), 'scheme');
        assert.equal(isNonHttpSchemeHref(href), true);
        assert.equal(shouldBlockSchemeLinks(true), true);
    });

    it('vector 2: http link is intercepted by extension (http)', () => {
        assert.equal(classifyHref('http://example.com/&calc.exe'), 'http');
    });

    it('vector 3: /etc/passwd is blocked by absolute-path guard (default)', () => {
        const result = resolveRelativeSvgLink(matrixSvg, '/etc/passwd', workspace);
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'absolute-path');
    });
});
