import * as vscode from 'vscode';
import { exportActiveMarkdown } from './exporter';

export function activate(context: vscode.ExtensionContext): void {
    const exportCommand = vscode.commands.registerCommand('documenticMarkdown.export', async () => {
        await exportActiveMarkdown(context);
    });

    const legacyPdfCommand = vscode.commands.registerCommand('documenticMarkdown.exportToPdf', async () => {
        await exportActiveMarkdown(context, 'pdf');
    });

    context.subscriptions.push(exportCommand, legacyPdfCommand);
}

export function deactivate(): void {
}
