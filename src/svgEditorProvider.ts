import * as vscode from 'vscode';
import {
    buildScriptCsp,
    classifyHref,
    evaluateSchemeLink,
    getEffectiveAllowScripts as computeAllowScripts,
    getEffectiveBlockAbsolutePaths,
    getEffectiveExternalLinkPolicy,
    getEffectiveScriptPolicy,
    isNonHttpSchemeHref,
    resolveRelativeSvgLink,
    shouldBlockExternalLink,
    svgContainsScriptTag,
    verifyResolvedPathInWorkspace,
} from './linkSecurity';
import { openHttpExternalHref } from './openExternalBrowser';
import { openSchemeHref } from './openSchemeLink';

const CONFIG_SECTION = 'clickableSvg' as const;
const KEY_SCRIPT_POLICY = 'scriptPolicy' as const;
const KEY_EXTERNAL_LINK_POLICY = 'externalLinkPolicy' as const;
const KEY_BLOCK_ABSOLUTE_PATHS = 'blockAbsolutePaths' as const;
const KEY_BLOCK_SCHEME_LINKS = 'blockSchemeLinks' as const;

const MSG_OPEN_LINK = 'openLink' as const;
const MSG_OPEN_EXTERNAL_LINK = 'openExternalLink' as const;
const MSG_SCHEME_LINK = 'schemeLink' as const;
const MSG_REQUEST_ALLOW_SCRIPTS = 'requestAllowScripts' as const;

type ScriptPolicy = 'strict' | 'prompt' | 'permissive';
type ExternalLinkPolicy = 'block' | 'openExternal';

const SCRIPT_POLICIES: readonly ScriptPolicy[] = ['strict', 'prompt', 'permissive'];
const EXTERNAL_LINK_POLICIES: readonly ExternalLinkPolicy[] = ['block', 'openExternal'];

function isWorkspaceTrusted(): boolean {
    return vscode.workspace.isTrusted;
}

function readScriptPolicy(): ScriptPolicy {
    const raw = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(KEY_SCRIPT_POLICY);
    return SCRIPT_POLICIES.includes(raw as ScriptPolicy) ? (raw as ScriptPolicy) : 'prompt';
}

function readExternalLinkPolicy(): ExternalLinkPolicy {
    const raw = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(KEY_EXTERNAL_LINK_POLICY);
    return EXTERNAL_LINK_POLICIES.includes(raw as ExternalLinkPolicy) ? (raw as ExternalLinkPolicy) : 'block';
}

function readBlockAbsolutePaths(): boolean {
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(KEY_BLOCK_ABSOLUTE_PATHS, true);
}

function readBlockSchemeLinks(): boolean {
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(KEY_BLOCK_SCHEME_LINKS, true);
}

function effectiveScriptPolicy(): ScriptPolicy {
    return getEffectiveScriptPolicy(readScriptPolicy(), isWorkspaceTrusted());
}

function effectiveExternalLinkPolicy(): ExternalLinkPolicy {
    return getEffectiveExternalLinkPolicy(readExternalLinkPolicy(), isWorkspaceTrusted());
}

function effectiveBlockAbsolutePaths(): boolean {
    return getEffectiveBlockAbsolutePaths(readBlockAbsolutePaths(), isWorkspaceTrusted());
}

function schemeLinkWarningMessage(href: string, reason: string): string {
    switch (reason) {
        case 'untrusted-workspace':
            return `URI scheme links are blocked in Restricted Mode: ${href}`;
        case 'dangerous-scheme':
            return `This URI scheme is never allowed in SVG previews (vscode://, command://): ${href}`;
        case 'not-allowlisted':
            return `URI scheme not on the allowlist (file, mailto, tel): ${href}`;
        default:
            return `URI scheme links are blocked in SVG previews: ${href}`;
    }
}

