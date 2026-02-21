import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { buildHtmlDocument, collectKrokiSvgs, createMarkdownRenderer } from './rendering';

export type ExportFormat = 'pdf' | 'html' | 'png' | 'diagram-pngs' | 'diagram-svgs';
type PngQualityPreset = 'low' | 'medium' | 'high';

const execFileAsync = promisify(execFile);

function normalizeDisplayMathBlocks(markdown: string): string {
    const lines = markdown.split(/\r?\n/);
    const output: string[] = [];

    let inCodeFence = false;
    let inMathBlock = false;
    let mathLines: string[] = [];

    for (const line of lines) {
        if (!inMathBlock && /^```/.test(line.trim())) {
            inCodeFence = !inCodeFence;
            output.push(line);
            continue;
        }

        if (inCodeFence) {
            output.push(line);
            continue;
        }

        const trimmed = line.trim();

        if (!inMathBlock) {
            const oneLine = trimmed.match(/^\$\$(.+)\$\$$/);
            if (oneLine) {
                output.push('```tex');
                output.push(oneLine[1].trim());
                output.push('```');
                continue;
            }

            if (trimmed === '$$') {
                inMathBlock = true;
                mathLines = [];
                continue;
            }

            output.push(line);
            continue;
        }

        if (trimmed === '$$') {
            output.push('```tex');
            output.push(mathLines.join('\n'));
            output.push('```');
            inMathBlock = false;
            mathLines = [];
            continue;
        }

        mathLines.push(line);
    }

    if (inMathBlock) {
        output.push('$$');
        output.push(...mathLines);
    }

    return output.join('\n');
}

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
            { label: 'PNG', value: 'png' as const },
            { label: '図ブロックPNG一括（フォルダ）', value: 'diagram-pngs' as const },
            { label: '図ブロックSVG一括（フォルダ）', value: 'diagram-svgs' as const }
        ],
        {
            title: '出力形式を選択',
            placeHolder: 'PDF / HTML / PNG / 図ブロックPNG一括 / 図ブロックSVG一括'
        }
    );

    return picked?.value;
}

async function chooseOutputPath(currentFile: vscode.Uri, format: ExportFormat): Promise<vscode.Uri | undefined> {
    if (format === 'diagram-pngs' || format === 'diagram-svgs') {
        const selected = await vscode.window.showOpenDialog({
            title: '保存先フォルダを選択',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: vscode.Uri.file(path.dirname(currentFile.fsPath))
        });

        return selected?.[0];
    }

    const titleMap: Record<ExportFormat, string> = {
        pdf: 'PDFの保存先を選択',
        html: 'HTMLの保存先を選択',
        png: 'PNGの保存先を選択',
        'diagram-pngs': '保存先フォルダを選択',
        'diagram-svgs': '保存先フォルダを選択'
    };

    const filterMap: Record<ExportFormat, Record<string, string[]>> = {
        pdf: { PDF: ['pdf'] },
        html: { HTML: ['html'] },
        png: { PNG: ['png'] },
        'diagram-pngs': {},
        'diagram-svgs': {}
    };

    return vscode.window.showSaveDialog({
        title: titleMap[format],
        defaultUri: getDefaultOutputUri(currentFile, format),
        filters: filterMap[format]
    });
}

async function ensureCreatedDiagramOutputDir(baseDir: string, markdownFilePath: string, suffixName: string): Promise<string> {
    const baseName = path.parse(markdownFilePath).name;
    const rootName = `${baseName}-${suffixName}`;

    for (let attempt = 0; attempt < 1000; attempt += 1) {
        const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
        const candidate = path.join(baseDir, `${rootName}${suffix}`);

        try {
            await fs.mkdir(candidate);
            return candidate;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw error;
            }
        }
    }

    throw new Error('図ブロック保存フォルダを作成できませんでした。');
}

function normalizePngQualityScale(value: number): number {
    if (!Number.isFinite(value)) {
        return 1;
    }
    return Math.min(4, Math.max(1, Math.round(value)));
}

