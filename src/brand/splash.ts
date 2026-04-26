import { brand } from './colors.js';

export const VERSION = '0.1.1';
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
