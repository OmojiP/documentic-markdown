# Documentic Markdown

A VS Code extension to export Markdown to PDF while preserving visual layout.

## Features

- Run `Documentic: Export Markdown` from the Command Palette
- Render Markdown as HTML, then export as PDF
- Embed Mermaid code blocks as SVG
- Embed PlantUML/UML code blocks as SVG (via Kroki)
- Embed non-UML Kroki-supported formats (e.g. `graphviz`, `d2`, `erd`, `svgbob`, `vega`) as SVG
- Render `tex` / `latex` code blocks as math
- Export SVG-embedded diagram blocks as individual PNG files
- Export SVG-embedded diagram blocks as individual SVG files

## Usage

1. Open a Markdown file
2. Run `Documentic: Export Markdown` from the Command Palette
3. Select output format (PDF / HTML / PNG / Diagram PNG Batch / Diagram SVG Batch)
4. Choose destination path

Note: An export button is also available on the top-right of the Markdown editor.

## Development

1. Install Node.js 20+
2. Run `npm install` in this folder
3. Run `npm run build`
4. Press `F5` in VS Code to launch Extension Development Host

## Test fixture export

You can generate test artifacts from all Markdown files under `test-fixtures`:

```bash
npm run fixtures:export
```

Generated artifacts:

- PDF
- HTML
- PNG
- Per-code-block SVG
- Per-code-block PNG

Output directory: `test-fixtures/.exports`.

## Notes

- Mermaid is rendered and embedded as SVG during export
- PlantUML/UML is converted to SVG through Kroki (`https://kroki.io`)
- Other Kroki-supported languages are also rendered via Kroki
- `tex` / `latex` blocks are rendered by MathJax as SVG
- If Kroki is unavailable, affected blocks are shown as normal code blocks
- Mermaid/Kroki SVG blocks are size-adjusted to keep visual consistency
- Mermaid / MathJax runtimes are bundled locally in this extension (no CDN dependency)

## Settings

- `documenticMarkdown.untrustedMarkdownProtection`: Protection mode for untrusted Markdown (default: `true`)
- `documenticMarkdown.allowRawHtml`: Allow raw HTML in Markdown (default: `false`; ignored when `untrustedMarkdownProtection=true`)
- `documenticMarkdown.includeKroki`: Enable Kroki embedding (default: `true`, includes PlantUML/UML; when `untrustedMarkdownProtection=true`, Kroki blocks are shown as code)
- `documenticMarkdown.pdfFormat`: `A4` or `Letter`
- `documenticMarkdown.openOutputAfterExport`: Auto-open output after export (default: `true`)
- `documenticMarkdown.renderTimeoutMilliSecond`: Mermaid/Math render wait timeout in milliseconds (default: `10000`)
- `documenticMarkdown.pngQuality`: PNG quality preset (`low` / `medium` / `high`, default: `medium`)

Notes:

- `untrustedMarkdownProtection`: Parent protection switch. When `true`, external fetches (Kroki) and raw HTML are blocked.
- `allowRawHtml`: Per-feature switch for raw HTML. Effective only when `untrustedMarkdownProtection=false`.

### What each setting can / cannot do

#### 1) `documenticMarkdown.untrustedMarkdownProtection`

- `true` (default)
	- Can do: Mermaid rendering, MathJax rendering, normal Markdown export
	- Cannot do: Kroki SVG conversion (including UML), raw HTML rendering
	- Result: Kroki-targeted blocks (`plantuml`, `uml`, `graphviz`, etc.) are shown as code blocks
- `false`
	- Can do: Kroki SVG conversion and `allowRawHtml` behavior
	- Note: This is less safe for untrusted Markdown content

#### 2) `documenticMarkdown.allowRawHtml`

- `true`
	- Can do: Render raw HTML in Markdown
	- But: ineffective when `untrustedMarkdownProtection=true`
- `false` (default)
	- Cannot do: raw HTML rendering
	- Result: raw HTML is handled as plain text

#### 3) `documenticMarkdown.includeKroki`

- `true` (default)
	- Can do: SVG conversion for Kroki-supported languages (including PlantUML/UML)
	- Requirements: `untrustedMarkdownProtection=false` and network access to Kroki
- `false`
	- Cannot do: any Kroki-based diagram conversion
	- Result: Kroki-targeted blocks are shown as code blocks

## Technical Summary

This extension converts Markdown to HTML first, then exports from browser-rendered output.

1. Convert Markdown to HTML with `markdown-it`
2. Convert diagram blocks (`mermaid` / `plantuml` / `uml`) into SVG and embed
3. Export final HTML via `puppeteer`

### Mermaid vs UML Blocks

Common point: both end up as SVG embedded in HTML, then included in exported output.

- `mermaid`: Rendered with the Mermaid runtime inside the extension
- `plantuml` / `uml`: Source is sent to Kroki to retrieve SVG
- Other Kroki formats (e.g. `graphviz`, `d2`, `erd`): Also rendered through Kroki

So the embedding stage is the same; only the SVG generation path differs.

Main implementation entry point: [src/extension.ts](src/extension.ts)
