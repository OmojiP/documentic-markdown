import * as vscode from 'vscode';
import { exportActiveMarkdown } from './exporter';
import { forceReloadCustomCss, getOrLoadCustomCss } from './custom-css';

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

    // EN: Manually re-read the custom CSS file, since it is otherwise cached until the setting value changes.
    // JA: カスタムCSSは設定変更まで内部キャッシュされるため、手動で再読み込みするコマンドです。
    const reloadCustomCssCommand = vscode.commands.registerCommand('documenticMarkdown.reloadCustomCss', async () => {
        const configuredPath = vscode.workspace.getConfiguration('documenticMarkdown').get<string>('customCssPath', '');
        const result = await forceReloadCustomCss(context, configuredPath);
        if (result.warning) {
            vscode.window.showWarningMessage(result.warning);
            return;
        }
        vscode.window.showInformationMessage(
            configuredPath.trim() ? 'カスタムCSSを再読み込みしました。' : 'カスタムCSSは設定されていません。'
        );
    });

    // EN: Pre-warm the custom CSS cache as soon as the path setting changes, surfacing read errors early.
    // JA: パス設定の変更を検知した時点でキャッシュを更新し、読み込みエラーを早期に通知します。
    const configChangeListener = vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (!event.affectsConfiguration('documenticMarkdown.customCssPath')) {
            return;
        }
        const configuredPath = vscode.workspace.getConfiguration('documenticMarkdown').get<string>('customCssPath', '');
        const result = await getOrLoadCustomCss(context, configuredPath);
        if (result.warning) {
            vscode.window.showWarningMessage(result.warning);
            return;
        }
        vscode.window.showInformationMessage(
            configuredPath.trim() ? `カスタムCSSを読み込みました: ${configuredPath}` : 'カスタムCSSの指定を解除しました。'
        );
    });

    context.subscriptions.push(
        exportCommand,
        exportDiagramPngsCommand,
        exportDiagramSvgsCommand,
        reloadCustomCssCommand,
        configChangeListener
    );
}

// EN: Reserved deactivation hook.
// JA: 将来拡張用の無効化フックです。
export function deactivate(): void {
}