function resolvePngQualityScale(config: vscode.WorkspaceConfiguration): number {
    const preset = config.get<PngQualityPreset>('pngQuality');
    if (preset === 'low') {
        return 1;
    }
    if (preset === 'medium') {
        return 2;
    }
    if (preset === 'high') {
        return 3;
    }

    return normalizePngQualityScale(config.get<number>('pngQualityScale', 1));
}

async function applyPngQualityScale(page: Page, scale: number): Promise<void> {
    const currentViewport = page.viewport() ?? { width: 1280, height: 720, deviceScaleFactor: 1 };
    await page.setViewport({
        width: currentViewport.width,
        height: currentViewport.height,
        deviceScaleFactor: scale
    });
}

async function exportWholePageAsPng(page: Page, outputPath: string): Promise<number> {
    try {
        const layout = await page.evaluate(() => {
            const root = document.documentElement;
            const body = document.body;
            const width = Math.max(root.scrollWidth, root.clientWidth, body?.scrollWidth ?? 0);
            const height = Math.max(root.scrollHeight, root.clientHeight, body?.scrollHeight ?? 0);
            return {
                width: Math.ceil(width),
                height: Math.ceil(height)
            };
        });

        const currentViewport = page.viewport() ?? { width: 1280, height: 720, deviceScaleFactor: 1 };
        const targetWidth = Math.max(currentViewport.width, layout.width);
        const segmentHeight = Math.min(2000, Math.max(800, currentViewport.height));
        const requestedScale = currentViewport.deviceScaleFactor || 1;
        const maxSafeDimension = 32000;
        const maxScaleByWidth = Math.max(1, Math.floor(maxSafeDimension / Math.max(1, layout.width)));
        const maxScaleByHeight = Math.max(1, Math.floor(maxSafeDimension / Math.max(1, layout.height)));
        const deviceScaleFactor = Math.max(1, Math.min(requestedScale, maxScaleByWidth, maxScaleByHeight));
        await page.setViewport({
            width: targetWidth,
            height: segmentHeight,
            deviceScaleFactor
        });

        await page.evaluate(() => window.scrollTo(0, 0));
        const captures: Array<{ y: number; image: PNG }> = [];
        let previousY = -1;
        let nextY = 0;

        for (let guard = 0; guard < 2000; guard += 1) {
            await page.evaluate((scrollY) => {
                window.scrollTo(0, scrollY);
            }, nextY);
            await new Promise((resolve) => setTimeout(resolve, 40));

            const actualY = await page.evaluate(() => Math.round(window.scrollY));
            if (actualY === previousY) {
                break;
            }

            const chunk = await page.screenshot({
                type: 'png'
            });

            const chunkBuffer = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk);
            captures.push({ y: actualY, image: PNG.sync.read(chunkBuffer) });

            previousY = actualY;
            if (actualY + segmentHeight >= layout.height - 1) {
                break;
            }
            nextY = actualY + segmentHeight;
        }

        if (captures.length === 0) {
            throw new Error('PNG画像の生成に失敗しました。');
        }

        const stitchedWidth = Math.max(...captures.map((item) => item.image.width));
        const stitchedHeight = Math.max(1, Math.round(layout.height * deviceScaleFactor));
        const stitched = new PNG({ width: stitchedWidth, height: stitchedHeight });

        for (const capture of captures) {
            const offsetY = Math.round(capture.y * deviceScaleFactor);
            const writableHeight = Math.max(0, Math.min(capture.image.height, stitched.height - offsetY));
            if (writableHeight <= 0) {
                continue;
            }

            PNG.bitblt(capture.image, stitched, 0, 0, capture.image.width, writableHeight, 0, offsetY);
        }

        await fs.writeFile(outputPath, PNG.sync.write(stitched));
        return deviceScaleFactor;
    } catch (chunkError) {
        try {
            await page.screenshot({
                path: outputPath,
                fullPage: true,
                type: 'png'
            });
            return page.viewport()?.deviceScaleFactor || 1;
        } catch (fallbackError) {
            const first = chunkError instanceof Error ? chunkError.message : String(chunkError);
            const second = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            throw new Error(`PNG画像の生成に失敗しました（分割撮影: ${first} / fullPageフォールバック: ${second}）`);
        }
    }
}

