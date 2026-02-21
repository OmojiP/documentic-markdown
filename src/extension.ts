import * as vscode from 'vscode';
import { exportActiveMarkdown } from './exporter';

export function activate(context: vscode.ExtensionContext): void {
    const exportCommand = vscode.commands.registerCommand('documenticMarkdown.export', async () => {
        await exportActiveMarkdown(context);
    });

    const exportDiagramPngsCommand = vscode.commands.registerCommand('documenticMarkdown.exportDiagramBlocksPng', async () => {
        await exportActiveMarkdown(context, 'diagram-pngs');
    });

    const exportDiagramSvgsCommand = vscode.commands.registerCommand('documenticMarkdown.exportDiagramBlocksSvg', async () => {
        await exportActiveMarkdown(context, 'diagram-svgs');
    });

    const legacyPdfCommand = vscode.commands.registerCommand('documenticMarkdown.exportToPdf', async () => {
        await exportActiveMarkdown(context, 'pdf');
    });

    context.subscriptions.push(exportCommand, exportDiagramPngsCommand, exportDiagramSvgsCommand, legacyPdfCommand);
}

export function deactivate(): void {
}
