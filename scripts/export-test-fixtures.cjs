#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const { PNG } = require('pngjs');
const puppeteer = require('puppeteer');
const { createMarkdownRenderer, collectKrokiSvgs, buildHtmlDocument } = require('../dist/rendering');

const ROOT_DIR = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(ROOT_DIR, 'test-fixtures');
const OUTPUT_ROOT = path.join(FIXTURES_DIR, '.exports');
const RENDER_TIMEOUT_MS = 30000;
const QUALITY_PRESETS = {
    low: 1,
    medium: 2,
    high: 3
};
const NETWORK_PROFILES = [
    { name: 'online', allowExternalHttp: true },
    { name: 'offline', allowExternalHttp: false }
];

function printUsage() {
    console.log('Usage: npm run fixtures:export -- [--network online|offline|online,offline] [--quality low|medium|high|low,high] [--clean]');
    console.log('');
    console.log('Examples:');
    console.log('  npm run fixtures:export -- --network offline --quality high');
    console.log('  npm run fixtures:export -- --network online --quality low,medium');
    console.log('  npm run fixtures:export -- --network offline --quality high --clean');
}

function parseCsvArg(value) {
    return String(value)
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0);
}

function parseCliOptions(argv) {
    const options = {
        networks: undefined,
        qualities: undefined,
        clean: false,
        help: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--help' || token === '-h') {
            options.help = true;
            continue;
        }

        if (token === '--clean') {
            options.clean = true;
            continue;
        }

        if (token === '--network' || token === '-n') {
            const value = argv[index + 1];
            if (!value || value.startsWith('-')) {
                throw new Error('`--network` の値が指定されていません。');
            }
            options.networks = parseCsvArg(value);
            index += 1;
            continue;
        }

        if (token === '--quality' || token === '-q') {
            const value = argv[index + 1];
            if (!value || value.startsWith('-')) {
                throw new Error('`--quality` の値が指定されていません。');
            }
            options.qualities = parseCsvArg(value);
            index += 1;
            continue;
        }

        throw new Error(`未対応の引数です: ${token}`);
    }

    const validNetworks = new Set(NETWORK_PROFILES.map((profile) => profile.name));
    const validQualities = new Set(Object.keys(QUALITY_PRESETS));

    if (options.networks) {
        const invalid = options.networks.filter((name) => !validNetworks.has(name));
        if (invalid.length > 0) {
            throw new Error(`無効な --network 値です: ${invalid.join(', ')}`);
        }
        options.networks = Array.from(new Set(options.networks));
    }

    if (options.qualities) {
        const invalid = options.qualities.filter((name) => !validQualities.has(name));
        if (invalid.length > 0) {
            throw new Error(`無効な --quality 値です: ${invalid.join(', ')}`);
        }
        options.qualities = Array.from(new Set(options.qualities));
    }

    return options;
}

function buildScenarios(options) {
    const selectedNetworks = options.networks
        ? NETWORK_PROFILES.filter((profile) => options.networks.includes(profile.name))
        : NETWORK_PROFILES;

    const selectedQualities = options.qualities
        ? Object.entries(QUALITY_PRESETS).filter(([qualityName]) => options.qualities.includes(qualityName))
        : Object.entries(QUALITY_PRESETS);

    return selectedNetworks.flatMap((networkProfile) => {
        return selectedQualities.map(([qualityName, scale]) => {
            return {
                name: `${networkProfile.name}-${qualityName}`,
                allowExternalHttp: networkProfile.allowExternalHttp,
                qualityName,
                deviceScaleFactor: scale
            };
        });
    });
}