async function exportDiagramBlocksAsPng(page: Page, outputDir: string): Promise<number> {
    await fs.mkdir(outputDir, { recursive: true });

    const handles = await page.$$('.mermaid svg, .kroki-svg svg, .math-block svg');
    let savedCount = 0;

    for (let index = 0; index < handles.length; index += 1) {
        const handle = handles[index];
        try {
            const name = `diagram-${String(index + 1).padStart(3, '0')}.png`;
            const filePath = path.join(outputDir, name);
            await handle.screenshot({ path: filePath, type: 'png' });
            savedCount += 1;
        } catch {
        } finally {
            await handle.dispose();
        }
    }

    return savedCount;
}

async function exportDiagramBlocksAsSvg(page: Page, outputDir: string): Promise<number> {
    await fs.mkdir(outputDir, { recursive: true });

    const svgSources = await page.evaluate(() => {
        const svgNs = 'http://www.w3.org/2000/svg';
        const globalCache = document.querySelector<SVGElement>('#MJX-SVG-global-cache');
        const globalDefs = globalCache?.querySelector('defs')?.innerHTML ?? '';
        const targets = document.querySelectorAll<SVGSVGElement>('.mermaid svg, .kroki-svg svg, .math-block svg');
        return Array.from(targets).map((svg) => {
            const cloned = svg.cloneNode(true) as SVGSVGElement;
            const isMathSvg = Boolean(svg.closest('.math-block'));

            if (!cloned.getAttribute('xmlns')) {
                cloned.setAttribute('xmlns', svgNs);
            }
            if (!cloned.getAttribute('xmlns:xlink')) {
                cloned.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
            }

            if (isMathSvg && globalDefs) {
                const hasMathRef = /(?:xlink:href|href)="#MJX-/.test(cloned.outerHTML);
                if (hasMathRef) {
                    let defs = cloned.querySelector('defs');
                    if (!defs) {
                        defs = document.createElementNS(svgNs, 'defs');
                        cloned.insertBefore(defs, cloned.firstChild);
                    }
                    defs.insertAdjacentHTML('beforeend', globalDefs);
                }
            }

            return cloned.outerHTML;
        });
    });

    let savedCount = 0;
    for (let index = 0; index < svgSources.length; index += 1) {
        const source = svgSources[index];
        try {
            const name = `diagram-${String(index + 1).padStart(3, '0')}.svg`;
            const filePath = path.join(outputDir, name);
            await fs.writeFile(filePath, source, 'utf8');
            savedCount += 1;
        } catch {
        }
    }

    return savedCount;
}

async function openRenderedPage(
    tempHtmlPath: string,
    renderTimeoutMilliSecond: number
): Promise<{ browser: Browser; page: Page; renderErrors: string[] }> {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`file:///${tempHtmlPath.replace(/\\/g, '/')}`, {
        waitUntil: 'networkidle0'
    });

    await page.waitForFunction('window.__MERMAID_RENDER_DONE__ === true && window.__MATH_RENDER_DONE__ === true', {
        timeout: renderTimeoutMilliSecond
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
    let outputUriToOpen = targetUri;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Documentic: ${format.toUpperCase()} を出力中...`,
            cancellable: false
        },
        async (progress) => {
            const markdownText = normalizeDisplayMathBlocks(editor.document.getText());
            const config = vscode.workspace.getConfiguration('documenticMarkdown');
            const includeUml = config.get<boolean>('includeUml', true);
            const includeKroki = config.get<boolean>('includeKroki', true);
            const pdfFormat = config.get<'A4' | 'Letter'>('pdfFormat', 'A4');
            const pngQualityScale = resolvePngQualityScale(config);
            const configuredTimeout = config.get<number>('renderTimeoutMilliSecond', config.get<number>('renderTimeoutMs', 10000));
            const renderTimeoutMilliSecond = Math.max(1000, configuredTimeout);

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
                const opened = await openRenderedPage(tempHtmlPath, renderTimeoutMilliSecond);
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
                await openOutputIfEnabled(outputUriToOpen, format);

                if (renderErrors.length > 0) {
                    vscode.window.showWarningMessage(`一部の図/数式の描画に失敗しました: ${renderErrors.join(' | ')}`);
                }
            }
        }
    );
}
