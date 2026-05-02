import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brand } from './colors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findPackageJson(start: string): string {
  // Walk up until package.json is found. Works in both the bundled case
  // (dist/cli.js, repo root one level up) and the tsx-from-source case
  // (src/brand/splash.ts, repo root two levels up).
  let dir = start;
  while (true) {
    const candidate = resolve(dir, 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('package.json not found above splash module');
    dir = parent;
  }
}

const pkg = JSON.parse(readFileSync(findPackageJson(__dirname), 'utf-8')) as { version: string };

export const VERSION = pkg.version;
const TAGLINE = 'Application Stack Composer';
const PITCH = 'Compose your application stack using templated components and recipes.';

export function splash(): string {
  const e = brand.honey;
  const title = `${brand.bold(`hex ${VERSION}`)}  ${brand.dim(`—  ${TAGLINE}`)}`;
  const subtitle = brand.dim(PITCH);
  return [
    `      ${e('__    __')}`,
    `   ${e('__/  \\__/  \\')}`,
    `  ${e('/  \\__/  \\__/')}`,
    `  ${e('\\__/  \\__/')}      ${title}`,
    `     ${e('\\__/')}         ${subtitle}`,
  ].join('\n');
}
