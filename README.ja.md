# Documentic Markdown

Markdownを見た目付きでPDF化するVS Code拡張です。

## 機能

- コマンドパレットから `Documentic: Export Markdown`
- MarkdownをHTMLとして描画し、そのままPDF化
- MermaidコードブロックをSVGとして埋め込み
- PlantUML/UMLコードブロックをSVGとして埋め込み（Kroki経由）
- UML以外のKroki対応形式（例: `graphviz`, `d2`, `erd`, `svgbob`, `vega`）もSVGとして埋め込み
- `tex` / `latex` コードブロックを数式として描画
- Markdown内のローカル画像ファイルをPDF/PNG出力時にも正しく埋め込み
- SVG埋め込み対象コードブロックを個別PNGとしてフォルダ出力
- SVG埋め込み対象コードブロックを個別SVGとしてフォルダ出力

## 使い方

1. Markdownファイルを開く
2. コマンドパレットで `Documentic: Export Markdown` を実行
3. 出力形式（PDF / HTML / PNG / 図ブロックPNG一括 / 図ブロックSVG一括）を選択
4. 保存先を選択

補足: Markdownエディタ右上にも出力ボタンが表示されます。

## 開発手順

1. Node.js 20 以上をインストール
2. このフォルダで `npm install`
3. `npm run build`
4. VS Code で `F5` を押して Extension Development Host を起動

## テストフィクスチャ出力

`test-fixtures` 配下のすべての Markdown から、テスト用成果物を一括生成できます。

```bash
npm run fixtures:export
```

生成されるもの:

- PDF
- HTML
- PNG
- コードブロックごとの SVG
- コードブロックごとの PNG

`online/offline` と `low/medium/high`（PNG品質）の全組み合わせを一度に実行します。

出力先は `test-fixtures/.exports`（例: `test-fixtures/.exports/online-high/...`）です。

引数で絞り込みもできます:

```bash
npm run fixtures:export -- --network offline --quality high
```

```bash
npm run fixtures:export -- --network offline --quality high --clean
```

- `--network`: `online`, `offline`, またはカンマ区切り（例: `online,offline`）
- `--quality`: `low`, `medium`, `high`, またはカンマ区切り（例: `low,high`）
- `--clean`: 実行前に対象シナリオの出力ディレクトリを削除してから再生成

## 補足

- Mermaid は PDF 生成時に SVG へ変換して埋め込みます
- PlantUML/UML は Kroki (`https://kroki.io`) を使って SVG 化します
- UML以外のKroki対応言語も、同様にKroki経由でSVG化できます
- `tex` / `latex` は MathJax でSVG描画します
- Kroki が利用できない場合、Kroki対象ブロックは通常のコードブロック表示になります
- Mermaid/Kroki のSVGは幅を揃えるようにスケール調整しています
- Mermaid / MathJax のランタイムは拡張内同梱ライブラリを使用します（CDN依存なし）
- PDF / PNG / 図ブロック出力には Chromium 系ブラウザ（Chrome または Edge）が必要です（npm や Puppeteer の追加インストールは不要）

## 設定

- `documenticMarkdown.untrustedMarkdownProtection`: 未信頼Markdown保護モード（既定: true）
- `documenticMarkdown.allowRawHtml`: Markdown内の生HTMLを許可（既定: false、`untrustedMarkdownProtection=true`時は無効）
- `documenticMarkdown.includeKroki`: Kroki形式埋め込みを有効化（既定: true、PlantUML/UMLを含む。`untrustedMarkdownProtection=true`時は描画されずコード表示）
- `documenticMarkdown.pdfFormat`: `A4` or `Letter`
- `documenticMarkdown.openOutputAfterExport`: 出力後に自動で開く（既定: true）
- `documenticMarkdown.renderTimeoutMilliSecond`: Mermaid/Math描画待機タイムアウト（ミリ秒、既定: 10000）
- `documenticMarkdown.browserExecutablePath`: Chromium系ブラウザ実行ファイル（Chrome/Edge）の絶対パス。空欄時は一般的なインストール先を自動検出
- `documenticMarkdown.pngQuality`: PNG品質プリセット（`low` / `medium` / `high`、既定: `medium`）