export class SvgCustomEditorProvider implements vscode.CustomReadonlyEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new SvgCustomEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            SvgCustomEditorProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                }
            }
        );
        return providerRegistration;
    }

    private static readonly viewType = 'clickableSvg.svgEditor';

    /** Per-document opt-in when scriptPolicy is `prompt` (cleared when the editor tab closes). */
    private allowedScripts = new Set<string>();

    constructor(
        private readonly context: vscode.ExtensionContext
    ) {
        context.subscriptions.push(
            vscode.commands.registerCommand('clickableSvg.allowScripts', (uri?: vscode.Uri) => {
                if (uri) {
                    this.allowedScripts.add(uri.toString());
                    const panel = this.panels.get(uri.toString());
                    if (panel) {
                        void this.updateWebview(panel, uri);
                    }
                }
            })
        );

        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (!e.affectsConfiguration(CONFIG_SECTION)) {
                    return;
                }
                this.refreshAllPanels();
            })
        );

        context.subscriptions.push(
            vscode.workspace.onDidGrantWorkspaceTrust(() => {
                this.refreshAllPanels();
            })
        );
    }

    private panels = new Map<string, vscode.WebviewPanel>();

    private refreshAllPanels(): void {
        for (const [uriStr, panel] of this.panels) {
            void this.updateWebview(panel, vscode.Uri.parse(uriStr));
        }
    }

    private getEffectiveAllowScripts(uri: vscode.Uri): boolean {
        return computeAllowScripts(effectiveScriptPolicy(), uri.toString(), this.allowedScripts);
    }

    public async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media')
            ]
        };

        const documentKey = document.uri.toString();
        this.panels.set(documentKey, webviewPanel);

        webviewPanel.onDidDispose(() => {
            this.panels.delete(documentKey);
            this.allowedScripts.delete(documentKey);
        });

        webviewPanel.webview.onDidReceiveMessage(e => {
            switch (e.command) {
                case MSG_OPEN_LINK:
                    void this.handleOpenLink(document.uri, e.href);
                    return;
                case MSG_OPEN_EXTERNAL_LINK:
                    this.handleExternalLink(e.href);
                    return;
                case MSG_SCHEME_LINK:
                    this.handleSchemeLink(e.href);
                    return;
                case MSG_REQUEST_ALLOW_SCRIPTS:
                    if (effectiveScriptPolicy() !== 'prompt') {
                        return;
                    }
                    vscode.window.showWarningMessage(
                        'This SVG contains scripts. Do you want to allow them to run?',
                        'Allow Scripts'
                    ).then(selection => {
                        if (selection === 'Allow Scripts') {
                            void vscode.commands.executeCommand('clickableSvg.allowScripts', document.uri);
                        }
                    });
                    return;
            }
        });

        await this.updateWebview(webviewPanel, document.uri);
    }

    private async updateWebview(webviewPanel: vscode.WebviewPanel, uri: vscode.Uri) {
        try {
            const documentData = await vscode.workspace.fs.readFile(uri);
            const svgContent = Buffer.from(documentData).toString('utf8');
            webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, svgContent, uri);
        } catch (e) {
            webviewPanel.webview.html = `<!DOCTYPE html><html><body>Error loading SVG</body></html>`;
        }
    }

    private handleSchemeLink(href: string) {
        if (!href) {
            return;
        }

        const decision = evaluateSchemeLink(href, readBlockSchemeLinks(), isWorkspaceTrusted());
        if (decision.action === 'block') {
            void vscode.window.showWarningMessage(
                schemeLinkWarningMessage(href, decision.reason)
            );
            return;
        }

        setImmediate(() => {
            const result = openSchemeHref(href, readBlockSchemeLinks(), isWorkspaceTrusted());
            if (result === 'invalid') {
                void vscode.window.showErrorMessage(`Could not open scheme link: ${href}`);
            }
        });
    }

    private handleExternalLink(href: string) {
        if (!href) return;

        if (shouldBlockExternalLink(effectiveExternalLinkPolicy())) {
            const suffix = isWorkspaceTrusted() ? '' : ' (Restricted Mode)';
            void vscode.window.showWarningMessage(`External link blocked${suffix}: ${href}`);
            return;
        }

        setImmediate(() => {
            const result = openHttpExternalHref(href);
            if (result === 'invalid-url') {
                void vscode.window.showErrorMessage(`Could not open external link: ${href}`);
                return;
            }
            if (result === 'spawn-failed') {
                void vscode.window.showErrorMessage(`Could not launch browser for: ${href}`);
            }
        });
    }

    private async handleOpenLink(documentUri: vscode.Uri, href: string) {
        if (!href) return;

        if (isNonHttpSchemeHref(href)) {
            this.handleSchemeLink(href);
            return;
        }

        if (classifyHref(href) === 'http') {
            this.handleExternalLink(href);
            return;
        }

        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
            const workspaceRoot = workspaceFolder?.uri.fsPath;
            const result = resolveRelativeSvgLink(
                documentUri.fsPath,
                href,
                workspaceRoot,
                effectiveBlockAbsolutePaths()
            );

            if (!result.ok) {
                if (result.reason === 'absolute-path') {
                    void vscode.window.showErrorMessage(
                        `Malicious link detected: Absolute paths are not allowed in SVG links (${result.urlPath}).`
                    );
                } else {
                    void vscode.window.showErrorMessage(
                        `Malicious link detected: Directory traversal outside workspace is blocked (${result.urlPath}).`
                    );
                }
                return;
            }

            const verified = await verifyResolvedPathInWorkspace(result.targetPath, workspaceRoot);
            if (!verified.ok) {
                if (verified.reason === 'symlink-escape') {
                    void vscode.window.showErrorMessage(
                        `Malicious link detected: Symlink target outside workspace is blocked (${href}).`
                    );
                } else {
                    void vscode.window.showErrorMessage(`Failed to open link (path not found): ${href}`);
                }
                return;
            }

            let targetUri = vscode.Uri.file(verified.resolvedPath);
            if (result.fragment) {
                targetUri = targetUri.with({ fragment: result.fragment });
            }

            void vscode.commands.executeCommand('vscode.open', targetUri);
        } catch {
            void vscode.window.showErrorMessage(`Failed to open link: ${href}`);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview, svgContent: string, uri: vscode.Uri): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
        const panzoomUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'panzoom.min.js'));

        const scriptPolicy = effectiveScriptPolicy();
        const allowScriptsEffective = this.getEffectiveAllowScripts(uri);

        const scriptCsp = buildScriptCsp(allowScriptsEffective, webview.cspSource);

        const hasScripts = svgContainsScriptTag(svgContent);

        const encodedSvg = Buffer.from(svgContent).toString('base64');

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${scriptCsp};">
                <style>
                    body {
                        margin: 0;
                        padding: 0;
                        width: 100vw;
                        height: 100vh;
                        overflow: hidden;
                        background-color: var(--vscode-editor-background);
                        display: flex;
                        justify-content: center;
                        align-items: center;
                    }
                    #svg-container {
                        width: 100%;
                        height: 100%;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                    }
                    /* Wrap SVG in HTML so Panzoom uses transform-origin that matches focal zoom math */
                    .panzoom-stage {
                        width: 100%;
                        height: 100%;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                    }
                    .panzoom-stage svg {
                        max-width: 100%;
                        max-height: 100%;
                        display: block;
                    }
                    .controls {
                        position: fixed;
                        bottom: 20px;
                        right: 20px;
                        display: flex;
                        gap: 10px;
                        z-index: 1000;
                    }
                    button {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 5px 10px;
                        cursor: pointer;
                        border-radius: 2px;
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div id="svg-container" data-script-policy="${scriptPolicy}" data-has-scripts="${hasScripts}" data-allow-scripts="${allowScriptsEffective}">
                    <div class="panzoom-stage" id="stage" data-svg="${encodedSvg}"></div>
                </div>
                <div class="controls">
                    <button id="zoom-in">+</button>
                    <button id="zoom-out">-</button>
                    <button id="zoom-reset">Reset</button>
                </div>
                <script src="${panzoomUri}"></script>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }
}
