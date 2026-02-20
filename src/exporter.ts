import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { buildHtmlDocument, collectKrokiSvgs, createMarkdownRenderer } from './rendering';

export type ExportFormat = 'pdf' | 'html' | 'png';

const execFileAsync = promisify(execFile);

function getDefaultOutputUri(inputUri: vscode.Uri, format: ExportFormat): vscode.Uri {
    const ext = `.${format}`;
    const outputPath = inputUri.path.replace(/\.(md|markdown)$/i, ext);
    if (outputPath !== inputUri.path) {
        return inputUri.with({ path: outputPath });
    }
    return inputUri.with({ path: `${inputUri.path}${ext}` });
}

async function chooseExportFormat(forced?: ExportFormat): Promise<ExportFormat | undefined> {
    if (forced) {
        return forced;
    }

    const picked = await vscode.window.showQuickPick(
        [
            { label: 'PDF', value: 'pdf' as const },
            { label: 'HTML', value: 'html' as const },
            { label: 'PNG', value: 'png' as const }
        ],
        {
            title: '出力形式を選択',
            placeHolder: 'PDF / HTML / PNG'
        }
    );

    return picked?.value;
}

async function chooseOutputPath(currentFile: vscode.Uri, format: ExportFormat): Promise<vscode.Uri | undefined> {
    const titleMap: Record<ExportFormat, string> = {
        pdf: 'PDFの保存先を選択',
        html: 'HTMLの保存先を選択',
        png: 'PNGの保存先を選択'
    };

    const filterMap: Record<ExportFormat, Record<string, string[]>> = {
        pdf: { PDF: ['pdf'] },
        html: { HTML: ['html'] },
        png: { PNG: ['png'] }
    };

    return vscode.window.showSaveDialog({
        title: titleMap[format],
        defaultUri: getDefaultOutputUri(currentFile, format),
        filters: filterMap[format]
    });
}

async function openRenderedPage(tempHtmlPath: string): Promise<{ browser: Browser; page: Page; renderErrors: string[] }> {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`file:///${tempHtmlPath.replace(/\\/g, '/')}`, {
        waitUntil: 'networkidle0'
    });

    await page.waitForFunction('window.__MERMAID_RENDER_DONE__ === true && window.__MATH_RENDER_DONE__ === true', {
        timeout: 15000
    });

    const renderErrors = await page.evaluate(() => {
        const errors = (window as Window & { __RENDER_ERRORS__?: unknown }).__RENDER_ERRORS__;
        return Array.isArray(errors) ? errors.map((item) => String(item)) : [];
    });

    return { browser, page, renderErrors };
}

async function openOutputIfEnabled(targetUri: vscode.Uri, format: ExportFormat): Promise<void> {
    const config = vscode.workspace.getConfiguration('documenticMarkdown');
    const shouldOpen = config.get<boolean>('openOutputAfterExport', true);
    if (!shouldOpen) {
        return;
    }

    const normalizedFileUri = vscode.Uri.file(targetUri.fsPath);

    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            await fs.access(targetUri.fsPath);
            break;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 120));
        }
    }

    const fileUrl = pathToFileURL(targetUri.fsPath).toString();
    const openTarget = process.platform === 'win32'
        ? targetUri.fsPath
        : (format === 'png' ? targetUri.fsPath : fileUrl);

    try {
        if (process.platform === 'win32') {
            await execFileAsync('cmd.exe', ['/c', 'start', '', openTarget]);
            return;
        }

        if (process.platform === 'darwin') {
            await execFileAsync('open', [openTarget]);
            return;
        }

        await execFileAsync('xdg-open', [openTarget]);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const fallbackOk = await vscode.env.openExternal(normalizedFileUri);
        if (!fallbackOk) {
            vscode.window.showWarningMessage(`出力ファイルの自動オープンに失敗しました: ${message}`);
        }
    }
}

export async function exportActiveMarkdown(context: vscode.ExtensionContext, forcedFormat?: ExportFormat): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showErrorMessage('Markdownファイルを開いてから実行してください。');
        return;
    }

    const format = await chooseExportFormat(forcedFormat);
    if (!format) {
        return;
    }

    const currentFile = editor.document.uri;
    const targetUri = await chooseOutputPath(currentFile, format);
    if (!targetUri) {
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Documentic: ${format.toUpperCase()} を出力中...`,
            cancellable: false
        },
        async (progress) => {
            const markdownText = editor.document.getText();
            const config = vscode.workspace.getConfiguration('documenticMarkdown');
            const includeUml = config.get<boolean>('includeUml', true);
            const includeKroki = config.get<boolean>('includeKroki', true);
            const pdfFormat = config.get<'A4' | 'Letter'>('pdfFormat', 'A4');

            progress.report({ message: '図を解析しています...', increment: 15 });
            const krokiSvgMap = await collectKrokiSvgs(markdownText, { includeUml, includeKroki });

            progress.report({ message: 'HTMLを生成しています...', increment: 25 });
            const cssPath = path.join(context.extensionPath, 'resources', 'github-markdown.css');
            const css = await fs.readFile(cssPath, 'utf8');
            const md = createMarkdownRenderer();
            const htmlBody = md.render(markdownText, { krokiSvgMap });
            const html = buildHtmlDocument(htmlBody, css);

            if (format === 'html') {
                progress.report({ message: 'HTMLを書き出しています...', increment: 40 });
                await fs.writeFile(targetUri.fsPath, html, 'utf8');
                await openOutputIfEnabled(targetUri, format);
                vscode.window.showInformationMessage(`HTMLを出力しました: ${targetUri.fsPath}`);
                progress.report({ increment: 20 });
                return;
            }

            const tempHtmlPath = path.join(os.tmpdir(), `documentic-markdown-${Date.now()}.html`);
            await fs.writeFile(tempHtmlPath, html, 'utf8');

            let browser: Browser | undefined;
            let renderErrors: string[] = [];
            let exportCompleted = false;
            try {
                progress.report({ message: 'ブラウザ描画を待機しています...', increment: 25 });
                const opened = await openRenderedPage(tempHtmlPath);
                browser = opened.browser;
                renderErrors = opened.renderErrors;

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
                } else {
                    progress.report({ message: 'PNGを書き出しています...', increment: 15 });
                    await opened.page.screenshot({
                        path: targetUri.fsPath,
                        fullPage: true,
                        type: 'png'
                    });
                    vscode.window.showInformationMessage(`PNGを出力しました: ${targetUri.fsPath}`);
                }

                exportCompleted = true;

                progress.report({ increment: 20 });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`出力に失敗しました: ${message}`);
            } finally {
                try {
                    await browser?.close();
                } catch {
                }
                try {
                    await fs.unlink(tempHtmlPath);
                } catch {
                }
            }

            if (exportCompleted) {
                await openOutputIfEnabled(targetUri, format);

                if (renderErrors.length > 0) {
                    vscode.window.showWarningMessage(`一部の図/数式の描画に失敗しました: ${renderErrors.join(' | ')}`);
                }
            }
        }
    );
}
