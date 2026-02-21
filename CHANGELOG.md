# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [0.1.2] - 2026-02-21

### Added

- `vsix:update` npm command for one-shot patch bump + build + VSIX packaging.
- Release script help output now includes a quick updater command hint.

### Changed

- Release automation script now executes `npm` / `npx` directly (`npm.cmd` / `npx.cmd` on Windows) instead of using shell execution.

### Fixed

- Removed shell-execution deprecation warning from the release helper path on Windows environments.

## [0.1.1] - 2026-02-21

### Added

- Export formats: PDF / HTML / PNG and diagram block batch export (SVG / PNG).
- Diagram rendering support for Mermaid, PlantUML/UML (via Kroki), and other Kroki-supported languages.
- Math block rendering for `tex` / `latex` using MathJax.
- Test fixture export script to generate artifacts from `test-fixtures` in one run.
- Fixture export scenario matrix (`online/offline` x `low/medium/high`) and filters (`--network`, `--quality`) plus cleanup flag (`--clean`).
- Release helper command to bump version and regenerate VSIX in one command.

### Changed

- Extension naming unified to Documentic Markdown.
- Settings descriptions and configuration labels localized (English / Japanese).
- Security-related settings clarified and expanded (`untrustedMarkdownProtection`, `allowRawHtml`, `includeKroki`).
- Packaging setup improved for release (`.vscodeignore`, repository metadata, activation events).

### Fixed

- Mermaid rendering fallback issues in packaged/runtime execution paths.
- Kroki source normalization differences (line break handling).
- MathJax SVG glyph/definition issues in exported diagrams.
- Long-page PNG export artifacts via segmented capture and stitching.
- Output auto-open behavior on Windows.

### Notes

- VSIX artifact name follows the package version (e.g. `documentic-markdown-0.1.1.vsix`).
