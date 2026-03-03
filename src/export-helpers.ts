import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

export type ExportFormat = 'pdf' | 'html' | 'png' | 'diagram-pngs' | 'diagram-svgs';
export type PngQualityPreset = 'low' | 'medium' | 'high';

const execFileAsync = promisify(execFile);

async function fileExists(filePath: string): Promise<boolean> {
    if (!filePath) {
        return false;
    }
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function collectBrowserCandidates(): string[] {
    const candidates: string[] = [];
    const pushIfDefined = (value: string | undefined): void => {
        if (value) {
            candidates.push(value);
        }
    };

    pushIfDefined(process.env.PUPPETEER_EXECUTABLE_PATH);
    pushIfDefined(process.env.CHROME_PATH);

    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        const programFiles = process.env.PROGRAMFILES;
        const programFilesX86 = process.env['PROGRAMFILES(X86)'];

        pushIfDefined(localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined);
        pushIfDefined(programFiles ? path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined);
        pushIfDefined(programFilesX86 ? path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined);

        pushIfDefined(localAppData ? path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : undefined);
        pushIfDefined(programFiles ? path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : undefined);
        pushIfDefined(programFilesX86 ? path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : undefined);

        return candidates;
    }

    if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
        );
        return candidates;
    }

    candidates.push(
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/microsoft-edge',
        '/snap/bin/chromium'
    );
    return candidates;
}

async function resolveBrowserExecutablePath(): Promise<string> {
    const config = vscode.workspace.getConfiguration('documenticMarkdown');
    const configuredPath = config.get<string>('browserExecutablePath', '').trim();
    if (configuredPath) {
        if (await fileExists(configuredPath)) {
            return configuredPath;
        }
        throw new Error(
            `設定 documenticMarkdown.browserExecutablePath のファイルが見つかりません: ${configuredPath}`
        );
    }

    const candidates = collectBrowserCandidates();
    for (const candidate of candidates) {
        if (await fileExists(candidate)) {
            return candidate;
        }
    }

    throw new Error(
        'Chromium系ブラウザ実行ファイルが見つかりませんでした。' +
        ' Chrome または Edge をインストールするか、設定 documenticMarkdown.browserExecutablePath に実行ファイルの絶対パスを指定してください。'
    );
}

// EN: Convert $$...$$ display math blocks into ```tex code blocks for unified rendering.
// JA: $$...$$ の数式ブロックを ```tex コードブロックに変換し、描画処理を統一します。
export function normalizeDisplayMathBlocks(markdown: string): string {
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

// EN: Ask user which output format to export.
// JA: ユーザーに出力形式を選択してもらいます。
export async function chooseExportFormat(forced?: ExportFormat): Promise<ExportFormat | undefined> {
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

// EN: Ask destination path/folder depending on selected format.
// JA: 出力形式に応じて保存先ファイルまたはフォルダを選択します。
export async function chooseOutputPath(currentFile: vscode.Uri, format: ExportFormat): Promise<vscode.Uri | undefined> {
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

// EN: Create a unique output directory for bulk diagram export.
// JA: 図の一括出力用に重複しないフォルダを作成します。
export async function ensureCreatedDiagramOutputDir(baseDir: string, markdownFilePath: string, suffixName: string): Promise<string> {
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

// EN: Resolve configured PNG quality into numeric scale.
// JA: PNG品質設定を実際の拡大率に解決します。
export function resolvePngQualityScale(config: vscode.WorkspaceConfiguration): number {
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

export async function applyPngQualityScale(page: Page, scale: number): Promise<void> {
    const currentViewport = page.viewport() ?? { width: 1280, height: 720, deviceScaleFactor: 1 };
    await page.setViewport({
        width: currentViewport.width,
        height: currentViewport.height,
        deviceScaleFactor: scale
    });
}

// EN: Export whole page PNG via segmented capture + stitch for long documents.
// JA: 長文書向けに分割キャプチャして縦結合し、1枚のPNGとして出力します。
export async function exportWholePageAsPng(page: Page, outputPath: string): Promise<number> {
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

export async function exportDiagramBlocksAsPng(page: Page, outputDir: string): Promise<number> {
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

// EN: Export each rendered SVG block as a standalone SVG file.
// JA: 描画済みSVGブロックを個別のSVGファイルとして保存します。
export async function exportDiagramBlocksAsSvg(page: Page, outputDir: string): Promise<number> {
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

// EN: Open rendered HTML and wait until Mermaid/Math rendering is finished.
// JA: 一時HTMLを開き、Mermaid/Mathの描画完了まで待機します。
export async function openRenderedPage(
    tempHtmlPath: string,
    renderTimeoutMilliSecond: number
): Promise<{ browser: Browser; page: Page; renderErrors: string[] }> {
    const executablePath = await resolveBrowserExecutablePath();
    const browser = await puppeteer.launch({
        executablePath,
        headless: true
    });
    const page = await browser.newPage();

    await page.goto(pathToFileURL(tempHtmlPath).toString(), {
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

// EN: Open exported artifact with system default app when enabled.
// JA: 設定が有効な場合、出力物をOS既定アプリで開きます。
export async function openOutputIfEnabled(targetUri: vscode.Uri, format: ExportFormat): Promise<void> {
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
