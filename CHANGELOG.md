# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-04-25

### Added

- Initial Node + TypeScript CLI scaffold (`hex` binary).
- Brand surface: hexagonal cell glyphs (`⬢` `⬡` `⬣`) with ASCII fallback (`[#]` `[ ]` `[!]`), honey-tinted splash, picocolors-based palette.
- Terminal capability detection (Unicode via locale, ANSI colour, TTY) honouring `NO_COLOR`, `HEX_FORCE_ASCII`, `HEX_FORCE_UNICODE`.
- `hex --version` and `hex --help`.
- `hex doctor` — prints runtime info and a glyph-rendering check.
- Build pipeline: tsup (esbuild) bundling to ESM for Node 20+.
- Dev tooling: vitest (tests), biome (lint + format), tsx (dev runner), strict TypeScript.
