#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function printUsage() {
    console.log('Usage: npm run release:vsix -- <version|patch|minor|major>');
    console.log('Quick update: npm run vsix:update');
    console.log('');
    console.log('Examples:');
    console.log('  npm run release:vsix -- 0.1.1');
    console.log('  npm run release:vsix -- patch');
    console.log('  npm run release:vsix -- minor');
}

function run(command, args) {
    const executable = process.platform === 'win32' && (command === 'npm' || command === 'npx')
        ? `${command}.cmd`
        : command;

    const result = spawnSync(executable, args, {
        stdio: 'inherit'
    });

    if (result.status !== 0) {
        throw new Error(`Command failed: ${command} ${args.join(' ')}`);
    }
}

function getPackageVersion() {
    const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version;
}

function main() {
    const target = process.argv[2];
    if (!target || target === '--help' || target === '-h') {
        printUsage();
        process.exit(target ? 0 : 1);
    }

    run('npm', ['version', target, '--no-git-tag-version']);
    run('npm', ['run', 'build']);
    run('npx', ['@vscode/vsce', 'package']);

    const version = getPackageVersion();
    console.log(`Release artifact generated: documentic-markdown-${version}.vsix`);
}

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
}
