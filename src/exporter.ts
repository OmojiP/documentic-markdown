import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { type Browser } from 'puppeteer';
import { buildHtmlDocument, collectKrokiSvgs, createMarkdownRenderer } from './rendering';
import {
    type ExportFormat,
    normalizeDisplayMathBlocks,
    chooseExportFormat,
    chooseOutputPath,
    ensureCreatedDiagramOutputDir,
    resolvePngQualityScale,
    applyPngQualityScale,
    exportWholePageAsPng,
    exportDiagramBlocksAsPng,
    exportDiagramBlocksAsSvg,
    openRenderedPage,
    openOutputIfEnabled
} from './export-helpers';

export async function exportActiveMarkdown(context: vscode.ExtensionContext, forcedFormat?: ExportFormat): Promise<void> {
    // EN: Main export orchestration from active editor to target format.
    // JA: アクティブエディタから指定形式へ出力するメイン処理です。
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showErrorMessage('Markdownファイルを開いてから実行してください。');
        return;
    }

    const format = await chooseExportFormat(forcedFormat);
    if (!format) {
        return;
    }

    // EN: Resolve destination file/folder before starting heavy rendering work.
    // JA: 重い描画処理に入る前に保存先（ファイル/フォルダ）を確定します。
    const currentFile = editor.document.uri;
    const targetUri = await chooseOutputPath(currentFile, format);
    if (!targetUri) {
        return;
    }
    let outputUriToOpen = targetUri;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Documentic: ${format.toUpperCase()} を出力中...`,
            cancellable: false
        },
        async (progress) => {
            // EN: Build render inputs based on workspace security/output settings.
            // JA: ワークスペース設定（セキュリティ・出力）をもとに描画入力を構築します。
            const markdownText = normalizeDisplayMathBlocks(editor.document.getText());
            const config = vscode.workspace.getConfiguration('documenticMarkdown');
            const untrustedMarkdownProtection = config.get<boolean>('untrustedMarkdownProtection', true);
            const allowRawHtmlByConfig = config.get<boolean>('allowRawHtml', false);
            const allowRawHtml = !untrustedMarkdownProtection && allowRawHtmlByConfig;
            const allowExternalHttp = !untrustedMarkdownProtection;
            const includeKroki = config.get<boolean>('includeKroki', true);
            const pdfFormat = config.get<'A4' | 'Letter'>('pdfFormat', 'A4');
            const pngQualityScale = resolvePngQualityScale(config);
            const configuredTimeout = config.get<number>('renderTimeoutMilliSecond', config.get<number>('renderTimeoutMs', 10000));
            const renderTimeoutMilliSecond = Math.max(1000, configuredTimeout);
            const mermaidScriptPath = path.join(context.extensionPath, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
            const mathJaxScriptPath = path.join(context.extensionPath, 'node_modules', 'mathjax-full', 'es5', 'tex-svg.js');
            const mermaidScript = await fs.readFile(mermaidScriptPath, 'utf8');
            const mathJaxScript = await fs.readFile(mathJaxScriptPath, 'utf8');

            progress.report({ message: '図を解析しています...', increment: 15 });
            const krokiSvgMap = await collectKrokiSvgs(markdownText, { includeKroki, allowExternalHttp });

            // EN: Build final HTML document that Puppeteer will render.
            // JA: Puppeteerで描画する最終HTMLドキュメントを生成します。
            progress.report({ message: 'HTMLを生成しています...', increment: 25 });
            const cssPath = path.join(context.extensionPath, 'resources', 'github-markdown.css');
            const css = await fs.readFile(cssPath, 'utf8');
            const md = createMarkdownRenderer(allowRawHtml);
            const htmlBody = md.render(markdownText, { krokiSvgMap });
            const html = buildHtmlDocument(htmlBody, css, { mermaidScript, mathJaxScript });

            // EN: HTML export is a fast path and does not require browser rendering.
            // JA: HTML出力はブラウザ描画を必要としないため、この時点で完了できます。
            if (format === 'html') {
                progress.report({ message: 'HTMLを書き出しています...', increment: 40 });
                await fs.writeFile(targetUri.fsPath, html, 'utf8');
                await openOutputIfEnabled(targetUri, format);
                vscode.window.showInformationMessage(`HTMLを出力しました: ${targetUri.fsPath}`);
                progress.report({ increment: 20 });
                return;
            }

            // EN: Other formats use temporary HTML rendered in headless browser.
            // JA: それ以外の形式は一時HTMLをヘッドレスブラウザで描画して出力します。
            const tempHtmlPath = path.join(os.tmpdir(), `documentic-markdown-${Date.now()}.html`);
            await fs.writeFile(tempHtmlPath, html, 'utf8');

            let browser: Browser | undefined;
            let renderErrors: string[] = [];
            let exportCompleted = false;
            try {
                progress.report({ message: 'ブラウザ描画を待機しています...', increment: 25 });
                const opened = await openRenderedPage(tempHtmlPath, renderTimeoutMilliSecond);
                browser = opened.browser;
                renderErrors = opened.renderErrors;

                // EN: Branch export behavior by selected output format.
                // JA: 選択された出力形式ごとに保存処理を分岐します。
                if (format === 'pdf') {
                    progress.report({ message: 'PDFを書き出しています...', increment: 15 });
                    await opened.page.pdf({
                        path: targetUri.fsPath,
                        format: pdfFormat,
                        printBackground: true,
                        margin: {
                            top: '16mm',
                            right: '16mm',
                            bottom: '16mm',
                            left: '16mm'
                        }
                    });
                    vscode.window.showInformationMessage(`PDFを出力しました: ${targetUri.fsPath}`);
                } else if (format === 'png') {
                    progress.report({ message: 'PNGを書き出しています...', increment: 15 });
                    await applyPngQualityScale(opened.page, pngQualityScale);
                    const appliedScale = await exportWholePageAsPng(opened.page, targetUri.fsPath);
                    vscode.window.showInformationMessage(`PNGを出力しました: ${targetUri.fsPath}`);
                    if (appliedScale < pngQualityScale) {
                        vscode.window.showWarningMessage(
                            `画像サイズ上限を超えるためPNG品質を自動調整しました（設定: ${pngQualityScale}x → 適用: ${appliedScale}x）。`
                        );
                    }
                } else if (format === 'diagram-pngs') {
                    progress.report({ message: '図ブロックPNGを保存しています...', increment: 15 });
                    await applyPngQualityScale(opened.page, pngQualityScale);
                    const outputDir = await ensureCreatedDiagramOutputDir(targetUri.fsPath, currentFile.fsPath, 'diagram-pngs');
                    const count = await exportDiagramBlocksAsPng(opened.page, outputDir);
                    outputUriToOpen = vscode.Uri.file(outputDir);
                    vscode.window.showInformationMessage(`図ブロックPNGを保存しました: ${outputDir}（${count}件）`);
                } else {
                    progress.report({ message: '図ブロックSVGを保存しています...', increment: 15 });
                    const outputDir = await ensureCreatedDiagramOutputDir(targetUri.fsPath, currentFile.fsPath, 'diagram-svgs');
                    const count = await exportDiagramBlocksAsSvg(opened.page, outputDir);
                    outputUriToOpen = vscode.Uri.file(outputDir);
                    vscode.window.showInformationMessage(`図ブロックSVGを保存しました: ${outputDir}（${count}件）`);
                }

                exportCompleted = true;

                progress.report({ increment: 20 });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const isTimeout = /Waiting failed:.*ms exceeded|Timed out|timeout/i.test(message);
                if (isTimeout) {
                    vscode.window.showErrorMessage(
                        `出力に失敗しました: 描画待機がタイムアウトしました（現在: ${renderTimeoutMilliSecond} milli second, 設定: documenticMarkdown.renderTimeoutMilliSecond）。詳細: ${message}`
                    );
                } else {
                    vscode.window.showErrorMessage(`出力に失敗しました: ${message}`);
                }
            } finally {
                // EN: Always release browser and temporary HTML file.
                // JA: ブラウザと一時HTMLを必ず解放します。
                try {
                    await browser?.close();
                } catch {
                }
                try {
                    await fs.unlink(tempHtmlPath);
                } catch {
                }
            }

            // EN: Open output and report non-fatal render warnings after successful export.
            // JA: 正常出力後にファイルを開き、非致命な描画警告を通知します。
            if (exportCompleted) {
                await openOutputIfEnabled(outputUriToOpen, format);

                if (renderErrors.length > 0) {
                    vscode.window.showWarningMessage(`一部の図/数式の描画に失敗しました: ${renderErrors.join(' | ')}`);
                }
            }
        }
    );
}
