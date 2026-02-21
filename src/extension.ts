import * as vscode from 'vscode';
import { exportActiveMarkdown } from './exporter';

// EN: Register extension commands and wire each command to export entry points.
// JA: 拡張コマンドを登録し、各コマンドをエクスポート処理へ接続します。
export function activate(context: vscode.ExtensionContext): void {
    // EN: Main command with interactive export format selection.
    // JA: 出力形式を対話的に選べるメインコマンドです。
    const exportCommand = vscode.commands.registerCommand('documenticMarkdown.export', async () => {
        await exportActiveMarkdown(context);
    });

    // EN: Direct command for batch PNG export of diagram and math blocks.
    // JA: 図・数式ブロックをPNGで一括出力する直接コマンドです。
    const exportDiagramPngsCommand = vscode.commands.registerCommand('documenticMarkdown.exportDiagramBlocksPng', async () => {
        await exportActiveMarkdown(context, 'diagram-pngs');
    });

    // EN: Direct command for batch SVG export of diagram and math blocks.
    // JA: 図・数式ブロックをSVGで一括出力する直接コマンドです。
    const exportDiagramSvgsCommand = vscode.commands.registerCommand('documenticMarkdown.exportDiagramBlocksSvg', async () => {
        await exportActiveMarkdown(context, 'diagram-svgs');
    });

    context.subscriptions.push(exportCommand, exportDiagramPngsCommand, exportDiagramSvgsCommand);
}

// EN: Reserved deactivation hook.
// JA: 将来拡張用の無効化フックです。
export function deactivate(): void {
}