補足:

- `untrustedMarkdownProtection`: 保護モードの親スイッチです。`true` の間は外部通信（Kroki）と生HTMLを抑止します。
- `allowRawHtml`: 生HTMLの個別許可スイッチです。`untrustedMarkdownProtection=false` のときだけ有効になります。

### 設定で「できること / できないこと」

#### 1) `documenticMarkdown.untrustedMarkdownProtection`

- `true`（既定）
	- できること: Mermaid描画、MathJax描画、通常のMarkdown出力
	- できないこと: Kroki経由のSVG化（UML含む）、生HTMLの有効化
	- 結果: Kroki対象ブロック（`plantuml`, `uml`, `graphviz` など）はコードブロック表示
- `false`
	- できること: Kroki通信によるSVG化、`allowRawHtml` の反映
	- 注意: 未信頼なMarkdownを扱うときはリスクが上がります

#### 2) `documenticMarkdown.allowRawHtml`

- `true`
	- できること: Markdown内の生HTMLをそのまま描画
	- ただし: `untrustedMarkdownProtection=true` の場合は無効（実際には描画されません）
- `false`（既定）
	- できないこと: 生HTMLの有効化
	- 結果: 生HTMLはテキストとして扱われます

#### 3) `documenticMarkdown.includeKroki`

- `true`（既定）
	- できること: Kroki対象言語のSVG化（PlantUML/UMLを含む）
	- 前提: `untrustedMarkdownProtection=false` かつ Krokiへ通信可能
- `false`
	- できないこと: Kroki経由の図変換すべて
	- 結果: Kroki対象ブロックはコードブロック表示

### よく使う組み合わせ（早見表）

| 目的                 | untrustedMarkdownProtection | allowRawHtml | includeKroki | 結果                                    |
| -------------------- | --------------------------: | -----------: | -----------: | --------------------------------------- |
| 安全優先で閲覧       |                      `true` |      `false` |       `true` | Kroki変換なし（コード表示）、生HTML無効 |
| UML/Kroki図を有効化  |                     `false` |      `false` |       `true` | Kroki図をSVG化（通信必須）              |
| HTMLも含めて忠実表示 |                     `false` |       `true` |       `true` | Kroki図SVG化 + 生HTML有効               |
| Krokiを完全無効      |           `false` or `true` |         任意 |      `false` | Kroki対象は常にコード表示               |

### トラブル時の確認ポイント

- UMLがコード表示になる場合:
	1. `includeKroki=true` か
	2. `untrustedMarkdownProtection=false` か
	3. ネットワークから `https://kroki.io` に到達できるか
- 生HTMLが有効にならない場合:
	1. `allowRawHtml=true` か
	2. `untrustedMarkdownProtection=false` か

## 技術的な説明（簡潔版）

この拡張は、Markdown をいったん HTML に変換し、ブラウザ描画結果を PDF 化する方式です。

1. `markdown-it` で Markdown を HTML に変換
2. 図ブロック（`mermaid` / `plantuml` / `uml`）を SVG 化して埋め込み
3. `puppeteer-core` でローカルの Chrome/Edge を使って最終 HTML を出力

### Mermaid ブロックと UML ブロックの違い

共通点として、どちらも最終的には SVG として HTML に埋め込まれ、PDF では画像として出力されます。

- `mermaid`: 拡張内で Mermaid ランタイムを使って描画
- `plantuml` / `uml`: Kroki にソースを渡して SVG を取得
- その他のKroki対応形式（例: `graphviz`, `d2`, `erd`）: Kroki にソースを渡して SVG を取得

つまり「PDF に埋め込む段階」は同じで、「SVG を作る手段」が異なります。

この方式の利点は、見出し・表・コードブロックなどの見た目を保ちやすい点です。
一方で、UML 変換は Kroki を利用するため、ネットワーク環境の影響を受けます。

主要な実装は [src/extension.ts](src/extension.ts) にまとまっています。
