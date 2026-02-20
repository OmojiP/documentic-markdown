import MarkdownIt from 'markdown-it';

export type KrokiRenderOptions = {
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

export function createMarkdownRenderer(): MarkdownIt {
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
    const result: Record<string, string> = {};
    const fencedBlockRegex = /```([^\n`]*)\n([\s\S]*?)```/g;

    for (const match of markdown.matchAll(fencedBlockRegex)) {
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

export function buildHtmlDocument(markdownHtml: string, css: string): string {
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
              inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
              displayMath: [['\\\\[', '\\\\]']]
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
