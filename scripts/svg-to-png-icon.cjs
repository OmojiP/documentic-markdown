#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer');

async function main() {
    const root = path.resolve(__dirname, '..');
    const inputPath = path.join(root, 'resources', 'icons', 'export-dark.svg');
    const outputPath = path.join(root, 'resources', 'icons', 'extension-icon.png');

    const rawSvg = await fs.readFile(inputPath, 'utf8');
    const svg = rawSvg
        .replace(/\swidth="[^"]*"/i, '')
        .replace(/\sheight="[^"]*"/i, '')
        .replace('<svg', '<svg style="width:100%;height:100%;display:block;"');

    const browser = await puppeteer.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 256, height: 256, deviceScaleFactor: 1 });
        await page.setContent(
            `<!doctype html><html><body style="margin:0;width:256px;height:256px;background:transparent;overflow:hidden;">${svg}</body></html>`
        );
        await page.screenshot({
            path: outputPath,
            type: 'png',
            omitBackground: true
        });
    } finally {
        await browser.close();
    }

    console.log(`Generated: ${outputPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
