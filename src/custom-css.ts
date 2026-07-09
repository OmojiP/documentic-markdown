import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface CustomCssCacheEntry {
    path: string;
    content: string;
    cachedAt: string;
}

export interface CustomCssResult {
    content: string;
    warning?: string;
}

const CACHE_KEY = 'documenticMarkdown.customCssCache';

function resolveCustomCssPath(configuredPath: string): string {
    if (path.isAbsolute(configuredPath)) {
        return configuredPath;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder ? path.join(workspaceFolder.uri.fsPath, configuredPath) : configuredPath;
}

function getCachedEntry(context: vscode.ExtensionContext): CustomCssCacheEntry | undefined {
    return context.globalState.get<CustomCssCacheEntry>(CACHE_KEY);
}

async function readAndCache(context: vscode.ExtensionContext, configuredPath: string): Promise<CustomCssResult> {
    const resolvedPath = resolveCustomCssPath(configuredPath);
    try {
        const content = await fs.readFile(resolvedPath, 'utf8');
        await context.globalState.update(CACHE_KEY, {
            path: configuredPath,
            content,
            cachedAt: new Date().toISOString()
        });
        return { content };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cached = getCachedEntry(context);
        if (cached && cached.path === configuredPath) {
            return {
                content: cached.content,
                warning: `カスタムCSSファイルを読み込めなかったため、前回キャッシュした内容を使用します: ${resolvedPath} (${message})`
            };
        }
        return {
            content: '',
            warning: `カスタムCSSファイルの読み込みに失敗しました: ${resolvedPath} (${message})`
        };
    }
}

// EN: Return cached custom CSS for the configured path; the file is only re-read when the setting value changed since the last cache.
// JA: 設定パスに対応するキャッシュ済みCSSを返します。前回キャッシュ時から設定値が変わった場合のみファイルを再読み込みします。
export async function getOrLoadCustomCss(context: vscode.ExtensionContext, configuredPath: string): Promise<CustomCssResult> {
    const trimmed = configuredPath.trim();
    if (!trimmed) {
        return { content: '' };
    }

    const cached = getCachedEntry(context);
    if (cached && cached.path === trimmed) {
        return { content: cached.content };
    }

    return readAndCache(context, trimmed);
}

// EN: Force re-reading the custom CSS file regardless of cache state. Used by the manual reload command.
// JA: キャッシュの一致有無に関わらず強制的にファイルを再読み込みします。再読み込みコマンド用です。
export async function forceReloadCustomCss(context: vscode.ExtensionContext, configuredPath: string): Promise<CustomCssResult> {
    const trimmed = configuredPath.trim();
    if (!trimmed) {
        await context.globalState.update(CACHE_KEY, undefined);
        return { content: '' };
    }

    return readAndCache(context, trimmed);
}