function normalizeDisplayMathBlocks(markdown) {
    const lines = markdown.split(/\r?\n/);
    const output = [];

    let inCodeFence = false;
    let inMathBlock = false;
    let mathLines = [];

    for (const line of lines) {
        if (!inMathBlock && /^```/.test(line.trim())) {
            inCodeFence = !inCodeFence;
            output.push(line);
            continue;
        }

        if (inCodeFence) {
            output.push(line);
            continue;
        }

        const trimmed = line.trim();

        if (!inMathBlock) {
            const oneLine = trimmed.match(/^\$\$(.+)\$\$$/);
            if (oneLine) {
                output.push('```tex');
                output.push(oneLine[1].trim());
                output.push('```');
                continue;
            }

            if (trimmed === '$$') {
                inMathBlock = true;
                mathLines = [];
                continue;
            }

            output.push(line);
            continue;
        }

        if (trimmed === '$$') {
            output.push('```tex');
            output.push(mathLines.join('\n'));
            output.push('```');
            inMathBlock = false;
            mathLines = [];
            continue;
        }

        mathLines.push(line);
    }

    if (inMathBlock) {
        output.push('$$');
        output.push(...mathLines);
    }

    return output.join('\n');
}

async function collectMarkdownFiles(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        if (entry.name === '.exports') {
            continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collectMarkdownFiles(fullPath)));
            continue;
        }

        if (/\.md$/i.test(entry.name)) {
            files.push(fullPath);
        }
    }

    return files;
}

async function exportWholePageAsPng(page, outputPath) {
    const layout = await page.evaluate(() => {
        const root = document.documentElement;
        const body = document.body;
        const width = Math.max(root.scrollWidth, root.clientWidth, body?.scrollWidth ?? 0);
        const height = Math.max(root.scrollHeight, root.clientHeight, body?.scrollHeight ?? 0);
        return {
            width: Math.ceil(width),
            height: Math.ceil(height)
        };
    });

    const currentViewport = page.viewport() ?? { width: 1280, height: 720, deviceScaleFactor: 2 };
    const targetWidth = Math.max(currentViewport.width, layout.width);
    const segmentHeight = Math.min(2000, Math.max(800, currentViewport.height));
    const requestedScale = currentViewport.deviceScaleFactor || 1;
    const maxSafeDimension = 32000;
    const maxScaleByWidth = Math.max(1, Math.floor(maxSafeDimension / Math.max(1, layout.width)));
    const maxScaleByHeight = Math.max(1, Math.floor(maxSafeDimension / Math.max(1, layout.height)));
    const deviceScaleFactor = Math.max(1, Math.min(requestedScale, maxScaleByWidth, maxScaleByHeight));

    await page.setViewport({
        width: targetWidth,
        height: segmentHeight,
        deviceScaleFactor
    });

    await page.evaluate(() => window.scrollTo(0, 0));

    const captures = [];
    let previousY = -1;
    let nextY = 0;

    for (let guard = 0; guard < 2000; guard += 1) {
        await page.evaluate((scrollY) => {
            window.scrollTo(0, scrollY);
        }, nextY);
        await new Promise((resolve) => setTimeout(resolve, 40));

        const actualY = await page.evaluate(() => Math.round(window.scrollY));
        if (actualY === previousY) {
            break;
        }

        const chunk = await page.screenshot({ type: 'png' });
        const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        captures.push({ y: actualY, image: PNG.sync.read(chunkBuffer) });

        previousY = actualY;
        if (actualY + segmentHeight >= layout.height - 1) {
            break;
        }
        nextY = actualY + segmentHeight;
    }

    if (captures.length === 0) {
        throw new Error('Failed to capture PNG segments.');
    }

    const stitchedWidth = Math.max(...captures.map((item) => item.image.width));
    const stitchedHeight = Math.max(1, Math.round(layout.height * deviceScaleFactor));
    const stitched = new PNG({ width: stitchedWidth, height: stitchedHeight });

    for (const capture of captures) {
        const offsetY = Math.round(capture.y * deviceScaleFactor);
        const writableHeight = Math.max(0, Math.min(capture.image.height, stitched.height - offsetY));
        if (writableHeight <= 0) {
            continue;
        }

        PNG.bitblt(capture.image, stitched, 0, 0, capture.image.width, writableHeight, 0, offsetY);
    }

    await fs.writeFile(outputPath, PNG.sync.write(stitched));
}

