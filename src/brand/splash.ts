import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brand } from './colors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };

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
