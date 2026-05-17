import * as vscode from 'vscode';
import { SvgCustomEditorProvider } from './svgEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(SvgCustomEditorProvider.register(context));
}

export function deactivate() {}
