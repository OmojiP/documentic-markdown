# Documentic Markdown PDF

Markdownを見た目付きでPDF化するVS Code拡張です。

## 機能

- コマンドパレットから `Documentic: Export Markdown to PDF`
- MarkdownをHTMLとして描画し、そのままPDF化
- MermaidコードブロックをSVGとして埋め込み
- PlantUML/UMLコードブロックをSVGとして埋め込み（Kroki経由）
- UML以外のKroki対応形式（例: `graphviz`, `d2`, `erd`, `svgbob`, `vega`）もSVGとして埋め込み
- `tex` / `latex` コードブロックを数式として描画

## 使い方

1. Markdownファイルを開く
2. コマンドパレットで `Documentic: Export Markdown` を実行
3. 出力形式（PDF / HTML / PNG）を選択
4. 保存先を選択

補足: Markdownエディタ右上にも出力ボタンが表示されます。

## 開発手順

1. Node.js 20 以上をインストール
2. このフォルダで `npm install`
3. `npm run build`
4. VS Code で `F5` を押して Extension Development Host を起動

## 補足

- Mermaid は PDF 生成時に SVG へ変換して埋め込みます
- PlantUML/UML は Kroki (`https://kroki.io`) を使って SVG 化します
- UML以外のKroki対応言語も、同様にKroki経由でSVG化できます
- `tex` / `latex` は MathJax でSVG描画します
- Kroki が利用できない場合、Kroki対象ブロックは通常のコードブロック表示になります
- Mermaid/Kroki のSVGは幅を揃えるようにスケール調整しています

## 設定

- `documenticMarkdown.includeUml`: UML埋め込みを有効化（既定: true）
- `documenticMarkdown.includeKroki`: UML以外のKroki形式埋め込みを有効化（既定: true）
- `documenticMarkdown.pdfFormat`: `A4` or `Letter`
- `documenticMarkdown.openOutputAfterExport`: 出力後に自動で開く（既定: true）

## 技術的な説明（簡潔版）

この拡張は、Markdown をいったん HTML に変換し、ブラウザ描画結果を PDF 化する方式です。

1. `markdown-it` で Markdown を HTML に変換
2. 図ブロック（`mermaid` / `plantuml` / `uml`）を SVG 化して埋め込み
4. `puppeteer` で最終 HTML を PDF 出力

### Mermaid ブロックと UML ブロックの違い

共通点として、どちらも最終的には SVG として HTML に埋め込まれ、PDF では画像として出力されます。

- `mermaid`: 拡張内で Mermaid ランタイムを使って描画
- `plantuml` / `uml`: Kroki にソースを渡して SVG を取得
- その他のKroki対応形式（例: `graphviz`, `d2`, `erd`）: Kroki にソースを渡して SVG を取得

つまり「PDF に埋め込む段階」は同じで、「SVG を作る手段」が異なります。

この方式の利点は、見出し・表・コードブロックなどの見た目を保ちやすい点です。
一方で、UML 変換は Kroki を利用するため、ネットワーク環境の影響を受けます。

主要な実装は [src/extension.ts](src/extension.ts) にまとまっています。
