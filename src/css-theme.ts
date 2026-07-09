import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type CssTheme = 'github' | 'markdown-native' | 'labeled' | 'none';

const THEME_FILE_MAP: Record<Exclude<CssTheme, 'none'>, string> = {
    github: 'github-markdown.css',
    'markdown-native': 'markdown-native.css',
    labeled: 'labeled.css'
};

// EN: Load the CSS file for a given theme; 'none' yields an empty stylesheet.
// JA: 指定テーマのCSSファイルを読み込みます。'none' の場合は空文字を返します。
export async function loadThemeCss(extensionPath: string, theme: CssTheme): Promise<string> {
    if (theme === 'none') {
        return '';
    }

    const fileName = THEME_FILE_MAP[theme] ?? THEME_FILE_MAP.github;
    const cssPath = path.join(extensionPath, 'resources', fileName);
    return fs.readFile(cssPath, 'utf8');
}
