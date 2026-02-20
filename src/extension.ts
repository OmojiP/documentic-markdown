import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import MarkdownIt from 'markdown-it';
import puppeteer, { type Browser } from 'puppeteer';

type KrokiRenderOptions = {
    includeUml: boolean;
    includeKroki: boolean;
};

const UML_LANGUAGE = 'plantuml';
const KROKI_LANGUAGES = new Set([
    'actdiag',
    'blockdiag',
    'bpmn',
    'bytefield',
    'c4plantuml',
    'dbml',
    'd2',
    'ditaa',
    'erd',
    'excalidraw',
    'graphviz',
    'mermaid',
    'nomnoml',
    'nwdiag',
    'packetdiag',
    'pikchr',
    'plantuml',
    'rackdiag',
    'seqdiag',
    'structurizr',
    'svgbob',
    'tikz',
    'umlet',
    'vega',
    'vegalite',
    'wavedrom',
    'wireviz',
    'uml'
]);

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function extractFenceLanguage(info: string): string {
    return info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

function normalizeDiagramSource(source: string): string {
    return source.replace(/\r\n/g, '\n').trim();
}

function normalizeKrokiType(language: string): string | undefined {
    if (!language || !KROKI_LANGUAGES.has(language)) {
        if (language === 'wabedrom') {
            return 'wavedrom';
        }
        return undefined;
    }
    if (language === 'uml') {
        return UML_LANGUAGE;
    }
    return language;
}

function createMarkdownRenderer(): MarkdownIt {
    const md = new MarkdownIt({
        html: true,
        linkify: true,
        breaks: false,
        typographer: true
    });

    const fallbackFence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const info = extractFenceLanguage(token.info ?? '');

        if (info === 'mermaid') {
            const source = token.content;
            return `<div class="mermaid">\n${escapeHtml(source)}\n</div>`;
        }

        if (info === 'tex' || info === 'latex') {
            const source = normalizeDiagramSource(token.content);
            return `<div class="math-block">\\[\n${escapeHtml(source)}\n\\]</div>`;
        }

        const krokiType = normalizeKrokiType(info);
        if (krokiType && krokiType !== 'mermaid') {
            const source = normalizeDiagramSource(token.content);
            const svgBySource = (env as { krokiSvgMap?: Record<string, string> }).krokiSvgMap ?? {};
            const svg = svgBySource[`${krokiType}::${source}`];
            if (svg) {
                return `<div class="kroki-svg">${svg}</div>`;
            }
        }

        if (fallbackFence) {
            return fallbackFence(tokens, idx, options, env, self);
        }
        return self.renderToken(tokens, idx, options);
    };

    return md;
}

async function renderKrokiToSvg(krokiType: string, source: string): Promise<string | undefined> {
    const url = `https://kroki.io/${krokiType}/svg`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                Accept: 'image/svg+xml'
            },
            body: source
        });
        if (!response.ok) {
            return undefined;
        }
        const payload = await response.text();
        if (!payload.includes('<svg')) {
            return undefined;
        }
        return payload;
    } catch {
        return undefined;
    }
}

