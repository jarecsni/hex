# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] — 2026-04-25

### Changed

- Package renamed from `hex` to `@hexology/hex`. The `@hexology` scope is reserved for related tools (CLI, future component libraries, marketplace client). The bin command remains `hex`.
- Splash redrawn as a font-independent ASCII honeycomb (5 tessellated cells using `/`, `\`, `_`); no longer relies on Unicode `⬢`/`⬡`/`⬣` glyphs that fall back to circles in fonts without those codepoints.
- Brand surface now shows "hex {version} — Application Stack Composer" plus a pitch line beside the splash on every entry point (`doctor`, `--help`, default help). VERSION + tagline + pitch live in `brand/splash.ts` so any new surface that calls `splash()` inherits them.
- `hex doctor` trimmed — drops the TTY / Unicode glyphs / ANSI colours capability rows; keeps Node, Platform, Terminal.
- CLI emits a single trailing newline only when stdout is a TTY, so interactive output ends with one breathing line before the prompt while piped/redirected output stays clean.

### Removed

- `program.description` from the root commander setup — the splash pitch covers it, and Commander was rendering it verbatim under the splash in `--help`.

## [0.1.0] — 2026-04-25

### Added

- Initial Node + TypeScript CLI scaffold (`hex` binary).
- Brand surface: hexagonal cell glyphs (`⬢` `⬡` `⬣`) with ASCII fallback (`[#]` `[ ]` `[!]`), honey-tinted splash, picocolors-based palette.
- Terminal capability detection (Unicode via locale, ANSI colour, TTY) honouring `NO_COLOR`, `HEX_FORCE_ASCII`, `HEX_FORCE_UNICODE`.
- `hex --version` and `hex --help`.
- `hex doctor` — prints runtime info and a glyph-rendering check.
- Build pipeline: tsup (esbuild) bundling to ESM for Node 20+.
- Dev tooling: vitest (tests), biome (lint + format), tsx (dev runner), strict TypeScript.
