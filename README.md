# Documentic Markdown PDF

Markdownを見た目付きでPDF化するVS Code拡張です。

## 機能

- コマンドパレットから `Documentic: Export Markdown to PDF`
- MarkdownをHTMLとして描画し、そのままPDF化
- MermaidコードブロックをSVGとして埋め込み
- PlantUML/UMLコードブロックをSVGとして埋め込み（Kroki経由）

## 使い方

1. Markdownファイルを開く
2. コマンドパレットで `Documentic: Export Markdown to PDF` を実行
3. 保存先を選択

## 開発手順

1. Node.js 20 以上をインストール
2. このフォルダで `npm install`
3. `npm run build`
4. VS Code で `F5` を押して Extension Development Host を起動

## 補足

- Mermaid は PDF 生成時に SVG へ変換して埋め込みます
- PlantUML/UML は Kroki (`https://kroki.io`) を使って SVG 化します
- Kroki が利用できない場合、UML ブロックは通常のコードブロック表示になります

## 設定

- `documenticMarkdown.includeUml`: UML埋め込みを有効化（既定: true）
- `documenticMarkdown.pdfFormat`: `A4` or `Letter`