async function collectKrokiSvgs(markdown: string, options: KrokiRenderOptions): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const fencedBlockRegex = /```([^\n`]*)\n([\s\S]*?)```/g;

    const matches = Array.from(markdown.matchAll(fencedBlockRegex));
    for (const match of matches) {
        const language = extractFenceLanguage(match[1] ?? '');
        const krokiType = normalizeKrokiType(language);
        if (!krokiType || krokiType === 'mermaid') {
            continue;
        }

        if (krokiType === UML_LANGUAGE && !options.includeUml) {
            continue;
        }

        if (krokiType !== UML_LANGUAGE && !options.includeKroki) {
            continue;
        }

        const source = normalizeDiagramSource(match[2] ?? '');
        const key = `${krokiType}::${source}`;
        if (!source || result[key]) {
            continue;
        }

        const svg = await renderKrokiToSvg(krokiType, source);
        if (svg) {
            result[key] = svg;
        }
    }

    return result;
}

function buildHtmlDocument(markdownHtml: string, css: string): string {
    return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${css}</style>
  </head>
  <body>
    <article class="markdown-body">
      ${markdownHtml}
    </article>
    <script type="module">
      window.__MERMAID_RENDER_DONE__ = false;
            window.__MATH_RENDER_DONE__ = false;
            window.__RENDER_ERRORS__ = [];
      try {
        const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
        mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
        const blocks = Array.from(document.querySelectorAll('.mermaid'));
        if (blocks.length > 0) {
          await mermaid.run({ nodes: blocks });
        }
            } catch (error) {
                                window.__RENDER_ERRORS__.push('Mermaid render failed: ' + (error?.message ?? String(error)));
      } finally {
        window.__MERMAID_RENDER_DONE__ = true;
      }

            try {
                const mathBlocks = Array.from(document.querySelectorAll('.math-block'));
                if (mathBlocks.length > 0) {
                    window.MathJax = {
                        tex: {
                            inlineMath: [['$', '$'], ['\\(', '\\)']],
                            displayMath: [['\\[', '\\]']]
                        },
                        svg: { fontCache: 'global' }
                    };

                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js';
                        script.async = true;
                        script.onload = resolve;
                        script.onerror = () => reject(new Error('MathJax load failed'));
                        document.head.appendChild(script);
                    });

                    if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
                        await window.MathJax.typesetPromise();
                    }
                }
            } catch (error) {
                                window.__RENDER_ERRORS__.push('Math render failed: ' + (error?.message ?? String(error)));
            } finally {
                window.__MATH_RENDER_DONE__ = true;
            }
    </script>
  </body>
</html>`;
}

async function exportActiveMarkdownToPdf(context: vscode.ExtensionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showErrorMessage('Markdownファイルを開いてから実行してください。');
        return;
    }

    const markdownText = editor.document.getText();
    const currentFile = editor.document.uri;

    const defaultPdf = currentFile.with({
        path: currentFile.path.replace(/\.md$/i, '.pdf')
    });

    const targetUri = await vscode.window.showSaveDialog({
        title: 'PDFの保存先を選択',
        defaultUri: defaultPdf,
        filters: {
            PDF: ['pdf']
        }
    });

    if (!targetUri) {
        return;
    }

    const config = vscode.workspace.getConfiguration('documenticMarkdown');
    const includeUml = config.get<boolean>('includeUml', true);
    const includeKroki = config.get<boolean>('includeKroki', true);
    const pdfFormat = config.get<'A4' | 'Letter'>('pdfFormat', 'A4');

    const cssPath = path.join(context.extensionPath, 'resources', 'github-markdown.css');
    const css = await fs.readFile(cssPath, 'utf8');

    const krokiSvgMap = await collectKrokiSvgs(markdownText, {
        includeUml,
        includeKroki
    });
    const md = createMarkdownRenderer();
    const htmlBody = md.render(markdownText, { krokiSvgMap });
    const html = buildHtmlDocument(htmlBody, css);

    const tempHtmlPath = path.join(os.tmpdir(), `documentic-markdown-${Date.now()}.html`);
    await fs.writeFile(tempHtmlPath, html, 'utf8');

    let browser: Browser | undefined;
    try {
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(`file:///${tempHtmlPath.replace(/\\/g, '/')}`, {
            waitUntil: 'networkidle0'
        });

        await page.waitForFunction('window.__MERMAID_RENDER_DONE__ === true && window.__MATH_RENDER_DONE__ === true', {
            timeout: 10000
        });

        await page.pdf({
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
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`PDF出力に失敗しました: ${message}`);
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
}

export function activate(context: vscode.ExtensionContext): void {
    const command = vscode.commands.registerCommand('documenticMarkdown.exportToPdf', async () => {
        await exportActiveMarkdownToPdf(context);
    });
    context.subscriptions.push(command);
}

export function deactivate(): void {
}
