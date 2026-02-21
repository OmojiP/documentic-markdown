import MarkdownIt from 'markdown-it';

export type KrokiRenderOptions = {
    includeKroki: boolean;
    allowExternalHttp: boolean;
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

export function createMarkdownRenderer(allowRawHtml: boolean): MarkdownIt {
    // EN: Renderer converts fenced diagram/math blocks into embeddable HTML containers.
    // JA: フェンス化された図/数式ブロックを埋め込み用HTMLコンテナへ変換します。
    const md = new MarkdownIt({
        html: allowRawHtml,
        linkify: true,
        breaks: false,
        typographer: true
    });

    const fallbackFence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const info = extractFenceLanguage(token.info ?? '');

        if (info === 'mermaid') {
            return `<div class="mermaid">\n${escapeHtml(token.content)}\n</div>`;
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
    try {
        const response = await fetch(`https://kroki.io/${krokiType}/svg`, {
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

export async function collectKrokiSvgs(markdown: string, options: KrokiRenderOptions): Promise<Record<string, string>> {
    // EN: Pre-fetch SVGs from Kroki so rendering phase can inject them without extra parsing.
    // JA: KrokiのSVGを事前取得し、描画フェーズで再解析せず埋め込めるようにします。
    const result: Record<string, string> = {};
    if (!options.allowExternalHttp) {
        return result;
    }

    const fencedBlockRegex = /```([^\n`]*)\n([\s\S]*?)```/g;

    for (const match of markdown.matchAll(fencedBlockRegex)) {
        const language = extractFenceLanguage(match[1] ?? '');
        const krokiType = normalizeKrokiType(language);
        if (!krokiType || krokiType === 'mermaid') {
            continue;
        }

        if (!options.includeKroki) {
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

export function buildHtmlDocument(markdownHtml: string, css: string, runtime: { mermaidScript: string; mathJaxScript: string }): string {
    // EN: Build standalone HTML with runtime hooks and completion flags for Puppeteer waits.
    // JA: Puppeteer待機用の完了フラグを含む、自己完結HTMLを組み立てます。
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
      const mermaidScriptText = ${JSON.stringify(runtime.mermaidScript)};
      const mathJaxScriptText = ${JSON.stringify(runtime.mathJaxScript)};

      try {
        const blocks = Array.from(document.querySelectorAll('.mermaid'));
        if (blocks.length > 0) {
          const script = document.createElement('script');
          script.textContent = mermaidScriptText;
          document.head.appendChild(script);

          const mermaid = window.mermaid;
          if (!mermaid) {
            throw new Error('Mermaid runtime is not available');
          }

          mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
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
              inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
              displayMath: [['\\\\[', '\\\\]']]
            },
            svg: { fontCache: 'global' }
          };

          const script = document.createElement('script');
          script.textContent = mathJaxScriptText;
          document.head.appendChild(script);

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
