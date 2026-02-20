import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import MarkdownIt from 'markdown-it';
import pako from 'pako';
import puppeteer, { type Browser } from 'puppeteer';

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function encodePlantUml(text: string): string {
    const deflated = pako.deflate(text, { level: 9 });
    let binary = '';
    for (const b of deflated) {
        binary += String.fromCharCode(b);
    }
    return Buffer.from(binary, 'binary')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
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
        const info = (token.info ?? '').trim().toLowerCase();

        if (info === 'mermaid') {
            const source = token.content;
            return `<div class="mermaid">\n${escapeHtml(source)}\n</div>`;
        }

        if (info === 'plantuml' || info === 'uml') {
            const source = token.content.trim();
            const svgBySource = (env as { umlSvgMap?: Record<string, string> }).umlSvgMap ?? {};
            const svg = svgBySource[source];
            if (svg) {
                return `<div class="plantuml-svg">${svg}</div>`;
            }
        }

        if (fallbackFence) {
            return fallbackFence(tokens, idx, options, env, self);
        }
        return self.renderToken(tokens, idx, options);
    };

    return md;
}

async function renderPlantUmlToSvg(umlSource: string): Promise<string | undefined> {
    const encoded = encodePlantUml(umlSource);
    const url = `https://kroki.io/plantuml/svg/${encoded}`;

    try {
        const response = await fetch(url, {
            headers: {
                Accept: 'image/svg+xml'
            }
        });
        if (!response.ok) {
            return undefined;
        }
        return await response.text();
    } catch {
        return undefined;
    }
}

async function collectUmlSvgs(markdown: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const umlRegex = /```(?:plantuml|uml)\s*\n([\s\S]*?)```/gi;

    const matches = Array.from(markdown.matchAll(umlRegex));
    for (const match of matches) {
        const source = (match[1] ?? '').trim();
        if (!source || result[source]) {
            continue;
        }

        const svg = await renderPlantUmlToSvg(source);
        if (svg) {
            result[source] = svg;
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
      try {
        const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
        mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
        const blocks = Array.from(document.querySelectorAll('.mermaid'));
        if (blocks.length > 0) {
          await mermaid.run({ nodes: blocks });
        }
      } finally {
        window.__MERMAID_RENDER_DONE__ = true;
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
    const pdfFormat = config.get<'A4' | 'Letter'>('pdfFormat', 'A4');

    const cssPath = path.join(context.extensionPath, 'resources', 'github-markdown.css');
    const css = await fs.readFile(cssPath, 'utf8');

    const umlSvgMap = includeUml ? await collectUmlSvgs(markdownText) : {};
    const md = createMarkdownRenderer();
    const htmlBody = md.render(markdownText, { umlSvgMap });
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

        await page.waitForFunction('window.__MERMAID_RENDER_DONE__ === true', {
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