async function exportDiagramBlocksAsPng(page, outputDir) {
    await fs.mkdir(outputDir, { recursive: true });

    const handles = await page.$$('.mermaid svg, .kroki-svg svg, .math-block svg');
    let count = 0;

    for (let index = 0; index < handles.length; index += 1) {
        const handle = handles[index];
        const filePath = path.join(outputDir, `diagram-${String(index + 1).padStart(3, '0')}.png`);
        try {
            await handle.screenshot({ path: filePath, type: 'png' });
            count += 1;
        } finally {
            await handle.dispose();
        }
    }

    return count;
}

async function exportDiagramBlocksAsSvg(page, outputDir) {
    await fs.mkdir(outputDir, { recursive: true });

    const svgSources = await page.evaluate(() => {
        const svgNs = 'http://www.w3.org/2000/svg';
        const globalCache = document.querySelector('#MJX-SVG-global-cache');
        const globalDefs = globalCache?.querySelector('defs')?.innerHTML ?? '';
        const targets = document.querySelectorAll('.mermaid svg, .kroki-svg svg, .math-block svg');

        return Array.from(targets).map((svg) => {
            const cloned = svg.cloneNode(true);
            const isMathSvg = Boolean(svg.closest('.math-block'));

            if (!cloned.getAttribute('xmlns')) {
                cloned.setAttribute('xmlns', svgNs);
            }
            if (!cloned.getAttribute('xmlns:xlink')) {
                cloned.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
            }

            if (isMathSvg && globalDefs) {
                const hasMathRef = /(?:xlink:href|href)="#MJX-/.test(cloned.outerHTML);
                if (hasMathRef) {
                    let defs = cloned.querySelector('defs');
                    if (!defs) {
                        defs = document.createElementNS(svgNs, 'defs');
                        cloned.insertBefore(defs, cloned.firstChild);
                    }
                    defs.insertAdjacentHTML('beforeend', globalDefs);
                }
            }

            return cloned.outerHTML;
        });
    });

    for (let index = 0; index < svgSources.length; index += 1) {
        const filePath = path.join(outputDir, `diagram-${String(index + 1).padStart(3, '0')}.svg`);
        await fs.writeFile(filePath, svgSources[index], 'utf8');
    }

    return svgSources.length;
}

