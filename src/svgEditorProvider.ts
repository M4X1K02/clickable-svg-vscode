import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';

const CONFIG_SECTION = 'clickableSvg' as const;
const KEY_SCRIPT_POLICY = 'scriptPolicy' as const;
const KEY_EXTERNAL_LINK_POLICY = 'externalLinkPolicy' as const;

type ScriptPolicy = 'strict' | 'prompt' | 'permissive';
type ExternalLinkPolicy = 'block' | 'openExternal';

const SCRIPT_POLICIES: readonly ScriptPolicy[] = ['strict', 'prompt', 'permissive'];
const EXTERNAL_LINK_POLICIES: readonly ExternalLinkPolicy[] = ['block', 'openExternal'];

/**
 * Open http(s) URLs via a detached OS process. On some Linux/Cursor builds,
 * `vscode.env.openExternal` never settles and can wedge the extension host.
 */
function openExternalHttpDetached(canonicalHref: string): void {
    if (process.platform === 'win32') {
        spawn('cmd', ['/c', 'start', '', canonicalHref], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
        spawn('open', [canonicalHref], { detached: true, stdio: 'ignore' }).unref();
    } else {
        spawn('xdg-open', [canonicalHref], { detached: true, stdio: 'ignore' }).unref();
    }
}

function readScriptPolicy(): ScriptPolicy {
    const raw = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(KEY_SCRIPT_POLICY);
    return SCRIPT_POLICIES.includes(raw as ScriptPolicy) ? (raw as ScriptPolicy) : 'prompt';
}

function readExternalLinkPolicy(): ExternalLinkPolicy {
    const raw = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(KEY_EXTERNAL_LINK_POLICY);
    return EXTERNAL_LINK_POLICIES.includes(raw as ExternalLinkPolicy)
        ? (raw as ExternalLinkPolicy)
        : 'block';
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

    /** Per-document opt-in when scriptPolicy is `prompt` */
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
                for (const [uriStr, panel] of this.panels) {
                    void this.updateWebview(panel, vscode.Uri.parse(uriStr));
                }
            })
        );
    }

    private panels = new Map<string, vscode.WebviewPanel>();

    private getEffectiveAllowScripts(uri: vscode.Uri): boolean {
        const policy = readScriptPolicy();
        if (policy === 'permissive') {
            return true;
        }
        if (policy === 'strict') {
            return false;
        }
        return this.allowedScripts.has(uri.toString());
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

        this.panels.set(document.uri.toString(), webviewPanel);

        webviewPanel.onDidDispose(() => {
            this.panels.delete(document.uri.toString());
        });

        webviewPanel.webview.onDidReceiveMessage(e => {
            switch (e.command) {
                case 'openLink':
                    this.handleOpenLink(document.uri, e.href);
                    return;
                case 'requestAllowScripts':
                    if (readScriptPolicy() !== 'prompt') {
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

    private handleOpenLink(documentUri: vscode.Uri, href: string) {
        if (!href) return;

        if (href.startsWith('http://') || href.startsWith('https://')) {
            const policy = readExternalLinkPolicy();
            if (policy === 'block') {
                void vscode.window.showWarningMessage(`External link blocked: ${href}`);
                return;
            }
            let canonicalHref: string;
            try {
                const u = new URL(href);
                if (u.protocol !== 'http:' && u.protocol !== 'https:') {
                    void vscode.window.showErrorMessage(`Unsupported external URL scheme: ${href}`);
                    return;
                }
                canonicalHref = u.href;
            } catch {
                void vscode.window.showErrorMessage(`Could not open external link: ${href}`);
                return;
            }

            void Promise.resolve().then(() => {
                try {
                    openExternalHttpDetached(canonicalHref);
                } catch {
                    void vscode.window.showErrorMessage(`Could not launch browser for: ${canonicalHref}`);
                }
            });
            return;
        }

        try {
            let targetUri: vscode.Uri;

            if (href.startsWith('vscode://')) {
                targetUri = vscode.Uri.parse(href);
            } else {
                const [urlPath, fragment] = href.split('#');

                const dir = path.dirname(documentUri.fsPath);
                const targetPath = path.resolve(dir, urlPath);
                targetUri = vscode.Uri.file(targetPath);

                if (fragment) {
                    targetUri = targetUri.with({ fragment });
                }
            }

            void vscode.commands.executeCommand('vscode.open', targetUri);
        } catch (e) {
            void vscode.window.showErrorMessage(`Failed to open link: ${href}`);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview, svgContent: string, uri: vscode.Uri): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
        const panzoomUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'panzoom.min.js'));

        const scriptPolicy = readScriptPolicy();
        const allowScriptsEffective = this.getEffectiveAllowScripts(uri);

        const scriptCsp = allowScriptsEffective ? `'unsafe-inline' ${webview.cspSource}` : webview.cspSource;

        const hasScripts = svgContent.includes('<script');

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
                    <div class="panzoom-stage">${svgContent}</div>
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