async function run() {
    const options = parseCliOptions(process.argv.slice(2));
    if (options.help) {
        printUsage();
        return;
    }

    const renderingEntry = path.join(ROOT_DIR, 'dist', 'rendering.js');
    try {
        await fs.access(renderingEntry);
    } catch {
        throw new Error('dist/rendering.js が見つかりません。先に `npm run build` を実行してください。');
    }

    const cssPath = path.join(ROOT_DIR, 'resources', 'github-markdown.css');
    const mermaidScriptPath = path.join(ROOT_DIR, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
    const mathJaxScriptPath = path.join(ROOT_DIR, 'node_modules', 'mathjax-full', 'es5', 'tex-svg.js');
    const [css, mermaidScript, mathJaxScript] = await Promise.all([
        fs.readFile(cssPath, 'utf8'),
        fs.readFile(mermaidScriptPath, 'utf8'),
        fs.readFile(mathJaxScriptPath, 'utf8')
    ]);

    const mdFiles = await collectMarkdownFiles(FIXTURES_DIR);
    if (mdFiles.length === 0) {
        console.log('No markdown fixtures found.');
        return;
    }

    const scenarios = buildScenarios(options);
    if (scenarios.length === 0) {
        throw new Error('実行対象のシナリオがありません。--network / --quality を確認してください。');
    }

    await fs.mkdir(OUTPUT_ROOT, { recursive: true });

    if (options.clean) {
        for (const scenario of scenarios) {
            await fs.rm(path.join(OUTPUT_ROOT, scenario.name), { recursive: true, force: true });
        }
    }

    console.log(`Found ${mdFiles.length} fixture files.`);
    console.log(`Scenarios: ${scenarios.map((scenario) => scenario.name).join(', ')}`);
    if (options.clean) {
        console.log('Clean mode: target scenario output directories were removed before export.');
    }

    const browser = await puppeteer.launch({ headless: true });
    const failures = [];

    try {
        for (const markdownPath of mdFiles) {
            const relativeMdPath = path.relative(FIXTURES_DIR, markdownPath);
            const relativeDir = path.dirname(relativeMdPath);
            const stem = path.parse(markdownPath).name;
            const markdownText = await fs.readFile(markdownPath, 'utf8');
            const normalized = normalizeDisplayMathBlocks(markdownText);

            for (const scenario of scenarios) {
                const outputDir = path.join(OUTPUT_ROOT, scenario.name, relativeDir, stem);
                const diagramSvgDir = path.join(outputDir, 'diagram-svgs');
                const diagramPngDir = path.join(outputDir, 'diagram-pngs');
                const htmlPath = path.join(outputDir, `${stem}.html`);
                const pdfPath = path.join(outputDir, `${stem}.pdf`);
                const pngPath = path.join(outputDir, `${stem}.png`);

                await fs.mkdir(outputDir, { recursive: true });

                let page;
                try {
                    const krokiSvgMap = await collectKrokiSvgs(normalized, {
                        includeKroki: true,
                        allowExternalHttp: scenario.allowExternalHttp
                    });

                    const md = createMarkdownRenderer(false);
                    const htmlBody = md.render(normalized, { krokiSvgMap });
                    const html = buildHtmlDocument(htmlBody, css, { mermaidScript, mathJaxScript });

                    await fs.writeFile(htmlPath, html, 'utf8');

                    page = await browser.newPage();
                    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: scenario.deviceScaleFactor });
                    await page.setContent(html, { waitUntil: 'networkidle0' });
                    await page.waitForFunction('window.__MERMAID_RENDER_DONE__ === true && window.__MATH_RENDER_DONE__ === true', {
                        timeout: RENDER_TIMEOUT_MS
                    });

                    const renderErrors = await page.evaluate(() => {
                        const errors = window.__RENDER_ERRORS__;
                        return Array.isArray(errors) ? errors.map((item) => String(item)) : [];
                    });

                    await page.pdf({
                        path: pdfPath,
                        format: 'A4',
                        printBackground: true,
                        margin: { top: '16mm', right: '16mm', bottom: '16mm', left: '16mm' }
                    });
                    await exportWholePageAsPng(page, pngPath);
                    const svgCount = await exportDiagramBlocksAsSvg(page, diagramSvgDir);
                    const pngCount = await exportDiagramBlocksAsPng(page, diagramPngDir);

                    const warningText = renderErrors.length > 0 ? ` warnings=${renderErrors.length}` : '';
                    console.log(
                        `OK   [${scenario.name}] ${relativeMdPath} -> PDF/HTML/PNG + SVG(${svgCount}) PNG(${pngCount})${warningText}`
                    );
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    failures.push({ markdownPath: `[${scenario.name}] ${relativeMdPath}`, message });
                    console.error(`FAIL [${scenario.name}] ${relativeMdPath} -> ${message}`);
                } finally {
                    if (page) {
                        await page.close();
                    }
                }
            }
        }
    } finally {
        await browser.close();
    }

    if (failures.length > 0) {
        console.error('\nFixture export finished with failures:');
        for (const failure of failures) {
            console.error(`- ${failure.markdownPath}: ${failure.message}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log(`\nFixture export completed. Output root: ${path.relative(ROOT_DIR, OUTPUT_ROOT)}`);
}

run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
